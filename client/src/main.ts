import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveHeaders, conversationsArchive, readExport } from "./archive.js";
import { deleteConnector, ensureConnector, gatewayBaseUrl } from "./connector.js";
import { connectionName, normalizeConnector, providerApi, publicConnectors, readDeployUpdate, readSetup, type SpriteConnector } from "./connectors.js";
import { deploySprite, localVersion, newSecret, remoteVersion } from "./deploy.js";
import { handleLocal, localMode } from "./local.js";
import { listSprites, sprite } from "./sprite.js";

type SavedSprite = {
  name: string;
  url: string;
  secret: string;
  xaiKey?: string;
  apiKey?: string;
  connectorId?: string;
  connectorType?: string;
  baseApiUrl?: string;
  model?: string;
};
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

function connectorOf(saved: SavedSprite): SpriteConnector {
  return normalizeConnector(saved);
}

function serviceEnv(saved: SavedSprite): Record<string, string> {
  if (!saved.connectorId) throw new Error("connector is not set up");
  const connector = connectorOf(saved);
  const gateway = gatewayBaseUrl(saved.connectorId);
  return {
    PI_API_SECRET: saved.secret,
    PI_MODEL: connector.model,
    PI_API: providerApi(connector.connectorType),
    PI_DB: "/home/sprite/app/data/agent.sqlite",
    PI_CWD: "/home/sprite/work",
    PI_BASE_URL: gateway,
    PI_XAI_BASE_URL: gateway,
    XAI_API_KEY: "connector",
    OPENAI_API_KEY: "connector",
  };
}

function publicSprite(saved: SavedSprite, extra: Record<string, unknown>): Record<string, unknown> {
  const connector = connectorOf(saved);
  return {
    name: saved.name,
    url: saved.url,
    connectorType: connector.connectorType,
    baseApiUrl: connector.baseApiUrl,
    model: connector.model,
    ...extra,
  };
}

async function withConnector(saved: SavedSprite): Promise<SavedSprite> {
  if (saved.connectorId) return saved;
  const connector = connectorOf(saved);
  const apiKey = saved.apiKey ?? saved.xaiKey ?? "";
  if (!apiKey) throw new Error("connector is not set up");
  const connectorId = await ensureConnector({
    name: connectionName(connector.connectorType, connector.baseApiUrl),
    baseApiUrl: connector.baseApiUrl,
    apiKey,
  });
  return { ...saved, connectorId };
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
    if (url.pathname === "/api/connector-presets" && req.method === "GET") {
      send(res, 200, { connectors: publicConnectors() });
      return;
    }
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
      const connector = connectorOf(saved);
      send(res, 200, {
        localVersion: local,
        sprite: {
          name: saved.name,
          url: saved.url,
          remoteVersion: remote,
          update: remote !== local,
          connectorType: connector.connectorType,
          baseApiUrl: connector.baseApiUrl,
          model: connector.model,
        },
      });
      return;
    }
    if (url.pathname === "/api/sprites" && req.method === "POST") {
      const setup = readSetup(await readBody(req));
      if ("error" in setup) {
        send(res, 400, { error: setup.error });
        return;
      }
      const live = await listSprites();
      if (!live.some((item) => item.name === setup.name)) {
        await sprite(["create", "--skip-console", setup.name]);
      }
      await sprite(["config", "update", "-s", setup.name, "--url-auth", "public"]);
      const infoRaw = await sprite(["api", `/v1/sprites/${setup.name}`]);
      const info = JSON.parse(infoRaw.slice(infoRaw.indexOf("{"))) as { url: string };
      const previous = state.sprites.find((item) => item.name === setup.name);
      const connectorId = await ensureConnector({
        name: connectionName(setup.connectorType, setup.baseApiUrl),
        baseApiUrl: setup.baseApiUrl,
        apiKey: setup.apiKey,
      });
      if (previous?.connectorId && previous.connectorId !== connectorId) await deleteConnector(previous.connectorId);
      const saved: SavedSprite = {
        name: setup.name,
        url: info.url,
        secret: previous?.secret ?? newSecret(),
        apiKey: setup.apiKey,
        ...(setup.connectorType === "xai" ? { xaiKey: setup.apiKey } : {}),
        connectorId,
        connectorType: setup.connectorType,
        baseApiUrl: setup.baseApiUrl,
        model: setup.model,
      };
      await deploySprite(setup.name, serviceEnv(saved));
      const remote = await remoteVersion(saved.url);
      if (!remote) {
        send(res, 502, { error: "sprite was created, but the server did not answer /version" });
        return;
      }
      state.sprites = [saved];
      await saveState(state);
      send(res, 201, {
        name: setup.name,
        url: saved.url,
        remoteVersion: remote,
        connectorType: setup.connectorType,
        baseApiUrl: setup.baseApiUrl,
        model: setup.model,
      });
      return;
    }
    const exportMatch = url.pathname.match(/^\/api\/sprites\/([^/]+)\/conversations\.zip$/);
    if (exportMatch && req.method === "GET") {
      let name: string;
      try {
        name = decodeURIComponent(exportMatch[1] ?? "");
      } catch {
        send(res, 404, { error: "not found" });
        return;
      }
      const saved = state.sprites.find((item) => item.name === name);
      if (!saved) {
        send(res, 404, { error: "sprite is not managed by this client" });
        return;
      }
      const response = await spriteFetch(saved, "/api/export");
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const error = payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : "export failed";
        send(res, response.status, { error });
        return;
      }
      const snapshot = readExport(saved.name, payload);
      if (!snapshot) {
        send(res, 502, { error: "sprite export was not a conversation list" });
        return;
      }
      const archive = conversationsArchive(snapshot, [
        saved.secret,
        saved.apiKey ?? "",
        saved.xaiKey ?? "",
        saved.connectorId ?? "",
        saved.connectorId ? gatewayBaseUrl(saved.connectorId) : "",
      ]);
      res.writeHead(200, archiveHeaders(archive.filename, archive.zip.length));
      res.end(archive.zip);
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
      if (saved.connectorId) await deleteConnector(saved.connectorId);
      await sprite(["destroy", "--force", saved.name]);
      state.sprites = state.sprites.filter((item) => item.name !== saved.name);
      await saveState(state);
      send(res, 200, { ok: true });
      return;
    }
    if (route[4] === "/deploy" && req.method === "POST") {
      const next = readDeployUpdate(await readBody(req), connectorOf(saved));
      if ("error" in next) {
        send(res, 400, { error: next.error });
        return;
      }
      const ready = await withConnector({ ...saved, ...next });
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
      send(res, 200, publicSprite(saved, { remoteVersion: remote, update: remote !== local, ...bots }));
      return;
    }
    if (route[2] === "/bots" && req.method === "POST") {
      const response = await spriteFetch(saved, "/api/bots", { method: "POST", body: JSON.stringify(await readBody(req)) });
      send(res, response.status, await response.json());
      return;
    }
    if (route[3] && req.method === "PATCH" && !url.pathname.endsWith("/messages")) {
      const response = await spriteFetch(saved, `/api/bots/${route[3]}`, { method: "PATCH", body: JSON.stringify(await readBody(req)) });
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
