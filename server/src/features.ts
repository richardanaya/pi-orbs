// Shared roster features for the sprite server and the local simulator.
// The copy in client/src/features.ts must stay the same.
import { randomBytes } from "node:crypto";

export const LOOKS = ["slate", "silver", "mist", "tide", "pine", "amber", "clay", "plum"] as const;
export type Look = (typeof LOOKS)[number];

export const NAME_MAX = 80;
export const INSTRUCTION_MAX = 8_000;
export const BOT_CAP = 24;
export const CREATED_BY_CAP = 8;
export const MEMORY_MAX = 40;
export const FACT_MAX = 500;
export const SECRET_NAME_MAX = 64;
export const SECRET_VALUE_MAX = 4_000;
export const SECRET_REASON_MAX = 240;
export const SECRET_MAX = 20;
export const PENDING_SECRET_MAX = 8;
export const APPROVAL_TTL_MS = 15 * 60 * 1000;
export const APPROVAL_COMMAND_MAX = 4_000;
export const CHECK_IN_MS = 60 * 60 * 1000;
export const SEARCH_MESSAGE_LIMIT = 20;
export const TEMPLATE_FORMAT = "pi-orbs-bot-template";
export const TEMPLATE_VERSION = 1;
export const REDACT_MIN = 16;

export const ACTION_CLASSES = ["shell", "browser", "network", "sprite"] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];

export const CHECK_IN_PROMPT = [
  "Main Bot check-in.",
  "You coordinate the other bots on this sprite.",
  "Review what each one is for and steer one concrete next step to the bot that should do it.",
  "Call steer_peer in this turn. Saying you will does not send it.",
  "Do not steer thanks or a second follow-up.",
].join(" ");

export const PALETTE_SETTINGS = [
  { id: "voice", label: "Voice", hint: "Grok or OpenAI realtime" },
  { id: "schedules", label: "Schedules", hint: "cron-job.org key" },
  { id: "export", label: "Download all conversations", hint: "Zip of every thread" },
  { id: "deploy", label: "Push server build", hint: "Update the sprite server" },
  { id: "destroy", label: "Destroy sprite", hint: "Delete this sprite" },
] as const;

export const PALETTE_ACTIONS = [
  { id: "add-bot", label: "Add bot", hint: "Create a bot in the roster" },
  { id: "import-template", label: "Import bot template", hint: "Copy a bot from a template file" },
  { id: "export-template", label: "Export bot template", hint: "Save this bot as a template" },
  { id: "main-bot", label: "Make Main Bot", hint: "Star this bot to coordinate the others" },
  { id: "check-in", label: "Main Bot check-in", hint: "Ask the Main Bot to coordinate now" },
  { id: "voice-call", label: "Start voice", hint: "Call the open bot" },
] as const;

export type PaletteItem = { id: string; label: string; hint: string };

export function isLook(value: unknown): value is Look {
  return typeof value === "string" && (LOOKS as readonly string[]).includes(value);
}

export function isAction(value: unknown): value is ActionClass {
  return typeof value === "string" && (ACTION_CLASSES as readonly string[]).includes(value);
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export function guardRoster(count: number): { ok: true } | { error: string } {
  if (count >= BOT_CAP) return { error: "roster is full" };
  return { ok: true };
}

export function guardSpawn(
  bots: readonly { id: string; createdBy?: string }[],
  createdBy: string,
): { ok: true } | { error: string } {
  if (!createdBy || !bots.some((bot) => bot.id === createdBy)) return { error: "bot not found" };
  const room = guardRoster(bots.length);
  if ("error" in room) return room;
  const made = bots.filter((bot) => bot.createdBy === createdBy).length;
  if (made >= CREATED_BY_CAP) return { error: "this bot has created enough bots" };
  return { ok: true };
}

export function copyName(name: string, taken: readonly string[]): string {
  const base = name.trim().slice(0, NAME_MAX) || "Bot";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  const once = `${base.slice(0, NAME_MAX - " copy".length)} copy`;
  if (!used.has(once)) return once;
  for (let n = 2; n < 1000; n += 1) {
    const extra = ` copy ${n}`;
    const candidate = `${base.slice(0, NAME_MAX - extra.length)}${extra}`;
    if (!used.has(candidate)) return candidate;
  }
  return base;
}

export type BotTemplate = {
  format: typeof TEMPLATE_FORMAT;
  formatVersion: typeof TEMPLATE_VERSION;
  name: string;
  instruction: string;
  look: Look;
};

export function templateFrom(bot: { name: string; instruction: string; look: Look }, secrets: readonly string[] = []): BotTemplate {
  return {
    format: TEMPLATE_FORMAT,
    formatVersion: TEMPLATE_VERSION,
    name: redactText(bot.name, secrets),
    instruction: redactText(bot.instruction, secrets),
    look: bot.look,
  };
}

function templateRecord(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const nested = record.template;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested as Record<string, unknown>;
  return record;
}

export function readTemplate(body: unknown): { name: string; instruction: string; look: Look } | { error: string } {
  const record = templateRecord(body);
  if (!record) return { error: "template is required" };
  if (record.format !== TEMPLATE_FORMAT) return { error: "template format is not recognized" };
  if (record.formatVersion !== TEMPLATE_VERSION) return { error: "template version is not recognized" };
  if (typeof record.name !== "string" || record.name.trim().length === 0) return { error: "name is required" };
  const name = record.name.trim();
  if (name.length > NAME_MAX) return { error: "name is too long" };
  const instruction = record.instruction === undefined ? "" : record.instruction;
  if (typeof instruction !== "string") return { error: "instruction must be a string" };
  const trimmed = instruction.trim();
  if (trimmed.length > INSTRUCTION_MAX) return { error: "instruction is too long" };
  if (!isLook(record.look)) return { error: "look is not recognized" };
  return { name, instruction: trimmed, look: record.look };
}

export type PaletteQuery = { raw: string; quoted: boolean; phrase: string; tokens: string[] };

export function parsePaletteQuery(raw: string): PaletteQuery {
  const trimmed = raw.trim();
  const quote = trimmed.length >= 2 ? trimmed[0] : "";
  const quoted = (quote === "\"" || quote === "'") && trimmed.endsWith(quote);
  const phrase = (quoted ? trimmed.slice(1, -1) : trimmed).trim();
  const tokens = phrase.length === 0 ? [] : quoted ? [phrase] : phrase.split(/\s+/).filter(Boolean);
  return { raw: trimmed, quoted, phrase, tokens };
}

function includesFold(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function matchesQuery(query: PaletteQuery, text: string): boolean {
  if (query.tokens.length === 0) return true;
  if (query.quoted) return includesFold(text, query.phrase);
  return query.tokens.every((token) => includesFold(text, token));
}

export type SearchBot = { id: string; name: string; look: string; instruction: string; main?: boolean };
export type SearchMessage = {
  botId: string;
  botName: string;
  look: string;
  messageId: string;
  kind: string;
  text: string;
  createdAt: string | null;
};

export type PaletteResult = {
  query: string;
  quoted: boolean;
  bots: SearchBot[];
  settings: PaletteItem[];
  actions: PaletteItem[];
  messages: SearchMessage[];
};

export function searchPalette(raw: string, bots: readonly SearchBot[], messages: readonly SearchMessage[]): PaletteResult {
  const query = parsePaletteQuery(raw);
  const botHits = bots.filter((bot) => query.tokens.length === 0 || matchesQuery(query, `${bot.name}\n${bot.instruction}`));
  const settings = PALETTE_SETTINGS.filter((item) => query.tokens.length === 0 || matchesQuery(query, `${item.label}\n${item.hint}`));
  const actions = PALETTE_ACTIONS.filter((item) => query.tokens.length === 0 || matchesQuery(query, `${item.label}\n${item.hint}`));
  const messageHits = query.tokens.length === 0
    ? []
    : messages
      .filter((item) => item.text.trim().length > 0 && matchesQuery(query, item.text))
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .slice(0, SEARCH_MESSAGE_LIMIT);
  return {
    query: query.raw,
    quoted: query.quoted,
    bots: botHits.map((bot) => ({ ...bot })),
    settings: settings.map((item) => ({ ...item })),
    actions: actions.map((item) => ({ ...item })),
    messages: messageHits.map((item) => ({ ...item, text: item.text.slice(0, 500) })),
  };
}

export type MemoryRecord = { id: string; botId: string; fact: string; createdAt: string };

export function normalizeMemories(parsed: unknown): MemoryRecord[] {
  const list = parsed && typeof parsed === "object" && Array.isArray((parsed as { memories?: unknown }).memories)
    ? (parsed as { memories: unknown[] }).memories
    : [];
  const memories: MemoryRecord[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as { id?: unknown; botId?: unknown; fact?: unknown; createdAt?: unknown };
    const id = typeof record.id === "string" ? record.id : "";
    const botId = typeof record.botId === "string" ? record.botId : "";
    const fact = typeof record.fact === "string" ? record.fact.trim() : "";
    const createdAt = typeof record.createdAt === "string" ? record.createdAt : "";
    if (!id || !botId || !fact || fact.length > FACT_MAX) continue;
    memories.push({ id, botId, fact, createdAt });
  }
  return memories;
}

export function publicMemories(memories: readonly MemoryRecord[], botId: string): { id: string; fact: string; createdAt: string }[] {
  return memories.filter((item) => item.botId === botId).map((item) => ({ id: item.id, fact: item.fact, createdAt: item.createdAt }));
}

export function saveMemory(
  memories: MemoryRecord[],
  botId: string,
  fact: unknown,
  now = new Date().toISOString(),
): { memories: MemoryRecord[]; memory: MemoryRecord } | { error: string } {
  if (typeof fact !== "string" || fact.trim().length === 0) return { error: "fact is required" };
  const trimmed = fact.trim();
  if (trimmed.length > FACT_MAX) return { error: "fact is too long" };
  const mine = memories.filter((item) => item.botId === botId);
  const prior = mine.find((item) => item.fact.toLowerCase() === trimmed.toLowerCase());
  if (prior) return { memories, memory: prior };
  if (mine.length >= MEMORY_MAX) return { error: "memory is full" };
  const memory: MemoryRecord = { id: newId("mem"), botId, fact: trimmed, createdAt: now };
  return { memories: [...memories, memory], memory };
}

export function forgetMemory(
  memories: MemoryRecord[],
  botId: string,
  input: { id?: unknown; query?: unknown; all?: unknown },
): { memories: MemoryRecord[]; forgotten: MemoryRecord[] } | { error: string } {
  const mine = memories.filter((item) => item.botId === botId);
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!id && !query) return { error: "id or query is required" };
  let hits: MemoryRecord[];
  if (id) {
    hits = mine.filter((item) => item.id === id);
    if (hits.length === 0) return { error: "memory not found" };
  } else {
    const needle = query.toLowerCase();
    hits = mine.filter((item) => item.fact.toLowerCase().includes(needle) || item.id === query);
    if (hits.length === 0) return { error: "memory not found" };
    if (hits.length > 1 && input.all !== true) return { error: "matches more than one memory; pass an id" };
  }
  const drop = new Set(hits.map((item) => item.id));
  return { memories: memories.filter((item) => !drop.has(item.id)), forgotten: hits };
}

export function memoryPrompt(memories: readonly MemoryRecord[], botId: string): string | undefined {
  const mine = memories.filter((item) => item.botId === botId);
  if (mine.length === 0) return undefined;
  return [
    "Saved memory for this bot. Use it when it is relevant. Call forget_memory when the human says to forget.",
    ...mine.map((item) => `- ${item.id}: ${item.fact}`),
  ].join("\n");
}

const SECRET_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export type SecretRecord = { botId: string; name: string; value: string; updatedAt: string };
export type SecretRequestRecord = {
  id: string;
  botId: string;
  name: string;
  reason: string;
  createdAt: string;
  status: "pending" | "saved" | "dismissed";
};
export type VaultState = { secrets: SecretRecord[]; requests: SecretRequestRecord[] };

export function normalizeVault(parsed: unknown): VaultState {
  const root = parsed && typeof parsed === "object" ? parsed as { secrets?: unknown; requests?: unknown } : {};
  const secrets: SecretRecord[] = [];
  const requests: SecretRequestRecord[] = [];
  if (Array.isArray(root.secrets)) {
    for (const item of root.secrets) {
      if (!item || typeof item !== "object") continue;
      const record = item as { botId?: unknown; name?: unknown; value?: unknown; updatedAt?: unknown };
      if (typeof record.botId !== "string" || typeof record.name !== "string" || typeof record.value !== "string") continue;
      if (!SECRET_NAME.test(record.name) || record.value.length === 0 || record.value.length > SECRET_VALUE_MAX) continue;
      secrets.push({
        botId: record.botId,
        name: record.name,
        value: record.value,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
      });
    }
  }
  if (Array.isArray(root.requests)) {
    for (const item of root.requests) {
      if (!item || typeof item !== "object") continue;
      const record = item as { id?: unknown; botId?: unknown; name?: unknown; reason?: unknown; createdAt?: unknown; status?: unknown };
      if (typeof record.id !== "string" || typeof record.botId !== "string" || typeof record.name !== "string") continue;
      if (!SECRET_NAME.test(record.name)) continue;
      const status = record.status === "saved" || record.status === "dismissed" || record.status === "pending" ? record.status : "pending";
      requests.push({
        id: record.id,
        botId: record.botId,
        name: record.name,
        reason: typeof record.reason === "string" ? record.reason.slice(0, SECRET_REASON_MAX) : "",
        createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
        status,
      });
    }
  }
  return { secrets, requests };
}

export function vaultValues(vault: VaultState, botId?: string): string[] {
  return vault.secrets.filter((item) => !botId || item.botId === botId).map((item) => item.value);
}

export function redactText(text: string, secrets: readonly string[]): string {
  const needles = [...new Set(secrets.filter((item) => item.length >= REDACT_MIN))].sort((a, b) => b.length - a.length);
  let out = text;
  for (const needle of needles) out = out.split(needle).join("[redacted]");
  return out;
}

export function publicVault(vault: VaultState, botId: string, secrets: readonly string[] = []): {
  secrets: { name: string; updatedAt: string }[];
  requests: { id: string; name: string; reason: string; createdAt: string; status: SecretRequestRecord["status"] }[];
} {
  return {
    secrets: vault.secrets
      .filter((item) => item.botId === botId)
      .map((item) => ({ name: item.name, updatedAt: item.updatedAt })),
    requests: vault.requests
      .filter((item) => item.botId === botId && item.status === "pending")
      .map((item) => ({
        id: item.id,
        name: item.name,
        reason: redactText(item.reason, secrets),
        createdAt: item.createdAt,
        status: item.status,
      })),
  };
}

export function requestSecret(
  vault: VaultState,
  botId: string,
  name: unknown,
  reason: unknown,
  now = new Date().toISOString(),
): { vault: VaultState; request: SecretRequestRecord; created: boolean } | { error: string } {
  if (typeof name !== "string" || !SECRET_NAME.test(name)) return { error: "secret name must be letters, digits, and underscores" };
  const note = typeof reason === "string" ? reason.trim().slice(0, SECRET_REASON_MAX) : "";
  if (typeof reason !== "undefined" && typeof reason !== "string") return { error: "reason must be a string" };
  const pending = vault.requests.find((item) => item.botId === botId && item.name === name && item.status === "pending");
  if (pending) return { vault, request: pending, created: false };
  const open = vault.requests.filter((item) => item.botId === botId && item.status === "pending");
  if (open.length >= PENDING_SECRET_MAX) return { error: "too many secret cards are waiting" };
  const request: SecretRequestRecord = { id: newId("sec"), botId, name, reason: note, createdAt: now, status: "pending" };
  return { vault: { ...vault, requests: [...vault.requests, request] }, request, created: true };
}

export function fulfillSecret(
  vault: VaultState,
  botId: string,
  input: { requestId?: unknown; name?: unknown; value?: unknown },
  now = new Date().toISOString(),
): { vault: VaultState; name: string } | { error: string } {
  const value = typeof input.value === "string" ? input.value : "";
  if (value.length === 0) return { error: "value is required" };
  if (value.length > SECRET_VALUE_MAX) return { error: "value is too long" };
  const requestId = typeof input.requestId === "string" ? input.requestId : "";
  const request = requestId ? vault.requests.find((item) => item.id === requestId && item.botId === botId) : undefined;
  if (requestId && !request) return { error: "secret card not found" };
  if (request && request.status !== "pending") return { error: "secret card is closed" };
  const name = request ? request.name : input.name;
  if (typeof name !== "string" || !SECRET_NAME.test(name)) return { error: "secret name must be letters, digits, and underscores" };
  const mine = vault.secrets.filter((item) => item.botId === botId);
  const existing = mine.find((item) => item.name === name);
  if (!existing && mine.length >= SECRET_MAX) return { error: "secret vault is full" };
  const secrets = existing
    ? vault.secrets.map((item) => item.botId === botId && item.name === name ? { ...item, value, updatedAt: now } : item)
    : [...vault.secrets, { botId, name, value, updatedAt: now }];
  const requests = vault.requests.map((item) => {
    if (request && item.id === request.id) return { ...item, status: "saved" as const };
    if (!request && item.botId === botId && item.name === name && item.status === "pending") return { ...item, status: "saved" as const };
    return item;
  });
  return { vault: { secrets, requests }, name };
}

export function dismissSecret(vault: VaultState, botId: string, requestId: string): { vault: VaultState } | { error: string } {
  const request = vault.requests.find((item) => item.id === requestId && item.botId === botId);
  if (!request) return { error: "secret card not found" };
  if (request.status !== "pending") return { error: "secret card is closed" };
  return {
    vault: {
      ...vault,
      requests: vault.requests.map((item) => item.id === requestId ? { ...item, status: "dismissed" as const } : item),
    },
  };
}

export function deleteSecret(vault: VaultState, botId: string, name: string): { vault: VaultState } | { error: string } {
  if (!vault.secrets.some((item) => item.botId === botId && item.name === name)) return { error: "secret not found" };
  return { vault: { ...vault, secrets: vault.secrets.filter((item) => !(item.botId === botId && item.name === name)) } };
}

export function readSecret(vault: VaultState, botId: string, name: unknown): { name: string; value: string } | { error: string } {
  if (typeof name !== "string" || !SECRET_NAME.test(name)) return { error: "secret name must be letters, digits, and underscores" };
  const saved = vault.secrets.find((item) => item.botId === botId && item.name === name);
  if (saved) return { name: saved.name, value: saved.value };
  const pending = vault.requests.find((item) => item.botId === botId && item.name === name && item.status === "pending");
  if (pending) return { error: `The human has not saved ${name} yet. Wait for the secret card. Do not ask them to paste it into the chat.` };
  return { error: `No secret named ${name}. Call request_secret and wait for the card. Do not ask the human to paste it into the chat.` };
}

export function secretsPrompt(vault: VaultState, botId: string): string | undefined {
  const names = vault.secrets.filter((item) => item.botId === botId).map((item) => item.name);
  const pending = vault.requests.filter((item) => item.botId === botId && item.status === "pending");
  if (names.length === 0 && pending.length === 0) return undefined;
  const lines = [
    "Secrets for this bot stay in the vault. Never type a secret value in the chat, and never ask the human to.",
    "Call request_secret to open a card. Call read_secret when you need a saved value for a tool. The page does not show that value.",
  ];
  if (names.length > 0) lines.push(`Saved: ${names.join(", ")}.`);
  if (pending.length > 0) lines.push(`Waiting on a card: ${pending.map((item) => item.name).join(", ")}.`);
  return lines.join("\n");
}

export type ApprovalCard = {
  id: string;
  botId: string;
  action: ActionClass;
  command: string;
  createdAt: string;
  status: "pending" | "allowed" | "denied" | "expired";
  decision?: "once" | "always" | "deny";
};
export type ApprovalGrant = {
  id: string;
  botId: string;
  action: ActionClass;
  scope: "once" | "always";
  command?: string;
  createdAt: string;
};
export type ApprovalState = { cards: ApprovalCard[]; grants: ApprovalGrant[] };

export function classifyCommand(command: string): ActionClass {
  if (/\b(chromium|chrome|google-chrome|firefox|playwright|puppeteer|webkit)\b/i.test(command)) return "browser";
  if (/\b(curl|wget|nc|ncat|netcat|ssh|scp|sftp|rsync|ping|dig|nslookup|host|ftp|telnet|httpie|aria2c|socat)\b/i.test(command) || /https?:\/\//i.test(command)) {
    return "network";
  }
  return "shell";
}

export function normalizeApprovals(parsed: unknown): ApprovalState {
  const root = parsed && typeof parsed === "object" ? parsed as { cards?: unknown; grants?: unknown } : {};
  const cards: ApprovalCard[] = [];
  const grants: ApprovalGrant[] = [];
  if (Array.isArray(root.cards)) {
    for (const item of root.cards) {
      if (!item || typeof item !== "object") continue;
      const record = item as Partial<ApprovalCard>;
      if (typeof record.id !== "string" || typeof record.botId !== "string" || typeof record.command !== "string") continue;
      if (!isAction(record.action)) continue;
      const status = record.status === "allowed" || record.status === "denied" || record.status === "expired" || record.status === "pending"
        ? record.status
        : "pending";
      cards.push({
        id: record.id,
        botId: record.botId,
        action: record.action,
        command: record.command.slice(0, APPROVAL_COMMAND_MAX),
        createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
        status,
        ...(record.decision === "once" || record.decision === "always" || record.decision === "deny" ? { decision: record.decision } : {}),
      });
    }
  }
  if (Array.isArray(root.grants)) {
    for (const item of root.grants) {
      if (!item || typeof item !== "object") continue;
      const record = item as Partial<ApprovalGrant>;
      if (typeof record.id !== "string" || typeof record.botId !== "string" || !isAction(record.action)) continue;
      if (record.scope !== "once" && record.scope !== "always") continue;
      grants.push({
        id: record.id,
        botId: record.botId,
        action: record.action,
        scope: record.scope,
        ...(typeof record.command === "string" ? { command: record.command } : {}),
        createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
      });
    }
  }
  return { cards, grants };
}

export function expireApprovals(state: ApprovalState, now = Date.now()): ApprovalState {
  const cards = state.cards.map((card) => {
    if (card.status !== "pending") return card;
    const created = Date.parse(card.createdAt);
    if (!Number.isFinite(created) || now - created < APPROVAL_TTL_MS) return card;
    return { ...card, status: "expired" as const };
  });
  return { cards, grants: state.grants };
}

export type PublicCard = {
  id: string;
  action: ActionClass;
  command: string;
  createdAt: string;
  status: ApprovalCard["status"];
  decision?: ApprovalCard["decision"];
};

function publicCard(card: ApprovalCard, secrets: readonly string[]): PublicCard {
  return {
    id: card.id,
    action: card.action,
    command: redactText(card.command, secrets),
    createdAt: card.createdAt,
    status: card.status,
    ...(card.decision ? { decision: card.decision } : {}),
  };
}

export function publicApprovals(state: ApprovalState, botId: string, secrets: readonly string[] = [], now = Date.now()): {
  cards: PublicCard[];
  grants: { action: ActionClass; scope: "always" }[];
} {
  const expired = expireApprovals(state, now);
  return {
    cards: expired.cards
      .filter((card) => card.botId === botId && (card.status === "pending" || card.status === "expired"))
      .map((card) => publicCard(card, secrets)),
    grants: expired.grants
      .filter((grant) => grant.botId === botId && grant.scope === "always")
      .map((grant) => ({ action: grant.action, scope: "always" as const })),
  };
}

export type ReviewResult = {
  state: ApprovalState;
  decision: "allow" | "pending";
  action: ActionClass;
  card?: PublicCard;
  message: string;
};

export function reviewAction(
  state: ApprovalState,
  input: { botId: string; command: unknown; action?: unknown; now?: number; secrets?: readonly string[] },
): ReviewResult | { error: string } {
  if (typeof input.command !== "string" || input.command.trim().length === 0) return { error: "command is required" };
  const command = input.command.trim();
  if (command.length > APPROVAL_COMMAND_MAX) return { error: "command is too long" };
  const action = input.action === undefined ? classifyCommand(command) : input.action;
  if (!isAction(action)) return { error: "action is not recognized" };
  const now = input.now ?? Date.now();
  const secrets = input.secrets ?? [];
  let next = expireApprovals(state, now);
  const always = next.grants.find((grant) => grant.botId === input.botId && grant.action === action && grant.scope === "always");
  if (always) {
    return { state: next, decision: "allow", action, message: `Always allowed for ${action}.` };
  }
  const onceIndex = next.grants.findIndex((grant) => grant.botId === input.botId && grant.action === action && grant.scope === "once" && grant.command === command);
  if (onceIndex >= 0) {
    const grants = next.grants.filter((_, index) => index !== onceIndex);
    return { state: { ...next, grants }, decision: "allow", action, message: `Allowed once for ${action}.` };
  }
  const waiting = next.cards.find((card) => card.botId === input.botId && card.action === action && card.command === command && card.status === "pending");
  if (waiting) {
    return {
      state: next,
      decision: "pending",
      action,
      card: publicCard(waiting, secrets),
      message: `This ${action} command is waiting for approval. A card is in the thread. Do not run it another way.`,
    };
  }
  const stale = next.cards.find((card) => card.botId === input.botId && card.action === action && card.command === command && card.status === "expired");
  if (stale) {
    const card: ApprovalCard = { ...stale, status: "pending", createdAt: new Date(now).toISOString() };
    delete card.decision;
    next = { ...next, cards: next.cards.map((item) => item.id === stale.id ? card : item) };
    return {
      state: next,
      decision: "pending",
      action,
      card: publicCard(card, secrets),
      message: `The earlier ${action} card expired. Asked again. Wait for the human to allow it once or always.`,
    };
  }
  const card: ApprovalCard = {
    id: newId("apr"),
    botId: input.botId,
    action,
    command,
    createdAt: new Date(now).toISOString(),
    status: "pending",
  };
  next = { ...next, cards: [...next.cards, card].slice(-80) };
  return {
    state: next,
    decision: "pending",
    action,
    card: publicCard(card, secrets),
    message: `This ${action} command needs approval before it can run. A card is in the thread. Wait for Allow once or Always allow.`,
  };
}

export function resolveApproval(
  state: ApprovalState,
  input: { botId: string; cardId: unknown; decision: unknown; now?: number; secrets?: readonly string[] },
): { state: ApprovalState; card: PublicCard; note: string } | { error: string } {
  const decision = input.decision;
  if (decision !== "once" && decision !== "always" && decision !== "deny") return { error: "decision must be once, always, or deny" };
  if (typeof input.cardId !== "string" || input.cardId.length === 0) return { error: "card is required" };
  const now = input.now ?? Date.now();
  const expired = expireApprovals(state, now);
  const current = expired.cards.find((card) => card.id === input.cardId && card.botId === input.botId);
  if (!current) return { error: "approval card not found" };
  if (current.status !== "pending" && current.status !== "expired") return { error: "approval card is closed" };
  const status = decision === "deny" ? "denied" as const : "allowed" as const;
  const card: ApprovalCard = { ...current, status, decision };
  let grants = expired.grants;
  if (decision === "once") {
    grants = grants.filter((grant) => !(grant.botId === input.botId && grant.action === current.action && grant.scope === "once" && grant.command === current.command));
    grants = [...grants, { id: newId("grn"), botId: input.botId, action: current.action, scope: "once", command: current.command, createdAt: new Date(now).toISOString() }];
  }
  if (decision === "always") {
    grants = grants.filter((grant) => !(grant.botId === input.botId && grant.action === current.action && grant.scope === "always"));
    grants = [...grants, { id: newId("grn"), botId: input.botId, action: current.action, scope: "always", createdAt: new Date(now).toISOString() }];
  }
  const note = decision === "deny"
    ? `The human denied the pending ${current.action} action. Do not retry it unless they ask.`
    : decision === "always"
      ? `The human always allows ${current.action} actions for you. Continue if you still should.`
      : `The human allowed the pending ${current.action} action once. Continue if you still should.`;
  return {
    state: { cards: expired.cards.map((item) => item.id === card.id ? card : item), grants },
    card: publicCard(card, input.secrets ?? []),
    note,
  };
}

export function revokeAlways(state: ApprovalState, botId: string, action: unknown): { state: ApprovalState } | { error: string } {
  if (!isAction(action)) return { error: "action is not recognized" };
  return { state: { ...state, grants: state.grants.filter((grant) => !(grant.botId === botId && grant.action === action && grant.scope === "always")) } };
}

export function coordinatorPrompt(others: readonly { name: string; id: string }[]): string {
  const lines = [
    "You are the Main Bot. A star marks you in the roster.",
    "You check in on a schedule and coordinate the other bots.",
    "When a check-in arrives, steer one concrete next step to the bot that should do it. Saying you will does not send it.",
    "You still follow the need-to-know rule and the peer chain limit.",
  ];
  if (others.length === 0) lines.push("No other bots are on this sprite yet.");
  else lines.push(...others.map((item) => `${item.name} (id ${item.id})`));
  return lines.join("\n");
}

export function approvalPrompt(): string {
  return [
    "Bash on this sprite is reviewed before it runs.",
    "Shell, network, and browser commands wait for a card in the thread. Sprite actions use the same cards.",
    "Allow once runs the next matching command. Always allow covers that kind of command afterward.",
    "If a card expires, the human can still choose Always allow, or the next attempt asks again.",
    "Do not hide a command, encode it, or split it to skip the card.",
  ].join("\n");
}

export function dropBot<T extends { botId: string }>(items: readonly T[], botId: string): T[] {
  return items.filter((item) => item.botId !== botId);
}
