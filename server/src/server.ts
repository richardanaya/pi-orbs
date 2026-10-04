import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { ConversationBusy, createRegistry, defineExtension, defineTool, Harness, section, type Conversation, type ConversationId, type Cursor, type EntryRecord, type Extension, type SubmissionId } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { installSharedModel, sharedModel } from "./model.js";
import { hiddenThreadEntryIds, normalizePeers, outgoingHop, PEER_CONTENT_MAX, PEER_LEDGER_MAX, PEER_REQUEST_PREFIX, peerChainUsed, peerPrompt, peerTurn, publicPeer, readSteer, resolvePeerTarget, withPeerInstruction, withPeerLines, type PeerRecord, type PublicPeer } from "./peers.js";
import { CRON_API_DEFAULT, CRON_KEY_MAX, deleteCronJob, fetchCron, newHookToken, putCronJob, readHookBody, readScheduleRequest, scheduleTitle, tokensEqual, validHookToken, webhookUrl } from "./schedule.js";

const here = dirname(fileURLToPath(import.meta.url));
const version = (await readFile(join(here, "../VERSION"), "utf8").catch(() => readFile(join(here, "VERSION"), "utf8"))).trim();
const port = Number(process.env.PORT ?? 8080);
const secret = process.env.PI_API_SECRET ?? "";
const dbPath = process.env.PI_DB ?? "./data/agent.sqlite";
const botsPath = process.env.PI_BOTS ?? dbPath.replace(/[^/]+$/, "bots.json");
const peersPath = process.env.PI_PEERS ?? botsPath.replace(/[^/]+$/, "peers.json");
const schedulesPath = process.env.PI_SCHEDULES ?? botsPath.replace(/[^/]+$/, "schedules.json");
const cronKeyPath = process.env.PI_CRON_KEY ?? botsPath.replace(/[^/]+$/, "cron.json");
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
  hookToken: string;
};
type ScheduleRecord = { botId: string; jobId: number; requestKey: string };
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

function normalizeBots(parsed: unknown): { bots: BotRecord[]; changed: boolean } {
  const list = parsed && typeof parsed === "object" && Array.isArray((parsed as BotsFile).bots)
    ? (parsed as BotsFile).bots
    : [];
  const used: string[] = [];
  const bots: BotRecord[] = [];
  let changed = false;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const id = typeof item.id === "string" ? item.id : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const conversationId = typeof item.conversationId === "string" && item.conversationId ? item.conversationId : id;
    if (!id || !name || !conversationId) continue;
    const instruction = typeof item.instruction === "string" ? item.instruction.trim().slice(0, INSTRUCTION_MAX) : "";
    const look = isLook(item.look) ? item.look : nextLook(used);
    used.push(look);
    const hookToken = validHookToken(item.hookToken) ? item.hookToken : newHookToken();
    if (hookToken !== item.hookToken) changed = true;
    bots.push({ id, name: name.slice(0, NAME_MAX), conversationId, instruction, look, hookToken });
  }
  return { bots, changed };
}

function publicBot(bot: BotRecord): Omit<BotRecord, "hookToken"> {
  return {
    id: bot.id,
    name: bot.name,
    conversationId: bot.conversationId,
    instruction: bot.instruction,
    look: bot.look,
  };
}

async function loadBots(): Promise<BotRecord[]> {
  try {
    const normalized = normalizeBots(JSON.parse(await readFile(botsPath, "utf8")) as unknown);
    if (normalized.changed) await saveBots(normalized.bots);
    return normalized.bots;
  } catch {
    return [];
  }
}

async function applyInstruction(conversation: Conversation, instruction: string): Promise<void> {
  // The reserved instructions section is rendered on the next request. With
  // supportsMidConvoSystemMessages, that change stays a mid-conversation system update.
  await conversation.configure({ instructions: withPeerInstruction(instruction) }, context);
}

async function saveBots(bots: BotRecord[]): Promise<void> {
  await mkdir(dirname(botsPath), { recursive: true });
  await writeFile(botsPath, JSON.stringify({ bots }, null, 2));
}

let cronApiKey = (process.env.CRON_JOB_ORG_API_KEY ?? "").trim();
const cronCall = fetchCron((process.env.CRON_JOB_ORG_API ?? CRON_API_DEFAULT).trim() || CRON_API_DEFAULT);

async function loadCronKey(): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(cronKeyPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || !("apiKey" in parsed)) return;
    const apiKey = (parsed as { apiKey?: unknown }).apiKey;
    if (typeof apiKey !== "string") return;
    cronApiKey = apiKey.trim();
  } catch {
    // No file yet. The service env value stands.
  }
}

async function saveCronKey(apiKey: string): Promise<void> {
  cronApiKey = apiKey.trim();
  await mkdir(dirname(cronKeyPath), { recursive: true });
  await writeFile(cronKeyPath, JSON.stringify({ apiKey: cronApiKey }));
}

function normalizeSchedules(parsed: unknown): ScheduleRecord[] {
  const list = parsed && typeof parsed === "object" && Array.isArray((parsed as { jobs?: unknown }).jobs)
    ? (parsed as { jobs: unknown[] }).jobs
    : [];
  const jobs: ScheduleRecord[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as { botId?: unknown; jobId?: unknown; requestKey?: unknown };
    const botId = typeof record.botId === "string" ? record.botId : "";
    const requestKey = typeof record.requestKey === "string" ? record.requestKey : "";
    if (!botId || !requestKey || typeof record.jobId !== "number" || !Number.isInteger(record.jobId)) continue;
    jobs.push({ botId, jobId: record.jobId, requestKey });
  }
  return jobs;
}

async function loadSchedules(): Promise<ScheduleRecord[]> {
  try {
    return normalizeSchedules(JSON.parse(await readFile(schedulesPath, "utf8")) as unknown);
  } catch {
    return [];
  }
}

async function saveSchedules(jobs: ScheduleRecord[]): Promise<void> {
  await mkdir(dirname(schedulesPath), { recursive: true });
  await writeFile(schedulesPath, JSON.stringify({ jobs }, null, 2));
}

function spritePublicUrl(): string | null {
  const value = (process.env.PI_PUBLIC_URL ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function scheduleMessage(botId: string, message: string, cron: string, timezone: string | undefined, requestKey: string): Promise<{ jobId: number } | { error: string }> {
  if (!cronApiKey) return { error: "cron-job.org API key is not configured" };
  const base = spritePublicUrl();
  if (!base) return { error: "this server has no public URL" };
  const read = readScheduleRequest({ message, cron, ...(timezone ? { timezone } : {}) });
  if ("error" in read) return { error: read.error };
  const bots = await loadBots();
  const bot = bots.find((item) => item.id === botId);
  if (!bot) return { error: "bot not found" };
  const jobs = await loadSchedules();
  const existing = jobs.find((item) => item.requestKey === requestKey);
  if (existing) return { jobId: existing.jobId };
  const created = await putCronJob(cronCall, cronApiKey, {
    url: webhookUrl(base, bot.hookToken),
    title: scheduleTitle(bot.name),
    message: read.message,
    schedule: read.schedule,
  });
  if ("error" in created) return { error: created.error };
  jobs.push({ botId: bot.id, jobId: created.jobId, requestKey });
  await saveSchedules(jobs);
  return { jobId: created.jobId };
}

async function deleteScheduleRecords(records: ScheduleRecord[]): Promise<{ ok: true } | { error: string; status: number }> {
  if (records.length === 0) return { ok: true };
  if (!cronApiKey) return { error: "cron-job.org API key is not configured", status: 409 };
  for (const record of records) {
    const removed = await deleteCronJob(cronCall, cronApiKey, record.jobId);
    if ("error" in removed) return removed;
  }
  const drop = new Set(records.map((item) => item.requestKey));
  const jobs = (await loadSchedules()).filter((item) => !drop.has(item.requestKey));
  await saveSchedules(jobs);
  return { ok: true };
}

let peerExtension: Extension | undefined;
let scheduleExtension: Extension | undefined;
let peerQueue: Promise<unknown> = Promise.resolve();

function botExtensions() {
  const extensions: Extension[] = [CodingTools];
  if (peerExtension) extensions.push(peerExtension);
  if (scheduleExtension) extensions.push(scheduleExtension);
  return extensions;
}

function enqueuePeers<T>(work: () => Promise<T>): Promise<T> {
  const run = peerQueue.then(work, work);
  peerQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function loadPeers(): Promise<PeerRecord[]> {
  try {
    return normalizePeers(JSON.parse(await readFile(peersPath, "utf8")) as unknown);
  } catch {
    return [];
  }
}

async function savePeers(peers: PeerRecord[]): Promise<void> {
  const kept = peers.length > PEER_LEDGER_MAX ? peers.slice(peers.length - PEER_LEDGER_MAX) : peers;
  await mkdir(dirname(peersPath), { recursive: true });
  await writeFile(peersPath, JSON.stringify({ peers: kept }, null, 2));
}

async function peerEntryIds(): Promise<Set<string>> {
  return enqueuePeers(async () => {
    const peers = await loadPeers();
    let changed = false;
    const ids = new Set<string>();
    for (const peer of peers) {
      if (!peer.entryId && /^\d+$/.test(peer.submissionId)) {
        const handle = await harness.submission(Number(peer.submissionId) as SubmissionId, context);
        const admitted = handle ? await handle.status(context) : undefined;
        if (admitted && admitted.type === "input" && admitted.status !== "queued" && admitted.entry != null) {
          peer.entryId = String(admitted.entry);
          changed = true;
        }
      }
      if (peer.entryId) ids.add(peer.entryId);
    }
    if (changed) await savePeers(peers);
    return ids;
  });
}

type SteerResult = { status: number; body: PublicPeer | { error: string } };

async function steerPeer(targetId: string, fromId: string, content: string, requestId: string, hop = 1, parentId?: string, callContext: Context = context): Promise<SteerResult> {
  const trimmed = content.trim();
  if (!trimmed) return { status: 400, body: { error: "content is required" } };
  if (trimmed.length > PEER_CONTENT_MAX) return { status: 400, body: { error: "content is too long" } };
  if (fromId === targetId) return { status: 400, body: { error: "a bot cannot steer itself" } };
  const bots = await loadBots();
  const target = bots.find((item) => item.id === targetId);
  const source = bots.find((item) => item.id === fromId);
  if (!target || !source) return { status: 404, body: { error: "bot not found" } };
  return enqueuePeers(async () => {
    const peers = await loadPeers();
    const prior = peers.find((item) => item.requestId === requestId);
    if (prior) return { status: 202, body: publicPeer(prior) };
    if (parentId && peerChainUsed(peers, fromId, parentId)) {
      return { status: 409, body: { error: "peer chain is closed" } };
    }
    const conversation = await conversationFor(target.id);
    const submission = await conversation.submit({
      type: "input",
      content: peerPrompt(source.name, source.id, trimmed, hop, requestId.startsWith(PEER_REQUEST_PREFIX) ? requestId.slice(PEER_REQUEST_PREFIX.length) : requestId),
      whenBusy: "steer",
      requestId,
    }, callContext);
    const admitted = await submission.status(callContext);
    const entryId = admitted.status === "placed" || admitted.status === "done" ? String(admitted.entry) : undefined;
    const record: PeerRecord = {
      id: requestId.startsWith(PEER_REQUEST_PREFIX) ? requestId.slice(PEER_REQUEST_PREFIX.length) : requestId,
      from: source.id,
      to: target.id,
      fromName: source.name,
      toName: target.name,
      content: trimmed,
      requestId,
      submissionId: String(submission.id),
      ...(entryId ? { entryId } : {}),
      hop,
      ...(parentId ? { parentId } : {}),
      createdAt: new Date().toISOString(),
    };
    peers.push(record);
    await savePeers(peers);
    return { status: 202, body: publicPeer(record) };
  });
}

async function conversationFor(id: string): Promise<Conversation> {
  let conversation = conversations.get(id);
  if (!conversation) {
    const opened = await harness.conversation(Number(id) as ConversationId, context);
    if (!opened) throw new Error("missing conversation");
    conversation = opened;
    await conversation.configure({ extensions: botExtensions(), cwd: workdir }, context);
    conversations.set(id, conversation);
    const bots = await loadBots();
    const bot = bots.find((item) => item.id === id);
    if (bot) await applyInstruction(conversation, bot.instruction);
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

function redactSecrets(text: string, secrets: readonly string[]): string {
  const needles = [...new Set(secrets.filter((item) => item.length >= 16))].sort((a, b) => b.length - a.length);
  let out = text;
  for (const needle of needles) out = out.split(needle).join("[redacted]");
  return out;
}

function createdAtOf(entry: EntryRecord): string | null {
  for (const message of entry.model ?? []) {
    const timestamp = message.timestamp;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) continue;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) continue;
    return date.toISOString();
  }
  return null;
}

function exportSecrets(extra: readonly string[] = []): string[] {
  return [secret, process.env.PI_BASE_URL ?? "", process.env.PI_XAI_BASE_URL ?? "", process.env.XAI_API_KEY ?? "", process.env.OPENAI_API_KEY ?? "", cronApiKey, ...extra];
}

type ExportMessage = { id: string; kind: "pi.user" | "pi.assistant"; text: string; createdAt: string | null };

async function transcript(conversation: Conversation, extra: readonly string[] = []): Promise<ExportMessage[]> {
  const collected: EntryRecord[] = [];
  const seenIds = new Set<number>();
  const seenCursors = new Set<string>();
  let cursor: Cursor | undefined;
  for (let page = 0; page < 200; page += 1) {
    const batch = await conversation.entries({}, 200, cursor, context);
    for (const entry of batch.items) {
      if (seenIds.has(entry.id)) continue;
      seenIds.add(entry.id);
      collected.push(entry);
    }
    if (!batch.next) break;
    const key = JSON.stringify(batch.next);
    if (seenCursors.has(key)) break;
    seenCursors.add(key);
    cursor = batch.next;
    if (page === 199) throw new Error("export is too large");
  }
  const messages: ExportMessage[] = [];
  for (const entry of collected.reverse()) {
    if (entry.kind !== "pi.user" && entry.kind !== "pi.assistant") continue;
    const raw = textOf(entry);
    if (raw.trim().length === 0) continue;
    messages.push({
      id: String(entry.id),
      kind: entry.kind,
      text: redactSecrets(raw, exportSecrets(extra)),
      createdAt: createdAtOf(entry),
    });
  }
  return messages;
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

async function busyBotIds(): Promise<string[]> {
  const bots = await loadBots();
  const inspection = await harness.inspect(context);
  const live = new Set<string>();
  for (const task of inspection.tasks) live.add(String(task.record.conversationId));
  for (const submission of inspection.submissions) {
    if (submission.status === "queued" || submission.status === "placed") live.add(String(submission.conversationId));
  }
  return bots.filter((bot) => live.has(bot.id) || live.has(bot.conversationId)).map((bot) => bot.id);
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
  const hookRoute = url.pathname.match(/^\/hooks\/([^/]+)$/);
  if (hookRoute && req.method === "POST") {
    try {
      let token = "";
      try {
        token = decodeURIComponent(hookRoute[1] ?? "");
      } catch {
        token = "";
      }
      const bots = await loadBots();
      const bot = bots.find((item) => tokensEqual(token, item.hookToken));
      if (!bot) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const message = readHookBody(await readBody(req));
      if ("error" in message) {
        send(res, 400, { error: message.error });
        return;
      }
      const conversation = await conversationFor(bot.id);
      const submission = await conversation.submit({ type: "input", content: message.content }, context);
      send(res, 202, { submissionId: submission.id });
    } catch (error) {
      if (error instanceof ConversationBusy) {
        send(res, 409, { error: "busy" });
        return;
      }
      if (error instanceof SyntaxError) {
        send(res, 400, { error: "content is required" });
        return;
      }
      send(res, 500, { error: error instanceof Error ? error.message : "error" });
    }
    return;
  }
  if (!authorized(req)) {
    send(res, 401, { error: "unauthorized" });
    return;
  }
  try {
    if (url.pathname === "/api/bots" && req.method === "GET") {
      send(res, 200, { bots: (await loadBots()).map(publicBot) });
      return;
    }
    if (url.pathname === "/api/cron-key" && req.method === "POST") {
      const body = asRecord(await readBody(req));
      if (typeof body.apiKey !== "string") {
        send(res, 400, { error: "cron API key must be a string" });
        return;
      }
      const apiKey = body.apiKey.trim();
      if (apiKey.length > CRON_KEY_MAX) {
        send(res, 400, { error: "cron API key is too long" });
        return;
      }
      if (!apiKey) {
        const cleared = await deleteScheduleRecords(await loadSchedules());
        if ("error" in cleared) {
          send(res, cleared.status, { error: cleared.error });
          return;
        }
      }
      await saveCronKey(apiKey);
      send(res, 200, { configured: Boolean(cronApiKey) });
      return;
    }
    if (url.pathname === "/api/schedules" && req.method === "DELETE") {
      const cleared = await deleteScheduleRecords(await loadSchedules());
      if ("error" in cleared) {
        send(res, cleared.status, { error: cleared.error });
        return;
      }
      send(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/export" && req.method === "GET") {
      const bots = await loadBots();
      const tokens = bots.map((bot) => bot.hookToken);
      const exported = [];
      for (const bot of bots) {
        exported.push({
          id: bot.id,
          name: redactSecrets(bot.name, exportSecrets(tokens)),
          conversationId: bot.conversationId,
          instruction: redactSecrets(bot.instruction, exportSecrets(tokens)),
          look: bot.look,
          messages: await transcript(await conversationFor(bot.id), tokens),
        });
      }
      send(res, 200, { exportedAt: new Date().toISOString(), bots: exported });
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
          instructions: withPeerInstruction(instruction),
        },
      }, context);
      await conversation.configure({ extensions: botExtensions(), cwd: workdir }, context);
      const bot: BotRecord = {
        id: String(conversation.id),
        name: fields.name ?? "",
        conversationId: String(conversation.id),
        instruction,
        look,
        hookToken: newHookToken(),
      };
      conversations.set(bot.id, conversation);
      bots.push(bot);
      await saveBots(bots);
      send(res, 201, publicBot(bot));
      return;
    }
    if (url.pathname === "/api/bots/activity" && req.method === "GET") {
      send(res, 200, { busy: await busyBotIds() });
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
      const peerIds = await peerEntryIds();
      const entries = await conversation.entries({}, 200, undefined, context);
      const chronological = [...entries.items].reverse();
      const hidden = hiddenThreadEntryIds(chronological.map((entry) => ({ id: String(entry.id), kind: entry.kind })), peerIds);
      const visible = chronological
        .filter((entry) => (entry.kind === "pi.user" || entry.kind === "pi.assistant") && !hidden.has(String(entry.id)))
        .map((entry) => ({ id: String(entry.id), kind: entry.kind, text: textOf(entry), createdAt: createdAtOf(entry) }))
        .filter((entry) => entry.text.trim().length > 0);
      const peers = (await loadPeers()).filter((item) => item.from === bot.id || item.to === bot.id);
      send(res, 200, { bot: publicBot(bot), messages: withPeerLines(visible, peers.map(publicPeer)) });
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
      send(res, 200, publicBot(bot));
      return;
    }
    if (messageRoute && req.method === "DELETE" && !messageRoute[2]) {
      const bots = await loadBots();
      const index = bots.findIndex((item) => item.id === messageRoute[1]);
      if (index < 0) {
        send(res, 404, { error: "bot not found" });
        return;
      }
      const removed = bots[index];
      if (!removed) {
        send(res, 404, { error: "bot not found" });
        return;
      }
      const cleared = await deleteScheduleRecords((await loadSchedules()).filter((item) => item.botId === removed.id));
      if ("error" in cleared) {
        send(res, cleared.status, { error: cleared.error });
        return;
      }
      bots.splice(index, 1);
      await saveBots(bots);
      conversations.delete(removed.id);
      const peers = (await loadPeers()).filter((item) => item.from !== removed.id && item.to !== removed.id);
      await savePeers(peers);
      send(res, 200, { ok: true });
      return;
    }
    const peerRoute = url.pathname.match(/^\/api\/bots\/([^/]+)\/(steer|peers)$/);
    if (peerRoute && req.method === "GET" && peerRoute[2] === "peers") {
      const bots = await loadBots();
      const bot = bots.find((item) => item.id === peerRoute[1]);
      if (!bot) {
        send(res, 404, { error: "bot not found" });
        return;
      }
      const peers = (await loadPeers()).filter((item) => item.from === bot.id || item.to === bot.id);
      send(res, 200, { peers: peers.map(publicPeer) });
      return;
    }
    if (peerRoute && req.method === "POST" && peerRoute[2] === "steer") {
      const fields = readSteer(await readBody(req));
      if ("error" in fields) {
        send(res, 400, { error: fields.error });
        return;
      }
      const steered = await steerPeer(peerRoute[1], fields.from, fields.content, `${PEER_REQUEST_PREFIX}${randomBytes(8).toString("hex")}`);
      send(res, steered.status, steered.body);
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

peerExtension = defineExtension({
  name: "peers",
  tools: [
    defineTool({
      name: "steer_peer",
      description: "Send a need-to-know message into another bot on this sprite. Call it in the same turn the human asks you to contact that bot. Saying you will does not send it. Also call it once to return a result the other bot asked for. The server refuses a further steer. The human's thread does not show the tool call.",
      parameters: Type.Object({
        bot: Type.String({ description: "Name or id of the other bot" }),
        content: Type.String({ description: "What to tell that bot" }),
      }),
      replay: "safe",
      execute: async (args, api, toolContext) => {
        const bots = await loadBots();
        const fromId = String(api.conversationId);
        const target = resolvePeerTarget(bots, fromId, args.bot);
        if ("error" in target) {
          return { content: [{ type: "text", text: target.error }], isError: true };
        }
        const conversation = await conversationFor(fromId);
        const entries = await conversation.entries({}, 20, undefined, toolContext);
        const latestUser = entries.items.find((entry) => entry.kind === "pi.user");
        const turn = peerTurn(latestUser ? textOf(latestUser) : undefined);
        const hop = outgoingHop(turn);
        if ("error" in hop) {
          return { content: [{ type: "text", text: hop.error }], isError: true };
        }
        if (turn && peerChainUsed(await loadPeers(), fromId, turn.id)) {
          return { content: [{ type: "text", text: "peer chain is closed" }], isError: true };
        }
        const steered = await steerPeer(
          target.id,
          fromId,
          args.content,
          `${PEER_REQUEST_PREFIX}tool:${api.taskId}:${api.callId}`,
          hop.hop,
          turn?.id,
          toolContext,
        );
        if ("error" in steered.body) {
          return { content: [{ type: "text", text: steered.body.error }], isError: true };
        }
        const name = steered.body.toName || target.id;
        return { content: [{ type: "text", text: `Steered to ${name}.` }] };
      },
    }),
  ],
  sections: [
    section("peers", async (input) => {
      const bots = await loadBots();
      const self = String(input.conversationId);
      const others = bots.filter((item) => item.id !== self && item.conversationId !== self);
      if (others.length === 0) return undefined;
      const lines = others.map((item) => `${item.name} (id ${item.id})`);
      return [
        "Other bots on this sprite share the work directory and the model.",
        "When the human names one of these bots and asks you to tell them something or have them do something, call steer_peer in this turn. Saying you will does not send it.",
        "When one of them asks you for something, steer the result back once. That is the one forward the server allows.",
        "Do not steer acknowledgements or a second follow-up. The server then closes the chain.",
        ...lines,
      ].join("\n");
    }),
  ],
});
registry.install(peerExtension);

scheduleExtension = defineExtension({
  name: "schedules",
  tools: [
    defineTool({
      name: "schedule_message",
      description: "Schedule a message that cron-job.org will deliver into this conversation. It arrives as a normal user message, not a steer. cron is five fields: minute hour day-of-month month day-of-week.",
      parameters: Type.Object({
        message: Type.String({ description: "What to send into this conversation when the schedule fires" }),
        cron: Type.String({ description: "Five cron fields, for example 0 9 * * 1-5" }),
        timezone: Type.Optional(Type.String({ description: "IANA time zone. Defaults to UTC." })),
      }),
      replay: "safe",
      execute: async (args, api) => {
        const scheduled = await scheduleMessage(
          String(api.conversationId),
          args.message,
          args.cron,
          args.timezone,
          `schedule:${api.taskId}:${api.callId}`,
        );
        if ("error" in scheduled) {
          return { content: [{ type: "text", text: scheduled.error }], isError: true };
        }
        return { content: [{ type: "text", text: `Scheduled job ${scheduled.jobId}.` }] };
      },
    }),
  ],
  sections: [
    section("schedules", async () => {
      if (!cronApiKey) return undefined;
      return [
        "You can schedule a later message into this conversation with schedule_message.",
        "Use a five-field cron expression: minute hour day-of-month month day-of-week.",
        "When it fires, the text arrives as a normal user message. It is not a steer, and it does not continue a peer chain.",
      ].join("\n");
    }),
  ],
});
registry.install(scheduleExtension);

await loadCronKey();
http.listen(port, () => {
  console.log(`pi-orbs server ${version} on ${port}`);
});
