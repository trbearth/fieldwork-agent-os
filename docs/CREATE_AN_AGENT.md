# Create an agent

An agent is a small executable module plus a registry entry. It should own one bounded job and write inspectable output.

## 1. Create a module

Create `agents/competitor-monitor/run.mjs`.

```js
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const generatedAt = new Date().toISOString();

const report = {
  run: {
    id: generatedAt.slice(0, 10),
    generatedAt,
    mode: process.argv.includes("--fixture") ? "fixture" : "live"
  },
  signals: [
    {
      id: "example-change",
      name: "Example change",
      stage: "emerging",
      score: 40,
      confidence: 35,
      youthRelevance: 50,
      evidence: "One bounded example observation.",
      citations: []
    }
  ]
};

await mkdir(path.join(root, "data"), { recursive: true });
await mkdir(path.join(root, "public", "exports"), { recursive: true });
await writeFile(
  path.join(root, "data", "competitor-latest.json"),
  `${JSON.stringify(report, null, 2)}\n`
);
await writeFile(
  path.join(root, "public", "exports", "competitor-report.md"),
  `# Competitor Monitor\n\nGenerated ${generatedAt}\n`
);
```

## 2. Register it

Add an entry to `agents/registry.json`:

```json
{
  "id": "competitor-monitor",
  "name": "Competitor Monitor",
  "entry": "agents/competitor-monitor/run.mjs",
  "enabled": true,
  "schedule": null,
  "report": "public/exports/competitor-report.md"
}
```

## 3. Add it to the interface

Add its display metadata to `data/command-center.json`. The current interface has first-class detail views for the three included report shapes. A wholly new report shape also needs a rendering branch in `app/page.tsx`.

## 4. Add a fixture

Every networked agent should support `--fixture` and complete without contacting the internet. Keep fixture inputs small, deterministic, and free of real personal data.

## 5. Test the contract

Add a focused test under `tests/`, then run:

```bash
npm run agent -- competitor-monitor --fixture
npm test
```

## Agent rules

- Do one job.
- Use documented public APIs or feeds.
- Bound requests and add delays.
- Fail closed when credentials or permissions are absent.
- Never read browser cookies or session storage.
- Never write secrets into logs, reports, or fixtures.
- Attach public citations to claims.
- Label inference and uncertainty.
- Keep human review in the workflow.
