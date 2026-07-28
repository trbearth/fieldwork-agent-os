# Customize Fieldwork

Fieldwork separates the workspace shell from the example research domain. You can change the product identity and monitored subject without rebuilding the dashboard architecture.

## Change the workspace identity

Edit `config/workspace.json`:

```json
{
  "name": "Northstar",
  "mark": "N.",
  "workspaceLabel": "Research desk",
  "ownerName": "Alex",
  "ownerInitials": "AR",
  "briefAudience": "founder"
}
```

Restart the desktop app after editing.

## Choose a research domain

Write one sentence before changing configuration:

> This workspace helps [person] notice [type of change] early enough to [decision].

Examples:

- A founder notices competitor positioning changes before planning a launch.
- A recruiter notices skill-demand changes before opening a role.
- A creator notices recurring audience questions before making a content calendar.
- A seller notices category and pricing shifts before sourcing inventory.

This sentence should determine your sources, taxonomy, and report language.

## Replace the feed sources

Edit `config/sources.json`.

Each source needs:

```json
{
  "id": "unique-source-id",
  "name": "Readable source name",
  "type": "rss",
  "url": "https://example.com/feed.xml",
  "weight": 0.8,
  "enabled": true
}
```

Use public RSS or Atom feeds offered by the publisher. Keep the request delay at 1,000 ms or more, keep the item cap bounded, and replace the contact address in `userAgent`.

Do not add a URL that requires login, cookies, a paywall bypass, or automated browser interaction.

## Replace the signal taxonomy

Edit `config/taxonomy.json`.

```json
{
  "signals": [
    {
      "id": "usage-based-pricing",
      "name": "Usage-based pricing",
      "terms": ["usage based pricing", "metered billing", "consumption pricing"]
    }
  ],
  "youthTerms": ["student", "campus", "gen z"]
}
```

The built-in field is named `youthTerms` because the example pack measures youth relevance. In another domain, use it as your target-audience vocabulary and rename the visible label in `app/page.tsx` if needed.

Good signals are specific enough to match evidence and broad enough to recur across independent sources.

## Replace public-conversation queries

Edit `config/social-sources.json`. For every query, provide:

- a stable ID;
- an API search query;
- a public hashtag for no-key Mastodon coverage;
- relevance terms used to filter noise.

Keep gated networks disabled until you have official access and the intended use is permitted.

## Update the starter dashboard language

Edit `data/command-center.json` to change:

- the brief and recommended action;
- display names and missions;
- schedules and starter statuses;
- report rows;
- source cards.

This file provides the initial presentation layer. Live signal and source counts come from the saved agent reports.

## Rename or replace agents

Edit `agents/registry.json`. A registry entry contains:

```json
{
  "id": "competitor-monitor",
  "name": "Competitor Monitor",
  "entry": "agents/competitor-monitor/run.mjs",
  "enabled": true,
  "schedule": "0 12 * * *",
  "report": "public/exports/competitor-report.md"
}
```

Then follow [CREATE_AN_AGENT.md](CREATE_AN_AGENT.md).

## Validate every change

```bash
npm run doctor
npm run agents:fixture
npm test
npm run build
```

Open the app only after these complete:

```bash
npm run desktop
```

## Keep your fork safe

- Never commit `.env.local`.
- Use API-specific app passwords instead of primary passwords.
- Restrict keys by API, quota, origin, or IP when the provider supports it.
- Do not put secrets in JSON reports or console output.
- Keep citations and retrieval timestamps.
- Treat automated conclusions as research prompts that require human review.
