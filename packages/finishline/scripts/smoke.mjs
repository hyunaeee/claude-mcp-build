// Spawns the built server against a throwaway project and walks the full lifecycle.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dir = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "finishline-"));
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "demo", version: "0.1.0", dependencies: { express: "^4.17.0" } }));
mkdirSync(join(dir, "src"), { recursive: true });
writeFileSync(join(dir, "src/app.js"), "// TODO: handle errors\nconsole.log('hi')\n");

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: [resolve("dist/index.js")], cwd: dir, env: process.env }));
const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } };

const tools = (await client.listTools()).tools;
console.log("tools:", tools.map((t) => t.name).join(", "));
assert(tools.find((t) => t.name === "status")?._meta?.ui?.resourceUri === "ui://finishline/dashboard.html", "status declares UI resource");
const res = await client.readResource({ uri: "ui://finishline/dashboard.html" });
assert(res.contents[0].mimeType === "text/html;profile=mcp-app", "resource mime type");

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  assert(!r.isError, `${name} failed: ${r.content?.[0]?.text}`);
  return r;
};

await call("start_project", {
  title: "Recipe Box",
  why: "Stop losing family recipes in chat threads",
  done_when: ["Family can add and search recipes on their phones", "Deployed at a public URL"],
  out_of_scope: ["Meal planning", "Native apps"],
  target_date: "2026-11-30",
  milestones: [
    { title: "Rough end-to-end", tasks: ["Add recipe form", "List recipes", "Deploy a first version"] },
    { title: "Make it useful", tasks: ["Search", "Photo upload", "Mobile layout polish"] },
  ],
});
const dup = await client.callTool({ name: "start_project", arguments: { title: "x", why: "x", done_when: ["x"], milestones: [{ title: "a", tasks: ["b"] }] } });
assert(dup.isError, "refuses to overwrite an existing plan");

let s = await call("status");
assert(s.structuredContent.next.taskId === "t2", "first next action is the first task");

await call("update_plan", { changes: [{ id: "t2", action: "done" }, { id: "t3", action: "start" }] });
const up = await call("update_plan", {
  changes: [{ id: "t3", action: "done" }, { id: "t4", action: "done", note: "on Fly.io" }],
  add: [{ title: "Meal planner calendar" }, { title: "Shopping list export" }, { title: "Recipe import from URL" }],
  session_note: "First version is live",
});
console.log(up.content[0].text, "\n---");
assert(/Milestone complete: Rough end-to-end/.test(up.content[0].text), "celebrates milestone");
assert(/Parked/.test(up.content[0].text), "parks new ideas");

const ship = await call("ship_check");
console.log(ship.content[0].text, "\n---");

s = await call("status");
console.log(s.content[0].text);
assert(s.structuredContent.later.length === 3, "3 parked ideas");
assert(s.structuredContent.warnings.some((w) => w.kind === "scope"), "scope creep warning");
assert(existsSync(join(dir, ".finishline/dashboard.html")), "dashboard written");
console.log("\nOK. Project dir:", dir);
await client.close();
