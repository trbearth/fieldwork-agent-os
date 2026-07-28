# Getting started

This guide assumes no prior app-development experience.

## 1. Install the two tools

Install:

- Git from <https://git-scm.com/downloads>
- Node.js 22 LTS or newer from <https://nodejs.org/>

On macOS, open Terminal after installation.

## 2. Download Fieldwork

```bash
git clone https://github.com/trbearth/fieldwork-agent-os.git
cd fieldwork-agent-os
```

Your Terminal prompt should now end with `fieldwork-agent-os`. If it does not, do not run the next commands yet.

## 3. Install and check it

```bash
npm install
npm run doctor
```

The doctor should show check marks. If Terminal says it cannot find `package.json`, you are in the wrong folder; run `cd fieldwork-agent-os`.

## 4. Load safe sample data

```bash
npm run agents:fixture
```

Fixtures do not contact external services. They prove that the registry, reports, scoring, exports, and dashboard contract work together.

## 5. Open the desktop app

```bash
npm run desktop
```

The first build can take a few minutes. Later launches can use:

```bash
npm run desktop:open
```

## 6. Run live public collection

```bash
npm run agents
```

Live collection uses the configured publisher feeds and public Mastodon timelines. Optional sources skip themselves when their credentials are absent.

## 7. Customize

Start with `config/workspace.json`, then follow [CUSTOMIZE.md](CUSTOMIZE.md).
