import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execSprite, spritesJson, spritesRequest, writeSpriteFile } from "./sprite.js";

const exec = promisify(execFile);
const serverRoot = resolve(import.meta.dirname, "../../server");

export async function localVersion(): Promise<string> {
  return (await readFile(join(serverRoot, "VERSION"), "utf8")).trim();
}

export async function packServer(): Promise<string> {
  await readFile(join(serverRoot, "dist", "server.js"));
  const dir = await mkdtemp(join(tmpdir(), "pi-orbs-"));
  const archive = join(dir, "server.tgz");
  await exec("tar", ["-czf", archive, "-C", serverRoot, "dist", "package.json", "package-lock.json", "VERSION"]);
  return archive;
}

export function newSecret(): string {
  return randomBytes(24).toString("hex");
}

export async function remoteVersion(url: string): Promise<string | null> {
  try {
    const response = await fetch(new URL("/version", url), { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const body = await response.json() as { version?: string };
    return body.version ?? null;
  } catch {
    return null;
  }
}

async function serviceRunning(name: string): Promise<boolean> {
  const info = await spritesJson<{ state?: { status?: string } | null }>("GET", `/v1/sprites/${encodeURIComponent(name)}/services/web`);
  return info.state?.status === "running";
}

export async function deploySprite(name: string, env: Record<string, string>): Promise<void> {
  const archive = await packServer();
  try {
    await execSprite(name, ["mkdir", "-p", "/home/sprite/app", "/home/sprite/work"]);
    await writeSpriteFile(name, "/tmp/pi-orbs-server.tgz", await readFile(archive));
    await execSprite(name, ["tar", "-xzf", "/tmp/pi-orbs-server.tgz", "-C", "/home/sprite/app"]);
    await execSprite(name, ["/.sprite/bin/npm", "install", "--omit=dev"], { dir: "/home/sprite/app" });
    await spritesRequest("DELETE", `/v1/sprites/${encodeURIComponent(name)}/services/web`, { allow: [204, 404] });
    const created = await spritesRequest("PUT", `/v1/sprites/${encodeURIComponent(name)}/services/web?duration=20`, {
      contentType: "application/json",
      body: JSON.stringify({
        cmd: "/.sprite/bin/node",
        args: ["/home/sprite/app/dist/server.js"],
        dir: "/home/sprite/work",
        http_port: 8080,
        needs: [],
        env: { ...env, PORT: "8080" },
      }),
    });
    await created.text();
    if (!await serviceRunning(name)) throw new Error("web service did not report running");
  } finally {
    await rm(archive, { force: true });
  }
}
