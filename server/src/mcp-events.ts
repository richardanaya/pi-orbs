import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  acceptMcpWebhook,
  buildMcpHook,
  disconnectHook,
  dropBotHooks,
  hookLimitError,
  hooksForBot,
  normalizeHook,
  publicBase,
  publicMcpHook,
  rememberSeen,
  signWebhook,
  webhookUrl,
  type McpHook,
  type PublicMcpHook,
  type WebhookResult,
} from "./mcp-hook.js";

export { publicBase, signWebhook, webhookUrl };
export type { McpHook, PublicMcpHook, WebhookResult };

type HooksFile = { hooks: unknown };

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

async function loadHooks(path: string): Promise<McpHook[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as HooksFile;
    if (!parsed || !Array.isArray(parsed.hooks)) return [];
    return parsed.hooks.flatMap((hook) => {
      const normalized = normalizeHook(hook);
      return normalized ? [normalized] : [];
    });
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
  return enqueue(async () => {
    const hooks = await loadHooks(path);
    const limited = hookLimitError(hooks, botId);
    if (limited) return { error: limited };
    const hook = buildMcpHook(botId, label);
    hooks.push(hook);
    await saveHooks(path, hooks);
    return { url: webhookUrl(origin, hook.token), secret: hook.secret, label: hook.label };
  });
}

export async function listMcpHooks(path: string, botId: string, conversationId = botId): Promise<PublicMcpHook[]> {
  return enqueue(async () => {
    const hooks = await loadHooks(path);
    return hooksForBot(hooks, botId, conversationId).map(publicMcpHook);
  });
}

export async function disconnectMcpHook(
  path: string,
  botId: string,
  publicId: string,
  conversationId = botId,
): Promise<{ ok: true } | { error: string }> {
  return enqueue(async () => {
    const hooks = await loadHooks(path);
    const next = disconnectHook(hooks, botId, publicId, conversationId);
    if (!next.removed) return { error: "webhook not found" };
    await saveHooks(path, next.hooks);
    return { ok: true };
  });
}

export async function disconnectBotMcpHooks(path: string, botId: string, conversationId = botId): Promise<void> {
  await enqueue(async () => {
    const hooks = await loadHooks(path);
    const next = dropBotHooks(hooks, botId, conversationId);
    if (next.length === hooks.length) return;
    await saveHooks(path, next);
  });
}

export async function mcpHookActive(path: string, token: string): Promise<boolean> {
  return enqueue(async () => {
    const hooks = await loadHooks(path);
    return hooks.some((hook) => hook.token === token);
  });
}

export async function rememberWebhook(path: string, token: string, id: string): Promise<void> {
  await enqueue(async () => {
    const hooks = await loadHooks(path);
    const next = rememberSeen(hooks, token, id);
    if (!next.changed) return;
    await saveHooks(path, next.hooks);
  });
}

export async function receiveMcpWebhook(
  path: string,
  token: string,
  raw: string,
  headers: Record<string, string | string[] | undefined>,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<WebhookResult> {
  if (Buffer.byteLength(raw) > 262_144) return { status: 413, body: { error: "body too large" } };
  return enqueue(async () => {
    const hooks = await loadHooks(path);
    return acceptMcpWebhook(hooks, token, raw, headers, nowSeconds);
  });
}
