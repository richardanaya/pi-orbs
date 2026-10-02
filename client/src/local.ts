// In-memory stand-in for a Sprite. Used only when PI_ORBS_MODE=local or --local.
import type { IncomingMessage, ServerResponse } from "node:http";
import { archiveHeaders, conversationsArchive, type ExportSnapshot } from "./archive.js";
import { defaultConnector, publicConnectors, readDeployUpdate, readSetup, type SpriteConnector } from "./connectors.js";
import { localVersion } from "./deploy.js";

const LOOKS = ["slate", "silver", "mist", "tide", "pine", "amber", "clay", "plum"] as const;
const NAME_MAX = 80;
const INSTRUCTION_MAX = 8_000;
const PEER_CONTENT_MAX = 8_000;
const PEER_LEDGER_MAX = 1_000;
const PEER_BUSY_MS = 12_000;

type Look = (typeof LOOKS)[number];
type Kind = "pi.user" | "pi.assistant";
type Message = { id: string; kind: Kind; text: string; createdAt: string };
type Peer = {
  id: string;
  from: string;
  to: string;
  fromName: string;
  toName: string;
  content: string;
  submissionId: string;
  entryId?: string;
  createdAt: string;
};
type Bot = {
  id: string;
  name: string;
  conversationId: string;
  instruction: string;
  look: Look;
  messages: Message[];
  busyUntil?: number;
};
type Sprite = { name: string; url: string } & SpriteConnector;
type FieldPatch = { name?: string; instruction?: string; look?: Look };

const localUrl = "http://127.0.0.1:8787";

const seedStart = Date.parse("2026-03-02T15:04:00.000Z");

let nextMessage = 1;
let nextBot = 1;
let nextPeer = 1;
let seedClock = 0;
let sprite: Sprite | null = null;
let bots: Bot[] = [];
let peers: Peer[] = [];

function message(kind: Kind, text: string, createdAt?: string): Message {
  const id = `m${nextMessage++}`;
  const at = createdAt ?? new Date(seedStart + seedClock * 1000).toISOString();
  if (!createdAt) seedClock += 30;
  return { id, kind, text, createdAt: at };
}

function publicMessage(item: Message): { id: string; kind: Kind; text: string } {
  return { id: item.id, kind: item.kind, text: item.text };
}

function seedBots(): Bot[] {
  nextMessage = 1;
  nextBot = 1;
  seedClock = 0;
  return [
    {
      id: "ada",
      name: "Ada",
      conversationId: "ada",
      instruction: "Sketch status pages on a black background.",
      look: "tide",
      messages: [
        message("pi.user", "Sketch a status page for this sprite. Black background, large type."),
        message("pi.assistant", "A single page is enough. The title is the sprite name, and one line under it says whether the server answered."),
        message("pi.user", "Keep that line in the same muted gray as the roster."),
        message("pi.assistant", "Done. status.html is in the work directory. Black page, large title, gray status line."),
      ],
    },
    {
      id: "kepler",
      name: "Kepler",
      conversationId: "kepler",
      instruction: "Answer questions about this sprite and its shared work directory.",
      look: "pine",
      messages: [
        message("pi.user", "What can the other bots see?"),
        message("pi.assistant", "The work directory. Bots on this sprite share that disk and keep their own threads."),
      ],
    },
    {
      id: "nova",
      name: "Nova",
      conversationId: "nova",
      instruction: "Suggest short names for bots.",
      look: "amber",
      messages: [
        message("pi.user", "Suggest a short name for a bot that writes commit messages."),
        message("pi.assistant", "Call it Scribe. One job, one thread, the same computer as the others."),
      ],
    },
  ];
}

function samplePeers(): Peer[] {
  return [
    {
      id: "peer-sample-1",
      from: "ada",
      to: "kepler",
      fromName: "Ada",
      toName: "Kepler",
      content: "The status line is in status.html. Same muted gray as the roster.",
      submissionId: "local-peer-sample-1",
      createdAt: new Date(seedStart + 120_000).toISOString(),
    },
    {
      id: "peer-sample-2",
      from: "kepler",
      to: "ada",
      fromName: "Kepler",
      toName: "Ada",
      content: "I see it. The work directory is shared, so that file is on my disk too.",
      submissionId: "local-peer-sample-2",
      createdAt: new Date(seedStart + 180_000).toISOString(),
    },
  ];
}

function reset(name: string, connector: SpriteConnector = defaultConnector(), sample = false): void {
  sprite = { name, url: localUrl, ...connector };
  bots = seedBots();
  peers = sample ? samplePeers() : [];
  nextPeer = 1;
}

function busyIds(): string[] {
  const now = Date.now();
  return bots.filter((bot) => (bot.busyUntil ?? 0) > now).map((bot) => bot.id);
}

reset("atlas", defaultConnector(), true);

export function localMode(): boolean {
  const mode = (process.env.PI_ORBS_MODE ?? "").trim().toLowerCase();
  return mode === "local" || process.argv.includes("--local");
}

export function cannedReply(content: string): string {
  const heard = content.length > 180 ? `${content.slice(0, 179)}…` : content;
  return `“${heard}” — noted. This is a canned reply from the local simulator. No model was called.`;
}

function isLook(value: unknown): value is Look {
  return typeof value === "string" && (LOOKS as readonly string[]).includes(value);
}

function nextLook(used: readonly string[]): Look {
  let best: Look = LOOKS[0];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const look of LOOKS) {
    let count = 0;
    for (const item of used) if (item === look) count += 1;
    if (count < bestCount) {
      best = look;
      bestCount = count;
    }
  }
  return best;
}

function readFields(body: Record<string, unknown>, mode: "create" | "edit"): FieldPatch | { error: string } {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const patch: FieldPatch = {};
  if (mode === "create" || has("name")) {
    const name = body.name;
    if (typeof name !== "string" || name.trim().length === 0) return { error: "name is required" };
    const trimmed = name.trim();
    if (trimmed.length > NAME_MAX) return { error: "name is too long" };
    patch.name = trimmed;
  }
  if (mode === "create" || has("instruction")) {
    if (mode === "create" && !has("instruction")) {
      patch.instruction = "";
    } else {
      const instruction = body.instruction;
      if (typeof instruction !== "string") return { error: "instruction must be a string" };
      const trimmed = instruction.trim();
      if (trimmed.length > INSTRUCTION_MAX) return { error: "instruction is too long" };
      patch.instruction = trimmed;
    }
  }
  if (has("look")) {
    if (!isLook(body.look)) return { error: "look is not recognized" };
    patch.look = body.look;
  }
  if (mode === "edit" && patch.name === undefined && patch.instruction === undefined && patch.look === undefined) {
    return { error: "nothing to update" };
  }
  return patch;
}

function publicBot(bot: Bot): { id: string; name: string; conversationId: string; instruction: string; look: Look } {
  return { id: bot.id, name: bot.name, conversationId: bot.conversationId, instruction: bot.instruction, look: bot.look };
}

function publicPeer(record: Peer): {
  id: string;
  from: string;
  to: string;
  fromName: string;
  toName: string;
  content: string;
  submissionId: string;
  entryId?: string;
  createdAt: string;
  delivery: "steer";
} {
  return {
    id: record.id,
    from: record.from,
    to: record.to,
    fromName: record.fromName,
    toName: record.toName,
    content: record.content,
    submissionId: record.submissionId,
    ...(record.entryId ? { entryId: record.entryId } : {}),
    createdAt: record.createdAt,
    delivery: "steer",
  };
}

function rememberPeer(record: Peer): void {
  peers.push(record);
  if (peers.length > PEER_LEDGER_MAX) peers = peers.slice(peers.length - PEER_LEDGER_MAX);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function localSnapshot(): ExportSnapshot {
  return {
    sprite: sprite?.name ?? "",
    exportedAt: new Date().toISOString(),
    bots: bots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      conversationId: bot.conversationId,
      instruction: bot.instruction,
      look: bot.look,
      messages: bot.messages.map((item) => ({
        id: item.id,
        kind: item.kind,
        text: item.text,
        createdAt: item.createdAt,
      })),
    })),
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function textField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

function spriteBody(version: string): Record<string, unknown> | null {
  if (!sprite) return null;
  return {
    name: sprite.name,
    url: sprite.url,
    remoteVersion: version,
    update: false,
    connectorType: sprite.connectorType,
    baseApiUrl: sprite.baseApiUrl,
    model: sprite.model,
  };
}

export async function handleLocal(url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (url.pathname === "/api/connector-presets" && req.method === "GET") {
    send(res, 200, { connectors: publicConnectors() });
    return;
  }
  if (url.pathname === "/api/sprites" && req.method === "GET") {
    const version = await localVersion();
    send(res, 200, {
      localVersion: version,
      simulator: true,
      sprite: spriteBody(version),
    });
    return;
  }
  if (url.pathname === "/api/sprites" && req.method === "POST") {
    const setup = readSetup(await readJson(req));
    if ("error" in setup) {
      send(res, 400, { error: setup.error });
      return;
    }
    reset(setup.name, { connectorType: setup.connectorType, baseApiUrl: setup.baseApiUrl, model: setup.model });
    send(res, 201, {
      name: setup.name,
      url: localUrl,
      remoteVersion: await localVersion(),
      connectorType: setup.connectorType,
      baseApiUrl: setup.baseApiUrl,
      model: setup.model,
    });
    return;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "api" || parts[1] !== "sprites") {
    send(res, 404, { error: "not found" });
    return;
  }
  let name: string;
  try {
    name = decodeURIComponent(parts[2] ?? "");
  } catch {
    send(res, 404, { error: "not found" });
    return;
  }
  if (!sprite || sprite.name !== name) {
    send(res, 404, { error: "sprite is not managed by this client" });
    return;
  }

  const rest = parts.slice(3);
  if (rest.length === 0 && req.method === "DELETE") {
    sprite = null;
    bots = [];
    peers = [];
    send(res, 200, { ok: true });
    return;
  }
  if (rest.length === 1 && rest[0] === "conversations.zip" && req.method === "GET") {
    const archive = conversationsArchive(localSnapshot());
    res.writeHead(200, archiveHeaders(archive.filename, archive.zip.length));
    res.end(archive.zip);
    return;
  }
  if (rest.length === 1 && rest[0] === "deploy" && req.method === "POST") {
    const next = readDeployUpdate(await readJson(req), sprite);
    if ("error" in next) {
      send(res, 400, { error: next.error });
      return;
    }
    sprite = { ...sprite, ...next };
    send(res, 200, { ok: true, version: await localVersion() });
    return;
  }
  if (rest.length === 1 && rest[0] === "activity" && req.method === "GET") {
    send(res, 200, { busy: busyIds() });
    return;
  }
  if (rest.length === 0 && req.method === "GET") {
    const version = await localVersion();
    send(res, 200, {
      ...(spriteBody(version) ?? {}),
      bots: bots.map(publicBot),
    });
    return;
  }
  if (rest[0] === "bots" && rest.length === 1 && req.method === "POST") {
    const fields = readFields(await readJson(req), "create");
    if ("error" in fields) {
      send(res, 400, { error: fields.error });
      return;
    }
    const id = `bot-${nextBot++}`;
    const bot: Bot = {
      id,
      name: fields.name ?? "",
      conversationId: id,
      instruction: fields.instruction ?? "",
      look: fields.look ?? nextLook(bots.map((item) => item.look)),
      messages: [],
    };
    bots.push(bot);
    send(res, 201, publicBot(bot));
    return;
  }
  if (rest[0] === "bots" && rest.length >= 2 && rest[1]) {
    let id: string;
    try {
      id = decodeURIComponent(rest[1]);
    } catch {
      send(res, 404, { error: "not found" });
      return;
    }
    const bot = bots.find((item) => item.id === id);
    if (!bot) {
      send(res, 404, { error: "bot not found" });
      return;
    }
    if (rest.length === 2 && req.method === "GET") {
      send(res, 200, { bot: publicBot(bot), messages: bot.messages.map(publicMessage) });
      return;
    }
    if (rest.length === 2 && req.method === "PATCH") {
      const fields = readFields(await readJson(req), "edit");
      if ("error" in fields) {
        send(res, 400, { error: fields.error });
        return;
      }
      if (fields.name !== undefined) bot.name = fields.name;
      if (fields.instruction !== undefined) bot.instruction = fields.instruction;
      if (fields.look !== undefined) bot.look = fields.look;
      send(res, 200, publicBot(bot));
      return;
    }
    if (rest.length === 2 && req.method === "DELETE") {
      const index = bots.findIndex((item) => item.id === bot.id);
      if (index >= 0) bots.splice(index, 1);
      for (let i = peers.length - 1; i >= 0; i -= 1) {
        const peer = peers[i];
        if (peer && (peer.from === bot.id || peer.to === bot.id)) peers.splice(i, 1);
      }
      send(res, 200, { ok: true });
      return;
    }
    if (rest.length === 3 && rest[2] === "peers" && req.method === "GET") {
      send(res, 200, { peers: peers.filter((item) => item.from === bot.id || item.to === bot.id).map(publicPeer) });
      return;
    }
    if (rest.length === 3 && rest[2] === "messages" && req.method === "POST") {
      const content = textField(await readJson(req), "content");
      if (!content) {
        send(res, 400, { error: "content is required" });
        return;
      }
      const at = new Date();
      bot.messages.push(message("pi.user", content, at.toISOString()));
      bot.messages.push(message("pi.assistant", cannedReply(content), new Date(at.getTime() + 1000).toISOString()));
      send(res, 202, { submissionId: `local-${bot.messages.at(-1)?.id ?? "reply"}` });
      return;
    }
    if (rest.length === 3 && rest[2] === "steer" && req.method === "POST") {
      const body = await readJson(req);
      const fromId = textField(body, "from");
      const content = textField(body, "content");
      if (!fromId) {
        send(res, 400, { error: "from is required" });
        return;
      }
      if (!content) {
        send(res, 400, { error: "content is required" });
        return;
      }
      if (content.length > PEER_CONTENT_MAX) {
        send(res, 400, { error: "content is too long" });
        return;
      }
      if (fromId === bot.id) {
        send(res, 400, { error: "a bot cannot steer itself" });
        return;
      }
      const source = bots.find((item) => item.id === fromId);
      if (!source) {
        send(res, 404, { error: "bot not found" });
        return;
      }
      const id = `peer-${nextPeer++}`;
      const record: Peer = {
        id,
        from: source.id,
        to: bot.id,
        fromName: source.name,
        toName: bot.name,
        content,
        submissionId: `local-${id}`,
        createdAt: new Date().toISOString(),
      };
      rememberPeer(record);
      bot.busyUntil = Date.now() + PEER_BUSY_MS;
      send(res, 202, publicPeer(record));
      return;
    }
  }
  send(res, 404, { error: "not found" });
}
