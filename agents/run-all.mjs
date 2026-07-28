import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const registry = JSON.parse(await readFile(path.join(root, "agents/registry.json"), "utf8"));
const requested = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const fixture = process.argv.includes("--fixture");
const selected = registry.agents.filter((agent) => agent.enabled && (!requested || agent.id === requested));

if (requested && selected.length === 0) {
  console.error(`Unknown or disabled agent: ${requested}`);
  process.exit(1);
}

for (const agent of selected) {
  console.log(`\n[agent:${agent.id}] starting`);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [agent.entry, ...(fixture ? ["--fixture"] : [])], { cwd: root, stdio: "inherit", env: process.env });
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${agent.id} exited ${code}`)));
  });
}
