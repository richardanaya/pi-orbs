// Starts the app the e2e suite drives.
// Simulator (default): local client on :8787 and the static site on :8790.
// Live (E2E_STACK=live): local Pi Orbs server talking to xAI, and the client
// proxied at it. The API key stays in the server process environment only.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.PIORBS_XAI_API_KEY && !process.env.XAI_API_KEY) {
  process.env.XAI_API_KEY = process.env.PIORBS_XAI_API_KEY;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const live = process.env.E2E_STACK === "live";
const clientUrl = "http://127.0.0.1:8787";
const sitePort = Number(process.env.E2E_SITE_PORT ?? 8790);
const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

function track(child, name) {
  children.push(child);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const why = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
    console.error(`${name} exited (${why})`);
    shutdown(code && code !== 0 ? code : 1);
  });
}

function spawnNode(scriptArgs, env, cwd) {
  const child = spawn(process.execPath, scriptArgs, {
    cwd,
    env,
    stdio: "inherit",
  });
  return child;
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function startSite() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = normalize(join(root, pathname));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  server.listen(sitePort, "127.0.0.1");
  return new Promise((resolveReady, reject) => {
    server.once("listening", resolveReady);
    server.once("error", reject);
  });
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = address && typeof address === "object" ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}

async function waitForOk(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`timed out waiting for ${url}`);
}

const clientDist = join(root, "client", "dist", "main.js");
if (!existsSync(clientDist)) {
  console.error("client/dist is missing. Run npm run build --prefix client first.");
  process.exit(1);
}

if (!live) {
  try {
    await startSite();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "site server failed");
    process.exit(1);
  }
  const home = join(tmpdir(), `pi-orbs-e2e-sim-${process.pid}`);
  await mkdir(home, { recursive: true });
  const child = spawnNode(["bin/pi-orbs.js"], {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    PI_ORBS_MODE: "local",
    PI_ORBS_NO_OPEN: "1",
  }, root);
  track(child, "simulator");
  console.log(`pi-orbs e2e simulator ${clientUrl} site http://127.0.0.1:${sitePort}`);
} else {
  if (!process.env.XAI_API_KEY) {
    console.error("Live e2e needs XAI_API_KEY or PIORBS_XAI_API_KEY. The value is not printed.");
    process.exit(1);
  }
  const serverDist = join(root, "server", "dist", "server.js");
  if (!existsSync(serverDist)) {
    console.error("server/dist is missing. Run npm run build --prefix server first.");
    process.exit(1);
  }
  const home = join(tmpdir(), `pi-orbs-e2e-live-${process.pid}`);
  const work = join(home, "work");
  const data = join(home, "data");
  await mkdir(work, { recursive: true });
  await mkdir(data, { recursive: true });
  const port = await freePort();
  const secret = randomBytes(24).toString("hex");
  const serverUrl = `http://127.0.0.1:${port}`;
  const server = spawnNode(["server/dist/server.js"], {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    PORT: String(port),
    PI_API_SECRET: secret,
    PI_MODEL: "grok-4.7",
    PI_API: "openai-responses",
    PI_BASE_URL: "https://api.x.ai/v1",
    PI_XAI_BASE_URL: "https://api.x.ai/v1",
    PI_DB: join(data, "agent.sqlite"),
    PI_CWD: work,
    PI_PUBLIC_URL: serverUrl,
    XAI_API_KEY: process.env.XAI_API_KEY,
  }, root);
  track(server, "server");
  try {
    await waitForOk(`${serverUrl}/version`, 60_000);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "server did not answer /version");
    shutdown(1);
  }
  await mkdir(join(home, ".pi-orbs"), { recursive: true });
  await writeFile(join(home, ".pi-orbs", "state.json"), JSON.stringify({
    spritesToken: "e2e-local",
    sprites: [{
      name: "e2e",
      url: serverUrl,
      secret,
      connectorType: "xai",
      baseApiUrl: "https://api.x.ai/v1",
      model: "grok-4.7",
    }],
  }, null, 2));
  const client = spawnNode(["bin/pi-orbs.js"], {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    PI_ORBS_NO_OPEN: "1",
  }, root);
  track(client, "client");
  console.log(`pi-orbs e2e live client ${clientUrl}`);
}
