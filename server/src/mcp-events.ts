import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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

type HooksFile = { hooks: McpHook[] };

export type WebhookResult = {
  status: number;
  body: Record<string, unknown>;
  deliver?: { botId: string; content: string; requestId: string; webhookId: string };
};

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

export function publicBase(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

export function webhookUrl(base: string, token: string): string {
  return `${publicBase(base)}/api/mcp-events/${token}`;
}

export function mintSecret(): string {
  return `whsec_${randomBytes(32).toString("base64")}`;
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

async function loadHooks(path: string): Promise<McpHook[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as HooksFile;
    if (!parsed || !Array.isArray(parsed.hooks)) return [];
    return parsed.hooks.filter((hook) => hook && typeof hook.token === "string" && typeof hook.secret === "string" && typeof hook.botId === "string");
  } catch {
    return [];
  }
}

async function saveHooks(path: string, hooks: McpHook[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ hooks }, null, 2));
}

export async function createMcpHook(path: string, botId: string, base: string, label: string): Promise<{ url: string; secret: string; label: string } | { error: string }> {
  const origin = publicBase(base);
  if (!origin.startsWith("https://") && !origin.startsWith("http://")) {
    return { error: "PI_PUBLIC_URL is not set, so this bot cannot mint a callback URL" };
  }
  const trimmed = label.trim().slice(0, LABEL_MAX);
  return enqueue(async () => {
    const hooks = await loadHooks(path);
    const mine = hooks.filter((hook) => hook.botId === botId);
    if (mine.length >= HOOK_MAX) return { error: `this bot already has ${HOOK_MAX} webhook URLs` };
    const token = randomBytes(24).toString("hex");
    const secret = mintSecret();
    const hook: McpHook = {
      token,
      botId,
      secret,
      label: trimmed,
      createdAt: new Date().toISOString(),
      seen: [],
    };
    hooks.push(hook);
    await saveHooks(path, hooks);
    return { url: webhookUrl(origin, token), secret, label: trimmed };
  });
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

export async function rememberWebhook(path: string, token: string, id: string): Promise<void> {
  await enqueue(async () => {
    const hooks = await loadHooks(path);
    const hook = hooks.find((item) => item.token === token);
    if (!hook || hook.seen.includes(id)) return;
    hook.seen.push(id);
    if (hook.seen.length > SEEN_MAX) hook.seen.splice(0, hook.seen.length - SEEN_MAX);
    await saveHooks(path, hooks);
  });
}

export async function receiveMcpWebhook(
  path: string,
  token: string,
  raw: string,
  headers: Record<string, string | string[] | undefined>,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<WebhookResult> {
  if (Buffer.byteLength(raw) > BODY_MAX) return { status: 413, body: { error: "body too large" } };
  return enqueue(async () => {
    const hooks = await loadHooks(path);
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
    if (hook.seen.includes(id)) return { status: 200, body: { ok: true, duplicate: true } };
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
  });
}
