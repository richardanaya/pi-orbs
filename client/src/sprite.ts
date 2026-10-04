const apiBase = "https://api.sprites.dev";

const stdoutId = 1;
const stderrId = 2;
const exitId = 3;
const stdinEof = 4;

let spritesToken = "";

export function setSpritesToken(token: string): void {
  spritesToken = token.trim();
}

export function hasSpritesToken(): boolean {
  return spritesToken.length > 0;
}

function token(): string {
  if (!spritesToken) throw new Error("Save a Sprites API token first.");
  return spritesToken;
}

function apiError(status: number, body: string, action: string): Error {
  const detail = body.replace(/\s+/g, " ").trim().slice(0, 400);
  if (status === 401) return new Error("That Sprites API token was rejected.");
  return new Error(detail ? `${action} failed (${status}): ${detail}` : `${action} failed (${status})`);
}

export async function spritesRequest(method: string, path: string, init?: {
  body?: BodyInit;
  contentType?: string;
  allow?: number[];
}): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${token()}` };
  if (init?.contentType) headers["content-type"] = init.contentType;
  const response = await fetch(new URL(path, apiBase), { method, headers, body: init?.body });
  const allow = init?.allow ?? [];
  if (!response.ok && !allow.includes(response.status)) {
    const text = await response.text();
    throw apiError(response.status, text, `${method} ${path}`);
  }
  return response;
}

export async function verifySpritesToken(candidate: string): Promise<void> {
  const previous = spritesToken;
  spritesToken = candidate.trim();
  try {
    if (!spritesToken) throw new Error("Enter a Sprites API token.");
    await spritesRequest("GET", "/v1/sprites?max_results=1");
  } catch (error) {
    spritesToken = previous;
    throw error;
  }
}

export type SpriteInfo = { name: string; url?: string; status?: string };

type SpritePage = {
  sprites?: SpriteInfo[];
  has_more?: boolean;
  next_continuation_token?: string;
};

export async function listSprites(): Promise<SpriteInfo[]> {
  const found: SpriteInfo[] = [];
  let tokenQuery = "";
  for (let page = 0; page < 20; page += 1) {
    const response = await spritesRequest("GET", `/v1/sprites?max_results=100${tokenQuery}`);
    const body = await response.json() as SpritePage;
    for (const item of body.sprites ?? []) found.push({ name: item.name, url: item.url, status: item.status });
    if (!body.has_more || !body.next_continuation_token) break;
    tokenQuery = `&continuation_token=${encodeURIComponent(body.next_continuation_token)}`;
  }
  return found;
}

export async function getSprite(name: string): Promise<SpriteInfo> {
  const response = await spritesRequest("GET", `/v1/sprites/${encodeURIComponent(name)}`);
  const body = await response.json() as SpriteInfo;
  if (!body.url) throw new Error("sprites did not return a sprite url");
  return body;
}

export async function createSprite(name: string): Promise<void> {
  await spritesRequest("POST", "/v1/sprites", {
    contentType: "application/json",
    body: JSON.stringify({ name, url_settings: { auth: "public" } }),
  });
}

export async function publishSprite(name: string): Promise<void> {
  await spritesRequest("PUT", `/v1/sprites/${encodeURIComponent(name)}`, {
    contentType: "application/json",
    body: JSON.stringify({ url_settings: { auth: "public" } }),
  });
}

export async function destroySprite(name: string): Promise<void> {
  await spritesRequest("DELETE", `/v1/sprites/${encodeURIComponent(name)}`);
}

export async function writeSpriteFile(name: string, path: string, body: Buffer): Promise<void> {
  const query = new URLSearchParams({ path, workingDir: "/", mkdir: "true" });
  await spritesRequest("PUT", `/v1/sprites/${encodeURIComponent(name)}/fs/write?${query}`, {
    contentType: "application/octet-stream",
    body: new Uint8Array(body),
  });
}

type ExecResult = { stdout: string; stderr: string; exitCode: number };

export async function execSprite(name: string, args: string[], options?: { dir?: string; input?: Buffer }): Promise<ExecResult> {
  const url = new URL(`/v1/sprites/${encodeURIComponent(name)}/exec`, apiBase);
  for (const arg of args) url.searchParams.append("cmd", arg);
  url.searchParams.set("path", args[0] ?? "bash");
  url.searchParams.set("stdin", "true");
  if (options?.dir) url.searchParams.set("dir", options.dir);
  url.protocol = "wss:";
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const exitCode = await new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${token()}` } } as unknown as string);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`sprite exec timed out: ${args[0] ?? "command"}`));
    }, 15 * 60 * 1000);
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
      ws.close();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
      ws.close();
    };
    ws.binaryType = "arraybuffer";
    ws.addEventListener("open", () => {
      const input = options?.input;
      if (input && input.length > 0) {
        const frame = Buffer.allocUnsafe(input.length + 1);
        frame[0] = 0;
        input.copy(frame, 1);
        ws.send(frame);
      }
      ws.send(Buffer.from([stdinEof]));
    });
    ws.addEventListener("message", (event) => {
      const data = event.data;
      const bytes = Buffer.isBuffer(data)
        ? data
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : typeof data === "string"
            ? null
            : null;
      if (!bytes || bytes.length === 0) return;
      const payload = bytes.subarray(1);
      if (bytes[0] === stdoutId) stdout.push(Buffer.from(payload));
      else if (bytes[0] === stderrId) stderr.push(Buffer.from(payload));
      else if (bytes[0] === exitId) finish(payload.length > 0 ? payload[0] ?? 255 : 0);
    });
    ws.addEventListener("error", () => fail(new Error(`sprite exec failed: ${args[0] ?? "command"}`)));
    ws.addEventListener("close", () => {
      if (!settled) fail(new Error(`sprite exec closed before exit: ${args[0] ?? "command"}`));
    });
  });
  const result = {
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
    exitCode,
  };
  if (exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(0, 800);
    throw new Error(detail || `sprite exec exited ${exitCode}`);
  }
  return result;
}

export async function spritesJson<T>(method: string, path: string, body?: unknown, allow?: number[]): Promise<T> {
  const response = await spritesRequest(method, path, body === undefined ? { allow } : {
    contentType: "application/json",
    body: JSON.stringify(body),
    allow,
  });
  if (allow?.includes(response.status) && !response.ok) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
