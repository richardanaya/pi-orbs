// Scheduled messages via cron-job.org. The API key never goes to the page.
// Webhook auth is a per-bot token, not that key.
import { randomBytes, timingSafeEqual } from "node:crypto";

export const MESSAGE_MAX = 8_000;
export const CRON_KEY_MAX = 500;
export const HOOK_TOKEN_BYTES = 24;

export type PublicCron = { configured: boolean };

export type JobSchedule = {
  timezone: string;
  expiresAt: 0;
  minutes: number[];
  hours: number[];
  mdays: number[];
  months: number[];
  wdays: number[];
};

export type ScheduleRequest = {
  message: string;
  cron: string;
  timezone: string;
  schedule: JobSchedule;
};

export type CronResult = { status: number; json: unknown };

export type CronCaller = (input: {
  method: "PUT" | "DELETE";
  path: string;
  apiKey: string;
  json?: unknown;
}) => Promise<CronResult>;

type Bounds = { min: number; max: number; week?: boolean };

const BOUNDS: Bounds[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7, week: true },
];

const TIMEZONE = /^[A-Za-z0-9_+-]{1,32}(?:\/[A-Za-z0-9_+-]{1,32}){0,2}$/;

export function publicCron(apiKey: string | null | undefined): PublicCron {
  return { configured: Boolean(apiKey && apiKey.trim()) };
}

export function isCronFailure<T>(value: T | { error: string }): value is { error: string } {
  return !!value && typeof value === "object" && "error" in value;
}

export function newHookToken(): string {
  return randomBytes(HOOK_TOKEN_BYTES).toString("hex");
}

export function validHookToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{48}$/.test(value);
}

export function tokensEqual(given: string, expected: string): boolean {
  if (!given || !expected || given.length > 128 || expected.length > 128) return false;
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function webhookUrl(publicBase: string, token: string): string {
  return `${publicBase.replace(/\/$/, "")}/hooks/${token}`;
}

export function scheduleTitle(botName: string): string {
  const name = botName.trim().slice(0, 48) || "bot";
  return `pi-orbs ${name}`;
}

export function cronFromSetup(body: Record<string, unknown>): string | null | { error: string } {
  if (!Object.prototype.hasOwnProperty.call(body, "cronApiKey")) return null;
  if (typeof body.cronApiKey !== "string") return { error: "cron API key must be a string" };
  const apiKey = body.cronApiKey.trim();
  if (!apiKey) return null;
  if (apiKey.length > CRON_KEY_MAX) return { error: "cron API key is too long" };
  return apiKey;
}

export function readCronSettings(
  body: Record<string, unknown>,
  current: string | null,
): { unchanged: true } | { apiKey: string | null } | { error: string } {
  const clear = body.clear === true;
  const hasKey = Object.prototype.hasOwnProperty.call(body, "cronApiKey");
  if (!hasKey && !clear) return { unchanged: true };
  if (body.clear !== undefined && typeof body.clear !== "boolean") return { error: "cron API key must be a string" };
  if (clear) return { apiKey: null };
  if (typeof body.cronApiKey !== "string") return { error: "cron API key must be a string" };
  const apiKey = body.cronApiKey.trim();
  if (apiKey.length > CRON_KEY_MAX) return { error: "cron API key is too long" };
  if (!apiKey) return { apiKey: current && current.trim() ? current.trim() : null };
  return { apiKey };
}

function parseField(raw: string, bounds: Bounds): number[] | { error: string } {
  const text = raw.trim();
  if (text === "*") return [-1];
  const out: number[] = [];
  const hardMax = bounds.week ? 6 : bounds.max;
  for (const part of text.split(",")) {
    const piece = part.trim();
    if (!piece) return { error: "cron expression is invalid" };
    const stepped = /^(\*|\d+-\d+|\d+)\/(\d+)$/.exec(piece);
    const range = /^(\d+)-(\d+)$/.exec(piece);
    const single = /^(\d+)$/.exec(piece);
    let start = 0;
    let end = 0;
    let step = 1;
    if (stepped) {
      step = Number(stepped[2]);
      if (!Number.isInteger(step) || step < 1) return { error: "cron expression is invalid" };
      const base = stepped[1] ?? "";
      if (base === "*") {
        start = bounds.min;
        end = hardMax;
      } else if (base.includes("-")) {
        const [left, right] = base.split("-");
        start = Number(left);
        end = Number(right);
      } else {
        start = Number(base);
        end = hardMax;
      }
    } else if (range) {
      start = Number(range[1]);
      end = Number(range[2]);
    } else if (single) {
      start = Number(single[1]);
      end = start;
    } else {
      return { error: "cron expression is invalid" };
    }
    if (!Number.isInteger(start) || !Number.isInteger(end)) return { error: "cron expression is invalid" };
    if (start < bounds.min || end > bounds.max || end < start) return { error: "cron expression is invalid" };
    for (let value = start; value <= end; value += step) {
      if (bounds.week && value === 7) {
        out.push(0);
        continue;
      }
      if (value > hardMax) break;
      out.push(value);
    }
  }
  if (out.length === 0) return { error: "cron expression is invalid" };
  return [...new Set(out)].sort((left, right) => left - right);
}

export function parseCron(expression: string, timezone = "UTC"): JobSchedule | { error: string } {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return { error: "cron expression is invalid" };
  const parsed: number[][] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const bounds = BOUNDS[index];
    const field = fields[index];
    if (!bounds || field === undefined) return { error: "cron expression is invalid" };
    const values = parseField(field, bounds);
    if ("error" in values) return values;
    parsed.push(values);
  }
  const zone = readTimezone(timezone);
  if (typeof zone !== "string") return zone;
  return {
    timezone: zone,
    expiresAt: 0,
    minutes: parsed[0] ?? [-1],
    hours: parsed[1] ?? [-1],
    mdays: parsed[2] ?? [-1],
    months: parsed[3] ?? [-1],
    wdays: parsed[4] ?? [-1],
  };
}

export function readTimezone(value: string | undefined): string | { error: string } {
  if (!value || !value.trim()) return "UTC";
  const zone = value.trim();
  if (!TIMEZONE.test(zone)) return { error: "timezone is invalid" };
  return zone;
}

export function readScheduleRequest(body: Record<string, unknown>): ScheduleRequest | { error: string } {
  if (typeof body.message !== "string") return { error: "message is required" };
  const message = body.message.trim();
  if (!message) return { error: "message is required" };
  if (message.length > MESSAGE_MAX) return { error: "message is too long" };
  if (typeof body.cron !== "string" || !body.cron.trim()) return { error: "cron is required" };
  if (body.timezone !== undefined && typeof body.timezone !== "string") return { error: "timezone is invalid" };
  const timezone = readTimezone(typeof body.timezone === "string" ? body.timezone : undefined);
  if (typeof timezone !== "string") return timezone;
  const schedule = parseCron(body.cron, timezone);
  if ("error" in schedule) return schedule;
  return { message, cron: body.cron.trim(), timezone, schedule };
}

export function readHookBody(body: unknown): { content: string } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "content is required" };
  const content = (body as { content?: unknown }).content;
  if (typeof content !== "string") return { error: "content is required" };
  const trimmed = content.trim();
  if (!trimmed) return { error: "content is required" };
  if (trimmed.length > MESSAGE_MAX) return { error: "content is too long" };
  return { content: trimmed };
}

export function cronJobPayload(draft: { url: string; title: string; message: string; schedule: JobSchedule }): {
  job: {
    url: string;
    enabled: true;
    title: string;
    saveResponses: false;
    requestMethod: 1;
    schedule: JobSchedule;
    extendedData: { headers: { "Content-Type": "application/json" }; body: string };
  };
} {
  return {
    job: {
      url: draft.url,
      enabled: true,
      title: draft.title,
      saveResponses: false,
      requestMethod: 1,
      schedule: draft.schedule,
      extendedData: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft.message }),
      },
    },
  };
}

function jobIdOf(json: unknown): number | null {
  if (!json || typeof json !== "object" || !("jobId" in json)) return null;
  const jobId = (json as { jobId?: unknown }).jobId;
  return typeof jobId === "number" && Number.isInteger(jobId) && jobId > 0 ? jobId : null;
}

export async function putCronJob(
  call: CronCaller,
  apiKey: string,
  draft: { url: string; title: string; message: string; schedule: JobSchedule },
): Promise<{ jobId: number } | { error: string; status: number }> {
  if (!apiKey.trim()) return { error: "cron-job.org API key is not configured", status: 400 };
  let result: CronResult;
  try {
    result = await call({ method: "PUT", path: "/jobs", apiKey, json: cronJobPayload(draft) });
  } catch {
    return { error: "cron-job.org request failed", status: 502 };
  }
  const jobId = jobIdOf(result.json);
  if (result.status >= 200 && result.status < 300 && jobId !== null) return { jobId };
  if (result.status === 401 || result.status === 403) return { error: "cron-job.org rejected the API key", status: 502 };
  return { error: "cron-job.org request failed", status: 502 };
}

export async function deleteCronJob(
  call: CronCaller,
  apiKey: string,
  jobId: number,
): Promise<{ ok: true } | { error: string; status: number }> {
  if (!apiKey.trim()) return { error: "cron-job.org API key is not configured", status: 409 };
  let result: CronResult;
  try {
    result = await call({ method: "DELETE", path: `/jobs/${jobId}`, apiKey });
  } catch {
    return { error: "cron-job.org request failed", status: 502 };
  }
  if (result.status === 404 || (result.status >= 200 && result.status < 300)) return { ok: true };
  if (result.status === 401 || result.status === 403) return { error: "cron-job.org rejected the API key", status: 502 };
  return { error: "cron-job.org request failed", status: 502 };
}

export type MemoryJob = { jobId: number; url: string; title: string; body: string; schedule: JobSchedule };

export function memoryCron(): { call: CronCaller; list: () => MemoryJob[] } {
  let next = 1;
  const jobs = new Map<number, MemoryJob>();
  const call: CronCaller = async ({ method, path, apiKey, json }) => {
    if (!apiKey.trim()) return { status: 401, json: {} };
    if (method === "PUT" && path === "/jobs") {
      const payload = json as ReturnType<typeof cronJobPayload> | undefined;
      const job = payload?.job;
      if (!job || typeof job.url !== "string" || !job.url) return { status: 400, json: {} };
      const jobId = next++;
      jobs.set(jobId, {
        jobId,
        url: job.url,
        title: typeof job.title === "string" ? job.title : "",
        body: job.extendedData?.body ?? "",
        schedule: job.schedule,
      });
      return { status: 200, json: { jobId } };
    }
    if (method === "DELETE" && path.startsWith("/jobs/")) {
      const id = Number(path.slice("/jobs/".length));
      if (!Number.isInteger(id) || !jobs.has(id)) return { status: 404, json: {} };
      jobs.delete(id);
      return { status: 200, json: {} };
    }
    return { status: 404, json: {} };
  };
  return { call, list: () => [...jobs.values()] };
}
