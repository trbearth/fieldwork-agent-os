import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const dryRun = process.argv.includes("--fixture");
const sourcesConfig = JSON.parse(await readFile(path.join(root, "config/sources.json"), "utf8"));
const taxonomy = JSON.parse(await readFile(path.join(root, "config/taxonomy.json"), "utf8"));
const historyPath = path.join(root, "data/history.json");
const history = JSON.parse(await readFile(historyPath, "utf8"));
const historyItems = dryRun ? [] : history.items.filter((item) => {
  try {
    return new URL(item.url).hostname !== "example.com";
  } catch {
    return false;
  }
});

const decode = (value = "") =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

function tag(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match) return decode(match[1]);
  }
  return "";
}

function parseFeed(xml, source) {
  const blocks = [
    ...(xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? []),
    ...(xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? []),
  ];
  return blocks.slice(0, sourcesConfig.maxItemsPerSource).map((block) => {
    const atomHref = block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1];
    const title = tag(block, ["title"]);
    const url = tag(block, ["link", "guid"]) || atomHref || source.url;
    const published = tag(block, ["pubDate", "published", "updated", "dc:date"]);
    const description = tag(block, ["description", "summary", "content", "content:encoded"]);
    return {
      id: createHash("sha1").update(`${source.id}:${url}:${title}`).digest("hex").slice(0, 16),
      sourceId: source.id,
      sourceName: source.name,
      sourceWeight: source.weight,
      title,
      url,
      publishedAt: Number.isNaN(Date.parse(published)) ? new Date().toISOString() : new Date(published).toISOString(),
      collectedAt: new Date().toISOString(),
      text: `${title} ${description}`.slice(0, 2500),
    };
  }).filter((item) => item.title && item.url);
}

async function collectSource(source) {
  if (dryRun) {
    const xml = await readFile(path.join(root, "agent/fixtures/sample-feed.xml"), "utf8");
    return parseFeed(xml, source);
  }
  const response = await fetch(source.url, {
    headers: {
      "user-agent": sourcesConfig.userAgent,
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  const looksLikeFeed = /<(rss|feed)(?:\s|>)/i.test(body);
  if (!contentType.includes("xml") && !contentType.includes("rss") && !contentType.includes("atom") && !looksLikeFeed) {
    throw new Error(`Unexpected content type: ${contentType || "unknown"}`);
  }
  return parseFeed(body, source);
}

const enabledSources = sourcesConfig.sources.filter((source) => source.enabled);
const collected = [];
const sourceResults = [];
for (const source of enabledSources) {
  try {
    const items = await collectSource(source);
    collected.push(...items);
    sourceResults.push({ source: source.name, status: "ok", count: items.length });
  } catch (error) {
    sourceResults.push({ source: source.name, status: "error", error: error.message });
  }
  if (!dryRun) await new Promise((resolve) => setTimeout(resolve, sourcesConfig.requestDelayMs));
}

const knownIds = new Set(historyItems.map((item) => item.id));
const newItems = collected.filter((item) => !knownIds.has(item.id));
const allItems = [...historyItems, ...newItems]
  .filter((item) => Date.now() - Date.parse(item.publishedAt) < 90 * 86400000)
  .slice(-5000);

function observationsFor(signal, windowDays) {
  const cutoff = Date.now() - windowDays * 86400000;
  return allItems.filter((item) => {
    if (Date.parse(item.publishedAt) < cutoff) return false;
    const title = item.title.toLowerCase();
    const haystack = item.text.toLowerCase();
    const matches = signal.terms.filter((term) => haystack.includes(term.toLowerCase()));
    return signal.terms.some((term) => title.includes(term.toLowerCase())) || matches.length >= 2;
  });
}

function clamp(value) { return Math.max(0, Math.min(100, Math.round(value))); }

const scored = taxonomy.signals.map((signal) => {
  const current = observationsFor(signal, 7);
  const recent14 = observationsFor(signal, 14);
  const prior = recent14.filter((item) => Date.parse(item.publishedAt) < Date.now() - 7 * 86400000);
  const sourceCount = new Set(current.map((item) => item.sourceId)).size;
  const weightedMentions = current.reduce((sum, item) => sum + item.sourceWeight, 0);
  const velocity = prior.length === 0 ? (current.length ? 1 : 0) : (current.length - prior.length) / prior.length;
  const youthHits = current.reduce((sum, item) => {
    const text = item.text.toLowerCase();
    return sum + taxonomy.youthTerms.filter((term) => text.includes(term)).length;
  }, 0);
  const novelty = Math.max(0, 1 - recent14.length / 35);
  const score = clamp(weightedMentions * 7 + sourceCount * 9 + Math.max(0, velocity) * 16 + novelty * 12);
  const confidence = clamp(sourceCount * 14 + Math.min(current.length, 10) * 4 + Math.min(recent14.length, 20));
  const youthRelevance = clamp(35 + youthHits * 8 + Math.min(current.length, 8) * 3);
  const citationItems = [...new Map(current.map((item) => [item.sourceId, item])).values()].slice(0, 3);
  const stage =
    recent14.length >= 18 && sourceCount >= 3 ? "saturated" :
    current.length >= 5 && sourceCount >= 3 && velocity > 0 ? "accelerating" :
    "emerging";
  return {
    id: signal.id,
    name: signal.name,
    stage,
    score,
    confidence,
    youthRelevance,
    direction: velocity > 0.2 ? "up" : velocity < -0.2 ? "down" : "flat",
    thesis: stage === "saturated"
      ? `${signal.name} is broadly visible; the opportunity is now in narrower, more specific interpretations.`
      : sourceCount
        ? `${signal.name} is appearing across ${sourceCount} independent public source${sourceCount === 1 ? "" : "s"}.`
        : `${signal.name} has too little independent public evidence.`,
    whyNow: `${current.length} mention${current.length === 1 ? "" : "s"} this week versus ${prior.length} in the prior seven-day window.`,
    evidence: `${current.length} observation${current.length === 1 ? "" : "s"} · ${sourceCount} independent source${sourceCount === 1 ? "" : "s"} · ${velocity >= 0 ? "+" : ""}${Math.round(velocity * 100)}% seven-day velocity`,
    citations: citationItems.map((item) => ({
      title: item.title,
      source: item.sourceName,
      date: new Date(item.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      url: item.url,
    })),
  };
}).filter((signal) => signal.citations.length > 0).sort((a, b) => b.score - a.score);

const now = new Date();
const top = scored[0];
const cooling = [...scored].filter((item) => item.direction !== "up").sort((a, b) => b.score - a.score)[0];
const report = {
  run: {
    id: now.toISOString().slice(0, 10),
    mode: dryRun ? "fixture" : "live",
    displayDate: now.toLocaleString("en-US", { timeZone: "America/New_York", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).toUpperCase(),
    generatedAt: now.toISOString(),
    itemsCollected: newItems.length,
    sourcesRead: sourceResults.filter((result) => result.status === "ok").length,
    sourceResults,
  },
  summary: top
    ? `${top.name} leads today’s evidence-weighted register. Treat the result as a research prompt: inspect the citations before making a curation decision.`
    : "No configured signal crossed the evidence threshold today. Review sources and taxonomy coverage.",
  signals: scored.slice(0, 8),
  cooling: cooling
    ? { name: cooling.name, reason: cooling.whyNow }
    : { name: "No reliable cooling signal", reason: "More history is required." },
  prediction: {
    title: top ? `${top.name} moves outward` : "Insufficient evidence",
    body: top ? `If source diversity and velocity persist for two more runs, test ${top.name.toLowerCase()} in a small experiment rather than treating it as a forecasted fact.` : "Collect at least seven daily runs before forecasting."
  },
  batch: {
    code: `AUTO ${now.toISOString().slice(5, 10).replace("-", "")}`,
    name: top?.name ?? "Hold",
    thesis: top ? `A deliberately small, evidence-checking batch built around ${top.name.toLowerCase()}.` : "No batch recommendation today.",
    objects: top?.citations.map((citation) => citation.title).slice(0, 4) ?? [],
  }
};

await mkdir(path.join(root, "public/exports"), { recursive: true });
await writeFile(path.join(root, "data/latest.json"), JSON.stringify(report, null, 2) + "\n");
if (!dryRun) {
  await writeFile(historyPath, JSON.stringify({
    runs: [...history.runs.filter((run) => run.mode !== "fixture"), { ...report.run, signalScores: scored.map(({ id, score, stage }) => ({ id, score, stage })) }].slice(-365),
    items: allItems,
  }, null, 2) + "\n");
}

const markdown = [
  `# Fieldwork Daily Signal — ${report.run.id}`,
  "",
  report.summary,
  "",
  ...report.signals.flatMap((signal, index) => [
    `## ${index + 1}. ${signal.name}`,
    "",
    `**${signal.stage} · score ${signal.score} · confidence ${signal.confidence}% · youth ${signal.youthRelevance}%**`,
    "",
    signal.thesis,
    "",
    signal.evidence,
    "",
    ...signal.citations.map((citation) => `- [${citation.title}](${citation.url}) — ${citation.source}, ${citation.date}`),
    "",
  ]),
  "## Method note",
  "",
  "Scores are directional research aids, not factual claims or purchase forecasts. They combine mention count, independent-source diversity, seven-day velocity, source weights, and youth-language matches. Inspect cited originals before acting.",
].join("\n");
await writeFile(path.join(root, "public/exports/latest-report.md"), markdown);
await writeFile(path.join(root, "public/exports/latest.json"), JSON.stringify(report, null, 2) + "\n");

const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csv = [
  ["Name", "Stage", "Signal Score", "Confidence", "Youth Relevance", "Direction", "Thesis", "Evidence", "Citation 1", "Citation 2"],
  ...report.signals.map((signal) => [
    signal.name, signal.stage, signal.score, signal.confidence, signal.youthRelevance,
    signal.direction, signal.thesis, signal.evidence, signal.citations[0]?.url, signal.citations[1]?.url,
  ])
].map((row) => row.map(csvCell).join(",")).join("\n");
await writeFile(path.join(root, "public/exports/notion-signals.csv"), csv + "\n");

await mkdir(path.join(root, "outputs"), { recursive: true });
await copyFile(path.join(root, "public/exports/latest-report.md"), path.join(root, "outputs/fieldwork-daily-signal.md"));
console.log(JSON.stringify({ ok: true, dryRun, newItems: newItems.length, signals: scored.length, sourceResults }, null, 2));
process.exit(0);
