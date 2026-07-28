import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const fashion = JSON.parse(await readFile(path.join(root, "data/latest.json"), "utf8"));
const social = JSON.parse(await readFile(path.join(root, "data/social-latest.json"), "utf8"));
const overlap = fashion.signals.filter((signal) => social.signals.some((socialSignal) => socialSignal.id === signal.id));
const candidates = overlap.length
  ? overlap
  : [...fashion.signals, ...social.signals].filter((signal, index, all) => all.findIndex((item) => item.id === signal.id) === index).slice(0, 3);
const proposal = [
  `# Fieldwork Synthesis Scout — ${new Date().toISOString().slice(0, 10)}`,
  "",
  overlap.length ? "## Cross-source candidates" : "## Adjacent candidates to review",
  "",
  ...candidates.slice(0, 3).map((signal, index) => {
    const publication = fashion.signals.find((item) => item.id === signal.id)?.score;
    const conversation = social.signals.find((item) => item.id === signal.id)?.score;
    return `${index + 1}. **${signal.name}** — publication ${publication ?? "no current evidence"}; public conversation ${conversation ?? "no current evidence"}.`;
  }),
  "",
  "Human curation required: select one thesis, define the customer and price ceiling, then research actual products and availability.",
].join("\n");
await writeFile(path.join(root, "public/exports/batch-proposal.md"), proposal);
console.log(JSON.stringify({ ok: true, candidates: candidates.length, crossSource: overlap.length }));
process.exit(0);
