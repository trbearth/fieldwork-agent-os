import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const checks = [];

async function check(label, run) {
  try {
    await run();
    checks.push({ label, ok: true });
  } catch (error) {
    checks.push({ label, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

await check("Running inside the Fieldwork folder", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (manifest.name !== "fieldwork-agent-os") throw new Error("Open Terminal in the cloned fieldwork-agent-os folder first.");
});

await check("Supported Node.js version", async () => {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) throw new Error(`Node ${process.versions.node} found; Node 22 or newer is required.`);
});

for (const relative of [
  "agents/registry.json",
  "config/workspace.json",
  "config/sources.json",
  "config/social-sources.json",
  "config/taxonomy.json",
]) {
  await check(`${relative} is valid`, async () => {
    JSON.parse(await readFile(path.join(root, relative), "utf8"));
  });
}

await check("Dependencies installed", () => access(path.join(root, "node_modules")));

console.log("\nFieldwork system check\n");
for (const result of checks) {
  console.log(`${result.ok ? "✓" : "✗"} ${result.label}${result.detail ? ` — ${result.detail}` : ""}`);
}

const failures = checks.filter((result) => !result.ok);
if (failures.length) {
  console.log("\nFix the items marked ✗, then run npm run doctor again.");
  process.exitCode = 1;
} else {
  console.log("\nEverything required is ready. Run: npm run agents:fixture");
}
