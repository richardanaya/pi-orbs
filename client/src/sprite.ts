import { spawn } from "node:child_process";

const pathPrefix = `${process.env.HOME}/.local/bin:${process.env.HOME}/.fly/bin:${process.env.PATH}`;

export function run(command: string, args: string[], input?: Buffer): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, PATH: pathPrefix } });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({
      code: code ?? 1,
      stdout: Buffer.concat(out).toString("utf8"),
      stderr: Buffer.concat(err).toString("utf8"),
    }));
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function sprite(args: string[], input?: Buffer): Promise<string> {
  const result = await run("sprite", args, input);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || `sprite ${args[0]} failed`);
  return result.stdout;
}

export type SpriteInfo = { name: string; url?: string; status?: string };

export async function listSprites(): Promise<SpriteInfo[]> {
  const raw = await sprite(["api", "/v1/sprites"]);
  const jsonStart = raw.indexOf("{");
  const arrayStart = raw.indexOf("[");
  const start = jsonStart === -1 ? arrayStart : arrayStart === -1 ? jsonStart : Math.min(jsonStart, arrayStart);
  const parsed = JSON.parse(raw.slice(start)) as { sprites?: SpriteInfo[] } | SpriteInfo[];
  const sprites = Array.isArray(parsed) ? parsed : parsed.sprites ?? [];
  return sprites.map((spriteInfo) => ({
    name: spriteInfo.name,
    url: spriteInfo.url,
    status: spriteInfo.status,
  }));
}
