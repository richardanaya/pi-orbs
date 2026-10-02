import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { sprite } from "./sprite.js";

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
    const response = await fetch(new URL("/version", url));
    if (!response.ok) return null;
    const body = await response.json() as { version?: string };
    return body.version ?? null;
  } catch {
    return null;
  }
}

export async function deploySprite(name: string, env: Record<string, string>): Promise<void> {
  const archive = await packServer();
  try {
    await sprite(["exec", "-s", name, "--", "mkdir", "-p", "/home/sprite/app"]);
    await sprite(["exec", "-s", name, "--", "bash", "-lc", "cat > /tmp/pi-orbs-server.tgz"], await readFile(archive));
    await sprite(["exec", "-s", name, "--", "bash", "-lc", "tar -xzf /tmp/pi-orbs-server.tgz -C /home/sprite/app && cd /home/sprite/app && /.sprite/bin/npm install --omit=dev"]);
    const envArg = Object.entries({ ...env, PORT: "8080" }).map(([key, value]) => `${key}=${value}`).join(",");
    const script = `
      if sprite-env services list | grep -q '"name": "web"'; then
        sprite-env services delete web || true
      fi
      sprite-env services create web --cmd /.sprite/bin/node --args /home/sprite/app/dist/server.js --dir /home/sprite/work --http-port 8080 --no-stream --env ${JSON.stringify(envArg)}
    `;
    await sprite(["exec", "-s", name, "--", "bash", "-lc", script]);
  } finally {
    await rm(archive, { force: true });
  }
}
