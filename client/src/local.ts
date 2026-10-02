// In-memory stand-in for a Sprite. Used only when PI_ORBS_MODE=local or --local.
import type { IncomingMessage, ServerResponse } from "node:http";
import { defaultConnector, publicConnectors, readDeployUpdate, readSetup, type SpriteConnector } from "./connectors.js";
import { localVersion } from "./deploy.js";

const LOOKS = ["slate", "silver", "mist", "tide", "pine", "amber", "clay", "plum"] as const;
const NAME_MAX = 80;
const INSTRUCTION_MAX = 8_000;

type Look = (typeof LOOKS)[number];
type Kind = "pi.user" | "pi.assistant";
type Message = { id: string; kind: Kind; text: string };
type Bot = {
  id: string;
  name: string;
  conversationId: string;
  instruction: string;
  look: Look;
  messages: Message[];
};
type Sprite = { name: string; url: string } & SpriteConnector;
type FieldPatch = { name?: string; instruction?: string; look?: Look };

const localUrl = "http://127.0.0.1:8787";

let nextMessage = 1;
let nextBot = 1;
let sprite: Sprite | null = null;
let bots: Bot[] = [];

function message(kind: Kind, text: string): Message {
  const id = `m${nextMessage++}`;
  return { id, kind, text };
}

function seedBots(): Bot[] {
  nextMessage = 1;
  nextBot = 1;
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

function reset(name: string, connector: SpriteConnector = defaultConnector()): void {
  sprite = { name, url: localUrl, ...connector };
  bots = seedBots();
}

reset("atlas");

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

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
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
    send(res, 200, { ok: true });
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
      send(res, 200, { bot: publicBot(bot), messages: bot.messages });
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
    if (rest.length === 3 && rest[2] === "messages" && req.method === "POST") {
      const content = textField(await readJson(req), "content");
      if (!content) {
        send(res, 400, { error: "content is required" });
        return;
      }
      bot.messages.push(message("pi.user", content));
      bot.messages.push(message("pi.assistant", cannedReply(content)));
      send(res, 202, { submissionId: `local-${bot.messages.at(-1)?.id ?? "reply"}` });
      return;
    }
  }
  send(res, 404, { error: "not found" });
}
