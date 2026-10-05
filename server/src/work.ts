// Human-readable working status and the hang cutoff. The sprite server uses this.
export const DEFAULT_HANG_MS = 90_000;
export const WATCH_GRACE_MS = 15_000;

export function hangLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.PI_ORBS_HANG_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return DEFAULT_HANG_MS;
}

export function isHung(startedAt: number, now: number, limit: number): boolean {
  return now - startedAt >= limit;
}

export function workingOn(tool: string, args: Record<string, unknown> = {}): string {
  const path = typeof args.path === "string" ? args.path.split("/").pop() || args.path : "";
  const command = typeof args.command === "string" ? (args.command.trim().split("\n")[0] ?? "").slice(0, 72) : "";
  switch (tool) {
    case "bash":
      return command ? `working on ${command}` : "working on a command";
    case "read":
      return path ? `working on reading ${path}` : "working on reading a file";
    case "write":
      return path ? `working on writing ${path}` : "working on writing a file";
    case "edit":
      return path ? `working on editing ${path}` : "working on editing a file";
    case "update_self":
      return "working on its name and face";
    case "ask_question":
      return "working on a question";
    case "schedule_message":
    case "pause_schedule":
    case "resume_schedule":
    case "delete_schedule":
    case "list_schedules":
      return "working on a schedule";
    case "steer_peer":
      return "working on a message to another bot";
    case "create_bot":
      return "working on a new bot";
    case "save_memory":
    case "forget_memory":
      return "working on memory";
    case "request_secret":
    case "read_secret":
      return "working on a secret";
    default:
      return `working on ${tool.replaceAll("_", " ")}`;
  }
}

export function hangNote(tool?: string): string {
  if (!tool || tool === "bash") return "Stopped an unresponsive command so the next message can continue.";
  const name = tool.replaceAll("_", " ");
  return `Stopped an unresponsive ${name} so the next message can continue.`;
}

export function bashTimeoutSeconds(requested: unknown, limitMs: number): number {
  const cap = Math.max(1, Math.round(limitMs / 1000));
  const given = typeof requested === "number" && Number.isFinite(requested) && requested > 0 ? requested : cap;
  return Math.min(given, cap);
}
