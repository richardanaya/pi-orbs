import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deleteXaiConnector, ensureXaiConnector, gatewayBaseUrl } from "./connector.js";
import { deploySprite, localVersion, newSecret, remoteVersion } from "./deploy.js";
import { handleLocal, localMode } from "./local.js";
import { listSprites, sprite } from "./sprite.js";

type SavedSprite = { name: string; url: string; secret: string; xaiKey: string; connectorId?: string };
type StateFile = { sprites: SavedSprite[] };

const statePath = join(homedir(), ".pi-orbs", "state.json");
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "../public");

async function loadState(): Promise<StateFile> {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as StateFile;
  } catch {
    return { sprites: [] };
  }
}

async function saveState(state: StateFile): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

async function readBody(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, string>;
}

function serviceEnv(saved: SavedSprite): Record<string, string> {
  if (!saved.connectorId) throw new Error("xAI connector is not set up");
  return {
    PI_API_SECRET: saved.secret,
    PI_MODEL: "grok-4.7",
    PI_DB: "/home/sprite/app/data/agent.sqlite",
    PI_CWD: "/home/sprite/work",
    PI_XAI_BASE_URL: gatewayBaseUrl(saved.connectorId),
    XAI_API_KEY: "connector",
  };
}

async function withConnector(saved: SavedSprite): Promise<SavedSprite> {
  return { ...saved, connectorId: saved.connectorId ?? await ensureXaiConnector(saved.xaiKey) };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function contentType(file: string): string {
  switch (extname(file)) {
    case ".html": return "text/html; charset=utf-8";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".svg": return "image/svg+xml";
    case ".ico": return "image/x-icon";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

function publicFile(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const rel = (decoded === "/" ? "index.html" : decoded).replace(/^\/+/, "");
  if (!rel || rel.includes("\0")) return null;
  const root = resolve(publicDir);
  const file = resolve(root, rel);
  if (file !== root && !file.startsWith(root + sep)) return null;
  return file;
}

async function servePublic(pathname: string, res: ServerResponse): Promise<boolean> {
  const file = publicFile(pathname);
  if (!file) return false;
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": contentType(file) });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

async function spriteFetch(saved: SavedSprite, path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, saved.url), {
    ...init,
    headers: { authorization: `Bearer ${saved.secret}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (await servePublic(url.pathname, res)) return;
    if (localMode()) {
      if (url.pathname.startsWith("/api/")) {
        await handleLocal(url, req, res);
        return;
      }
      send(res, 404, { error: "not found" });
      return;
    }
    const state = await loadState();
    if (url.pathname === "/api/sprites" && req.method === "GET") {
      const local = await localVersion();
      const saved = state.sprites[0];
      if (!saved) {
        send(res, 200, { localVersion: local, sprite: null });
        return;
      }
      const remote = await remoteVersion(saved.url);
      send(res, 200, {
        localVersion: local,
        sprite: { name: saved.name, url: saved.url, remoteVersion: remote, update: remote !== local },
      });
      return;
    }
    if (url.pathname === "/api/sprites" && req.method === "POST") {
      const body = await readBody(req);
      const name = body.name?.trim();
      if (!name || !body.xaiKey) {
        send(res, 400, { error: "name and xaiKey are required" });
        return;
      }
      const live = await listSprites();
      if (!live.some((item) => item.name === name)) {
        await sprite(["create", "--skip-console", name]);
      }
      await sprite(["config", "update", "-s", name, "--url-auth", "public"]);
      const infoRaw = await sprite(["api", `/v1/sprites/${name}`]);
      const info = JSON.parse(infoRaw.slice(infoRaw.indexOf("{"))) as { url: string };
      const previous = state.sprites.find((item) => item.name === name);
      const saved = await withConnector({
        name,
        url: info.url,
        secret: previous?.secret ?? newSecret(),
        xaiKey: body.xaiKey,
        connectorId: previous?.connectorId,
      });
      await deploySprite(name, serviceEnv(saved));
      const remote = await remoteVersion(saved.url);
      if (!remote) {
        send(res, 502, { error: "sprite was created, but the server did not answer /version" });
        return;
      }
      state.sprites = [saved];
      await saveState(state);
      send(res, 201, { name, url: saved.url, remoteVersion: remote });
      return;
    }
    const route = url.pathname.match(/^\/api\/sprites\/([^/]+)(\/bots(?:\/([^/]+)(?:\/messages)?)?)?(\/deploy)?$/);
    if (!route) {
      send(res, 404, { error: "not found" });
      return;
    }
    const saved = state.sprites.find((item) => item.name === route[1]);
    if (!saved) {
      send(res, 404, { error: "sprite is not managed by this client" });
      return;
    }
    if (req.method === "DELETE" && !route[2] && !route[4]) {
      if (saved.connectorId) await deleteXaiConnector(saved.connectorId);
      await sprite(["destroy", "--force", saved.name]);
      state.sprites = state.sprites.filter((item) => item.name !== saved.name);
      await saveState(state);
      send(res, 200, { ok: true });
      return;
    }
    if (route[4] === "/deploy" && req.method === "POST") {
      const ready = await withConnector(saved);
      state.sprites = state.sprites.map((item) => item.name === ready.name ? ready : item);
      await saveState(state);
      await deploySprite(ready.name, serviceEnv(ready));
      const remote = await remoteVersion(saved.url);
      if (!remote) {
        send(res, 502, { error: "deploy finished, but the server did not answer /version" });
        return;
      }
      send(res, 200, { ok: true, version: remote });
      return;
    }
    if (!route[2] && req.method === "GET") {
      const remote = await remoteVersion(saved.url);
      const local = await localVersion();
      const botsResponse = await spriteFetch(saved, "/api/bots");
      const bots = botsResponse.ok ? await botsResponse.json() : { bots: [] };
      send(res, 200, { ...saved, xaiKey: undefined, remoteVersion: remote, update: remote !== local, ...bots });
      return;
    }
    if (route[2] === "/bots" && req.method === "POST") {
      const response = await spriteFetch(saved, "/api/bots", { method: "POST", body: JSON.stringify(await readBody(req)) });
      send(res, response.status, await response.json());
      return;
    }
    if (route[3] && req.method === "GET") {
      const response = await spriteFetch(saved, `/api/bots/${route[3]}`);
      send(res, response.status, await response.json());
      return;
    }
    if (route[3] && url.pathname.endsWith("/messages") && req.method === "POST") {
      const response = await spriteFetch(saved, `/api/bots/${route[3]}/messages`, { method: "POST", body: JSON.stringify(await readBody(req)) });
      send(res, response.status, await response.json());
      return;
    }
    send(res, 404, { error: "not found" });
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : "error" });
  }
});

http.listen(8787, () => {
  if (localMode()) {
    console.log("pi-orbs local simulator http://127.0.0.1:8787 (no Sprite, no xAI)");
    return;
  }
  console.log("pi-orbs client http://127.0.0.1:8787");
});
