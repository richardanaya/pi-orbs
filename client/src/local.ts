// In-memory stand-in for a Sprite. Used only when PI_ORBS_MODE=local or --local.
import type { IncomingMessage, ServerResponse } from "node:http";
import { archiveHeaders, conversationsArchive, type ExportSnapshot } from "./archive.js";
import { defaultConnector, publicConnectors, readDeployUpdate, readSetup, type SpriteConnector } from "./connectors.js";
import { localVersion } from "./deploy.js";
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
  openSession,
  publicSession,
  publicVoice,
  readVoice,
  voiceFromSetup,
  type VoiceConfig,
  type VoiceMatch,
} from "./voice.js";
import {
  cronFromSetup,
  deleteCronJob,
  isCronFailure,
  memoryCron,
  newHookToken,
  publicCron,
  putCronJob,
  readCronSettings,
  readHookBody,
  readScheduleRequest,
  scheduleTitle,
  setCronJobEnabled,
  tokensEqual,
  webhookUrl,
  type CronCaller,
} from "./schedule.js";
import { fileResponseHeaders } from "./file-response.js";
import { answerText, decodeBase64, fileMarker, readAnswerInput, readQuestionInput, safeFileName, takeFileMarker } from "./thread-view.js";
import { hangLimit, hangNote, isHung, workingOn } from "./work.js";
import {
  CHECK_IN_MS,
  CHECK_IN_PROMPT,
  copyName,
  deleteSecret,
  dismissSecret,
  dropBot,
  expireApprovals,
  forgetMemory,
  fulfillSecret,
  guardRoster,
  guardSpawn,
  normalizeApprovals,
  publicApprovals,
  publicMemories,
  publicVault,
  readTemplate,
  redactText,
  requestSecret,
  resolveApproval,
  reviewAction,
  revokeAlways,
  saveMemory,
  searchPalette,
  templateFrom,
  vaultValues,
  type ApprovalState,
  type MemoryRecord,
  type SearchMessage,
  type VaultState,
} from "./features.js";

const LOOKS = ["slate", "silver", "mist", "tide", "pine", "amber", "clay", "plum"] as const;
const NAME_MAX = 80;
const INSTRUCTION_MAX = 8_000;
const PEER_CONTENT_MAX = 8_000;
const PEER_LEDGER_MAX = 1_000;
const PEER_BUSY_MS = 12_000;

type Look = (typeof LOOKS)[number];
type Kind = "pi.user" | "pi.assistant" | "pi.note";
type PublicFile = { id: string; name: string; mime: string; size: number; createdAt: string; path: string; messageId?: string };
type StoredFile = PublicFile & { botId: string; bytes: Uint8Array };
type QuestionOption = { id: string; label: string };
type Question = {
  id: string;
  botId: string;
  prompt: string;
  options: QuestionOption[];
  createdAt: string;
  selected?: string[];
  answeredAt?: string;
};
type WorkItem = { botId: string; text: string; tool?: string; startedAt: number; until?: number };
type Message = { id: string; kind: Kind; text: string; createdAt: string; files?: PublicFile[] };
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
  hookToken: string;
  messages: Message[];
  busyUntil?: number;
  createdBy?: string;
};
type ScheduledJob = {
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
type Sprite = { name: string; url: string; voice: VoiceConfig | null; cronApiKey: string | null } & SpriteConnector;
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
let schedules: ScheduledJob[] = [];
let cronJobs = memoryCron();
let files: StoredFile[] = [];
let questions: Question[] = [];
let work: WorkItem[] = [];
let memories: MemoryRecord[] = [];
let vault: VaultState = { secrets: [], requests: [] };
let approvals: ApprovalState = { cards: [], grants: [] };
let mainBotId: string | null = null;
let nextCheckInAt = 0;
let nextFile = 1;
let nextQuestion = 1;
let nextOption = 1;

function message(kind: Kind, text: string, createdAt?: string): Message {
  const id = `m${nextMessage++}`;
  const at = createdAt ?? new Date(seedStart + seedClock * 1000).toISOString();
  if (!createdAt) seedClock += 30;
  return { id, kind, text, createdAt: at };
}

function publicMessage(item: Message): { id: string; kind: Kind; text: string; files?: PublicFile[] } {
  const taken = takeFileMarker(item.text);
  return {
    id: item.id,
    kind: item.kind,
    text: redactText(taken.text, secretValues()),
    ...(item.files && item.files.length > 0 ? { files: item.files } : {}),
  };
}

function publicQuestion(question: Question) {
  return {
    id: question.id,
    prompt: question.prompt,
    options: question.options,
    createdAt: question.createdAt,
    ...(question.selected ? { selected: question.selected } : {}),
    ...(question.answeredAt ? { answeredAt: question.answeredAt } : {}),
  };
}

function publicSchedule(job: ScheduledJob) {
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

function sweepWork(now = Date.now()): void {
  const limit = hangLimit();
  const next: WorkItem[] = [];
  for (const item of work) {
    const bot = bots.find((entry) => entry.id === item.botId);
    if (isHung(item.startedAt, now, limit) && item.tool) {
      if (bot) bot.messages.push(message("pi.note", hangNote(item.tool), new Date(now).toISOString()));
      if (bot) bot.busyUntil = 0;
      continue;
    }
    if (item.until !== undefined && item.until <= now) continue;
    next.push(item);
  }
  work = next;
}

function statusLines(): { id: string; text: string }[] {
  sweepWork();
  const status = work.map((item) => ({ id: item.botId, text: item.text }));
  const seen = new Set(status.map((item) => item.id));
  for (const id of busyIds()) {
    if (!seen.has(id)) status.push({ id, text: "working on a message" });
  }
  return status;
}

function threadMessages(bot: Bot) {
  const lines: {
    id: string;
    kind: string;
    text: string;
    createdAt: string;
    from?: string;
    to?: string;
    fromName?: string;
    toName?: string;
  }[] = bot.messages.map((item) => ({ ...publicMessage(item), createdAt: item.createdAt }));
  const mine = peers.filter((item) => item.from === bot.id || item.to === bot.id);
  for (const peer of [...mine].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    const line = {
      id: `peer:${peer.id}`,
      kind: "pi.peer",
      text: redactText(peer.content, secretValues()),
      createdAt: peer.createdAt,
      from: peer.from,
      to: peer.to,
      fromName: peer.fromName,
      toName: peer.toName,
    };
    const index = lines.findIndex((item) => item.createdAt > peer.createdAt);
    if (index < 0) lines.push(line);
    else lines.splice(index, 0, line);
  }
  return lines;
}

const SKETCH = [
  "## Sketch",
  "",
  "A **black** page, *muted* gray type, and a ~~red~~ alert.",
  "",
  "- Background",
  "- Title",
  "  - Sprite name",
  "- One status line",
  "",
  "1. Open the work directory",
  "2. Read the page file",
  "",
  "> Same muted gray as the roster.",
  "",
  "See [notes](https://example.com/notes).",
  "",
  "| Piece | Tone |",
  "| --- | --- |",
  "| Title | White |",
  "| Line | Gray |",
  "",
  "---",
  "",
  "![Pi orb](/logo.png)",
  "",
  "![Walkthrough](/orb-clip.mp4)",
  "",
  "```html",
  "<p>Hi</p>",
  "```",
].join("\n");

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
      hookToken: newHookToken(),
      messages: [
        message("pi.user", "Sketch a status page for this sprite. Black background, large type."),
        message("pi.assistant", "A single page is enough. The title is the sprite name, and one line under it says whether the server answered."),
        message("pi.user", "Keep that line in the same muted gray as the roster."),
        message("pi.assistant", "Done. status.html is in the work directory. Black page, large title, gray status line."),
        message("pi.assistant", SKETCH, new Date(seedStart + 240_000).toISOString()),
      ],
    },
    {
      id: "kepler",
      name: "Kepler",
      conversationId: "kepler",
      instruction: "Answer questions about this sprite and its shared work directory.",
      look: "pine",
      hookToken: newHookToken(),
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
      hookToken: newHookToken(),
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

function reset(name: string, connector: SpriteConnector = defaultConnector(), sample = false, voice: VoiceConfig | null = null, cronApiKey: string | null = null): void {
  clearSessions();
  sprite = { name, url: localUrl, ...connector, voice, cronApiKey };
  bots = seedBots();
  peers = sample ? samplePeers() : [];
  schedules = [];
  cronJobs = memoryCron();
  files = [];
  questions = [];
  work = [];
  memories = [];
  vault = { secrets: [], requests: [] };
  approvals = { cards: [], grants: [] };
  mainBotId = null;
  nextCheckInAt = 0;
  nextFile = 1;
  nextQuestion = 1;
  nextOption = 1;
  nextPeer = 1;
}

function submitHuman(bot: Bot, content: string, fileIds: readonly string[] = []): { submissionId: string } {
  const at = new Date();
  const chosen = files.filter((item) => item.botId === bot.id && fileIds.includes(item.id) && !item.messageId);
  let text = content;
  if (chosen.length > 0) {
    const lines = chosen.map((item) => `Attached: ${item.path}`);
    text = text ? `${text}\n\n${lines.join("\n")}` : lines.join("\n");
    text = `${text}\n${fileMarker(chosen.map((item) => item.id))}`;
  }
  const user = message("pi.user", text, at.toISOString());
  if (chosen.length > 0) {
    user.files = chosen.map((item) => {
      item.messageId = user.id;
      return {
        id: item.id,
        name: item.name,
        mime: item.mime,
        size: item.size,
        createdAt: item.createdAt,
        path: item.path,
        messageId: user.id,
      };
    });
  }
  bot.messages.push(user);
  bot.messages.push(message("pi.assistant", cannedReply(takeFileMarker(text).text), new Date(at.getTime() + 1000).toISOString()));
  return { submissionId: `local-${bot.messages.at(-1)?.id ?? "reply"}` };
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

function publicBot(bot: Bot): {
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

function createLocalBot(fields: FieldPatch, createdBy?: string): { status: number; body: Record<string, unknown> } {
  const guard = createdBy ? guardSpawn(bots, createdBy) : guardRoster(bots.length);
  if ("error" in guard) return { status: guard.error === "bot not found" ? 404 : 409, body: { error: guard.error } };
  const id = `bot-${nextBot++}`;
  const bot: Bot = {
    id,
    name: fields.name ?? "",
    conversationId: id,
    instruction: fields.instruction ?? "",
    look: fields.look ?? nextLook(bots.map((item) => item.look)),
    hookToken: newHookToken(),
    messages: [],
    ...(createdBy ? { createdBy } : {}),
  };
  bots.push(bot);
  return { status: 201, body: publicBot(bot) };
}

function mainBody(): { botId: string | null; nextCheckInAt: string | null } {
  return {
    botId: mainBotId,
    nextCheckInAt: nextCheckInAt > 0 ? new Date(nextCheckInAt).toISOString() : null,
  };
}

function coordinate(bot: Bot): void {
  const other = bots.find((item) => item.id !== bot.id);
  if (!other) return;
  const id = `peer-${nextPeer++}`;
  rememberPeer({
    id,
    from: bot.id,
    to: other.id,
    fromName: bot.name,
    toName: other.name,
    content: "Main Bot check-in. Continue your current work and report anything blocked.",
    submissionId: `local-${id}`,
    createdAt: new Date().toISOString(),
  });
  other.busyUntil = Date.now() + PEER_BUSY_MS;
}

function runCheckIn(force: boolean): { status: number; body: Record<string, unknown> } {
  const bot = mainBotId ? bots.find((item) => item.id === mainBotId) : undefined;
  if (!bot) return { status: 409, body: { error: "no Main Bot" } };
  if (!force && Date.now() < nextCheckInAt) return { status: 409, body: { error: "check-in is not due" } };
  nextCheckInAt = Date.now() + CHECK_IN_MS;
  const submitted = submitHuman(bot, CHECK_IN_PROMPT);
  coordinate(bot);
  return { status: 202, body: { ...submitted, botId: bot.id } };
}

function maybeCheckIn(): void {
  if (!mainBotId || Date.now() < nextCheckInAt) return;
  runCheckIn(false);
}

function searchMessages(): SearchMessage[] {
  const messages: SearchMessage[] = [];
  for (const bot of bots) {
    for (const item of threadMessages(bot)) {
      messages.push({
        botId: bot.id,
        botName: bot.name,
        look: bot.look,
        messageId: item.id,
        kind: item.kind,
        text: item.text,
        createdAt: item.createdAt,
      });
    }
  }
  return messages;
}

function forgetLocalBot(botId: string): void {
  memories = dropBot(memories, botId);
  vault = { secrets: dropBot(vault.secrets, botId), requests: dropBot(vault.requests, botId) };
  approvals = { cards: dropBot(approvals.cards, botId), grants: dropBot(approvals.grants, botId) };
  if (mainBotId === botId) {
    mainBotId = null;
    nextCheckInAt = 0;
  }
}

function requestBase(req: IncomingMessage): string {
  const host = req.headers.host;
  if (typeof host === "string" && host.length > 0 && host.length < 200 && !/[\s/]/.test(host)) return `http://${host}`;
  return localUrl;
}

function cronCaller(): CronCaller {
  return cronJobs.call;
}

async function deleteSchedulesFor(botId: string | null): Promise<{ ok: true } | { error: string; status: number }> {
  const mine = botId ? schedules.filter((item) => item.botId === botId) : schedules.slice();
  if (mine.length === 0) return { ok: true };
  if (!sprite?.cronApiKey) return { error: "cron-job.org API key is not configured", status: 409 };
  for (const job of mine) {
    const removed = await deleteCronJob(cronCaller(), sprite.cronApiKey, job.jobId);
    if ("error" in removed) return removed;
  }
  const drop = new Set(mine.map((item) => item.jobId));
  schedules = schedules.filter((item) => !drop.has(item.jobId));
  return { ok: true };
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
    content: redactText(record.content, secretValues()),
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
      messages: bot.messages.flatMap((item) => {
        if (item.kind !== "pi.user" && item.kind !== "pi.assistant") return [];
        return [{
          id: item.id,
          kind: item.kind,
          text: takeFileMarker(item.text).text,
          createdAt: item.createdAt,
        }];
      }),
    })),
  };
}

async function readJson(req: IncomingMessage, limit = 1_000_000): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error("body too large");
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

function secretValues(): string[] {
  return [
    ...(sprite?.voice ? [sprite.voice.apiKey] : []),
    ...(sprite?.cronApiKey ? [sprite.cronApiKey] : []),
    ...bots.map((bot) => bot.hookToken),
    ...vaultValues(vault),
  ];
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
    voice: publicVoice(sprite.voice),
    cron: publicCron(sprite.cronApiKey),
  };
}

async function handleLocalVoice(match: VoiceMatch, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!sprite) {
    send(res, 404, { error: "sprite is not managed by this client" });
    return;
  }
  if (match.kind === "save") {
    if (req.method !== "POST") {
      send(res, 404, { error: "not found" });
      return;
    }
    const read = readVoice(await readJson(req), sprite.voice);
    if ("error" in read) {
      send(res, 400, { error: read.error });
      return;
    }
    if (!("unchanged" in read)) sprite.voice = read.voice;
    send(res, 200, { voice: publicVoice(sprite.voice) });
    return;
  }
  const bot = bots.find((item) => item.id === match.botId);
  if (!bot) {
    send(res, 404, { error: "bot not found" });
    return;
  }
  if (match.kind === "start") {
    if (req.method !== "POST") {
      send(res, 404, { error: "not found" });
      return;
    }
    if (!sprite.voice) {
      send(res, 400, { error: "voice is not configured" });
      return;
    }
    send(res, 201, publicSession(openSession(bot.id, "local"), bot.name));
    return;
  }
  const session = findSession(match.sessionId, bot.id);
  if (!session) {
    send(res, 404, { error: "voice call not found" });
    return;
  }
  if (match.kind === "session" && req.method === "GET") {
    send(res, 200, publicSession(session, bot.name));
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
    const body = await readJson(req);
    const appended = appendTranscript(session, body.role, body.text);
    if ("error" in appended) {
      send(res, 400, { error: appended.error });
      return;
    }
    send(res, 201, { id: appended.turn.id, role: appended.turn.role, createdAt: appended.turn.createdAt });
    return;
  }
  if (match.kind === "tools" && req.method === "POST") {
    const result = await executeVoiceTool(session, await readJson(req), {
      lines: async () => chatLines(threadMessages(bot)),
      submit: async (task) => submitHuman(bot, task),
      secrets: secretValues(),
    });
    send(res, result.status, result.body);
    return;
  }
  send(res, 404, { error: "not found" });
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
    const body = await readJson(req);
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
    reset(setup.name, { connectorType: setup.connectorType, baseApiUrl: setup.baseApiUrl, model: setup.model }, false, voice, cronApiKey);
    send(res, 201, {
      name: setup.name,
      url: localUrl,
      remoteVersion: await localVersion(),
      connectorType: setup.connectorType,
      baseApiUrl: setup.baseApiUrl,
      model: setup.model,
      voice: publicVoice(voice),
      cron: publicCron(cronApiKey),
    });
    return;
  }
  const hookRoute = url.pathname.match(/^\/hooks\/([^/]+)$/);
  if (hookRoute && req.method === "POST") {
    let token = "";
    try {
      token = decodeURIComponent(hookRoute[1] ?? "");
    } catch {
      token = "";
    }
    const bot = bots.find((item) => tokensEqual(token, item.hookToken));
    if (!sprite || !bot) {
      send(res, 401, { error: "unauthorized" });
      return;
    }
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      send(res, 400, { error: "content is required" });
      return;
    }
    const message = readHookBody(body);
    if ("error" in message) {
      send(res, 400, { error: message.error });
      return;
    }
    send(res, 202, submitHuman(bot, message.content));
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
    const cleared = await deleteSchedulesFor(null);
    if ("error" in cleared) {
      send(res, cleared.status, { error: cleared.error });
      return;
    }
    clearSessions();
    sprite = null;
    bots = [];
    peers = [];
    schedules = [];
    cronJobs = memoryCron();
    files = [];
    questions = [];
    work = [];
    memories = [];
    vault = { secrets: [], requests: [] };
    approvals = { cards: [], grants: [] };
    mainBotId = null;
    nextCheckInAt = 0;
    send(res, 200, { ok: true });
    return;
  }
  if (rest.length === 1 && rest[0] === "cron" && req.method === "POST") {
    const read = readCronSettings(await readJson(req), sprite.cronApiKey);
    if ("error" in read) {
      send(res, 400, { error: read.error });
      return;
    }
    if (!("unchanged" in read)) {
      if (!read.apiKey) {
        const cleared = await deleteSchedulesFor(null);
        if ("error" in cleared) {
          send(res, cleared.status, { error: cleared.error });
          return;
        }
      }
      sprite.cronApiKey = read.apiKey;
    }
    send(res, 200, { cron: publicCron(sprite.cronApiKey) });
    return;
  }
  const voiceMatch = matchVoicePath(url.pathname);
  if (voiceMatch && voiceMatch.name === name) {
    await handleLocalVoice(voiceMatch, req, res);
    return;
  }
  if (rest.length === 1 && rest[0] === "conversations.zip" && req.method === "GET") {
    const archive = conversationsArchive(localSnapshot(), secretValues());
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
    maybeCheckIn();
    send(res, 200, { busy: busyIds(), status: statusLines() });
    return;
  }
  if (rest.length === 1 && rest[0] === "search" && req.method === "GET") {
    const needles = secretValues();
    const result = searchPalette(url.searchParams.get("q") ?? "", bots.map((bot) => ({
      id: bot.id,
      name: redactText(bot.name, needles),
      look: bot.look,
      instruction: redactText(bot.instruction, needles),
      ...(bot.id === mainBotId ? { main: true } : {}),
    })), searchMessages());
    send(res, 200, result);
    return;
  }
  if (rest.length === 1 && rest[0] === "main" && req.method === "GET") {
    send(res, 200, mainBody());
    return;
  }
  if (rest.length === 2 && rest[0] === "main" && rest[1] === "check-in" && req.method === "POST") {
    const result = runCheckIn(true);
    send(res, result.status, result.body);
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
  if (rest[0] === "bots" && rest.length === 2 && rest[1] === "import" && req.method === "POST") {
    const read = readTemplate(await readJson(req));
    if ("error" in read) {
      send(res, 400, { error: read.error });
      return;
    }
    const room = guardRoster(bots.length);
    if ("error" in room) {
      send(res, 409, { error: room.error });
      return;
    }
    const created = createLocalBot({
      name: copyName(read.name, bots.map((bot) => bot.name)),
      instruction: read.instruction,
      look: read.look,
    });
    send(res, created.status, created.body);
    return;
  }
  if (rest[0] === "bots" && rest.length === 1 && req.method === "POST") {
    const fields = readFields(await readJson(req), "create");
    if ("error" in fields) {
      send(res, 400, { error: fields.error });
      return;
    }
    const created = createLocalBot(fields);
    send(res, created.status, created.body);
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
      sweepWork();
      send(res, 200, {
        bot: publicBot(bot),
        messages: threadMessages(bot),
        questions: questions.filter((item) => item.botId === bot.id).map(publicQuestion),
        files: files.filter((item) => item.botId === bot.id).map((item) => ({
          id: item.id,
          name: item.name,
          mime: item.mime,
          size: item.size,
          createdAt: item.createdAt,
          path: item.path,
          ...(item.messageId ? { messageId: item.messageId } : {}),
        })),
      });
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
    if (rest.length === 3 && rest[2] === "schedules" && req.method === "GET") {
      send(res, 200, { jobs: schedules.filter((item) => item.botId === bot.id).map(publicSchedule) });
      return;
    }
    if (rest.length === 3 && rest[2] === "schedules" && req.method === "POST") {
      if (!sprite.cronApiKey) {
        send(res, 400, { error: "cron-job.org API key is not configured" });
        return;
      }
      const read = readScheduleRequest(await readJson(req));
      if ("error" in read) {
        send(res, 400, { error: read.error });
        return;
      }
      const urlForJob = webhookUrl(requestBase(req), bot.hookToken);
      const created = await putCronJob(cronCaller(), sprite.cronApiKey, {
        url: urlForJob,
        title: scheduleTitle(bot.name),
        message: read.message,
        schedule: read.schedule,
      });
      if ("error" in created) {
        send(res, created.status, { error: created.error });
        return;
      }
      schedules.push({
        botId: bot.id,
        jobId: created.jobId,
        requestKey: `local-${created.jobId}`,
        message: read.message,
        cron: read.cron,
        timezone: read.timezone,
        enabled: true,
        once: read.once,
        ...(read.at ? { at: read.at } : {}),
      });
      send(res, 201, { jobId: created.jobId, url: urlForJob, once: read.once, ...(read.at ? { at: read.at } : {}) });
      return;
    }
    if (rest.length === 4 && rest[2] === "schedules" && rest[3] && req.method === "PATCH") {
      const jobId = Number(rest[3]);
      const job = schedules.find((item) => item.botId === bot.id && item.jobId === jobId);
      if (!job || !sprite.cronApiKey) {
        send(res, job ? 400 : 404, { error: job ? "cron-job.org API key is not configured" : "schedule not found" });
        return;
      }
      const body = await readJson(req);
      if (typeof body.enabled !== "boolean") {
        send(res, 400, { error: "enabled is required" });
        return;
      }
      const updated = await setCronJobEnabled(cronCaller(), sprite.cronApiKey, jobId, body.enabled);
      if ("error" in updated) {
        send(res, updated.status, { error: updated.error });
        return;
      }
      job.enabled = body.enabled;
      send(res, 200, publicSchedule(job));
      return;
    }
    if (rest.length === 4 && rest[2] === "schedules" && rest[3] && req.method === "DELETE") {
      const jobId = Number(rest[3]);
      const job = schedules.find((item) => item.botId === bot.id && item.jobId === jobId);
      if (!job) {
        send(res, 404, { error: "schedule not found" });
        return;
      }
      if (!sprite.cronApiKey) {
        send(res, 409, { error: "cron-job.org API key is not configured" });
        return;
      }
      const single = await deleteCronJob(cronCaller(), sprite.cronApiKey, jobId);
      if ("error" in single) {
        send(res, single.status, { error: single.error });
        return;
      }
      schedules = schedules.filter((item) => item.jobId !== jobId);
      send(res, 200, { ok: true });
      return;
    }
    if (rest.length === 3 && rest[2] === "questions" && req.method === "POST") {
      const read = readQuestionInput(await readJson(req));
      if ("error" in read) {
        send(res, 400, { error: read.error });
        return;
      }
      const question: Question = {
        id: `q${nextQuestion++}`,
        botId: bot.id,
        prompt: read.prompt,
        options: read.options.map((label) => ({ id: `o${nextOption++}`, label })),
        createdAt: new Date().toISOString(),
      };
      questions.push(question);
      send(res, 201, publicQuestion(question));
      return;
    }
    if (rest.length === 5 && rest[2] === "questions" && rest[3] && rest[4] === "answer" && req.method === "POST") {
      let qid = rest[3];
      try { qid = decodeURIComponent(qid); } catch { /* keep raw */ }
      const question = questions.find((item) => item.id === qid && item.botId === bot.id);
      if (!question) {
        send(res, 404, { error: "question not found" });
        return;
      }
      if (question.answeredAt) {
        send(res, 409, { error: "question is already answered" });
        return;
      }
      const picked = readAnswerInput((await readJson(req)).selected, question.options.map((option) => option.id));
      if ("error" in picked) {
        send(res, 400, { error: picked.error });
        return;
      }
      question.selected = picked;
      question.answeredAt = new Date().toISOString();
      const submitted = submitHuman(bot, answerText(question.options, picked));
      send(res, 202, { ...submitted, question: publicQuestion(question) });
      return;
    }
    if (rest.length === 3 && rest[2] === "files" && req.method === "POST") {
      const body = await readJson(req, 12_000_000);
      const name = safeFileName(typeof body.name === "string" ? body.name : "file");
      const mime = typeof body.mime === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(body.mime) ? body.mime : "application/octet-stream";
      if (typeof body.data !== "string") {
        send(res, 400, { error: "file data is required" });
        return;
      }
      const decoded = decodeBase64(body.data);
      if ("error" in decoded) {
        send(res, 400, { error: decoded.error });
        return;
      }
      const id = `f${nextFile++}`;
      const record: StoredFile = {
        id,
        botId: bot.id,
        name,
        mime,
        size: decoded.length,
        createdAt: new Date().toISOString(),
        path: `uploads/${bot.id}/${id}-${name}`,
        bytes: decoded,
      };
      files.push(record);
      send(res, 201, { id: record.id, name: record.name, mime: record.mime, size: record.size, createdAt: record.createdAt, path: record.path });
      return;
    }
    if (rest.length === 4 && rest[2] === "files" && rest[3] && req.method === "GET") {
      let fileId = rest[3];
      try { fileId = decodeURIComponent(fileId); } catch { /* keep raw */ }
      const record = files.find((item) => item.id === fileId && item.botId === bot.id);
      if (!record) {
        send(res, 404, { error: "file not found" });
        return;
      }
      const mime = record.mime || "application/octet-stream";
      res.writeHead(200, {
        "content-type": mime,
        ...fileResponseHeaders(mime, record.name),
        "content-length": String(record.bytes.length),
        "cache-control": "no-store",
      });
      res.end(Buffer.from(record.bytes));
      return;
    }
    if (rest.length === 3 && rest[2] === "work" && req.method === "POST") {
      const body = await readJson(req);
      const tool = typeof body.tool === "string" && body.tool.trim() ? body.tool.trim() : "bash";
      const detail = typeof body.detail === "string" ? body.detail : "";
      const args = tool === "bash" ? { command: detail } : { path: detail };
      const startedAt = typeof body.startedAt === "number" && Number.isFinite(body.startedAt) ? body.startedAt : Date.now();
      work = work.filter((item) => item.botId !== bot.id);
      work.push({ botId: bot.id, text: workingOn(tool, args), tool, startedAt });
      bot.busyUntil = startedAt + hangLimit() + 1_000;
      send(res, 200, { status: statusLines().filter((item) => item.id === bot.id) });
      return;
    }
    if (rest.length === 2 && req.method === "DELETE") {
      const cleared = await deleteSchedulesFor(bot.id);
      if ("error" in cleared) {
        send(res, cleared.status, { error: cleared.error });
        return;
      }
      const index = bots.findIndex((item) => item.id === bot.id);
      if (index >= 0) bots.splice(index, 1);
      for (let i = peers.length - 1; i >= 0; i -= 1) {
        const peer = peers[i];
        if (peer && (peer.from === bot.id || peer.to === bot.id)) peers.splice(i, 1);
      }
      clearBotSessions(bot.id);
      files = files.filter((item) => item.botId !== bot.id);
      questions = questions.filter((item) => item.botId !== bot.id);
      work = work.filter((item) => item.botId !== bot.id);
      forgetLocalBot(bot.id);
      send(res, 200, { ok: true });
      return;
    }
    if (rest.length === 3 && rest[2] === "template" && req.method === "GET") {
      send(res, 200, templateFrom(bot, secretValues()));
      return;
    }
    if (rest.length === 3 && rest[2] === "spawn" && req.method === "POST") {
      const fields = readFields(await readJson(req), "create");
      if ("error" in fields) {
        send(res, 400, { error: fields.error });
        return;
      }
      const created = createLocalBot(fields, bot.id);
      send(res, created.status, created.body);
      return;
    }
    if (rest.length === 3 && rest[2] === "main" && req.method === "POST") {
      const body = await readJson(req);
      if (typeof body.main !== "boolean") {
        send(res, 400, { error: "main must be a boolean" });
        return;
      }
      if (body.main) {
        mainBotId = bot.id;
        nextCheckInAt = Date.now() + CHECK_IN_MS;
      } else if (mainBotId === bot.id) {
        mainBotId = null;
        nextCheckInAt = 0;
      }
      send(res, 200, publicBot(bot));
      return;
    }
    if (rest.length === 3 && rest[2] === "memories" && req.method === "GET") {
      send(res, 200, { memories: publicMemories(memories, bot.id) });
      return;
    }
    if (rest.length === 3 && rest[2] === "memories" && req.method === "POST") {
      const next = saveMemory(memories, bot.id, (await readJson(req)).fact);
      if ("error" in next) {
        send(res, 400, { error: next.error });
        return;
      }
      memories = next.memories;
      send(res, 201, { memory: { id: next.memory.id, fact: next.memory.fact, createdAt: next.memory.createdAt } });
      return;
    }
    if (rest.length === 4 && rest[2] === "memories" && rest[3] && req.method === "DELETE") {
      let memoryId = "";
      try {
        memoryId = decodeURIComponent(rest[3]);
      } catch {
        send(res, 404, { error: "memory not found" });
        return;
      }
      const next = forgetMemory(memories, bot.id, { id: memoryId });
      if ("error" in next) {
        send(res, 404, { error: next.error });
        return;
      }
      memories = next.memories;
      send(res, 200, { ok: true });
      return;
    }
    if (rest.length === 3 && rest[2] === "secrets" && req.method === "GET") {
      send(res, 200, publicVault(vault, bot.id, vaultValues(vault, bot.id)));
      return;
    }
    if (rest.length === 3 && rest[2] === "secrets" && req.method === "POST") {
      const body = await readJson(req);
      if (body.dismiss === true) {
        const requestId = typeof body.requestId === "string" ? body.requestId : "";
        const dismissed = dismissSecret(vault, bot.id, requestId);
        if ("error" in dismissed) {
          send(res, 400, { error: dismissed.error });
          return;
        }
        vault = dismissed.vault;
        send(res, 200, { dismissed: true });
        return;
      }
      if (body.request === true) {
        const opened = requestSecret(vault, bot.id, body.name, body.reason);
        if ("error" in opened) {
          send(res, 400, { error: opened.error });
          return;
        }
        vault = opened.vault;
        send(res, 201, {
          request: {
            id: opened.request.id,
            name: opened.request.name,
            reason: opened.request.reason,
            createdAt: opened.request.createdAt,
            status: opened.request.status,
          },
        });
        return;
      }
      const saved = fulfillSecret(vault, bot.id, body);
      if ("error" in saved) {
        send(res, 400, { error: saved.error });
        return;
      }
      vault = saved.vault;
      send(res, 200, { name: saved.name, saved: true });
      return;
    }
    if (rest.length === 4 && rest[2] === "secrets" && rest[3] && req.method === "DELETE") {
      let name = "";
      try {
        name = decodeURIComponent(rest[3]);
      } catch {
        send(res, 404, { error: "secret not found" });
        return;
      }
      const removed = deleteSecret(vault, bot.id, name);
      if ("error" in removed) {
        send(res, 404, { error: removed.error });
        return;
      }
      vault = removed.vault;
      send(res, 200, { ok: true });
      return;
    }
    if (rest.length === 3 && rest[2] === "approvals" && req.method === "GET") {
      approvals = expireApprovals(normalizeApprovals(approvals));
      send(res, 200, publicApprovals(approvals, bot.id, vaultValues(vault, bot.id)));
      return;
    }
    if (rest.length === 3 && rest[2] === "approvals" && req.method === "POST") {
      const body = await readJson(req);
      const resolved = resolveApproval(approvals, {
        botId: bot.id,
        cardId: body.cardId,
        decision: body.decision,
        secrets: vaultValues(vault, bot.id),
      });
      if ("error" in resolved) {
        send(res, 400, { error: resolved.error });
        return;
      }
      approvals = resolved.state;
      submitHuman(bot, resolved.note);
      send(res, 200, { card: resolved.card });
      return;
    }
    if (rest.length === 4 && rest[2] === "approvals" && rest[3] && req.method === "DELETE") {
      let action = "";
      try {
        action = decodeURIComponent(rest[3]);
      } catch {
        send(res, 400, { error: "action is not recognized" });
        return;
      }
      const revoked = revokeAlways(approvals, bot.id, action);
      if ("error" in revoked) {
        send(res, 400, { error: revoked.error });
        return;
      }
      approvals = revoked.state;
      send(res, 200, { ok: true });
      return;
    }
    if (rest.length === 3 && rest[2] === "actions" && req.method === "POST") {
      const body = await readJson(req);
      const reviewed = reviewAction(approvals, {
        botId: bot.id,
        command: body.command,
        ...(body.action !== undefined ? { action: body.action } : {}),
        secrets: vaultValues(vault, bot.id),
      });
      if ("error" in reviewed) {
        send(res, 400, { error: reviewed.error });
        return;
      }
      approvals = reviewed.state;
      send(res, reviewed.decision === "allow" ? 200 : 202, {
        decision: reviewed.decision,
        action: reviewed.action,
        message: reviewed.message,
        ...(reviewed.card ? { card: reviewed.card } : {}),
        ...(reviewed.decision === "allow" ? { result: "local simulator did not run this command" } : {}),
      });
      return;
    }
    if (rest.length === 3 && rest[2] === "peers" && req.method === "GET") {
      send(res, 200, { peers: peers.filter((item) => item.from === bot.id || item.to === bot.id).map(publicPeer) });
      return;
    }
    if (rest.length === 3 && rest[2] === "messages" && req.method === "POST") {
      const body = await readJson(req);
      const content = textField(body, "content");
      const fileIds = Array.isArray(body.fileIds) ? body.fileIds.filter((item): item is string => typeof item === "string") : [];
      if (!content && fileIds.length === 0) {
        send(res, 400, { error: "content is required" });
        return;
      }
      send(res, 202, submitHuman(bot, content, fileIds));
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
      work = work.filter((item) => item.botId !== bot.id || item.tool);
      work.push({
        botId: bot.id,
        text: `working on a message from ${source.name}`,
        startedAt: Date.now(),
        until: bot.busyUntil,
      });
      send(res, 202, publicPeer(record));
      return;
    }
  }
  send(res, 404, { error: "not found" });
}
