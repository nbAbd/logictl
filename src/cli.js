#!/usr/bin/env node
// logictl - drive the Logi Options+ kiros agent from the command line.
//
// Usage:
//   logictl get <resource> [json-payload]
//   logictl set <resource> <json-payload>
//   logictl post|update|delete <resource> [json-payload]
//   logictl raw <VERB> <resource> [json-payload]
//   logictl watch <resource> [json-payload]      (SUBSCRIBE; Ctrl-C to stop)
//   logictl routes [filter]                      (list known resource routes)
//   logictl path                                 (print the agent socket path)
//
// Output is the agent's JSON reply, pretty-printed to stdout.
// Replies may contain device serial numbers and account data; redirect to a
// file rather than pasting terminal output into shared channels.

const fs = require("node:fs");
const path = require("node:path");
const { KirosClient, agentSocketPath, VERBS } = require("./protocol");

function usage(code = 0) {
  console.log(`logictl - Logi Options+ kiros agent client

  logictl get <resource> [json]
  logictl set <resource> <json>
  logictl post|update|delete <resource> [json]
  logictl raw <VERB> <resource> [json]
  logictl watch <resource> [json]      SUBSCRIBE, stream pushes until Ctrl-C
  logictl routes [filter]              list known resources (from routes.txt)
  logictl path                         print the agent socket path

Verbs: ${VERBS.join(" ")}`);
  process.exit(code);
}

function parsePayload(arg) {
  if (arg === undefined) return undefined;
  try {
    return JSON.parse(arg);
  } catch (e) {
    console.error(`invalid JSON payload: ${e.message}`);
    process.exit(2);
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "-h" || cmd === "--help") usage(0);

  if (cmd === "path") {
    console.log(agentSocketPath());
    return;
  }

  if (cmd === "routes") {
    const file = path.join(__dirname, "..", "routes.txt");
    let lines = [];
    try {
      lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    } catch {
      console.error(`routes.txt not found at ${file}`);
      process.exit(1);
    }
    const filter = rest[0];
    for (const l of lines) if (!filter || l.includes(filter)) console.log(l);
    return;
  }

  const verbMap = { get: "GET", set: "SET", post: "POST", update: "UPDATE", delete: "DELETE" };
  let verb, resource, payloadArg;

  if (cmd === "raw") {
    verb = (rest[0] || "").toUpperCase();
    resource = rest[1];
    payloadArg = rest[2];
  } else if (cmd === "watch") {
    verb = "SUBSCRIBE";
    resource = rest[0];
    payloadArg = rest[1];
  } else if (verbMap[cmd]) {
    verb = verbMap[cmd];
    resource = rest[0];
    payloadArg = rest[1];
  } else {
    console.error(`unknown command: ${cmd}`);
    usage(2);
  }

  if (!resource) {
    console.error("missing <resource>");
    process.exit(2);
  }
  const payload = parsePayload(payloadArg);

  const client = new KirosClient({ onClose: () => {} });
  try {
    await client.connect();
  } catch (e) {
    console.error(`cannot connect to agent socket (${agentSocketPath()}): ${e.code || e.message}`);
    console.error("Is Logi Options+ running? Start logioptionsplus.app, then retry.");
    process.exit(1);
  }

  if (verb === "SUBSCRIBE") {
    console.error(`# watching ${resource} (Ctrl-C to stop)`);
    client.subscribe(resource, (reply) => console.log(JSON.stringify(reply)));
    process.on("SIGINT", () => {
      client.close();
      process.exit(0);
    });
    return; // stay open
  }

  try {
    const reply = await client.request(verb, resource, payload);
    console.log(JSON.stringify(reply, null, 2));
    process.exitCode = reply && typeof reply.status === "number" && reply.status >= 400 ? 1 : 0;
  } catch (e) {
    console.error(`request failed: ${e.message}`);
    process.exitCode = 1;
  } finally {
    client.close();
  }
}

main();
