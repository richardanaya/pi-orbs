import { timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { ConversationBusy, createRegistry, Harness, type Conversation, type ConversationId } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import type { EntryRecord } from "@earendil-works/pi-durable";
import { installSharedModel, sharedModel } from "./model.js";

const here = dirname(fileURLToPath(import.meta.url));
const version = (await readFile(join(here, "../VERSION"), "utf8").catch(() => readFile(join(here, "VERSION"), "utf8"))).trim();
const port = Number(process.env.PORT ?? 8080);
const secret = process.env.PI_API_SECRET ?? "";
const dbPath = process.env.PI_DB ?? "./data/agent.sqlite";
const botsPath = process.env.PI_BOTS ?? dbPath.replace(/[^/]+$/, "bots.json");
const workdir = process.env.PI_CWD ?? process.cwd();
const context = BACKGROUND_CONTEXT;

const LOOKS = ["slate", "silver", "mist", "tide", "pine", "amber", "clay", "plum"] as const;
const NAME_MAX = 80;
const INSTRUCTION_MAX = 8_000;

type Look = (typeof LOOKS)[number];
type BotRecord = {
  id: string;
  name: string;
  conversationId: string;
  instruction: string;
  look: Look;
};
type BotsFile = { bots: BotRecord[] };
type FieldPatch = { name?: string; instruction?: string; look?: Look };

const models = createModels();
installSharedModel(models);

await mkdir(dirname(dbPath), { recursive: true });
const storage = await openNodeSqliteStorage(dbPath);
const registry = createRegistry();
const harness = await Harness.open(storage, {
  models,
  registry,
  env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? workdir }),
}, context);
harness.resume();

const conversations = new Map<string, Conversation>();

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

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

function readFields(body: unknown, mode: "create" | "edit"): FieldPatch | { error: string } {
  const record = asRecord(body);
  const has = (key: string) => Object.prototype.hasOwnProperty.call(record, key);
  const patch: FieldPatch = {};
  if (mode === "create" || has("name")) {
    const name = record.name;
    if (typeof name !== "string" || name.trim().length === 0) return { error: "name is required" };
    const trimmed = name.trim();
    if (trimmed.length > NAME_MAX) return { error: "name is too long" };
    patch.name = trimmed;
  }
  if (mode === "create" || has("instruction")) {
    if (mode === "create" && !has("instruction")) {
      patch.instruction = "";
    } else {
      const instruction = record.instruction;
      if (typeof instruction !== "string") return { error: "instruction must be a string" };
      const trimmed = instruction.trim();
      if (trimmed.length > INSTRUCTION_MAX) return { error: "instruction is too long" };
      patch.instruction = trimmed;
    }
  }
  if (has("look")) {
    if (!isLook(record.look)) return { error: "look is not recognized" };
    patch.look = record.look;
  }
  if (mode === "edit" && patch.name === undefined && patch.instruction === undefined && patch.look === undefined) {
    return { error: "nothing to update" };
  }
  return patch;
}

function normalizeBots(parsed: unknown): BotRecord[] {
  const list = parsed && typeof parsed === "object" && Array.isArray((parsed as BotsFile).bots)
    ? (parsed as BotsFile).bots
    : [];
  const used: string[] = [];
  const bots: BotRecord[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const id = typeof item.id === "string" ? item.id : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const conversationId = typeof item.conversationId === "string" && item.conversationId ? item.conversationId : id;
    if (!id || !name || !conversationId) continue;
    const instruction = typeof item.instruction === "string" ? item.instruction.trim().slice(0, INSTRUCTION_MAX) : "";
    const look = isLook(item.look) ? item.look : nextLook(used);
    used.push(look);
    bots.push({ id, name: name.slice(0, NAME_MAX), conversationId, instruction, look });
  }
  return bots;
}

async function loadBots(): Promise<BotRecord[]> {
  try {
    return normalizeBots(JSON.parse(await readFile(botsPath, "utf8")) as unknown);
  } catch {
    return [];
  }
}

async function applyInstruction(conversation: Conversation, instruction: string): Promise<void> {
  // The reserved instructions section is rendered on the next request. With
  // supportsMidConvoSystemMessages, that change stays a mid-conversation system update.
  await conversation.configure({ instructions: instruction.length > 0 ? instruction : null }, context);
}

async function saveBots(bots: BotRecord[]): Promise<void> {
  await mkdir(dirname(botsPath), { recursive: true });
  await writeFile(botsPath, JSON.stringify({ bots }, null, 2));
}

async function conversationFor(id: string): Promise<Conversation> {
  let conversation = conversations.get(id);
  if (!conversation) {
    const opened = await harness.conversation(Number(id) as ConversationId, context);
    if (!opened) throw new Error("missing conversation");
    conversation = opened;
    await conversation.configure({ extensions: [CodingTools], cwd: workdir }, context);
    conversations.set(id, conversation);
  }
  const agent = await conversation.agent(context);
  const shared = sharedModel();
  if (agent.model?.provider !== shared.provider || agent.model?.modelId !== shared.modelId) {
    await conversation.configure({ model: shared }, context);
  }
  return conversation;
}

function authorized(req: IncomingMessage): boolean {
  if (secret.length === 0) return false;
  const header = req.headers.authorization ?? "";
  const alt = req.headers["x-api-key"];
  const token = header.startsWith("Bearer ") ? header.slice(7) : (Array.isArray(alt) ? alt[0] : alt) ?? "";
  const given = Buffer.from(token);
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function textOf(entry: EntryRecord): string {
  const parts: string[] = [];
  for (const message of entry.model ?? []) {
    const content = message.content as unknown;
    if (typeof content === "string") {
      parts.push(content);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object" || !("text" in block) || typeof block.text !== "string") continue;
      if ("type" in block && block.type === "thinking") continue;
      parts.push(block.text);
    }
  }
  return parts.join("");
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
}

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type, x-api-key",
      "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
    });
    res.end();
    return;
  }
  if (url.pathname === "/version") {
    send(res, 200, { version });
    return;
  }
  if (!authorized(req)) {
    send(res, 401, { error: "unauthorized" });
    return;
  }
  try {
    if (url.pathname === "/api/bots" && req.method === "GET") {
      send(res, 200, { bots: await loadBots() });
      return;
    }
    if (url.pathname === "/api/bots" && req.method === "POST") {
      const fields = readFields(await readBody(req), "create");
      if ("error" in fields) {
        send(res, 400, { error: fields.error });
        return;
      }
      const bots = await loadBots();
      const look = fields.look ?? nextLook(bots.map((item) => item.look));
      const instruction = fields.instruction ?? "";
      const conversation = await harness.createConversation({
        ownership: { kind: "ownerless" },
        agent: {
          model: sharedModel(),
          cwd: workdir,
          ...(instruction ? { instructions: instruction } : {}),
        },
      }, context);
      await conversation.configure({ extensions: [CodingTools], cwd: workdir }, context);
      const bot: BotRecord = {
        id: String(conversation.id),
        name: fields.name ?? "",
        conversationId: String(conversation.id),
        instruction,
        look,
      };
      conversations.set(bot.id, conversation);
      bots.push(bot);
      await saveBots(bots);
      send(res, 201, bot);
      return;
    }
    const messageRoute = url.pathname.match(/^\/api\/bots\/([^/]+)(\/messages)?$/);
    if (messageRoute && req.method === "GET") {
      const bots = await loadBots();
      const bot = bots.find((item) => item.id === messageRoute[1]);
      if (!bot) {
        send(res, 404, { error: "bot not found" });
        return;
      }
      const conversation = await conversationFor(bot.id);
      const entries = await conversation.entries({}, 200, undefined, context);
      const messages = entries.items
        .filter((entry) => entry.kind === "pi.user" || entry.kind === "pi.assistant")
        .map((entry) => ({ id: entry.id, kind: entry.kind, text: textOf(entry) }))
        .filter((entry) => entry.text.trim().length > 0)
        .reverse();
      send(res, 200, { bot, messages });
      return;
    }
    if (messageRoute && req.method === "PATCH" && !messageRoute[2]) {
      const fields = readFields(await readBody(req), "edit");
      if ("error" in fields) {
        send(res, 400, { error: fields.error });
        return;
      }
      const bots = await loadBots();
      const index = bots.findIndex((item) => item.id === messageRoute[1]);
      if (index < 0) {
        send(res, 404, { error: "bot not found" });
        return;
      }
      const current = bots[index];
      if (!current) {
        send(res, 404, { error: "bot not found" });
        return;
      }
      const instruction = fields.instruction !== undefined ? fields.instruction : current.instruction;
      if (instruction !== current.instruction) {
        await applyInstruction(await conversationFor(current.id), instruction);
      }
      const bot: BotRecord = {
        ...current,
        ...(fields.name !== undefined ? { name: fields.name } : {}),
        instruction,
        ...(fields.look !== undefined ? { look: fields.look } : {}),
      };
      bots[index] = bot;
      await saveBots(bots);
      send(res, 200, bot);
      return;
    }
    if (messageRoute && req.method === "POST" && messageRoute[2]) {
      const body = await readBody(req) as { content?: string; whenBusy?: "followUp" | "steer" | "reject" };
      const content = body.content?.trim();
      if (!content) {
        send(res, 400, { error: "content is required" });
        return;
      }
      const conversation = await conversationFor(messageRoute[1]);
      const submission = await conversation.submit({
        type: "input",
        content,
        ...(body.whenBusy ? { whenBusy: body.whenBusy } : {}),
      }, context);
      send(res, 202, { submissionId: submission.id });
      return;
    }
    send(res, 404, { error: "not found" });
  } catch (error) {
    if (error instanceof ConversationBusy) {
      send(res, 409, { error: "busy" });
      return;
    }
    send(res, 500, { error: error instanceof Error ? error.message : "error" });
  }
});

http.listen(port, () => {
  console.log(`pi-orbs server ${version} on ${port}`);
});
