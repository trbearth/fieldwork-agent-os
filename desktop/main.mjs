import { app, BrowserWindow, Menu, shell, session, utilityProcess } from "electron";
import { createServer } from "node:http";
import { access, cp, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

app.setName("Fieldwork");
const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = app.isPackaged ? path.join(process.resourcesPath, "app") : path.resolve(desktopDir, "..");
const workspaceRoot = app.isPackaged ? path.join(app.getPath("userData"), "workspace") : projectRoot;
const clientRoot = path.join(projectRoot, "dist", "client");
let server;
let mainWindow;
let origin;
let activeAgentRun = null;
let activeAgentProcess = null;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

async function loadLocalEnvironment() {
  const candidates = [
    path.join(projectRoot, ".env.local"),
    path.join(app.getPath("userData"), ".env.local"),
  ];
  for (const candidate of candidates) {
    try {
      const contents = await readFile(candidate, "utf8");
      for (const rawLine of contents.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const separator = line.indexOf("=");
        if (separator < 1) continue;
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
        if (!(key in process.env)) process.env[key] = value;
      }
      break;
    } catch { /* This environment location is optional. */ }
  }
}

async function ensureWritableWorkspace() {
  if (!app.isPackaged) return;
  await mkdir(workspaceRoot, { recursive: true });
  for (const relative of ["config", "data", "public/exports", "agent/fixtures"]) {
    const destination = path.join(workspaceRoot, relative);
    try {
      await access(destination);
    } catch {
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(projectRoot, relative), destination, { recursive: true });
    }
  }
}

function toNodeHeaders(headers) {
  const result = {};
  headers.forEach((value, key) => {
    if (key.toLowerCase() !== "content-encoding") result[key] = value;
  });
  return result;
}

async function assetResponse(request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const relative = pathname.replace(/^\/+/, "");
  const resolved = path.resolve(clientRoot, relative);
  if (!resolved.startsWith(`${clientRoot}${path.sep}`) && resolved !== clientRoot) {
    return new Response("Not found", { status: 404 });
  }
  try {
    if (!(await stat(resolved)).isFile()) return new Response("Not found", { status: 404 });
    return new Response(await readFile(resolved), {
      headers: { "content-type": mimeTypes[path.extname(resolved).toLowerCase()] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function requestFromNode(req, port) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(`http://127.0.0.1:${port}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : body,
    duplex: body ? "half" : undefined,
  });
}

async function writeNodeResponse(req, res, response) {
  res.writeHead(response.status, toNodeHeaders(response.headers));
  if (req.method === "HEAD" || !response.body) return res.end();
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

async function readWorkspaceState() {
  const [fashion, social] = await Promise.all([
    readFile(path.join(workspaceRoot, "data", "latest.json"), "utf8").then(JSON.parse),
    readFile(path.join(workspaceRoot, "data", "social-latest.json"), "utf8").then(JSON.parse),
  ]);
  return {
    fashion,
    social,
    capabilities: {
      coreReady: true,
      voiceConfigured: Boolean(process.env.OPENAI_API_KEY),
      workspace: app.isPackaged ? "local-persistent" : "project",
    },
    readAt: new Date().toISOString(),
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function runAgentModule(agent, fixture) {
  const entry = path.resolve(projectRoot, agent.entry);
  if (!entry.startsWith(`${projectRoot}${path.sep}`)) throw new Error("Agent entry is outside the workspace.");
  let output = "";
  await new Promise((resolve, reject) => {
    const child = utilityProcess.fork(entry, fixture ? ["--fixture"] : [], {
      cwd: workspaceRoot,
      env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === "string")),
      serviceName: `Fieldwork — ${agent.name}`,
      stdio: "pipe",
    });
    activeAgentProcess = child;
    const append = (chunk) => { output = `${output}${chunk}`.slice(-80_000); };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("exit", (code) => {
      activeAgentProcess = null;
      if (code === 0) resolve();
      else reject(new Error(`${agent.name} stopped with code ${code}.${output ? ` ${output.slice(-600)}` : ""}`));
    });
  });
  return { id: agent.id, name: agent.name, output: output.trim().slice(-4_000) };
}

async function handleAgentRequest(request) {
  if (request.method === "GET") return jsonResponse(await readWorkspaceState());
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  if (activeAgentRun) return jsonResponse({ error: "An agent run is already active." }, 409);

  const body = await request.json().catch(() => ({}));
  const fixture = body.mode === "fixture";
  const registry = JSON.parse(await readFile(path.join(projectRoot, "agents", "registry.json"), "utf8"));
  const selected = registry.agents.filter((agent) =>
    agent.enabled && (!body.agentId || agent.id === body.agentId)
  );
  if (!selected.length) return jsonResponse({ error: "That agent is unavailable or paused." }, 404);

  activeAgentRun = (async () => {
    const results = [];
    for (const agent of selected) results.push(await runAgentModule(agent, fixture));
    return { ok: true, mode: fixture ? "fixture" : "live", results, state: await readWorkspaceState() };
  })();
  try {
    return jsonResponse(await activeAgentRun);
  } finally {
    activeAgentRun = null;
  }
}

async function startInternalServer() {
  await loadLocalEnvironment();
  await ensureWritableWorkspace();
  const workerPath = pathToFileURL(path.join(projectRoot, "dist", "server", "index.js")).href;
  const { default: worker } = await import(`${workerPath}?desktop=${Date.now()}`);

  server = createServer(async (req, res) => {
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const request = await requestFromNode(req, port);
      if (new URL(request.url).pathname === "/api/agents/run") {
        return writeNodeResponse(req, res, await handleAgentRequest(request));
      }
      if (req.method === "GET" || req.method === "HEAD") {
        const asset = await assetResponse(request);
        if (asset.status !== 404) return writeNodeResponse(req, res, asset);
      }
      const response = await worker.fetch(
        request,
        { ASSETS: { fetch: assetResponse } },
        { waitUntil() {}, passThroughOnException() {} }
      );
      await writeNodeResponse(req, res, response);
    } catch (error) {
      console.error("Fieldwork internal server error", error);
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Fieldwork could not load.");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  origin = `http://127.0.0.1:${port}`;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: "Fieldwork",
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f6f7f8",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(origin)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  await mainWindow.loadURL(origin);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });
  await startInternalServer();
  await createWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  activeAgentProcess?.kill();
  server?.close();
});
