import { timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import { ConversationBusy, createRegistry, Harness, type Conversation, type ConversationId } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import type { EntryRecord } from "@earendil-works/pi-durable";

const here = dirname(fileURLToPath(import.meta.url));
const version = (await readFile(join(here, "../VERSION"), "utf8").catch(() => readFile(join(here, "VERSION"), "utf8"))).trim();
const port = Number(process.env.PORT ?? 8080);
const secret = process.env.PI_API_SECRET ?? "";
const modelId = process.env.PI_MODEL ?? "grok-4.7";
const dbPath = process.env.PI_DB ?? "./data/agent.sqlite";
const botsPath = process.env.PI_BOTS ?? dbPath.replace(/[^/]+$/, "bots.json");
const workdir = process.env.PI_CWD ?? process.cwd();
const context = BACKGROUND_CONTEXT;

type BotRecord = { id: string; name: string; conversationId: string };
type BotsFile = { bots: BotRecord[] };

const models = createModels();
models.setProvider(xaiProvider());
const grok = models.getModel("xai", modelId);
if (grok) {
  grok.compat = { ...grok.compat, supportsMidConvoSystemMessages: true };
  if (process.env.PI_XAI_BASE_URL) grok.baseUrl = process.env.PI_XAI_BASE_URL;
}

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

async function loadBots(): Promise<BotRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(botsPath, "utf8")) as BotsFile;
    return parsed.bots ?? [];
  } catch {
    return [];
  }
}

async function saveBots(bots: BotRecord[]): Promise<void> {
  await mkdir(dirname(botsPath), { recursive: true });
  await writeFile(botsPath, JSON.stringify({ bots }, null, 2));
}

async function conversationFor(id: string): Promise<Conversation> {
  const cached = conversations.get(id);
  if (cached) return cached;
  const conversation = await harness.conversation(Number(id) as ConversationId, context);
  if (!conversation) throw new Error("missing conversation");
  await conversation.configure({ extensions: [CodingTools], cwd: workdir }, context);
  conversations.set(id, conversation);
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
  const model = entry.model as { content?: unknown; text?: unknown } | undefined;
  if (!model) return "";
  if (typeof model.text === "string") return model.text;
  if (!Array.isArray(model.content)) return "";
  return model.content.map((block) => {
    if (typeof block === "string") return block;
    if (block && typeof block === "object" && "text" in block && typeof block.text === "string") return block.text;
    return "";
  }).join("");
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
      "access-control-allow-methods": "GET, POST, OPTIONS",
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
      const body = await readBody(req) as { name?: string };
      const name = body.name?.trim();
      if (!name) {
        send(res, 400, { error: "name is required" });
        return;
      }
      const conversation = await harness.createConversation({
        ownership: { kind: "ownerless" },
        agent: { model: { provider: "xai", modelId }, cwd: workdir },
      }, context);
      await conversation.configure({ extensions: [CodingTools], cwd: workdir }, context);
      const bot: BotRecord = { id: String(conversation.id), name, conversationId: String(conversation.id) };
      conversations.set(bot.id, conversation);
      const bots = await loadBots();
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
