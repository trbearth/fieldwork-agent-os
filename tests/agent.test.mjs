import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("latest report has inspectable scoring and citations", async () => {
  const report = JSON.parse(await readFile(new URL("../data/latest.json", import.meta.url)));
  assert.ok(report.run.generatedAt);
  assert.ok(report.signals.length >= 1);
  for (const signal of report.signals) {
    assert.ok(["emerging", "accelerating", "saturated"].includes(signal.stage));
    assert.ok(signal.score >= 0 && signal.score <= 100);
    assert.ok(signal.confidence >= 0 && signal.confidence <= 100);
    assert.ok(signal.youthRelevance >= 0 && signal.youthRelevance <= 100);
    assert.ok(Array.isArray(signal.citations));
    for (const citation of signal.citations) assert.match(citation.url, /^https?:\/\//);
  }
});

test("source configuration uses feeds and identifies the agent", async () => {
  const config = JSON.parse(await readFile(new URL("../config/sources.json", import.meta.url)));
  assert.match(config.userAgent, /FieldworkAgentOS/);
  assert.ok(config.requestDelayMs >= 1000);
  assert.ok(config.sources.every((source) => source.type === "rss"));
});

test("social connectors are explicit about permission state", async () => {
  const config = JSON.parse(await readFile(new URL("../config/social-sources.json", import.meta.url)));
  const mastodon = config.networks.find((network) => network.id === "mastodon");
  const bluesky = config.networks.find((network) => network.id === "bluesky");
  const youtube = config.networks.find((network) => network.id === "youtube");
  const tiktok = config.networks.find((network) => network.id === "tiktok");
  const reddit = config.networks.find((network) => network.id === "reddit");
  assert.equal(mastodon.type, "mastodon_public_hashtag");
  assert.equal(mastodon.enabled, true);
  assert.equal(mastodon.credentials, null);
  assert.equal(bluesky.type, "bluesky_authenticated");
  assert.deepEqual(bluesky.credentials, ["BLUESKY_HANDLE", "BLUESKY_APP_PASSWORD"]);
  assert.equal(bluesky.optional, true);
  assert.equal(youtube.credentials, "YOUTUBE_API_KEY");
  assert.equal(youtube.optional, true);
  assert.equal(tiktok.enabled, false);
  assert.equal(reddit.enabled, false);
  assert.match(tiktok.reason, /approval/i);
  assert.match(reddit.reason, /approval/i);
});

test("agent registry has unique modular entry points", async () => {
  const registry = JSON.parse(await readFile(new URL("../agents/registry.json", import.meta.url)));
  const ids = registry.agents.map((agent) => agent.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(registry.agents.every((agent) => agent.entry.endsWith(".mjs")));
  assert.ok(registry.agents.every((agent) => agent.enabled));
});
