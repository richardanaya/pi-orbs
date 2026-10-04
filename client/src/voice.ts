// Realtime voice for one bot. The stored provider key never leaves this process.
// The page receives a short-lived provider token, or a local session with no token.
import { randomBytes } from "node:crypto";
import { redactSecrets } from "./archive.js";

export const VOICE_PROVIDERS = ["grok", "openai"] as const;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];
export type VoiceConfig = { provider: VoiceProvider; apiKey: string };
export type PublicVoice = { provider: VoiceProvider | null; configured: boolean };

export const VOICE_TOOL_NAMES = ["search_messages", "send_task", "stop_voice"] as const;
export type VoiceToolName = (typeof VOICE_TOOL_NAMES)[number];

const KEY_MAX = 500;
const QUERY_MAX = 500;
const TASK_MAX = 8_000;
const TEXT_MAX = 8_000;
const MATCH_MAX = 20;
const TRANSCRIPT_MAX = 200;
const SECRET_TTL_SECONDS = 300;

export type VoiceTool = {
  type: "function";
  name: VoiceToolName;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: "string"; description: string }>;
    required: string[];
    additionalProperties: false;
  };
};

export type SearchLine = { source: "chat" | "voice"; role: string; text: string };
export type VoiceTurn = { id: string; role: "user" | "assistant"; text: string; createdAt: string };
export type VoiceSession = {
  id: string;
  botId: string;
  provider: VoiceProvider | "local";
  transcript: VoiceTurn[];
  stopped: boolean;
};

export type RealtimeLink = {
  transport: "websocket" | "webrtc";
  url: string;
  model: string;
  protocol?: string;
};

const sessions = new Map<string, VoiceSession>();

export function publicVoice(config: VoiceConfig | null | undefined): PublicVoice {
  if (!config) return { provider: null, configured: false };
  return { provider: config.provider, configured: true };
}

export function voiceTools(): VoiceTool[] {
  return [
    {
      type: "function",
      name: "search_messages",
      description: "Search this bot's chat and this voice call's transcript. Use it to look up what was already said.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words to find. Matching is case-insensitive." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "send_task",
      description: "Send a task into this bot's chat so the bot starts working. This is the same path as a human message.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "What the bot should do." },
        },
        required: ["task"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "stop_voice",
      description: "Stop this voice call. Use it when the person says goodbye or asks to hang up.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  ];
}

export function voiceInstructions(botName: string): string {
  const name = botName.trim() || "this bot";
  return [
    `You are the voice for ${name}.`,
    "Speak in short spoken sentences.",
    "You have exactly three tools: search_messages, send_task, and stop_voice.",
    "search_messages looks through this bot's chat and this call's transcript.",
    "send_task sends a task into this bot's chat so the bot starts working. It uses the same path as a human message.",
    "stop_voice ends this call when the person wants to hang up.",
    "Do not use any other tool. Do not claim you edited files, searched the web, or messaged another bot.",
  ].join(" ");
}

export function isVoiceFailure(value: VoiceConfig | null | { error: string }): value is { error: string } {
  return !!value && typeof value === "object" && "error" in value;
}

export function readVoice(
  body: Record<string, unknown>,
  current: VoiceConfig | null,
): { unchanged: true } | { voice: VoiceConfig | null } | { error: string } {
  const hasProvider = Object.prototype.hasOwnProperty.call(body, "voiceProvider");
  const hasKey = Object.prototype.hasOwnProperty.call(body, "voiceApiKey");
  if (!hasProvider && !hasKey) return { unchanged: true };
  if (hasProvider && body.voiceProvider !== undefined && typeof body.voiceProvider !== "string") {
    return { error: "voice provider is not recognized" };
  }
  const providerRaw = hasProvider && typeof body.voiceProvider === "string" ? body.voiceProvider.trim().toLowerCase() : "";
  if (!providerRaw) {
    if (!hasProvider) return { error: "voice provider is not recognized" };
    return { voice: null };
  }
  if (providerRaw === "off" || providerRaw === "none") return { voice: null };
  if (providerRaw !== "grok" && providerRaw !== "openai") return { error: "voice provider is not recognized" };
  if (hasKey && typeof body.voiceApiKey !== "string") return { error: "voice API key must be a string" };
  const apiKey = hasKey && typeof body.voiceApiKey === "string" ? body.voiceApiKey.trim() : "";
  if (apiKey.length > KEY_MAX) return { error: "voice API key is too long" };
  if (!apiKey) {
    if (current && current.provider === providerRaw) return { voice: current };
    return { error: "voice API key is required" };
  }
  return { voice: { provider: providerRaw, apiKey } };
}

export function voiceFromSetup(body: Record<string, unknown>, current: VoiceConfig | null): VoiceConfig | null | { error: string } {
  const read = readVoice(body, current);
  if ("unchanged" in read) return current;
  if ("error" in read) return read;
  return read.voice;
}

export function chatLines(messages: readonly { kind?: unknown; text?: unknown }[]): SearchLine[] {
  const lines: SearchLine[] = [];
  for (const message of messages) {
    if (typeof message.text !== "string" || message.text.trim().length === 0) continue;
    const role = message.kind === "pi.user" ? "user" : message.kind === "pi.assistant" ? "assistant" : message.kind === "pi.peer" ? "peer" : "";
    if (!role) continue;
    lines.push({ source: "chat", role, text: message.text });
  }
  return lines;
}

export function searchMessages(query: string, lines: readonly SearchLine[], secrets: readonly string[]): { matches: SearchLine[] } | { error: string } {
  const needle = query.trim().toLowerCase();
  if (!needle) return { error: "query is required" };
  if (needle.length > QUERY_MAX) return { error: "query is too long" };
  const matches: SearchLine[] = [];
  for (const line of lines) {
    if (!line.text.toLowerCase().includes(needle)) continue;
    matches.push({ source: line.source, role: line.role, text: redactSecrets(line.text, secrets) });
    if (matches.length >= MATCH_MAX) break;
  }
  return { matches };
}

function transcriptLines(session: VoiceSession): SearchLine[] {
  return session.transcript.map((turn) => ({ source: "voice" as const, role: turn.role, text: turn.text }));
}

export function openSession(botId: string, provider: VoiceProvider | "local"): VoiceSession {
  for (const session of sessions.values()) session.stopped = true;
  const session: VoiceSession = {
    id: `voice-${randomBytes(8).toString("hex")}`,
    botId,
    provider,
    transcript: [],
    stopped: false,
  };
  sessions.set(session.id, session);
  return session;
}

export function findSession(sessionId: string, botId: string): VoiceSession | null {
  const session = sessions.get(sessionId);
  if (!session || session.botId !== botId) return null;
  return session;
}

export function endSession(session: VoiceSession): void {
  session.stopped = true;
}

export function clearSessions(): void {
  sessions.clear();
}

export function clearBotSessions(botId: string): void {
  for (const [id, session] of sessions) {
    if (session.botId === botId) sessions.delete(id);
  }
}

export function publicSession(session: VoiceSession, botName: string): {
  sessionId: string;
  provider: VoiceSession["provider"];
  botId: string;
  botName: string;
  stopped: boolean;
  tools: VoiceTool[];
  instructions: string;
} {
  return {
    sessionId: session.id,
    provider: session.provider,
    botId: session.botId,
    botName,
    stopped: session.stopped,
    tools: voiceTools(),
    instructions: voiceInstructions(botName),
  };
}

export function appendTranscript(session: VoiceSession, role: unknown, text: unknown): { turn: VoiceTurn } | { error: string } {
  if (role !== "user" && role !== "assistant") return { error: "role is not recognized" };
  if (typeof text !== "string" || text.trim().length === 0) return { error: "text is required" };
  const trimmed = text.trim();
  if (trimmed.length > TEXT_MAX) return { error: "text is too long" };
  const turn: VoiceTurn = {
    id: `line-${randomBytes(4).toString("hex")}`,
    role,
    text: trimmed,
    createdAt: new Date().toISOString(),
  };
  session.transcript.push(turn);
  if (session.transcript.length > TRANSCRIPT_MAX) session.transcript.splice(0, session.transcript.length - TRANSCRIPT_MAX);
  return { turn };
}

export class VoiceSubmitError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function parseToolCall(body: Record<string, unknown>): { name: VoiceToolName; args: Record<string, unknown> } | { error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { error: "tool name is required" };
  if (!VOICE_TOOL_NAMES.includes(name as VoiceToolName)) return { error: "unknown voice tool" };
  let args: unknown = body.arguments ?? body.args ?? {};
  if (typeof args === "string") {
    try {
      args = JSON.parse(args) as unknown;
    } catch {
      return { error: "tool arguments must be an object" };
    }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return { error: "tool arguments must be an object" };
  return { name: name as VoiceToolName, args: args as Record<string, unknown> };
}

function safeError(error: unknown, secrets: readonly string[]): string {
  const message = error instanceof Error ? error.message : "voice tool failed";
  return redactSecrets(message, secrets).slice(0, 300);
}

export async function executeVoiceTool(
  session: VoiceSession,
  body: Record<string, unknown>,
  backend: {
    lines(): Promise<SearchLine[]>;
    submit(task: string): Promise<{ submissionId: string }>;
    secrets: readonly string[];
  },
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (session.stopped) return { status: 409, body: { error: "voice call has ended" } };
  const call = parseToolCall(body);
  if ("error" in call) return { status: 400, body: { error: call.error } };
  if (call.name === "search_messages") {
    const query = typeof call.args.query === "string" ? call.args.query : "";
    let lines: SearchLine[];
    try {
      lines = [...await backend.lines(), ...transcriptLines(session)];
    } catch (error) {
      return { status: 502, body: { error: safeError(error, backend.secrets) } };
    }
    const found = searchMessages(query, lines, backend.secrets);
    if ("error" in found) return { status: 400, body: { error: found.error } };
    return { status: 200, body: { matches: found.matches } };
  }
  if (call.name === "send_task") {
    const task = typeof call.args.task === "string" ? call.args.task.trim() : "";
    if (!task) return { status: 400, body: { error: "task is required" } };
    if (task.length > TASK_MAX) return { status: 400, body: { error: "task is too long" } };
    try {
      const submitted = await backend.submit(task);
      return { status: 200, body: { submitted: true, submissionId: submitted.submissionId } };
    } catch (error) {
      const status = error instanceof VoiceSubmitError ? error.status : 502;
      return { status, body: { error: safeError(error, backend.secrets) } };
    }
  }
  endSession(session);
  return { status: 200, body: { stopped: true } };
}

export function realtimeLink(provider: VoiceProvider): RealtimeLink {
  if (provider === "grok") {
    return {
      transport: "websocket",
      url: "wss://api.x.ai/v1/realtime?model=grok-voice-latest",
      model: "grok-voice-latest",
      protocol: "xai-client-secret.",
    };
  }
  return {
    transport: "webrtc",
    url: "https://api.openai.com/v1/realtime/calls",
    model: "gpt-realtime",
  };
}

function redactRaw(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

async function providerJson(response: Response, secret: string): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  const raw = await response.text();
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) as unknown : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    const nested = record?.error;
    const message = typeof nested === "string"
      ? nested
      : nested && typeof nested === "object" && "message" in nested && typeof (nested as { message?: unknown }).message === "string"
        ? (nested as { message: string }).message
        : raw.slice(0, 240) || "voice provider rejected the session";
    return { ok: false, error: redactRaw(message, secret).slice(0, 300) };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "voice provider did not return a session token" };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}

function tokenValue(body: Record<string, unknown>): string {
  if (typeof body.value === "string") return body.value;
  const nested = body.client_secret;
  if (nested && typeof nested === "object" && !Array.isArray(nested) && typeof (nested as { value?: unknown }).value === "string") {
    return (nested as { value: string }).value;
  }
  return "";
}

export async function mintClientSecret(input: {
  provider: VoiceProvider;
  apiKey: string;
  instructions: string;
  fetchImpl?: typeof fetch;
}): Promise<{ clientSecret: string; expiresAt: number; realtime: RealtimeLink } | { error: string }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const link = realtimeLink(input.provider);
  const tools = voiceTools();
  const grokSession = {
    model: link.model,
    instructions: input.instructions,
    voice: "eve",
    turn_detection: { type: "server_vad" },
    tools,
    tool_choice: "auto",
  };
  const openaiSession = {
    type: "realtime",
    model: link.model,
    instructions: input.instructions,
    tool_choice: "auto",
    tools,
    audio: {
      input: {
        transcription: { model: "gpt-4o-mini-transcribe" },
        turn_detection: { type: "server_vad" },
      },
      output: { voice: "marin" },
    },
  };
  const attempts = input.provider === "grok"
    ? [
        { expires_after: { seconds: SECRET_TTL_SECONDS }, session: grokSession },
        { expires_after: { seconds: SECRET_TTL_SECONDS } },
      ]
    : [{
        expires_after: { anchor: "created_at", seconds: SECRET_TTL_SECONDS },
        session: openaiSession,
      }];
  const url = input.provider === "grok"
    ? "https://api.x.ai/v1/realtime/client_secrets"
    : "https://api.openai.com/v1/realtime/client_secrets";
  let failure = "voice provider did not answer";
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(attempt),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      return { error: "voice provider did not answer" };
    }
    const parsed = await providerJson(response, input.apiKey);
    if (!parsed.ok) {
      failure = parsed.error;
      if (input.provider === "grok" && response.status === 400 && index === 0) continue;
      return { error: failure };
    }
    const clientSecret = tokenValue(parsed.body);
    if (!clientSecret || clientSecret === input.apiKey) return { error: "voice provider did not return a session token" };
    const expiresAt = typeof parsed.body.expires_at === "number" ? parsed.body.expires_at : 0;
    return { clientSecret, expiresAt, realtime: link };
  }
  return { error: failure };
}

export type VoiceMatch =
  | { name: string; kind: "save" }
  | { name: string; kind: "start"; botId: string }
  | { name: string; kind: "session"; botId: string; sessionId: string }
  | { name: string; kind: "tools"; botId: string; sessionId: string }
  | { name: string; kind: "transcript"; botId: string; sessionId: string };

export function matchVoicePath(pathname: string): VoiceMatch | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "sprites" || !parts[2]) return null;
  let name = "";
  try {
    name = decodeURIComponent(parts[2]);
  } catch {
    return null;
  }
  if (parts.length === 4 && parts[3] === "voice") return { name, kind: "save" };
  if (parts[3] !== "bots" || !parts[4] || parts[5] !== "voice") return null;
  let botId = "";
  let sessionId = "";
  try {
    botId = decodeURIComponent(parts[4]);
    sessionId = parts[6] ? decodeURIComponent(parts[6]) : "";
  } catch {
    return null;
  }
  if (!botId) return null;
  if (parts.length === 6) return { name, kind: "start", botId };
  if (!sessionId) return null;
  if (parts.length === 7) return { name, kind: "session", botId, sessionId };
  if (parts.length === 8 && parts[7] === "tools") return { name, kind: "tools", botId, sessionId };
  if (parts.length === 8 && parts[7] === "transcript") return { name, kind: "transcript", botId, sessionId };
  return null;
}
