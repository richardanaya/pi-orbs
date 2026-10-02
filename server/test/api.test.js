import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(serverRoot, "dist", "server.js");
const secret = "pi-orbs-test-secret";
const state = {
  base: "",
  child: /** @type {import("node:child_process").ChildProcess | null} */ (null),
  dir: "",
  stderr: "",
};

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close(() => reject(new Error("could not reserve a port")));
        return;
      }
      const { port } = address;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function serverFailure() {
  const code = state.child?.exitCode;
  const hint = state.stderr.includes("ERR_UNKNOWN_BUILTIN_MODULE")
    ? "\nThe server needs Node.js 22 (node:sqlite)."
    : "";
  return `server exited with ${code}\n${state.stderr}${hint}`;
}

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (state.child?.exitCode != null) throw new Error(serverFailure());
    try {
      const response = await fetch(`${state.base}/version`);
      if (response.status === 200) return;
    } catch {
      // The process is up before the port accepts connections.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${state.base}\n${state.stderr}`);
}

before(async () => {
  state.dir = await mkdtemp(join(tmpdir(), "pi-orbs-api-"));
  const port = await freePort();
  const env = { ...process.env };
  delete env.XAI_API_KEY;
  state.child = spawn(process.execPath, [entry], {
    env: {
      ...env,
      PORT: String(port),
      PI_API_SECRET: secret,
      PI_DB: join(state.dir, "agent.sqlite"),
      PI_BOTS: join(state.dir, "bots.json"),
      PI_CWD: state.dir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  state.child.stdout?.on("data", () => {});
  state.child.stderr?.setEncoding("utf8");
  state.child.stderr?.on("data", (chunk) => {
    state.stderr += chunk;
  });
  state.base = `http://127.0.0.1:${port}`;
  await waitForServer();
});

after(async () => {
  if (state.child && state.child.exitCode == null) {
    const child = state.child;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(undefined);
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve(undefined);
      });
      child.kill("SIGTERM");
    });
  }
  if (state.dir) await rm(state.dir, { recursive: true, force: true });
});

test("/version is public", async () => {
  const version = (await readFile(join(serverRoot, "VERSION"), "utf8")).trim();
  const response = await fetch(`${state.base}/version`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { version });
});

test("unauthorized requests get 401", async () => {
  const missing = await fetch(`${state.base}/api/bots`);
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { error: "unauthorized" });

  const posted = await fetch(`${state.base}/api/bots`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ada" }),
  });
  assert.equal(posted.status, 401);
  assert.deepEqual(await posted.json(), { error: "unauthorized" });

  const wrong = await fetch(`${state.base}/api/bots`, {
    headers: { authorization: "Bearer wrong-secret" },
  });
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), { error: "unauthorized" });
});

test("Bearer secret creates a bot and lists it", async () => {
  const created = await fetch(`${state.base}/api/bots`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Ada" }),
  });
  assert.equal(created.status, 201);
  const bot = await created.json();
  assert.equal(bot.name, "Ada");
  assert.equal(typeof bot.id, "string");
  assert.ok(bot.id.length > 0);
  assert.equal(bot.conversationId, bot.id);

  const listed = await fetch(`${state.base}/api/bots`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), { bots: [bot] });
});
