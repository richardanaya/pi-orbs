// MCP event webhook records. The sprite server stores these in mcp-events.json.
// The local simulator keeps the same records in memory. Neither list nor
// disconnect responses include the signing secret or the full callback token.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const HOOK_MAX = 32;
const LABEL_MAX = 80;
const SEEN_MAX = 200;
const BODY_MAX = 262_144;
const SKEW_SECONDS = 5 * 60;

export type McpHook = {
  token: string;
  botId: string;
  secret: string;
  label: string;
  createdAt: string;
  seen: string[];
};

export type PublicMcpHook = {
  id: string;
  label: string;
  createdAt: string;
  endpoint: string;
};

export type WebhookResult = {
  status: number;
  body: Record<string, unknown>;
  deliver?: { botId: string; content: string; requestId: string; webhookId: string };
};

export function publicBase(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

export function webhookUrl(base: string, token: string): string {
  return `${publicBase(base)}/api/mcp-events/${token}`;
}

export function mintSecret(): string {
  return `whsec_${randomBytes(32).toString("base64")}`;
}

export function hookPublicId(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export function maskToken(token: string): string {
  if (token.length < 12) return "••••";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function publicMcpHook(hook: McpHook): PublicMcpHook {
  return {
    id: hookPublicId(hook.token),
    label: hook.label,
    createdAt: hook.createdAt,
    endpoint: `/api/mcp-events/${maskToken(hook.token)}`,
  };
}

export function normalizeHook(value: unknown): McpHook | undefined {
  if (!value || typeof value !== "object") return undefined;
  const hook = value as Record<string, unknown>;
  if (typeof hook.token !== "string" || hook.token.length === 0) return undefined;
  if (typeof hook.secret !== "string" || hook.secret.length === 0) return undefined;
  if (typeof hook.botId !== "string" || hook.botId.length === 0) return undefined;
  const seen = Array.isArray(hook.seen)
    ? hook.seen.filter((item): item is string => typeof item === "string").slice(-SEEN_MAX)
    : [];
  return {
    token: hook.token,
    botId: hook.botId,
    secret: hook.secret,
    label: typeof hook.label === "string" ? hook.label.slice(0, LABEL_MAX) : "",
    createdAt: typeof hook.createdAt === "string" ? hook.createdAt : "",
    seen,
  };
}

export function botOwnsHook(hook: McpHook, botId: string, conversationId = botId): boolean {
  return hook.botId === botId || hook.botId === conversationId;
}

export function hooksForBot(hooks: readonly McpHook[], botId: string, conversationId = botId): McpHook[] {
  return hooks.filter((hook) => botOwnsHook(hook, botId, conversationId));
}

export function hookLimitError(hooks: readonly McpHook[], botId: string, conversationId = botId): string | undefined {
  if (hooksForBot(hooks, botId, conversationId).length >= HOOK_MAX) {
    return `this bot already has ${HOOK_MAX} webhook URLs`;
  }
  return undefined;
}

export function buildMcpHook(botId: string, label: string): McpHook {
  return {
    token: randomBytes(24).toString("hex"),
    botId,
    secret: mintSecret(),
    label: label.trim().slice(0, LABEL_MAX),
    createdAt: new Date().toISOString(),
    seen: [],
  };
}

export function disconnectHook(
  hooks: readonly McpHook[],
  botId: string,
  publicId: string,
  conversationId = botId,
): { hooks: McpHook[]; removed: boolean } {
  const target = hooks.find((hook) => botOwnsHook(hook, botId, conversationId) && hookPublicId(hook.token) === publicId);
  if (!target) return { hooks: [...hooks], removed: false };
  return { hooks: hooks.filter((hook) => hook !== target), removed: true };
}

export function dropBotHooks(hooks: readonly McpHook[], botId: string, conversationId = botId): McpHook[] {
  return hooks.filter((hook) => !botOwnsHook(hook, botId, conversationId));
}

export function rememberSeen(hooks: readonly McpHook[], token: string, id: string): { hooks: McpHook[]; changed: boolean } {
  const index = hooks.findIndex((hook) => hook.token === token);
  const hook = index >= 0 ? hooks[index] : undefined;
  if (!hook) return { hooks: [...hooks], changed: false };
  const seen = seenIds(hook);
  if (seen.includes(id)) return { hooks: [...hooks], changed: false };
  seen.push(id);
  if (seen.length > SEEN_MAX) seen.splice(0, seen.length - SEEN_MAX);
  const next = hooks.slice();
  next[index] = { ...hook, seen };
  return { hooks: next, changed: true };
}

function decodeSecret(secret: string): Buffer | undefined {
  if (!secret.startsWith("whsec_")) return undefined;
  try {
    const key = Buffer.from(secret.slice(6), "base64");
    if (key.length < 24 || key.length > 64) return undefined;
    return key;
  } catch {
    return undefined;
  }
}

export function signWebhook(secret: string, id: string, timestamp: string, body: string): string {
  const key = decodeSecret(secret);
  if (!key) throw new Error("signing secret is not a whsec_ key");
  const mac = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${mac}`;
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function signatureMatches(header: string, expected: string): boolean {
  const wanted = Buffer.from(expected);
  for (const part of header.trim().split(/\s+/)) {
    if (!part.startsWith("v1,")) continue;
    const given = Buffer.from(part);
    if (given.length === wanted.length && timingSafeEqual(given, wanted)) return true;
  }
  return false;
}

function freshTimestamp(timestamp: string, nowSeconds: number): boolean {
  if (!/^\d+$/.test(timestamp)) return false;
  const sent = Number(timestamp);
  return Math.abs(nowSeconds - sent) <= SKEW_SECONDS;
}

function seenIds(hook: McpHook): string[] {
  const seen = (hook as { seen?: unknown }).seen;
  if (!Array.isArray(seen)) return [];
  return seen.filter((item): item is string => typeof item === "string");
}

function eventText(subscriptionId: string, body: Record<string, unknown>): string {
  const data = body.data === undefined ? null : body.data;
  let encoded = "";
  try {
    encoded = JSON.stringify(data, null, 2) ?? "null";
  } catch {
    encoded = "null";
  }
  return [
    "An MCP event arrived.",
    `Subscription: ${subscriptionId || "(none)"}`,
    `Event: ${typeof body.name === "string" ? body.name : "(unnamed)"}`,
    `Event id: ${typeof body.eventId === "string" ? body.eventId : "(none)"}`,
    `Occurred: ${typeof body.timestamp === "string" ? body.timestamp : "(none)"}`,
    "Data:",
    encoded,
  ].join("\n");
}

export function acceptMcpWebhook(
  hooks: readonly McpHook[],
  token: string,
  raw: string,
  headers: Record<string, string | string[] | undefined>,
  nowSeconds = Math.floor(Date.now() / 1000),
): WebhookResult {
  if (Buffer.byteLength(raw) > BODY_MAX) return { status: 413, body: { error: "body too large" } };
  const hook = hooks.find((item) => item.token === token);
  if (!hook) return { status: 404, body: { error: "not found" } };
  const id = headerValue(headers, "webhook-id");
  const timestamp = headerValue(headers, "webhook-timestamp");
  const signature = headerValue(headers, "webhook-signature");
  if (!id || !timestamp || !signature) return { status: 401, body: { error: "missing webhook signature" } };
  if (!freshTimestamp(timestamp, nowSeconds)) return { status: 401, body: { error: "webhook timestamp is outside the window" } };
  let expected = "";
  try {
    expected = signWebhook(hook.secret, id, timestamp, raw);
  } catch {
    return { status: 401, body: { error: "signing secret is unusable" } };
  }
  if (!signatureMatches(signature, expected)) return { status: 401, body: { error: "webhook signature does not match" } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { status: 400, body: { error: "body is not json" } };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { status: 400, body: { error: "body is not an object" } };
  const body = parsed as Record<string, unknown>;
  if (body.type === "verification") {
    if (typeof body.challenge !== "string" || body.challenge.length === 0) {
      return { status: 400, body: { error: "challenge is required" } };
    }
    return { status: 200, body: { challenge: body.challenge } };
  }
  if (typeof body.eventId === "string" && body.eventId !== id) {
    return { status: 400, body: { error: "webhook-id does not match eventId" } };
  }
  if (seenIds(hook).includes(id)) return { status: 200, body: { ok: true, duplicate: true } };
  const subscription = headerValue(headers, "x-mcp-subscription-id");
  return {
    status: 200,
    body: { ok: true },
    deliver: {
      botId: hook.botId,
      content: eventText(subscription, body),
      requestId: `mcp-event:${token}:${id}`,
      webhookId: id,
    },
  };
}
