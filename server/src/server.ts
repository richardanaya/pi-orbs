import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { ConversationBusy, createRegistry, defineExtension, defineTool, GenerationTask, Harness, hook, section, ToolTask, wrapTool, type Conversation, type ConversationId, type Cursor, type EntryRecord, type Extension, type SubmissionId, type ToolRegistration } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { createMcpHook, disconnectBotMcpHooks, disconnectMcpHook, listMcpHooks, mcpHookActive, publicBase, receiveMcpWebhook, rememberWebhook } from "./mcp-events.js";
import { installSharedModel, sharedModel } from "./model.js";
import { hiddenThreadEntryIds, normalizePeers, outgoingHop, PEER_CONTENT_MAX, PEER_LEDGER_MAX, PEER_REQUEST_PREFIX, peerChainUsed, peerPrompt, peerTurn, publicPeer, readSteer, resolvePeerTarget, withPeerInstruction, withPeerLines, type PeerRecord, type PublicPeer } from "./peers.js";
import { CRON_API_DEFAULT, CRON_KEY_MAX, deleteCronJob, fetchCron, newHookToken, putCronJob, readHookBody, readScheduleRequest, scheduleTitle, setCronJobEnabled, tokensEqual, validHookToken, webhookUrl } from "./schedule.js";
import { fileResponseHeaders } from "./file-response.js";
import { answerText, decodeUpload, fileMarker, loadFiles, loadNotes, loadQuestions, newId, publicFile, publicQuestion, readAnswerInput, readQuestionInput, saveFiles, saveNotes, saveQuestions, takeFileMarker, type FileRecord, type NoteRecord, type QuestionRecord } from "./share.js";
import { bashTimeoutSeconds, hangLimit, hangNote, isHung, WATCH_GRACE_MS, workingOn } from "./work.js";
import {
  approvalPrompt,
  CHECK_IN_MS,
  CHECK_IN_PROMPT,
  coordinatorPrompt,
  copyName,
  deleteSecret,
  dismissSecret,
  dropBot,
  expireApprovals,
  forgetMemory,
  fulfillSecret,
  guardRoster,
  guardSpawn,
  memoryPrompt,
  normalizeApprovals,
  normalizeMemories,
  normalizeVault,
  publicApprovals,
  publicMemories,
  publicVault,
  readSecret,
  readTemplate,
  requestSecret,
  resolveApproval,
  reviewAction,
  revokeAlways,
  saveMemory,
  searchPalette,
  secretsPrompt,
  templateFrom,
  vaultValues,
  type SearchMessage,
} from "./features.js";

const here = dirname(fileURLToPath(import.meta.url));
const version = (await readFile(join(here, "../VERSION"), "utf8").catch(() => readFile(join(here, "VERSION"), "utf8"))).trim();
const port = Number(process.env.PORT ?? 8080);
const secret = process.env.PI_API_SECRET ?? "";
const dbPath = process.env.PI_DB ?? "./data/agent.sqlite";
const botsPath = process.env.PI_BOTS ?? dbPath.replace(/[^/]+$/, "bots.json");
const peersPath = process.env.PI_PEERS ?? botsPath.replace(/[^/]+$/, "peers.json");
const schedulesPath = process.env.PI_SCHEDULES ?? botsPath.replace(/[^/]+$/, "schedules.json");
const cronKeyPath = process.env.PI_CRON_KEY ?? botsPath.replace(/[^/]+$/, "cron.json");
const hooksPath = process.env.PI_HOOKS ?? botsPath.replace(/[^/]+$/, "mcp-events.json");
const filesPath = process.env.PI_FILES ?? botsPath.replace(/[^/]+$/, "files.json");
const questionsPath = process.env.PI_QUESTIONS ?? botsPath.replace(/[^/]+$/, "questions.json");
const notesPath = process.env.PI_NOTES ?? botsPath.replace(/[^/]+$/, "notes.json");
const memoriesPath = process.env.PI_MEMORIES ?? botsPath.replace(/[^/]+$/, "memories.json");
const secretsPath = process.env.PI_SECRETS ?? botsPath.replace(/[^/]+$/, "secrets.json");
const approvalsPath = process.env.PI_APPROVALS ?? botsPath.replace(/[^/]+$/, "approvals.json");
const publicUrl = publicBase(process.env.PI_PUBLIC_URL);
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
  createdBy?: string;
};
type ScheduleRecord = {
  botId: string;
  jobId: number;
  requestKey: string;
  message: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  once: boolean;
  at?: string;
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
    const createdBy = typeof item.createdBy === "string" && item.createdBy ? item.createdBy : undefined;
    bots.push({ id, name: name.slice(0, NAME_MAX), conversationId, instruction, look, hookToken, ...(createdBy ? { createdBy } : {}) });
  }
  return { bots, changed };
}

let mainBotId: string | null = null;
let nextCheckInAt = 0;

function publicBot(bot: BotRecord): {
  id: string;
  name: string;
  conversationId: string;
  instruction: string;
  look: Look;
  createdBy?: string;
  main?: true;
} {
  return {
    id: bot.id,
    name: bot.name,
    conversationId: bot.conversationId,
    instruction: bot.instruction,
    look: bot.look,
    ...(bot.createdBy ? { createdBy: bot.createdBy } : {}),
    ...(bot.id === mainBotId ? { main: true } : {}),
  };
}

async function loadBots(): Promise<BotRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(botsPath, "utf8")) as unknown;
    const normalized = normalizeBots(parsed);
    const record = parsed && typeof parsed === "object" ? parsed as { mainBotId?: unknown; nextCheckInAt?: unknown } : {};
    const id = typeof record.mainBotId === "string" ? record.mainBotId : null;
    const next = typeof record.nextCheckInAt === "number" && Number.isFinite(record.nextCheckInAt) ? record.nextCheckInAt : 0;
    const keptMain = id && normalized.bots.some((bot) => bot.id === id) ? id : null;
    mainBotId = keptMain;
    nextCheckInAt = next;
    if (normalized.changed || keptMain !== id) await saveBots(normalized.bots);
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
  await writeFile(botsPath, JSON.stringify({ bots, mainBotId, nextCheckInAt }, null, 2));
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
    const record = item as Partial<ScheduleRecord>;
    const botId = typeof record.botId === "string" ? record.botId : "";
    const requestKey = typeof record.requestKey === "string" ? record.requestKey : "";
    if (!botId || !requestKey || typeof record.jobId !== "number" || !Number.isInteger(record.jobId)) continue;
    jobs.push({
      botId,
      jobId: record.jobId,
      requestKey,
      message: typeof record.message === "string" ? record.message : "",
      cron: typeof record.cron === "string" ? record.cron : "",
      timezone: typeof record.timezone === "string" && record.timezone ? record.timezone : "UTC",
      enabled: record.enabled !== false,
      once: record.once === true,
      ...(typeof record.at === "string" && record.at ? { at: record.at } : {}),
    });
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

function publicSchedule(job: ScheduleRecord): {
  jobId: number;
  message: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  once: boolean;
  at?: string;
} {
  return {
    jobId: job.jobId,
    message: job.message,
    cron: job.cron,
    timezone: job.timezone,
    enabled: job.enabled,
    once: job.once,
    ...(job.at ? { at: job.at } : {}),
  };
}

function scheduleSummary(job: ScheduleRecord): string {
  const state = job.enabled ? "on" : "paused";
  const when = job.once && job.at ? `Once ${job.at}` : `${job.cron} ${job.timezone}`;
  return `job ${job.jobId}: ${state}, ${when} — ${job.message}`;
}

async function scheduleMessage(botId: string, message: string, cron: string, timezone: string | undefined, requestKey: string, at?: string): Promise<{ jobId: number } | { error: string }> {
  if (!cronApiKey) return { error: "cron-job.org API key is not configured" };
  const base = spritePublicUrl();
  if (!base) return { error: "this server has no public URL" };
  const read = readScheduleRequest(at ? { message, at } : { message, cron, ...(timezone ? { timezone } : {}) });
  if ("error" in read) return { error: read.error };
  const bots = await loadBots();
  const bot = bots.find((item) => item.id === botId);
  if (!bot) return { error: "bot not found" };
  const jobs = await loadSchedules();
  const existing = jobs.find((item) => item.requestKey === requestKey);
  if (existing) return { jobId: existing.jobId };
  const created = await putCronJob(cronCall, cronApiKey, {
    url: webhookUrl(base, bot.hookToken),
    title: read.once ? `${scheduleTitle(bot.name)} once` : scheduleTitle(bot.name),
    message: read.message,
    schedule: read.schedule,
  });
  if ("error" in created) return { error: created.error };
  jobs.push({
    botId: bot.id,
    jobId: created.jobId,
    requestKey,
    message: read.message,
    cron: read.cron,
    timezone: read.timezone,
    enabled: true,
    once: read.once,
    ...(read.at ? { at: read.at } : {}),
  });
  await saveSchedules(jobs);
  return { jobId: created.jobId };
}

async function setScheduleEnabled(botId: string, jobId: number, enabled: boolean): Promise<{ job: ReturnType<typeof publicSchedule> } | { error: string; status: number }> {
  if (!cronApiKey) return { error: "cron-job.org API key is not configured", status: 400 };
  const jobs = await loadSchedules();
  const job = jobs.find((item) => item.botId === botId && item.jobId === jobId);
  if (!job) return { error: "schedule not found", status: 404 };
  const updated = await setCronJobEnabled(cronCall, cronApiKey, jobId, enabled);
  if ("error" in updated) return updated;
  job.enabled = enabled;
  await saveSchedules(jobs);
  return { job: publicSchedule(job) };
}

async function deleteOneSchedule(botId: string, jobId: number): Promise<{ ok: true } | { error: string; status: number }> {
  const jobs = await loadSchedules();
  const job = jobs.find((item) => item.botId === botId && item.jobId === jobId);
  if (!job) return { error: "schedule not found", status: 404 };
  return deleteScheduleRecords([job]);
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
let selfExtension: Extension | undefined;
let presenceExtension: Extension | undefined;
let rosterExtension: Extension | undefined;
let memoryExtension: Extension | undefined;
let secretsExtension: Extension | undefined;
let coordinatorExtension: Extension | undefined;
let peerQueue: Promise<unknown> = Promise.resolve();
let featureQueue: Promise<unknown> = Promise.resolve();

function botExtensions() {
  const extensions: Extension[] = [CodingTools];
  if (presenceExtension) extensions.push(presenceExtension);
  if (selfExtension) extensions.push(selfExtension);
  if (peerExtension) extensions.push(peerExtension);
  if (scheduleExtension) extensions.push(scheduleExtension);
  if (rosterExtension) extensions.push(rosterExtension);
  if (memoryExtension) extensions.push(memoryExtension);
  if (secretsExtension) extensions.push(secretsExtension);
  if (coordinatorExtension) extensions.push(coordinatorExtension);
  return extensions;
}

function enqueueFeatures<T>(work: () => Promise<T>): Promise<T> {
  const run = featureQueue.then(work, work);
  featureQueue = run.then(() => undefined, () => undefined);
  return run;
}

type ActiveWork = { botId: string; taskId: string; text: string; tool?: string; startedAt: number };
const activeWork = new Map<string, ActiveWork>();

function rememberWork(botId: string, taskId: string, text: string, tool?: string): void {
  activeWork.set(taskId, { botId, taskId, text, ...(tool ? { tool } : {}), startedAt: Date.now() });
}

function forgetWork(taskId: string): void {
  activeWork.delete(taskId);
}

function statusForBots(busy: readonly string[]): { id: string; text: string }[] {
  const latest = new Map<string, ActiveWork>();
  for (const item of activeWork.values()) {
    const prior = latest.get(item.botId);
    if (!prior || item.startedAt >= prior.startedAt) latest.set(item.botId, item);
  }
  const status = [...latest.values()].map((item) => ({ id: item.botId, text: item.text }));
  const seen = new Set(status.map((item) => item.id));
  for (const id of busy) {
    if (!seen.has(id)) status.push({ id, text: "working on your message" });
  }
  return status;
}

async function addNote(botId: string, text: string): Promise<void> {
  const notes = await loadNotes(notesPath);
  notes.push({ id: newId("n"), botId, text, createdAt: new Date().toISOString() });
  await saveNotes(notesPath, notes);
}

async function sweepHangs(): Promise<void> {
  const limit = hangLimit() + WATCH_GRACE_MS;
  const now = Date.now();
  for (const item of [...activeWork.values()]) {
    if (!item.tool || !isHung(item.startedAt, now, limit)) continue;
    activeWork.delete(item.taskId);
    try {
      const conversation = await conversationFor(item.botId);
      await conversation.abort(context);
    } catch {
      // The run may already be idle.
    }
    await addNote(item.botId, hangNote(item.tool));
  }
}

function uploadFile(relativePath: string): string | null {
  if (!relativePath.startsWith("uploads/") || relativePath.includes("..")) return null;
  const root = resolve(workdir);
  const file = resolve(root, relativePath);
  if (file !== root && !file.startsWith(root + sep)) return null;
  return file;
}

async function editBot(id: string, fields: FieldPatch): Promise<BotRecord | { error: string; status: number }> {
  const bots = await loadBots();
  const index = bots.findIndex((item) => item.id === id || item.conversationId === id);
  if (index < 0) return { error: "bot not found", status: 404 };
  const current = bots[index];
  if (!current) return { error: "bot not found", status: 404 };
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
  return bot;
}

async function createQuestion(botId: string, prompt: string, labels: readonly string[]): Promise<QuestionRecord | { error: string }> {
  const bots = await loadBots();
  const bot = bots.find((item) => item.id === botId || item.conversationId === botId);
  if (!bot) return { error: "bot not found" };
  const read = readQuestionInput({ prompt, options: [...labels] });
  if ("error" in read) return read;
  const question: QuestionRecord = {
    id: newId("q"),
    botId: bot.id,
    prompt: read.prompt,
    options: read.options.map((label) => ({ id: newId("o"), label })),
    createdAt: new Date().toISOString(),
  };
  const questions = await loadQuestions(questionsPath);
  questions.push(question);
  await saveQuestions(questionsPath, questions);
  return question;
}

function withNotes<T extends { createdAt?: string | null }>(messages: T[], notes: NoteRecord[]): (T | { id: string; kind: "pi.note"; text: string; createdAt: string })[] {
  const lines: (T | { id: string; kind: "pi.note"; text: string; createdAt: string })[] = [...messages];
  for (const note of notes) {
    const row = { id: `note:${note.id}`, kind: "pi.note" as const, text: note.text, createdAt: note.createdAt };
    const index = lines.findIndex((item) => String(item.createdAt ?? "") > note.createdAt);
    if (index < 0) lines.push(row);
    else lines.splice(index, 0, row);
  }
  return lines;
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
    const raw = takeFileMarker(textOf(entry)).text;
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

async function readRaw(req: IncomingMessage, limit: number): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) return undefined;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readRaw(req, 1_000_000);
  if (raw === undefined) throw new Error("body too large");
  if (raw.length === 0) return {};
  return JSON.parse(raw);
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

async function loadJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return {};
  }
}

async function saveJson(path: string, body: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(body, null, 2));
}

async function secretNeedles(extra: readonly string[] = []): Promise<string[]> {
  const vault = normalizeVault(await loadJson(secretsPath));
  return exportSecrets([...vaultValues(vault), ...extra]);
}

async function createNamedBot(fields: FieldPatch, createdBy?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const bots = await loadBots();
  const guard = createdBy ? guardSpawn(bots, createdBy) : guardRoster(bots.length);
  if ("error" in guard) return { status: guard.error === "bot not found" ? 404 : 409, body: { error: guard.error } };
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
    ...(createdBy ? { createdBy } : {}),
  };
  conversations.set(bot.id, conversation);
  bots.push(bot);
  await saveBots(bots);
  return { status: 201, body: publicBot(bot) };
}

async function searchableMessages(): Promise<SearchMessage[]> {
  const bots = await loadBots();
  const needles = await secretNeedles(bots.map((bot) => bot.hookToken));
  const peers = await loadPeers();
  const messages: SearchMessage[] = [];
  for (const bot of bots) {
    const lines = await transcript(await conversationFor(bot.id), needles);
    for (const line of lines) {
      if (line.text.includes("pi-orbs-peer-hop:")) continue;
      messages.push({
        botId: bot.id,
        botName: bot.name,
        look: bot.look,
        messageId: line.id,
        kind: line.kind,
        text: line.text,
        createdAt: line.createdAt,
      });
    }
    for (const peer of peers.filter((item) => item.from === bot.id || item.to === bot.id)) {
      messages.push({
        botId: bot.id,
        botName: bot.name,
        look: bot.look,
        messageId: `peer:${peer.id}`,
        kind: "pi.peer",
        text: redactSecrets(peer.content, needles),
        createdAt: peer.createdAt,
      });
    }
  }
  return messages;
}

async function runCheckIn(force: boolean): Promise<{ status: number; body: Record<string, unknown> }> {
  const bots = await loadBots();
  const bot = mainBotId ? bots.find((item) => item.id === mainBotId) : undefined;
  if (!bot) return { status: 409, body: { error: "no Main Bot" } };
  if (!force && Date.now() < nextCheckInAt) return { status: 409, body: { error: "check-in is not due" } };
  nextCheckInAt = Date.now() + CHECK_IN_MS;
  await saveBots(bots);
  try {
    const conversation = await conversationFor(bot.id);
    await conversation.submit({
      type: "input",
      content: CHECK_IN_PROMPT,
      requestId: `check-in:${bot.id}:${Date.now()}`,
    }, context);
  } catch (error) {
    if (error instanceof ConversationBusy) {
      nextCheckInAt = Date.now() + 60_000;
      await saveBots(bots);
      return { status: 409, body: { error: "busy" } };
    }
    throw error;
  }
  return { status: 202, body: { ok: true, botId: bot.id } };
}

function mainBody(): { botId: string | null; nextCheckInAt: string | null } {
  return {
    botId: mainBotId,
    nextCheckInAt: nextCheckInAt > 0 ? new Date(nextCheckInAt).toISOString() : null,
  };
}

async function forgetBotFeatures(botId: string): Promise<void> {
  const memories = dropBot(normalizeMemories(await loadJson(memoriesPath)), botId);
  await saveJson(memoriesPath, { memories });
  const vault = normalizeVault(await loadJson(secretsPath));
  await saveJson(secretsPath, {
    secrets: dropBot(vault.secrets, botId),
    requests: dropBot(vault.requests, botId),
  });
  const approvals = normalizeApprovals(await loadJson(approvalsPath));
  await saveJson(approvalsPath, {
    cards: dropBot(approvals.cards, botId),
    grants: dropBot(approvals.grants, botId),
  });
  if (mainBotId === botId) {
    mainBotId = null;
    nextCheckInAt = 0;
  }
}

function featureTarget(pathname: string): { id: string; rest: string[] } | null {
  const match = pathname.match(/^\/api\/bots\/([^/]+)(?:\/(.*))?$/);
  if (!match || match[1] === undefined) return null;
  let id = "";
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return { id, rest: (match[2] ?? "").split("/").filter(Boolean) };
}

async function noteApproval(botId: string, note: string): Promise<void> {
  try {
    const conversation = await conversationFor(botId);
    await conversation.submit({ type: "input", content: note }, context);
  } catch (error) {
    if (error instanceof ConversationBusy) return;
    throw error;
  }
}

async function handleFeature(url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (url.pathname === "/api/search" && req.method === "GET") {
    const bots = await loadBots();
    const needles = await secretNeedles(bots.map((bot) => bot.hookToken));
    const result = searchPalette(url.searchParams.get("q") ?? "", bots.map((bot) => ({
      id: bot.id,
      name: redactSecrets(bot.name, needles),
      look: bot.look,
      instruction: redactSecrets(bot.instruction, needles),
      ...(bot.id === mainBotId ? { main: true } : {}),
    })), await searchableMessages());
    result.messages = result.messages.map((item) => ({ ...item, text: redactSecrets(item.text, needles), botName: redactSecrets(item.botName, needles) }));
    send(res, 200, result);
    return true;
  }
  if (url.pathname === "/api/main" && req.method === "GET") {
    await loadBots();
    send(res, 200, mainBody());
    return true;
  }
  if (url.pathname === "/api/main/check-in" && req.method === "POST") {
    const result = await runCheckIn(true);
    send(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/bots/import") {
    if (req.method !== "POST") {
      send(res, 404, { error: "not found" });
      return true;
    }
    const read = readTemplate(await readBody(req));
    if ("error" in read) {
      send(res, 400, { error: read.error });
      return true;
    }
    const bots = await loadBots();
    const room = guardRoster(bots.length);
    if ("error" in room) {
      send(res, 409, { error: room.error });
      return true;
    }
    const created = await createNamedBot({
      name: copyName(read.name, bots.map((bot) => bot.name)),
      instruction: read.instruction,
      look: read.look,
    });
    send(res, created.status, created.body);
    return true;
  }
  const target = featureTarget(url.pathname);
  if (!target || target.rest.length === 0) return false;
  const { id, rest } = target;
  const bots = await loadBots();
  const bot = bots.find((item) => item.id === id);
  if (!bot) {
    send(res, 404, { error: "bot not found" });
    return true;
  }
  if (rest[0] === "template" && rest.length === 1 && req.method === "GET") {
    send(res, 200, templateFrom(bot, await secretNeedles([bot.hookToken])));
    return true;
  }
  if (rest[0] === "spawn" && rest.length === 1 && req.method === "POST") {
    const fields = readFields(await readBody(req), "create");
    if ("error" in fields) {
      send(res, 400, { error: fields.error });
      return true;
    }
    const created = await enqueueFeatures(() => createNamedBot(fields, bot.id));
    send(res, created.status, created.body);
    return true;
  }
  if (rest[0] === "main" && rest.length === 1 && req.method === "POST") {
    const body = asRecord(await readBody(req));
    if (typeof body.main !== "boolean") {
      send(res, 400, { error: "main must be a boolean" });
      return true;
    }
    if (body.main) {
      mainBotId = bot.id;
      nextCheckInAt = Date.now() + CHECK_IN_MS;
    } else if (mainBotId === bot.id) {
      mainBotId = null;
      nextCheckInAt = 0;
    }
    await saveBots(bots);
    send(res, 200, publicBot(bot));
    return true;
  }
  if (rest[0] === "memories" && rest.length === 1 && req.method === "GET") {
    send(res, 200, { memories: publicMemories(normalizeMemories(await loadJson(memoriesPath)), bot.id) });
    return true;
  }
  if (rest[0] === "memories" && rest.length === 1 && req.method === "POST") {
    const saved = await enqueueFeatures(async () => {
      const memories = normalizeMemories(await loadJson(memoriesPath));
      const next = saveMemory(memories, bot.id, asRecord(await readBody(req)).fact);
      if ("error" in next) return next;
      await saveJson(memoriesPath, { memories: next.memories });
      return { memory: { id: next.memory.id, fact: next.memory.fact, createdAt: next.memory.createdAt } };
    });
    if ("error" in saved) {
      send(res, 400, { error: saved.error });
      return true;
    }
    send(res, 201, saved);
    return true;
  }
  if (rest[0] === "memories" && rest.length === 2 && rest[1] && req.method === "DELETE") {
    let memoryId = "";
    try {
      memoryId = decodeURIComponent(rest[1]);
    } catch {
      send(res, 404, { error: "memory not found" });
      return true;
    }
    const forgotten = await enqueueFeatures(async () => {
      const memories = normalizeMemories(await loadJson(memoriesPath));
      const next = forgetMemory(memories, bot.id, { id: memoryId });
      if ("error" in next) return next;
      await saveJson(memoriesPath, { memories: next.memories });
      return { ok: true as const };
    });
    if ("error" in forgotten) {
      send(res, 404, { error: forgotten.error });
      return true;
    }
    send(res, 200, forgotten);
    return true;
  }
  if (rest[0] === "secrets" && rest.length === 1 && req.method === "GET") {
    const vault = normalizeVault(await loadJson(secretsPath));
    send(res, 200, publicVault(vault, bot.id, vaultValues(vault, bot.id)));
    return true;
  }
  if (rest[0] === "secrets" && rest.length === 1 && req.method === "POST") {
    const body = asRecord(await readBody(req));
    const result = await enqueueFeatures(async () => {
      const vault = normalizeVault(await loadJson(secretsPath));
      if (body.dismiss === true) {
        const requestId = typeof body.requestId === "string" ? body.requestId : "";
        const dismissed = dismissSecret(vault, bot.id, requestId);
        if ("error" in dismissed) return dismissed;
        await saveJson(secretsPath, dismissed.vault);
        return { dismissed: true as const };
      }
      if (body.request === true) {
        const opened = requestSecret(vault, bot.id, body.name, body.reason);
        if ("error" in opened) return opened;
        await saveJson(secretsPath, opened.vault);
        return {
          request: {
            id: opened.request.id,
            name: opened.request.name,
            reason: opened.request.reason,
            createdAt: opened.request.createdAt,
            status: opened.request.status,
          },
        };
      }
      const saved = fulfillSecret(vault, bot.id, body);
      if ("error" in saved) return saved;
      await saveJson(secretsPath, saved.vault);
      return { name: saved.name, saved: true as const };
    });
    if ("error" in result) {
      send(res, 400, { error: result.error });
      return true;
    }
    send(res, "request" in result ? 201 : 200, result);
    return true;
  }
  if (rest[0] === "secrets" && rest.length === 2 && rest[1] && req.method === "DELETE") {
    let name = "";
    try {
      name = decodeURIComponent(rest[1]);
    } catch {
      send(res, 404, { error: "secret not found" });
      return true;
    }
    const removed = await enqueueFeatures(async () => {
      const vault = normalizeVault(await loadJson(secretsPath));
      const next = deleteSecret(vault, bot.id, name);
      if ("error" in next) return next;
      await saveJson(secretsPath, next.vault);
      return { ok: true as const };
    });
    if ("error" in removed) {
      send(res, 404, { error: removed.error });
      return true;
    }
    send(res, 200, removed);
    return true;
  }
  if (rest[0] === "approvals" && rest.length === 1 && req.method === "GET") {
    const listed = await enqueueFeatures(async () => {
      const vault = normalizeVault(await loadJson(secretsPath));
      const state = expireApprovals(normalizeApprovals(await loadJson(approvalsPath)));
      await saveJson(approvalsPath, state);
      return publicApprovals(state, bot.id, vaultValues(vault, bot.id));
    });
    send(res, 200, listed);
    return true;
  }
  if (rest[0] === "approvals" && rest.length === 1 && req.method === "POST") {
    const body = asRecord(await readBody(req));
    const resolved = await enqueueFeatures(async () => {
      const vault = normalizeVault(await loadJson(secretsPath));
      const state = normalizeApprovals(await loadJson(approvalsPath));
      const next = resolveApproval(state, {
        botId: bot.id,
        cardId: body.cardId,
        decision: body.decision,
        secrets: vaultValues(vault, bot.id),
      });
      if ("error" in next) return next;
      await saveJson(approvalsPath, next.state);
      return next;
    });
    if ("error" in resolved) {
      send(res, 400, { error: resolved.error });
      return true;
    }
    await noteApproval(bot.id, resolved.note);
    send(res, 200, { card: resolved.card });
    return true;
  }
  if (rest[0] === "approvals" && rest.length === 2 && rest[1] && req.method === "DELETE") {
    let action = "";
    try {
      action = decodeURIComponent(rest[1]);
    } catch {
      send(res, 400, { error: "action is not recognized" });
      return true;
    }
    const revoked = await enqueueFeatures(async () => {
      const state = normalizeApprovals(await loadJson(approvalsPath));
      const next = revokeAlways(state, bot.id, action);
      if ("error" in next) return next;
      await saveJson(approvalsPath, next.state);
      return { ok: true as const };
    });
    if ("error" in revoked) {
      send(res, 400, { error: revoked.error });
      return true;
    }
    send(res, 200, revoked);
    return true;
  }
  if (rest[0] === "actions" && rest.length === 1 && req.method === "POST") {
    const body = asRecord(await readBody(req));
    const reviewed = await enqueueFeatures(async () => {
      const vault = normalizeVault(await loadJson(secretsPath));
      const state = normalizeApprovals(await loadJson(approvalsPath));
      const next = reviewAction(state, {
        botId: bot.id,
        command: body.command,
        ...(body.action !== undefined ? { action: body.action } : {}),
        secrets: vaultValues(vault, bot.id),
      });
      if ("error" in next) return next;
      await saveJson(approvalsPath, next.state);
      return next;
    });
    if ("error" in reviewed) {
      send(res, 400, { error: reviewed.error });
      return true;
    }
    send(res, reviewed.decision === "allow" ? 200 : 202, {
      decision: reviewed.decision,
      action: reviewed.action,
      message: reviewed.message,
      ran: false,
      ...(reviewed.card ? { card: reviewed.card } : {}),
    });
    return true;
  }
  return false;
}

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type, x-api-key",
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
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
  const mcpRoute = url.pathname.match(/^\/api\/mcp-events\/([A-Za-z0-9]+)$/);
  if (mcpRoute && req.method === "POST") {
    const raw = await readRaw(req, 262_144);
    if (raw === undefined) {
      send(res, 413, { error: "body too large" });
      return;
    }
    const received = await receiveMcpWebhook(hooksPath, mcpRoute[1], raw, req.headers);
    if (received.deliver) {
      if (!(await mcpHookActive(hooksPath, mcpRoute[1]))) {
        send(res, 410, { error: "webhook is disconnected" });
        return;
      }
      try {
        const bots = await loadBots();
        const bot = bots.find((item) => item.id === received.deliver?.botId || item.conversationId === received.deliver?.botId);
        if (!bot) {
          send(res, 410, { error: "bot is gone" });
          return;
        }
        const conversation = await conversationFor(bot.id);
        await conversation.submit({
          type: "input",
          content: received.deliver.content,
          whenBusy: "followUp",
          requestId: received.deliver.requestId,
        }, context);
        await rememberWebhook(hooksPath, mcpRoute[1], received.deliver.webhookId);
      } catch (error) {
        if (error instanceof ConversationBusy) {
          send(res, 409, { error: "busy" });
          return;
        }
        send(res, 500, { error: error instanceof Error ? error.message : "error" });
        return;
      }
    }
    send(res, received.status, received.body);
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
      const tokens = await secretNeedles(bots.map((bot) => bot.hookToken));
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
      const created = await createNamedBot(fields);
      send(res, created.status, created.body);
      return;
    }
    if (url.pathname === "/api/bots/activity" && req.method === "GET") {
      const busy = await busyBotIds();
      send(res, 200, { busy, status: statusForBots(busy) });
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
      const storedFiles = (await loadFiles(filesPath)).filter((item) => item.botId === bot.id);
      const needles = await secretNeedles(bots.map((item) => item.hookToken));
      const visible = chronological
        .filter((entry) => (entry.kind === "pi.user" || entry.kind === "pi.assistant") && !hidden.has(String(entry.id)))
        .map((entry) => {
          const taken = takeFileMarker(textOf(entry));
          const id = String(entry.id);
          const attached = storedFiles.filter((item) => item.messageId === id || taken.fileIds.includes(item.id));
          return {
            id,
            kind: entry.kind,
            text: redactSecrets(taken.text, needles),
            createdAt: createdAtOf(entry),
            ...(attached.length > 0 ? { files: attached.map(publicFile) } : {}),
          };
        })
        .filter((entry) => entry.text.trim().length > 0 || (entry.files?.length ?? 0) > 0);
      const peers = (await loadPeers()).filter((item) => item.from === bot.id || item.to === bot.id);
      const notes = (await loadNotes(notesPath)).filter((item) => item.botId === bot.id).map((item) => ({ ...item, text: redactSecrets(item.text, needles) }));
      const questions = (await loadQuestions(questionsPath)).filter((item) => item.botId === bot.id);
      send(res, 200, {
        bot: publicBot(bot),
        messages: withNotes(withPeerLines(visible, peers.map((item) => publicPeer({ ...item, content: redactSecrets(item.content, needles) }))), notes),
        questions: questions.map(publicQuestion),
        files: storedFiles.map(publicFile),
      });
      return;
    }
    if (messageRoute && req.method === "PATCH" && !messageRoute[2]) {
      const fields = readFields(await readBody(req), "edit");
      if ("error" in fields) {
        send(res, 400, { error: fields.error });
        return;
      }
      const updated = await editBot(messageRoute[1] ?? "", fields);
      if ("error" in updated) {
        send(res, updated.status, { error: updated.error });
        return;
      }
      send(res, 200, publicBot(updated));
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
      await disconnectBotMcpHooks(hooksPath, removed.id, removed.conversationId);
      bots.splice(index, 1);
      await forgetBotFeatures(removed.id);
      await saveBots(bots);
      await saveFiles(filesPath, (await loadFiles(filesPath)).filter((item) => item.botId !== removed.id));
      await saveQuestions(questionsPath, (await loadQuestions(questionsPath)).filter((item) => item.botId !== removed.id));
      await saveNotes(notesPath, (await loadNotes(notesPath)).filter((item) => item.botId !== removed.id));
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
      const body = asRecord(await readBody(req));
      const fileIds = Array.isArray(body.fileIds) ? body.fileIds.filter((item): item is string => typeof item === "string") : [];
      let content = typeof body.content === "string" ? body.content.trim() : "";
      const whenBusy = body.whenBusy === "followUp" || body.whenBusy === "steer" || body.whenBusy === "reject" ? body.whenBusy : undefined;
      const bots = await loadBots();
      const bot = bots.find((item) => item.id === messageRoute[1]);
      if (!bot) {
        send(res, 404, { error: "bot not found" });
        return;
      }
      const stored = await loadFiles(filesPath);
      const chosen = stored.filter((item) => item.botId === bot.id && fileIds.includes(item.id) && !item.messageId);
      if (chosen.length > 0) {
        const lines = chosen.map((item) => `Attached: ${item.relativePath}`);
        content = content ? `${content}\n\n${lines.join("\n")}` : lines.join("\n");
        content = `${content}\n${fileMarker(chosen.map((item) => item.id))}`;
      }
      if (!content.trim()) {
        send(res, 400, { error: "content is required" });
        return;
      }
      const conversation = await conversationFor(bot.id);
      const submission = await conversation.submit({
        type: "input",
        content,
        ...(whenBusy ? { whenBusy } : {}),
      }, context);
      const admitted = await submission.status(context);
      const messageId = admitted.status === "placed" || admitted.status === "done" ? String(admitted.entry) : "";
      if (messageId && chosen.length > 0) {
        for (const item of stored) {
          if (chosen.some((file) => file.id === item.id)) item.messageId = messageId;
        }
        await saveFiles(filesPath, stored);
      }
      send(res, 202, { submissionId: submission.id });
      return;
    }
    const extraRoute = url.pathname.match(/^\/api\/bots\/([^/]+)\/(schedules|questions|files|mcp-events)(?:\/([^/]+))?(?:\/(answer))?$/);
    if (extraRoute) {
      const botId = extraRoute[1] ?? "";
      const kind = extraRoute[2];
      const leaf = extraRoute[3] ? decodeURIComponent(extraRoute[3]) : "";
      const answer = extraRoute[4] === "answer";
      const bots = await loadBots();
      const bot = bots.find((item) => item.id === botId);
      if (!bot) {
        send(res, 404, { error: "bot not found" });
        return;
      }
      if (kind === "schedules" && !leaf && req.method === "GET") {
        const jobs = (await loadSchedules()).filter((item) => item.botId === bot.id);
        send(res, 200, { jobs: jobs.map(publicSchedule) });
        return;
      }
      if (kind === "schedules" && leaf && req.method === "PATCH") {
        const jobId = Number(leaf);
        const body = asRecord(await readBody(req));
        if (!Number.isInteger(jobId) || typeof body.enabled !== "boolean") {
          send(res, 400, { error: "enabled is required" });
          return;
        }
        const updated = await setScheduleEnabled(bot.id, jobId, body.enabled);
        if ("error" in updated) {
          send(res, updated.status, { error: updated.error });
          return;
        }
        send(res, 200, updated.job);
        return;
      }
      if (kind === "schedules" && leaf && req.method === "DELETE") {
        const jobId = Number(leaf);
        if (!Number.isInteger(jobId)) {
          send(res, 400, { error: "schedule not found" });
          return;
        }
        const removed = await deleteOneSchedule(bot.id, jobId);
        if ("error" in removed) {
          send(res, removed.status, { error: removed.error });
          return;
        }
        send(res, 200, { ok: true });
        return;
      }
      if (kind === "mcp-events" && !leaf && req.method === "GET") {
        send(res, 200, { hooks: await listMcpHooks(hooksPath, bot.id, bot.conversationId) });
        return;
      }
      if (kind === "mcp-events" && leaf && req.method === "DELETE") {
        const removed = await disconnectMcpHook(hooksPath, bot.id, leaf, bot.conversationId);
        if ("error" in removed) {
          send(res, 404, { error: removed.error });
          return;
        }
        send(res, 200, { ok: true });
        return;
      }
      if (kind === "questions" && !leaf && req.method === "POST") {
        const read = readQuestionInput(asRecord(await readBody(req)));
        if ("error" in read) {
          send(res, 400, { error: read.error });
          return;
        }
        const created = await createQuestion(bot.id, read.prompt, read.options);
        if ("error" in created) {
          send(res, 404, { error: created.error });
          return;
        }
        send(res, 201, publicQuestion(created));
        return;
      }
      if (kind === "questions" && leaf && answer && req.method === "POST") {
        const questions = await loadQuestions(questionsPath);
        const question = questions.find((item) => item.id === leaf && item.botId === bot.id);
        if (!question) {
          send(res, 404, { error: "question not found" });
          return;
        }
        if (question.answeredAt) {
          send(res, 409, { error: "question is already answered" });
          return;
        }
        const picked = readAnswerInput(asRecord(await readBody(req)).selected, question.options.map((option) => option.id));
        if ("error" in picked) {
          send(res, 400, { error: picked.error });
          return;
        }
        question.selected = picked;
        question.answeredAt = new Date().toISOString();
        await saveQuestions(questionsPath, questions);
        const conversation = await conversationFor(bot.id);
        const submission = await conversation.submit({ type: "input", content: answerText(question.options, picked) }, context);
        send(res, 202, { submissionId: submission.id, question: publicQuestion(question) });
        return;
      }
      if (kind === "files" && !leaf && req.method === "POST") {
        const raw = await readRaw(req, 12_000_000);
        if (raw === undefined) {
          send(res, 413, { error: "file is too large" });
          return;
        }
        let parsed: unknown = {};
        if (raw.length > 0) parsed = JSON.parse(raw);
        const decoded = decodeUpload(asRecord(parsed));
        if ("error" in decoded) {
          send(res, 400, { error: decoded.error });
          return;
        }
        const id = newId("f");
        const relativePath = `uploads/${bot.id}/${id}-${decoded.name}`;
        const target = uploadFile(relativePath);
        if (!target) {
          send(res, 400, { error: "file name is invalid" });
          return;
        }
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, decoded.bytes);
        const record: FileRecord = {
          id,
          botId: bot.id,
          name: decoded.name,
          mime: decoded.mime,
          size: decoded.bytes.length,
          createdAt: new Date().toISOString(),
          relativePath,
        };
        const files = await loadFiles(filesPath);
        files.push(record);
        await saveFiles(filesPath, files);
        send(res, 201, publicFile(record));
        return;
      }
      if (kind === "files" && leaf && req.method === "GET") {
        const record = (await loadFiles(filesPath)).find((item) => item.id === leaf && item.botId === bot.id);
        if (!record) {
          send(res, 404, { error: "file not found" });
          return;
        }
        const target = uploadFile(record.relativePath);
        if (!target) {
          send(res, 404, { error: "file not found" });
          return;
        }
        const bytes = await readFile(target);
        const mime = record.mime || "application/octet-stream";
        res.writeHead(200, {
          "content-type": mime,
          ...fileResponseHeaders(mime, record.name),
          "content-length": String(bytes.length),
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
        });
        res.end(bytes);
        return;
      }
    }
    if (await handleFeature(url, req, res)) return;
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
      name: "create_mcp_event_webhook",
      description: "Mint an HTTPS webhook URL and a whsec_ signing secret for this bot. Give both to an MCP server as events/subscribe delivery { mode: \"webhook\", url, secret }. That server verifies the URL, then POSTs signed MCP events here. Each event is admitted into this conversation. The secret is shown once in this tool result.",
      parameters: Type.Object({
        label: Type.Optional(Type.String({ description: "Short note for what this URL watches" })),
      }),
      replay: "safe",
      execute: async (args, api) => {
        const created = await createMcpHook(hooksPath, String(api.conversationId), publicUrl, args.label ?? "");
        if ("error" in created) return { content: [{ type: "text", text: created.error }], isError: true };
        const lines = [
          `Webhook URL: ${created.url}`,
          `Signing secret: ${created.secret}`,
          "Pass both as delivery.mode \"webhook\" on events/subscribe. Verification challenges are answered here. Signed events enter this conversation.",
        ];
        if (created.label) lines.splice(2, 0, `Label: ${created.label}`);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      },
    }),
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
        "When an MCP server should push events into this conversation, call create_mcp_event_webhook and pass the URL and whsec_ secret as the webhook delivery on events/subscribe.",
        "The human disconnects a webhook from the bot dialog. After that, the URL stops accepting events.",
        ...lines,
      ].join("\n");
    }),
  ],
});
registry.install(peerExtension);

const bashTool = (CodingTools.tools ?? []).find((tool) => tool.name === "bash") as ToolRegistration | undefined;
presenceExtension = defineExtension({
  name: "presence",
  hooks: [
    hook(ToolTask, {
      beforeTool(call, api) {
        const args = call.arguments && typeof call.arguments === "object" ? call.arguments as Record<string, unknown> : {};
        rememberWork(String(api.conversationId), String(api.taskId), workingOn(call.name, args), call.name);
        return undefined;
      },
      afterTool(_call, _result, api) {
        forgetWork(String(api.taskId));
        return undefined;
      },
    }),
    hook(GenerationTask, {
      beforeRequest(_request, api) {
        rememberWork(String(api.conversationId), String(api.taskId), "working on a reply");
        return undefined;
      },
      afterResponse(_message, api) {
        forgetWork(String(api.taskId));
      },
    }),
  ],
  wraps: bashTool ? [
    wrapTool(bashTool, (tool) => ({
      ...tool,
      async execute(args, api, toolContext) {
        const command = args && typeof args === "object" && "command" in args ? (args as { command?: unknown }).command : "";
        const reviewed = await enqueueFeatures(async () => {
          const vault = normalizeVault(await loadJson(secretsPath));
          const state = normalizeApprovals(await loadJson(approvalsPath));
          const next = reviewAction(state, {
            botId: String(api.conversationId),
            command,
            secrets: vaultValues(vault, String(api.conversationId)),
          });
          if ("error" in next) return next;
          await saveJson(approvalsPath, next.state);
          return next;
        });
        if ("error" in reviewed) return { content: [{ type: "text", text: reviewed.error }], isError: true };
        if (reviewed.decision !== "allow") return { content: [{ type: "text", text: reviewed.message }], isError: true };
        const record = args as { timeout?: unknown };
        const timeout = bashTimeoutSeconds(record.timeout, hangLimit());
        try {
          return await tool.execute({ ...(args as object), timeout } as typeof args, api, toolContext);
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (/timed out|timeout/i.test(message)) await addNote(String(api.conversationId), hangNote("bash"));
          throw error;
        }
      },
    })),
  ] : [],
  sections: [
    section("review", async () => approvalPrompt()),
  ],
});
registry.install(presenceExtension);

selfExtension = defineExtension({
  name: "self",
  tools: [
    defineTool({
      name: "update_self",
      description: "Change this bot's own name and face. name is the roster title, at most 80 characters. look is one of slate, silver, mist, tide, pine, amber, clay, plum. Omit a field to leave it unchanged.",
      parameters: Type.Object({
        name: Type.Optional(Type.String({ description: "New name" })),
        look: Type.Optional(Type.String({ description: "Pastel face: slate, silver, mist, tide, pine, amber, clay, or plum" })),
      }),
      replay: "safe",
      execute: async (args, api) => {
        const body: Record<string, unknown> = {};
        if (args.name !== undefined) body.name = args.name;
        if (args.look !== undefined) body.look = args.look;
        const fields = readFields(body, "edit");
        if ("error" in fields) return { content: [{ type: "text", text: fields.error }], isError: true };
        const updated = await editBot(String(api.conversationId), fields);
        if ("error" in updated) return { content: [{ type: "text", text: updated.error }], isError: true };
        return { content: [{ type: "text", text: `Name is ${updated.name}. Look is ${updated.look}.` }] };
      },
    }),
    defineTool({
      name: "ask_question",
      description: "Ask the person a question with options they can multi-select and submit. Free text still works. Use this when you need a choice, not when a normal reply is enough.",
      parameters: Type.Object({
        prompt: Type.String({ description: "The question" }),
        options: Type.Array(Type.String({ description: "One choice" }), { description: "Two to twelve choices" }),
      }),
      replay: "safe",
      execute: async (args, api) => {
        const created = await createQuestion(String(api.conversationId), args.prompt, args.options);
        if ("error" in created) return { content: [{ type: "text", text: created.error }], isError: true };
        const labels = created.options.map((option) => option.label).join(", ");
        return { content: [{ type: "text", text: `Asked: ${created.prompt}\nOptions: ${labels}\nThe person can select more than one and submit.` }] };
      },
    }),
  ],
  sections: [
    section("self", () => [
      "When the person asks you to rename yourself or change your face, call update_self in this turn.",
      "Looks are slate, silver, mist, tide, pine, amber, clay, and plum.",
      "When you need the person to pick among choices, call ask_question. They can select more than one option. They can still type a normal message.",
    ].join("\n")),
  ],
});
registry.install(selfExtension);

scheduleExtension = defineExtension({
  name: "schedules",
  tools: [
    defineTool({
      name: "schedule_message",
      description: "Schedule a message that cron-job.org will deliver into this conversation. It arrives as a normal user message, not a steer. Pass cron (five fields: minute hour day-of-month month day-of-week) or at (an ISO time) for a one-shot reminder.",
      parameters: Type.Object({
        message: Type.String({ description: "What to send into this conversation when the schedule fires" }),
        cron: Type.Optional(Type.String({ description: "Five cron fields, for example 0 9 * * 1-5. Omit when at is set." })),
        timezone: Type.Optional(Type.String({ description: "IANA time zone. Defaults to UTC." })),
        at: Type.Optional(Type.String({ description: "ISO time for a one-shot reminder, shown as Once." })),
      }),
      replay: "safe",
      execute: async (args, api) => {
        const scheduled = await scheduleMessage(
          String(api.conversationId),
          args.message,
          args.cron ?? "",
          args.timezone,
          `schedule:${api.taskId}:${api.callId}`,
          args.at,
        );
        if ("error" in scheduled) {
          return { content: [{ type: "text", text: scheduled.error }], isError: true };
        }
        const jobs = await loadSchedules();
        const job = jobs.find((item) => item.jobId === scheduled.jobId);
        const detail = job?.once && job.at ? ` Once at ${job.at}.` : "";
        return { content: [{ type: "text", text: `Scheduled job ${scheduled.jobId}.${detail}` }] };
      },
    }),
    defineTool({
      name: "list_schedules",
      description: "List this bot's scheduled messages, including paused ones and one-shot Once reminders.",
      parameters: Type.Object({}),
      replay: "safe",
      execute: async (_args, api) => {
        const jobs = (await loadSchedules()).filter((item) => item.botId === String(api.conversationId));
        if (jobs.length === 0) return { content: [{ type: "text", text: "No schedules." }] };
        return { content: [{ type: "text", text: jobs.map(scheduleSummary).join("\n") }] };
      },
    }),
    defineTool({
      name: "pause_schedule",
      description: "Pause a scheduled message so cron-job.org does not run it. The job stays and can be resumed.",
      parameters: Type.Object({ jobId: Type.Number({ description: "Job id from list_schedules or schedule_message" }) }),
      replay: "safe",
      execute: async (args, api) => {
        if (!Number.isInteger(args.jobId)) return { content: [{ type: "text", text: "schedule not found" }], isError: true };
        const updated = await setScheduleEnabled(String(api.conversationId), args.jobId, false);
        if ("error" in updated) return { content: [{ type: "text", text: updated.error }], isError: true };
        return { content: [{ type: "text", text: `Paused job ${updated.job.jobId}.` }] };
      },
    }),
    defineTool({
      name: "resume_schedule",
      description: "Resume a paused scheduled message.",
      parameters: Type.Object({ jobId: Type.Number({ description: "Job id to resume" }) }),
      replay: "safe",
      execute: async (args, api) => {
        if (!Number.isInteger(args.jobId)) return { content: [{ type: "text", text: "schedule not found" }], isError: true };
        const updated = await setScheduleEnabled(String(api.conversationId), args.jobId, true);
        if ("error" in updated) return { content: [{ type: "text", text: updated.error }], isError: true };
        return { content: [{ type: "text", text: `Resumed job ${updated.job.jobId}.` }] };
      },
    }),
    defineTool({
      name: "delete_schedule",
      description: "Delete a scheduled message so it does not run again.",
      parameters: Type.Object({ jobId: Type.Number({ description: "Job id to delete" }) }),
      replay: "safe",
      execute: async (args, api) => {
        if (!Number.isInteger(args.jobId)) return { content: [{ type: "text", text: "schedule not found" }], isError: true };
        const removed = await deleteOneSchedule(String(api.conversationId), args.jobId);
        if ("error" in removed) return { content: [{ type: "text", text: removed.error }], isError: true };
        return { content: [{ type: "text", text: `Deleted job ${args.jobId}.` }] };
      },
    }),
  ],
  sections: [
    section("schedules", async () => {
      if (!cronApiKey) return undefined;
      return [
        "You can schedule a later message into this conversation with schedule_message.",
        "Use a five-field cron expression: minute hour day-of-month month day-of-week.",
        "For a one-shot reminder, pass at as an ISO time and omit cron. It is shown as Once.",
        "list_schedules, pause_schedule, resume_schedule, and delete_schedule manage those jobs.",
        "When a job fires, the text arrives as a normal user message. It is not a steer, and it does not continue a peer chain.",
      ].join("\n");
    }),
  ],
});
registry.install(scheduleExtension);

rosterExtension = defineExtension({
  name: "roster",
  tools: [
    defineTool({
      name: "create_bot",
      description: "Create another bot in the roster. It shows up in the sidebar. Use it only when the human asks for a new bot. Name is required. Instruction is optional. Look is optional: slate, silver, mist, tide, pine, amber, clay, or plum. You can create at most 8 bots. The roster holds at most 24.",
      parameters: Type.Object({
        name: Type.String({ description: "Name of the new bot" }),
        instruction: Type.Optional(Type.String({ description: "How the new bot should behave" })),
        look: Type.Optional(Type.String({ description: "One of slate, silver, mist, tide, pine, amber, clay, plum" })),
      }),
      replay: "safe",
      execute: async (args, api) => {
        const body: Record<string, unknown> = { name: args.name, instruction: args.instruction ?? "" };
        if (args.look !== undefined) body.look = args.look;
        const fields = readFields(body, "create");
        if ("error" in fields) return { content: [{ type: "text", text: fields.error }], isError: true };
        const created = await enqueueFeatures(() => createNamedBot(fields, String(api.conversationId)));
        if (created.status >= 400) {
          const error = typeof created.body.error === "string" ? created.body.error : "could not create the bot";
          return { content: [{ type: "text", text: error }], isError: true };
        }
        const name = typeof created.body.name === "string" ? created.body.name : fields.name;
        const id = typeof created.body.id === "string" ? created.body.id : "";
        return { content: [{ type: "text", text: `Created ${name} (id ${id}). It is in the roster.` }] };
      },
    }),
  ],
  sections: [
    section("roster", async () => [
      "You can create another bot with create_bot when the human asks for one. It appears in the roster.",
      "Pass a short name, an optional instruction, and an optional look: slate, silver, mist, tide, pine, amber, clay, plum.",
      "Do not create a bot they did not ask for. A roster holds at most 24 bots, and you can create at most 8.",
    ].join("\n")),
  ],
});
registry.install(rosterExtension);

memoryExtension = defineExtension({
  name: "memory",
  tools: [
    defineTool({
      name: "save_memory",
      description: "Save a fact in this bot's memory. It is added to later turns. Do not save secrets.",
      parameters: Type.Object({
        fact: Type.String({ description: "The fact to remember" }),
      }),
      replay: "safe",
      execute: async (args, api) => {
        const saved = await enqueueFeatures(async () => {
          const memories = normalizeMemories(await loadJson(memoriesPath));
          const next = saveMemory(memories, String(api.conversationId), args.fact);
          if ("error" in next) return next;
          await saveJson(memoriesPath, { memories: next.memories });
          return { id: next.memory.id };
        });
        if ("error" in saved) return { content: [{ type: "text", text: saved.error }], isError: true };
        return { content: [{ type: "text", text: `Saved memory ${saved.id}.` }] };
      },
    }),
    defineTool({
      name: "forget_memory",
      description: "Forget a saved fact for this bot. Pass its id, or a query that matches one fact. Pass all true only when the human wants every match forgotten.",
      parameters: Type.Object({
        id: Type.Optional(Type.String({ description: "Memory id" })),
        query: Type.Optional(Type.String({ description: "Text contained in the fact" })),
        all: Type.Optional(Type.Boolean({ description: "Forget every fact that matches query" })),
      }),
      replay: "safe",
      execute: async (args, api) => {
        const forgotten = await enqueueFeatures(async () => {
          const memories = normalizeMemories(await loadJson(memoriesPath));
          const next = forgetMemory(memories, String(api.conversationId), args);
          if ("error" in next) return next;
          await saveJson(memoriesPath, { memories: next.memories });
          return { count: next.forgotten.length };
        });
        if ("error" in forgotten) return { content: [{ type: "text", text: forgotten.error }], isError: true };
        return { content: [{ type: "text", text: `Forgot ${forgotten.count}.` }] };
      },
    }),
  ],
  sections: [
    section("memory", async (input) => memoryPrompt(normalizeMemories(await loadJson(memoriesPath)), String(input.conversationId))),
  ],
});
registry.install(memoryExtension);

secretsExtension = defineExtension({
  name: "secrets",
  tools: [
    defineTool({
      name: "request_secret",
      description: "Ask the human for a secret on a card. The value is typed into the card and stored in this bot's vault. It never goes in the chat. Do not ask them to paste it in a message.",
      parameters: Type.Object({
        name: Type.String({ description: "Secret name, letters digits and underscores, such as GITHUB_TOKEN" }),
        reason: Type.Optional(Type.String({ description: "Why this bot needs it" })),
      }),
      replay: "safe",
      execute: async (args, api) => {
        const opened = await enqueueFeatures(async () => {
          const vault = normalizeVault(await loadJson(secretsPath));
          const next = requestSecret(vault, String(api.conversationId), args.name, args.reason);
          if ("error" in next) return next;
          await saveJson(secretsPath, next.vault);
          return { name: next.request.name };
        });
        if ("error" in opened) return { content: [{ type: "text", text: opened.error }], isError: true };
        return { content: [{ type: "text", text: `A secret card is waiting for ${opened.name}. The value will not appear in the transcript. Do not ask the human to paste it in chat.` }] };
      },
    }),
    defineTool({
      name: "read_secret",
      description: "Read a secret this bot already saved. The value is for your next tool call only. Never repeat it in the chat.",
      parameters: Type.Object({
        name: Type.String({ description: "Secret name" }),
      }),
      replay: "safe",
      execute: async (args, api) => {
        const vault = normalizeVault(await loadJson(secretsPath));
        const read = readSecret(vault, String(api.conversationId), args.name);
        if ("error" in read) return { content: [{ type: "text", text: read.error }], isError: true };
        return { content: [{ type: "text", text: read.value }] };
      },
    }),
  ],
  sections: [
    section("secrets", async (input) => secretsPrompt(normalizeVault(await loadJson(secretsPath)), String(input.conversationId))),
  ],
});
registry.install(secretsExtension);

coordinatorExtension = defineExtension({
  name: "coordinator",
  sections: [
    section("coordinator", async (input) => {
      const bots = await loadBots();
      const self = String(input.conversationId);
      if (mainBotId !== self) return undefined;
      const others = bots.filter((item) => item.id !== self && item.conversationId !== self);
      return coordinatorPrompt(others);
    }),
  ],
});
registry.install(coordinatorExtension);

await loadCronKey();
await loadBots();
const hangTimer = setInterval(() => {
  sweepHangs().catch(() => undefined);
}, 5_000);
hangTimer.unref?.();
const checkTimer = setInterval(() => {
  runCheckIn(false).catch(() => undefined);
}, 30_000);
checkTimer.unref?.();
http.listen(port, () => {
  console.log(`pi-orbs server ${version} on ${port}`);
});
