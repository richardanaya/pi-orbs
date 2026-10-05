import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveHeaders, conversationsArchive, readExport } from "./archive.js";
import { deleteConnector, ensureConnector, gatewayBaseUrl } from "./connector.js";
import { connectionName, normalizeConnector, providerApi, publicConnectors, readDeployUpdate, readSetup, type SpriteConnector } from "./connectors.js";
import { deploySprite, localVersion, newSecret, remoteVersion } from "./deploy.js";
import { searchPalette, type SearchBot, type SearchMessage } from "./features.js";
import { handleLocal, localMode } from "./local.js";
import { createSprite, destroySprite, getSprite, hasSpritesToken, listSprites, publishSprite, setSpritesToken, verifySpritesToken } from "./sprite.js";
import {
  appendTranscript,
  chatLines,
  clearBotSessions,
  clearSessions,
  endSession,
  executeVoiceTool,
  findSession,
  isVoiceFailure,
  matchVoicePath,
  mintClientSecret,
  openSession,
  publicSession,
  publicVoice,
  readVoice,
  voiceFromSetup,
  voiceInstructions,
  VoiceSubmitError,
  type VoiceConfig,
} from "./voice.js";
import { cronFromSetup, isCronFailure, publicCron, readCronSettings } from "./schedule.js";

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
  voiceProvider?: string;
  voiceApiKey?: string;
  cronApiKey?: string;
};
type StateFile = { spritesToken?: string; sprites: SavedSprite[] };

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

async function readRaw(req: IncomingMessage, limit: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) return undefined;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function searchFromRoster(saved: SavedSprite, query: string): Promise<ReturnType<typeof searchPalette>> {
  const listed = await spriteFetch(saved, "/api/bots");
  const payload = await listed.json().catch(() => null) as { bots?: { id?: unknown; name?: unknown; look?: unknown; instruction?: unknown; main?: unknown }[] } | null;
  const bots: SearchBot[] = [];
  for (const item of payload?.bots ?? []) {
    if (!item || typeof item.id !== "string" || typeof item.name !== "string") continue;
    bots.push({
      id: item.id,
      name: item.name,
      look: typeof item.look === "string" ? item.look : "",
      instruction: typeof item.instruction === "string" ? item.instruction : "",
      ...(item.main === true ? { main: true } : {}),
    });
  }
  const messages: SearchMessage[] = [];
  for (const bot of bots) {
    const thread = await spriteFetch(saved, `/api/bots/${encodeURIComponent(bot.id)}`);
    if (!thread.ok) continue;
    const body = await thread.json().catch(() => null) as { messages?: { id?: unknown; kind?: unknown; text?: unknown; createdAt?: unknown }[] } | null;
    for (const item of body?.messages ?? []) {
      if (!item || typeof item.id !== "string" || typeof item.text !== "string") continue;
      messages.push({
        botId: bot.id,
        botName: bot.name,
        look: bot.look,
        messageId: item.id,
        kind: typeof item.kind === "string" ? item.kind : "",
        text: item.text,
        createdAt: typeof item.createdAt === "string" ? item.createdAt : null,
      });
    }
  }
  return searchPalette(query, bots, messages);
}

async function relaySprite(saved: SavedSprite, path: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const limit = path.includes("/files") && method === "POST" ? 12_000_000 : 1_000_000;
  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await readRaw(req, limit);
    if (!body) {
      send(res, 413, { error: "body too large" });
      return;
    }
  }
  const response = await spriteFetch(saved, path, {
    method,
    ...(body && body.length > 0 ? { body: new Uint8Array(body) } : {}),
  });
  const type = response.headers.get("content-type") ?? "application/json; charset=utf-8";
  const disposition = response.headers.get("content-disposition") ?? "";
  const bytes = Buffer.from(await response.arrayBuffer());
  const headers: Record<string, string> = { "content-type": type, "cache-control": "no-store" };
  if (disposition) headers["content-disposition"] = disposition;
  res.writeHead(response.status, headers);
  res.end(bytes);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function voiceConfigOf(saved: SavedSprite): VoiceConfig | null {
  const apiKey = saved.voiceApiKey ?? "";
  if ((saved.voiceProvider === "grok" || saved.voiceProvider === "openai") && apiKey) {
    return { provider: saved.voiceProvider, apiKey };
  }
  return null;
}

function withVoice(saved: SavedSprite, voice: VoiceConfig | null): SavedSprite {
  if (!voice) {
    const next = { ...saved };
    delete next.voiceProvider;
    delete next.voiceApiKey;
    return next;
  }
  return { ...saved, voiceProvider: voice.provider, voiceApiKey: voice.apiKey };
}

function withCron(saved: SavedSprite, apiKey: string | null): SavedSprite {
  if (!apiKey) {
    const next = { ...saved };
    delete next.cronApiKey;
    return next;
  }
  return { ...saved, cronApiKey: apiKey };
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
    PI_PUBLIC_URL: saved.url,
    PI_MODEL: connector.model,
    PI_API: providerApi(connector.connectorType),
    PI_DB: "/home/sprite/app/data/agent.sqlite",
    PI_CWD: "/home/sprite/work",
    PI_BASE_URL: gateway,
    PI_XAI_BASE_URL: gateway,
    XAI_API_KEY: "connector",
    OPENAI_API_KEY: "connector",
    ...(connector.connectorType === "anthropic" ? { ANTHROPIC_API_KEY: "connector" } : {}),
    ...(saved.cronApiKey ? { CRON_JOB_ORG_API_KEY: saved.cronApiKey } : {}),
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
    voice: publicVoice(voiceConfigOf(saved)),
    cron: publicCron(saved.cronApiKey),
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
    case ".js": return "text/javascript; charset=utf-8";
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

async function spriteBot(saved: SavedSprite, botId: string): Promise<{ name: string; messages: { kind?: unknown; text?: unknown }[] } | { status: number; error: string }> {
  const response = await spriteFetch(saved, `/api/bots/${encodeURIComponent(botId)}`);
  const payload = await response.json().catch(() => null) as { bot?: { name?: unknown }; messages?: unknown; error?: unknown } | null;
  if (!response.ok) {
    const error = payload && typeof payload.error === "string" ? payload.error : "bot not found";
    return { status: response.status, error };
  }
  const name = payload?.bot && typeof payload.bot.name === "string" ? payload.bot.name : botId;
  const messages = payload && Array.isArray(payload.messages) ? payload.messages as { kind?: unknown; text?: unknown }[] : [];
  return { name, messages };
}

async function handleLiveVoice(state: StateFile, saved: SavedSprite, match: NonNullable<ReturnType<typeof matchVoicePath>>, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (match.kind === "save") {
    if (req.method !== "POST") {
      send(res, 404, { error: "not found" });
      return;
    }
    const read = readVoice(await readBody(req), voiceConfigOf(saved));
    if ("error" in read) {
      send(res, 400, { error: read.error });
      return;
    }
    const next = "unchanged" in read ? saved : withVoice(saved, read.voice);
    state.sprites = state.sprites.map((item) => item.name === next.name ? next : item);
    await saveState(state);
    send(res, 200, { voice: publicVoice(voiceConfigOf(next)) });
    return;
  }
  if (match.kind === "start") {
    if (req.method !== "POST") {
      send(res, 404, { error: "not found" });
      return;
    }
    const config = voiceConfigOf(saved);
    if (!config) {
      send(res, 400, { error: "voice is not configured" });
      return;
    }
    const bot = await spriteBot(saved, match.botId);
    if ("error" in bot) {
      send(res, bot.status, { error: bot.error });
      return;
    }
    const minted = await mintClientSecret({
      provider: config.provider,
      apiKey: config.apiKey,
      instructions: voiceInstructions(bot.name),
    });
    if ("error" in minted) {
      send(res, 502, { error: minted.error });
      return;
    }
    const session = openSession(match.botId, config.provider);
    send(res, 201, {
      ...publicSession(session, bot.name),
      clientSecret: minted.clientSecret,
      expiresAt: minted.expiresAt,
      realtime: minted.realtime,
    });
    return;
  }
  const session = findSession(match.sessionId, match.botId);
  if (!session) {
    send(res, 404, { error: "voice call not found" });
    return;
  }
  if (match.kind === "session" && req.method === "GET") {
    const bot = await spriteBot(saved, match.botId);
    send(res, 200, publicSession(session, "error" in bot ? match.botId : bot.name));
    return;
  }
  if (match.kind === "session" && req.method === "DELETE") {
    endSession(session);
    send(res, 200, { stopped: true });
    return;
  }
  if (match.kind === "transcript" && req.method === "POST") {
    if (session.stopped) {
      send(res, 409, { error: "voice call has ended" });
      return;
    }
    const body = await readBody(req);
    const appended = appendTranscript(session, body.role, body.text);
    if ("error" in appended) {
      send(res, 400, { error: appended.error });
      return;
    }
    send(res, 201, { id: appended.turn.id, role: appended.turn.role, createdAt: appended.turn.createdAt });
    return;
  }
  if (match.kind === "tools" && req.method === "POST") {
    const secrets = [saved.voiceApiKey ?? "", saved.apiKey ?? "", saved.xaiKey ?? "", saved.secret, saved.connectorId ?? "", saved.cronApiKey ?? ""];
    const result = await executeVoiceTool(session, await readBody(req), {
      lines: async () => {
        const bot = await spriteBot(saved, match.botId);
        if ("error" in bot) throw new VoiceSubmitError(bot.status, bot.error);
        return chatLines(bot.messages);
      },
      submit: async (task) => {
        const response = await spriteFetch(saved, `/api/bots/${encodeURIComponent(match.botId)}/messages`, {
          method: "POST",
          body: JSON.stringify({ content: task }),
        });
        const payload = await response.json().catch(() => null) as { submissionId?: unknown; error?: unknown } | null;
        if (!response.ok) {
          const error = payload && typeof payload.error === "string" ? payload.error : "task was not sent";
          throw new VoiceSubmitError(response.status, error);
        }
        const submissionId = payload && (typeof payload.submissionId === "string" || typeof payload.submissionId === "number")
          ? String(payload.submissionId)
          : "";
        if (!submissionId) throw new VoiceSubmitError(502, "task was not sent");
        return { submissionId };
      },
      secrets,
    });
    send(res, result.status, result.body);
    return;
  }
  send(res, 404, { error: "not found" });
}

async function spriteFetch(saved: SavedSprite, path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, saved.url), {
    ...init,
    headers: { authorization: `Bearer ${saved.secret}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

async function pushCronKey(saved: SavedSprite): Promise<void> {
  const response = await spriteFetch(saved, "/api/cron-key", {
    method: "POST",
    body: JSON.stringify({ apiKey: saved.cronApiKey ?? "" }),
  });
  if (response.ok || response.status === 404) return;
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  const error = payload && typeof payload.error === "string" ? payload.error : "cron-job.org key was not saved";
  throw new Error(error);
}

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/thread-view.js" || url.pathname === "/words.js") {
      const file = join(dirname(fileURLToPath(import.meta.url)), url.pathname.slice(1));
      try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
        res.end(body);
      } catch {
        send(res, 404, { error: "not found" });
      }
      return;
    }
    if (await servePublic(url.pathname, res)) return;
    if (url.pathname === "/api/connector-presets" && req.method === "GET") {
      send(res, 200, { connectors: publicConnectors() });
      return;
    }
    if (localMode()) {
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/hooks/")) {
        await handleLocal(url, req, res);
        return;
      }
      send(res, 404, { error: "not found" });
      return;
    }
    const state = await loadState();
    setSpritesToken(state.spritesToken ?? "");
    if (url.pathname === "/api/token" && req.method === "POST") {
      const body = await readBody(req);
      const candidate = typeof body.token === "string" ? body.token.trim() : "";
      try {
        await verifySpritesToken(candidate);
      } catch (error) {
        send(res, 401, { error: error instanceof Error ? error.message : "token rejected" });
        return;
      }
      state.spritesToken = candidate;
      await saveState(state);
      send(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/sprites" && req.method === "GET") {
      const local = await localVersion();
      const saved = state.sprites[0];
      if (!hasSpritesToken()) {
        send(res, 200, { localVersion: local, token: false, sprite: null });
        return;
      }
      if (!saved) {
        send(res, 200, { localVersion: local, token: true, sprite: null });
        return;
      }
      const remote = await remoteVersion(saved.url);
      const connector = connectorOf(saved);
      send(res, 200, {
        localVersion: local,
        token: true,
        sprite: {
          name: saved.name,
          url: saved.url,
          remoteVersion: remote,
          update: remote !== local,
          connectorType: connector.connectorType,
          baseApiUrl: connector.baseApiUrl,
          model: connector.model,
          voice: publicVoice(voiceConfigOf(saved)),
          cron: publicCron(saved.cronApiKey),
        },
      });
      return;
    }
    if (url.pathname === "/api/sprites" && req.method === "POST") {
      const body = await readBody(req);
      const setup = readSetup(body);
      if ("error" in setup) {
        send(res, 400, { error: setup.error });
        return;
      }
      const voice = voiceFromSetup(body, null);
      if (isVoiceFailure(voice)) {
        send(res, 400, { error: voice.error });
        return;
      }
      const cronApiKey = cronFromSetup(body);
      if (isCronFailure(cronApiKey)) {
        send(res, 400, { error: cronApiKey.error });
        return;
      }
      if (!hasSpritesToken()) {
        send(res, 401, { error: "Save a Sprites API token first." });
        return;
      }
      const live = await listSprites();
      if (!live.some((item) => item.name === setup.name)) await createSprite(setup.name);
      await publishSprite(setup.name);
      const info = await getSprite(setup.name);
      const previous = state.sprites.find((item) => item.name === setup.name);
      const connectorId = await ensureConnector({
        name: connectionName(setup.connectorType, setup.baseApiUrl),
        baseApiUrl: setup.baseApiUrl,
        apiKey: setup.apiKey,
      });
      if (previous?.connectorId && previous.connectorId !== connectorId) await deleteConnector(previous.connectorId);
      const saved: SavedSprite = {
        name: setup.name,
        url: info.url ?? "",
        secret: previous?.secret ?? newSecret(),
        apiKey: setup.apiKey,
        ...(setup.connectorType === "xai" ? { xaiKey: setup.apiKey } : {}),
        connectorId,
        connectorType: setup.connectorType,
        baseApiUrl: setup.baseApiUrl,
        model: setup.model,
        ...(voice ? { voiceProvider: voice.provider, voiceApiKey: voice.apiKey } : {}),
        ...(cronApiKey ? { cronApiKey } : {}),
      };
      await deploySprite(setup.name, serviceEnv(saved));
      const remote = await remoteVersion(saved.url);
      if (!remote) {
        send(res, 502, { error: "sprite was created, but the server did not answer /version" });
        return;
      }
      state.sprites = [saved];
      await saveState(state);
      try {
        await pushCronKey(saved);
      } catch {
        // The service env already has the key. Settings can write the file later.
      }
      send(res, 201, {
        name: setup.name,
        url: saved.url,
        remoteVersion: remote,
        connectorType: setup.connectorType,
        baseApiUrl: setup.baseApiUrl,
        model: setup.model,
        voice: publicVoice(voice),
        cron: publicCron(cronApiKey),
      });
      return;
    }
    const cronMatch = url.pathname.match(/^\/api\/sprites\/([^/]+)\/cron$/);
    if (cronMatch && req.method === "POST") {
      let name: string;
      try {
        name = decodeURIComponent(cronMatch[1] ?? "");
      } catch {
        send(res, 404, { error: "not found" });
        return;
      }
      const saved = state.sprites.find((item) => item.name === name);
      if (!saved) {
        send(res, 404, { error: "sprite is not managed by this client" });
        return;
      }
      const read = readCronSettings(await readBody(req), saved.cronApiKey ?? null);
      if ("error" in read) {
        send(res, 400, { error: read.error });
        return;
      }
      const next = "unchanged" in read ? saved : withCron(saved, read.apiKey);
      if (next !== saved) {
        state.sprites = state.sprites.map((item) => item.name === next.name ? next : item);
        await saveState(state);
        await pushCronKey(next);
      }
      send(res, 200, { cron: publicCron(next.cronApiKey) });
      return;
    }
    const voiceMatch = matchVoicePath(url.pathname);
    if (voiceMatch) {
      const saved = state.sprites.find((item) => item.name === voiceMatch.name);
      if (!saved) {
        send(res, 404, { error: "sprite is not managed by this client" });
        return;
      }
      await handleLiveVoice(state, saved, voiceMatch, req, res);
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
        saved.voiceApiKey ?? "",
        saved.cronApiKey ?? "",
        saved.connectorId ?? "",
        saved.connectorId ? gatewayBaseUrl(saved.connectorId) : "",
      ]);
      res.writeHead(200, archiveHeaders(archive.filename, archive.zip.length));
      res.end(archive.zip);
      return;
    }
    const activityRoute = url.pathname.match(/^\/api\/sprites\/([^/]+)\/activity$/);
    if (activityRoute && req.method === "GET") {
      const saved = state.sprites.find((item) => item.name === activityRoute[1]);
      if (!saved) {
        send(res, 404, { error: "sprite is not managed by this client" });
        return;
      }
      const response = await spriteFetch(saved, "/api/bots/activity");
      send(res, response.status, await response.json());
      return;
    }
    const peerRoute = url.pathname.match(/^\/api\/sprites\/([^/]+)\/bots\/([^/]+)\/(steer|peers)$/);
    if (peerRoute) {
      const saved = state.sprites.find((item) => item.name === peerRoute[1]);
      if (!saved) {
        send(res, 404, { error: "sprite is not managed by this client" });
        return;
      }
      const target = `/api/bots/${peerRoute[2]}/${peerRoute[3]}`;
      if (peerRoute[3] === "steer" && req.method === "POST") {
        const response = await spriteFetch(saved, target, { method: "POST", body: JSON.stringify(await readBody(req)) });
        send(res, response.status, await response.json());
        return;
      }
      if (peerRoute[3] === "peers" && req.method === "GET") {
        const response = await spriteFetch(saved, target);
        send(res, response.status, await response.json());
        return;
      }
      send(res, 404, { error: "not found" });
      return;
    }
    const featurePaths = ["/search", "/main", "/main/check-in", "/bots/import"];
    const featureRoute = url.pathname.match(/^\/api\/sprites\/([^/]+)(\/.*)$/);
    if (featureRoute && featurePaths.includes(featureRoute[2] ?? "")) {
      const saved = state.sprites.find((item) => item.name === featureRoute[1]);
      if (!saved) {
        send(res, 404, { error: "sprite is not managed by this client" });
        return;
      }
      const tail = featureRoute[2] ?? "";
      if (tail === "/search" && (req.method ?? "GET") === "GET") {
        const response = await spriteFetch(saved, `/api/search${url.search}`);
        if (response.ok) {
          send(res, response.status, await response.json());
          return;
        }
        if (response.status !== 404) {
          const failed = await response.json().catch(() => null) as { error?: unknown } | null;
          send(res, response.status, { error: failed && typeof failed.error === "string" ? failed.error : "search failed" });
          return;
        }
        send(res, 200, await searchFromRoster(saved, url.searchParams.get("q") ?? ""));
        return;
      }
      await relaySprite(saved, `/api${tail}`, req, res);
      return;
    }
    const botExtra = url.pathname.match(/^\/api\/sprites\/([^/]+)\/bots\/([^/]+)\/(schedules|questions|files|work|template|spawn|main|memories|secrets|approvals|actions)(?:\/([^/]+))?(?:\/([^/]+))?$/);
    if (botExtra) {
      const saved = state.sprites.find((item) => item.name === botExtra[1]);
      if (!saved) {
        send(res, 404, { error: "sprite is not managed by this client" });
        return;
      }
      const tail = [botExtra[3], botExtra[4], botExtra[5]].filter((part): part is string => Boolean(part));
      await relaySprite(saved, `/api/bots/${botExtra[2]}/${tail.join("/")}`, req, res);
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
      try {
        const cleared = await spriteFetch(saved, "/api/schedules", { method: "DELETE" });
        if (cleared.status !== 404 && !cleared.ok) {
          const payload = await cleared.json().catch(() => null) as { error?: unknown } | null;
          const error = payload && typeof payload.error === "string" ? payload.error : "scheduled jobs were not deleted";
          send(res, cleared.status, { error });
          return;
        }
      } catch {
        // The sprite is not answering. Destroy still removes it.
      }
      if (saved.connectorId) await deleteConnector(saved.connectorId);
      await destroySprite(saved.name);
      clearSessions();
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
      await pushCronKey(ready);
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
    if (route[3] && req.method === "DELETE" && !url.pathname.endsWith("/messages")) {
      const response = await spriteFetch(saved, `/api/bots/${route[3]}`, { method: "DELETE" });
      if (response.ok) clearBotSessions(route[3]);
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

const pageUrl = "http://127.0.0.1:8787";

function openPage(url: string) {
  if (process.env.PI_ORBS_NO_OPEN === "1") return;
  const child = process.platform === "win32"
    ? spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true, windowsHide: true })
    : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

http.listen(8787, () => {
  if (localMode()) console.log(`pi-orbs local simulator ${pageUrl} (no Sprite, no xAI)`);
  else console.log(`pi-orbs client ${pageUrl}`);
  openPage(pageUrl);
});
