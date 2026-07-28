# Fieldwork

Fieldwork is a local-first desktop workspace for running small research agents, seeing what is active, and reading cited reports without living in a terminal.

It is intentionally domain-neutral. The repository includes a **fashion-signal example pack** so the app has real data on first launch. Replace its sources, signal taxonomy, social queries, labels, and agents to use Fieldwork for markets, sales, recruiting, policy, customer research, content, or another workflow.

## What works without an API key

- Run every enabled agent or one agent at a time.
- Collect bounded public RSS/Atom inputs.
- Check public Mastodon hashtag timelines.
- Classify signals as emerging, accelerating, or saturated.
- Score confidence and audience relevance.
- Keep local history.
- Read cited reports in the desktop app.
- Export Markdown, JSON, and Notion-ready CSV.
- Run the full product with deterministic fixture data while offline.

Voice is the only feature that requires an OpenAI API key. Bluesky and YouTube are optional expansion sources and quietly skip themselves when credentials are absent.

## Quick start

Requirements: macOS and Node.js 22.13 or newer.

Open Terminal and run:

```bash
git clone https://github.com/trbearth/fieldwork-agent-os.git
cd fieldwork-agent-os
npm install
npm run doctor
npm run agents:fixture
npm run desktop
```

The `cd fieldwork-agent-os` line matters: commands must run inside the folder containing `package.json`.

Fieldwork opens in its own native window. It uses a private loopback service internally, but you do not need to open or manage a localhost page.

After the first build, reopen it with:

```bash
npm run desktop:open
```

Build a draggable macOS app:

```bash
npm run desktop:package
```

The app will be under `dist-desktop/mac-arm64/Fieldwork.app` on Apple Silicon.

## Make it yours

The fastest customization path uses five files:

| File | What it controls |
|---|---|
| `config/workspace.json` | Product name, mark, owner label, workspace label |
| `config/sources.json` | RSS/Atom sources, weights, rate limits, user agent |
| `config/taxonomy.json` | The signals and audience-language the monitor recognizes |
| `config/social-sources.json` | Public conversation queries and permissioned connectors |
| `data/command-center.json` | Agent descriptions, starter brief, reports, source cards |

Then run:

```bash
npm run agents:fixture
npm test
npm run desktop
```

Read [Customize Fieldwork](docs/CUSTOMIZE.md) for a complete walkthrough and [Create an agent](docs/CREATE_AN_AGENT.md) for the module contract.

## Included example agents

- **Signal Monitor** reads configured feeds, keeps historical observations, scores evidence, and creates a cited daily register.
- **Public Pulse** measures configured topics across allowed public social APIs.
- **Synthesis Scout** combines saved evidence into a narrow, human-reviewable experiment.

The names are display labels. Agent execution is controlled by `agents/registry.json`.

```text
agents/registry.json
       │
       ▼
agents/run-all.mjs ────── runs enabled modules separately
       │
       ├── Signal Monitor ── RSS/Atom ─────── data/latest.json
       ├── Public Pulse ─── permissioned APIs ─ data/social-latest.json
       └── Synthesis Scout ─ saved reports ─── public/exports/
                                                   │
                                                   ▼
                                         Fieldwork desktop app
```

Run the agents:

```bash
npm run agents
npm run agent -- fashion-intelligence
npm run agent -- social-pulse
npm run agent -- batch-scout
```

The first internal ID remains `fashion-intelligence` for compatibility with the included example pack. You can rename it when creating your own module.

## Optional voice

Copy the example environment file:

```bash
cp .env.example .env.local
```

Add:

```dotenv
OPENAI_API_KEY=your_key_here
OPENAI_REALTIME_MODEL=gpt-realtime-mini
OPENAI_VOICE=marin
```

Restart the app and use the Voice control. The browser surface sends its WebRTC offer to the local server route; the API key stays server-side and is never bundled into client code.

For a packaged app, place `.env.local` at:

```text
~/Library/Application Support/Fieldwork/.env.local
```

Never rename the key to `NEXT_PUBLIC_OPENAI_API_KEY`.

## Optional public-source expansion

`config/social-sources.json` documents every connector and its permission state.

| Network | Method | Default |
|---|---|---|
| Mastodon | Public hashtag timeline | Enabled; no key |
| Bluesky | Official authenticated search | Optional |
| YouTube | Official Data API v3 | Optional |
| TikTok | Research API | Disabled; approval required |
| Reddit | Data API | Disabled; approval required |
| Instagram | Graph API | Disabled; business permissions required |

Optional credentials go in `.env.local`:

```dotenv
BLUESKY_HANDLE=your-handle.bsky.social
BLUESKY_APP_PASSWORD=your-app-password
YOUTUBE_API_KEY=your_restricted_key
```

Fieldwork does not scrape logged-in pages, reuse browser cookies, bypass access controls, or treat a social post as proof of demand.

## Daily GitHub run

The included workflow runs at 12:00 UTC and commits updated reports back to the repository.

1. Open the repository’s **Actions** tab.
2. Select **Fieldwork Daily Run**.
3. Choose **Run workflow**.
4. Keep Actions enabled for scheduled runs.

Add optional source credentials under **Settings → Secrets and variables → Actions**. Voice is not used by the scheduled workflow.

## Report contract

The UI expects saved JSON reports to include:

- run metadata and generation time;
- source/network status;
- signals with a stable ID and name;
- stage, score, confidence, and relevance values from 0–100;
- a short evidence statement;
- citations with public URLs.

Scores are directional research aids, not sales forecasts or demographic facts. Review original sources before publishing a claim or making a commercial decision.

## Security and source policy

- Secrets stay in ignored `.env.local` files or encrypted GitHub secrets.
- Collection uses feeds or documented APIs with bounded requests and delays.
- Optional connectors fail closed.
- Full articles, private data, login sessions, faces, and bodies are not collected.
- Citations remain attached to observations.
- Human review is required for forecasts and commercial decisions.

See [Security](SECURITY.md) before adding a connector.

## Project map

```text
app/                 desktop interface and local API routes
desktop/             native Electron shell
agent/               example source-monitor engine
agents/              agent registry, runner, and modules
config/              workspace, source, taxonomy, and social configuration
data/                saved local report state
public/exports/       portable Markdown, JSON, and CSV
tests/                contract and safety tests
docs/                 setup and extension guides
```

## License

MIT. Build your own internal version, ship a specialized fork, or contribute a reusable agent.
