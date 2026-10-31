// Spawns the built server over stdio and calls each tool once.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: process.env }));
console.log((await client.listTools()).tools.map((t) => t.name));

const show = (r) => console.log(r.content[0].text, "\n---");
show(await client.callTool({ name: "latest_version", arguments: { ecosystem: "npm", packages: ["react", "request", "@types/node", "no-such-pkg-zz9"] } }));
show(await client.callTool({ name: "latest_version", arguments: { ecosystem: "pypi", packages: ["requests", "Django"] } }));

const dir = mkdtempSync(join(tmpdir(), "fresh-deps-"));
const pkg = join(dir, "package.json");
writeFileSync(pkg, JSON.stringify({ dependencies: { react: "^17.0.2", lodash: "4.17.15", request: "^2.88.0", axios: "^1.7.0" }, devDependencies: { typescript: "^5.0.0" } }));
show(await client.callTool({ name: "check_deps", arguments: { path: pkg } }));
show(await client.callTool({ name: "check_deps", arguments: { filename: "requirements.txt", content: "django==3.2.0\nrequests>=2.20\nnumpy\n" } }));
show(await client.callTool({ name: "check_deps", arguments: { filename: "go.mod", content: "module x\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.7.0\n\tgolang.org/x/text v0.3.0 // indirect\n)\n" } }));
show(await client.callTool({ name: "check_deps", arguments: { filename: "Cargo.toml", content: '[dependencies]\nserde = "1.0"\ntokio = { version = "0.2", features = ["full"] }\n' } }));
await client.close();
