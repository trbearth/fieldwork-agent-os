import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const fixture = process.argv.includes("--fixture");
const config = JSON.parse(await readFile(path.join(root, "config/social-sources.json"), "utf8"));
const taxonomy = JSON.parse(await readFile(path.join(root, "config/taxonomy.json"), "utf8"));
const prior = JSON.parse(await readFile(path.join(root, "data/social-latest.json"), "utf8"));
const observations = [];
const networkStatus = [];

const sleep = () => new Promise((resolve) => setTimeout(resolve, config.requestDelayMs));
const plainText = (value = "") => value
  .replace(/<br\s*\/?>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/\s+/g, " ")
  .trim();

function missingCredentials(network) {
  if (!network.credentials) return [];
  const names = Array.isArray(network.credentials) ? network.credentials : [network.credentials];
  return names.filter((name) => !process.env[name]);
}

async function collectMastodon(network, query) {
  if (fixture) {
    return [
      { network: "Mastodon", text: `${query.hashtag} outfit notes from an independent fashion community`, url: `https://mastodon.social/tags/${query.hashtag}`, publishedAt: new Date().toISOString(), engagement: 12 },
      { network: "Mastodon", text: `new styling reference tagged ${query.hashtag}`, url: `https://mastodon.social/tags/${query.hashtag}`, publishedAt: new Date().toISOString(), engagement: 7 },
    ];
  }
  let lastError = "Public Mastodon timeline unavailable";
  for (const baseUrl of network.baseUrls) {
    try {
      const url = new URL(`/api/v1/timelines/tag/${encodeURIComponent(query.hashtag)}`, baseUrl);
      url.searchParams.set("limit", String(Math.min(config.maxResultsPerQuery, 40)));
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": config.userAgent },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        lastError = `Mastodon ${response.status}`;
        continue;
      }
      const data = await response.json();
      return data.filter((item) => !item.sensitive && (!item.language || item.language === "en")).map((item) => ({
        network: "Mastodon",
        text: plainText(`${item.spoiler_text ?? ""} ${item.content ?? ""}`),
        url: item.url ?? item.uri ?? `${baseUrl}/tags/${query.hashtag}`,
        publishedAt: item.created_at ?? new Date().toISOString(),
        engagement: (item.favourites_count ?? 0) + (item.reblogs_count ?? 0) * 2 + (item.replies_count ?? 0),
      })).filter((item) => {
        const text = item.text.toLowerCase();
        return item.text &&
          query.relevanceTerms.some((term) => text.includes(term)) &&
          !config.safetyExcludeTerms.some((term) => text.includes(term));
      }).slice(0, 12);
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  throw new Error(lastError);
}

async function createBlueskySession(network) {
  const identifier = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;
  if (!identifier || !password) throw new Error("Set BLUESKY_HANDLE and BLUESKY_APP_PASSWORD");
  const response = await fetch(new URL("/xrpc/com.atproto.server.createSession", network.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": config.userAgent },
    body: JSON.stringify({ identifier, password }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Bluesky sign-in ${response.status}`);
  const session = await response.json();
  if (!session.accessJwt) throw new Error("Bluesky did not return an access token");
  return session.accessJwt;
}

async function collectBluesky(network, query) {
  if (fixture) {
    return [
      { network: "Bluesky", text: `${query.query} spotted in a vintage low-profile outfit`, url: `https://bsky.app/search?q=${encodeURIComponent(query.query)}`, publishedAt: new Date().toISOString(), engagement: 18 },
      { network: "Bluesky", text: `new independent label showing ${query.query}`, url: `https://bsky.app/search?q=${encodeURIComponent(query.query)}`, publishedAt: new Date().toISOString(), engagement: 9 },
    ];
  }
  const accessToken = network.accessToken ?? await createBlueskySession(network);
  network.accessToken = accessToken;
  const url = new URL("/xrpc/app.bsky.feed.searchPosts", network.baseUrl);
  url.searchParams.set("q", query.query);
  url.searchParams.set("limit", String(config.maxResultsPerQuery));
  url.searchParams.set("sort", "latest");
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, "user-agent": config.userAgent },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Bluesky ${response.status}`);
  const data = await response.json();
  return (data.posts ?? []).map((item) => ({
    network: "Bluesky",
    text: item.record?.text ?? "",
    url: `https://bsky.app/profile/${item.author?.handle}/post/${item.uri?.split("/").pop()}`,
    publishedAt: item.record?.createdAt ?? new Date().toISOString(),
    engagement: (item.likeCount ?? 0) + (item.repostCount ?? 0) * 2 + (item.replyCount ?? 0),
  }));
}

async function collectYouTube(network, query) {
  const key = process.env[network.credentials];
  if (!key && !fixture) throw new Error(`Set ${network.credentials}`);
  if (fixture) {
    return [{ network: "YouTube", text: `${query.query} styling analysis`, url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query.query)}`, publishedAt: new Date().toISOString(), engagement: 25 }];
  }
  const publishedAfter = new Date(Date.now() - 7 * 86400000).toISOString();
  const searchUrl = new URL("/youtube/v3/search", "https://www.googleapis.com");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("order", "date");
  searchUrl.searchParams.set("maxResults", String(Math.min(config.maxResultsPerQuery, 25)));
  searchUrl.searchParams.set("publishedAfter", publishedAfter);
  searchUrl.searchParams.set("q", query.query);
  searchUrl.searchParams.set("key", key);
  const response = await fetch(searchUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`YouTube ${response.status}`);
  const data = await response.json();
  return (data.items ?? []).map((item) => ({
    network: "YouTube",
    text: `${item.snippet?.title ?? ""} ${item.snippet?.description ?? ""}`,
    url: `https://www.youtube.com/watch?v=${item.id?.videoId}`,
    publishedAt: item.snippet?.publishedAt ?? new Date().toISOString(),
    engagement: 1,
  }));
}

for (const network of config.networks) {
  if (!network.enabled) {
    networkStatus.push({ id: network.id, status: "gated", reason: network.reason });
    continue;
  }
  const missing = missingCredentials(network);
  if (!fixture && missing.length && network.optional) {
    networkStatus.push({ id: network.id, status: "optional", reason: `Add ${missing.join(" + ")} for extra coverage` });
    continue;
  }
  try {
    for (const query of config.queries) {
      const results = network.type === "mastodon_public_hashtag"
        ? await collectMastodon(network, query)
        : network.type === "bluesky_authenticated"
          ? await collectBluesky(network, query)
          : network.type === "youtube_data_api"
            ? await collectYouTube(network, query)
            : [];
      observations.push(...results.map((item) => ({ ...item, signalId: query.id })));
      if (!fixture) await sleep();
    }
    networkStatus.push({ id: network.id, status: "ready", reason: `${observations.filter((item) => item.network === network.name).length} observations` });
  } catch (error) {
    networkStatus.push({ id: network.id, status: "unavailable", reason: error.message });
  }
}

const scoredSignals = config.queries.map((query) => {
  const matching = observations.filter((item) => item.signalId === query.id);
  const networks = new Set(matching.map((item) => item.network)).size;
  const youthHits = matching.reduce((total, item) => total + taxonomy.youthTerms.filter((term) => item.text.toLowerCase().includes(term)).length, 0);
  const priorSignal = prior.signals.find((signal) => signal.id === query.id);
  const baseline = Math.max(1, Math.round((priorSignal?.score ?? matching.length) / 6));
  const velocity = Math.round(((matching.length - baseline) / baseline) * 100);
  const rawScore = Math.round(matching.length * 5 + networks * 14 + Math.min(20, youthHits * 3));
  const score = Math.max(0, Math.min(networks === 1 ? 72 : 100, rawScore));
  return {
    id: query.id,
    name: taxonomy.signals.find((signal) => signal.id === query.id)?.name ?? query.id,
    stage: matching.length >= 12 && networks >= 2 ? "accelerating" : "emerging",
    score,
    confidence: Math.min(100, 22 + networks * 18 + Math.min(30, matching.length * 2)),
    youthRelevance: Math.min(100, 45 + youthHits * 7 + matching.length),
    velocity,
    evidence: `${matching.length} public posts · ${networks} network${networks === 1 ? "" : "s"} · 7-day comparison`,
    citations: matching.sort((a, b) => b.engagement - a.engagement).slice(0, 4).map((item) => ({ title: item.text.slice(0, 100), url: item.url, network: item.network })),
  };
}).filter((signal) => signal.score > 0).sort((a, b) => b.score - a.score);
const signals = scoredSignals.length ? scoredSignals : prior.signals;

const report = {
  run: {
    id: `social-${new Date().toISOString().slice(0, 10)}`,
    mode: fixture ? "fixture" : scoredSignals.length ? "live" : "cached",
    generatedAt: new Date().toISOString(),
    postsCollected: observations.length,
    networksReady: networkStatus.filter((item) => item.status === "ready").length,
    usedPreviousReport: !scoredSignals.length,
  },
  signals,
  networkStatus,
};
await mkdir(path.join(root, "public/exports"), { recursive: true });
await writeFile(path.join(root, "data/social-latest.json"), JSON.stringify(report, null, 2) + "\n");
await writeFile(path.join(root, "public/exports/social-latest.json"), JSON.stringify(report, null, 2) + "\n");
const markdown = [
  `# Fieldwork Public Pulse — ${report.run.id.replace("social-", "")}`,
  "",
  ...signals.flatMap((signal, index) => [
    `## ${index + 1}. ${signal.name}`,
    "",
    `**${signal.stage} · score ${signal.score} · confidence ${signal.confidence}% · youth ${signal.youthRelevance}%**`,
    "",
    signal.evidence,
    "",
    ...signal.citations.map((citation) => `- [${citation.title}](${citation.url}) — ${citation.network}`),
    "",
  ]),
  "## Network status",
  "",
  ...networkStatus.map((network) => `- **${network.id}:** ${network.status} — ${network.reason}`),
  "",
  "Social scores indicate public conversation activity, not sales, identity, sentiment, or demographic truth.",
].join("\n");
await writeFile(path.join(root, "public/exports/social-report.md"), markdown);
console.log(JSON.stringify({ ok: true, fixture, observations: observations.length, signals: signals.length, networkStatus }, null, 2));
process.exit(0);
