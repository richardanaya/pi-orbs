// In-memory stand-in for a Sprite. Used only when PI_ORBS_MODE=local or --local.
import type { IncomingMessage, ServerResponse } from "node:http";
import { localVersion } from "./deploy.js";

type Kind = "pi.user" | "pi.assistant";
type Message = { id: string; kind: Kind; text: string };
type Bot = { id: string; name: string; conversationId: string; messages: Message[] };
type Sprite = { name: string; url: string };

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
      messages: [
        message("pi.user", "What can the other bots see?"),
        message("pi.assistant", "The work directory. Bots on this sprite share that disk and keep their own threads."),
      ],
    },
    {
      id: "nova",
      name: "Nova",
      conversationId: "nova",
      messages: [
        message("pi.user", "Suggest a short name for a bot that writes commit messages."),
        message("pi.assistant", "Call it Scribe. One job, one thread, the same computer as the others."),
      ],
    },
  ];
}

function reset(name: string): void {
  sprite = { name, url: localUrl };
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

function publicBot(bot: Bot): { id: string; name: string; conversationId: string } {
  return { id: bot.id, name: bot.name, conversationId: bot.conversationId };
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

export async function handleLocal(url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (url.pathname === "/api/sprites" && req.method === "GET") {
    const version = await localVersion();
    send(res, 200, {
      localVersion: version,
      simulator: true,
      sprite: sprite
        ? { name: sprite.name, url: sprite.url, remoteVersion: version, update: false }
        : null,
    });
    return;
  }
  if (url.pathname === "/api/sprites" && req.method === "POST") {
    const body = await readJson(req);
    const name = textField(body, "name");
    const xaiKey = textField(body, "xaiKey");
    if (!name || !xaiKey) {
      send(res, 400, { error: "name and xaiKey are required" });
      return;
    }
    reset(name);
    send(res, 201, { name, url: localUrl, remoteVersion: await localVersion() });
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
    send(res, 200, { ok: true, version: await localVersion() });
    return;
  }
  if (rest.length === 0 && req.method === "GET") {
    const version = await localVersion();
    send(res, 200, {
      name: sprite.name,
      url: sprite.url,
      remoteVersion: version,
      update: false,
      bots: bots.map(publicBot),
    });
    return;
  }
  if (rest[0] === "bots" && rest.length === 1 && req.method === "POST") {
    const botName = textField(await readJson(req), "name");
    if (!botName) {
      send(res, 400, { error: "name is required" });
      return;
    }
    const id = `bot-${nextBot++}`;
    const bot: Bot = { id, name: botName, conversationId: id, messages: [] };
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
