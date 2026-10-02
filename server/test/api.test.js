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

  const exportMissing = await fetch(`${state.base}/api/export`);
  assert.equal(exportMissing.status, 401);
});

test("GET /api/export is an empty conversation list before any bot exists", async () => {
  const response = await fetch(`${state.base}/api/export`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(typeof body.exportedAt, "string");
  assert.equal(Number.isNaN(Date.parse(body.exportedAt)), false);
  assert.deepEqual(body.bots, []);
  assert.equal(JSON.stringify(body).includes(secret), false);
  for (const hidden of ["apiKey", "xaiKey", "connectorId", "PI_API_SECRET"]) {
    assert.equal(JSON.stringify(body).includes(hidden), false, hidden);
  }
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
  assert.equal(bot.instruction, "");
  assert.equal(bot.look, "slate");
  assert.equal(typeof bot.id, "string");
  assert.ok(bot.id.length > 0);
  assert.equal(bot.conversationId, bot.id);

  const listed = await fetch(`${state.base}/api/bots`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), { bots: [bot] });
});

test("instruction and look are stored and can be edited", async () => {
  const created = await fetch(`${state.base}/api/bots`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Kepler", instruction: "  Answer briefly.  ", look: "pine" }),
  });
  assert.equal(created.status, 201);
  const bot = await created.json();
  assert.equal(bot.name, "Kepler");
  assert.equal(bot.instruction, "Answer briefly.");
  assert.equal(bot.look, "pine");

  const patched = await fetch(`${state.base}/api/bots/${bot.id}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Kepler 2", instruction: "", look: "clay" }),
  });
  assert.equal(patched.status, 200);
  const updated = await patched.json();
  assert.equal(updated.name, "Kepler 2");
  assert.equal(updated.instruction, "");
  assert.equal(updated.look, "clay");
  assert.equal(updated.id, bot.id);
  assert.equal(updated.conversationId, bot.conversationId);

  const listed = await fetch(`${state.base}/api/bots`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  const body = await listed.json();
  assert.deepEqual(body.bots.find((item) => item.id === bot.id), updated);

  const rejected = await fetch(`${state.base}/api/bots/${bot.id}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ look: "rainbow" }),
  });
  assert.equal(rejected.status, 400);

  const thread = await fetch(`${state.base}/api/bots/${bot.id}`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  const threadBody = await thread.json();
  assert.equal(threadBody.bot.look, "clay");
  assert.equal(threadBody.bot.instruction, "");
});

test("GET /api/export lists every bot and redacts the API secret from a message", async () => {
  const listed = await fetch(`${state.base}/api/bots`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  const roster = await listed.json();
  const ada = roster.bots.find((item) => item.name === "Ada");
  assert.ok(ada);

  const posted = await fetch(`${state.base}/api/bots/${ada.id}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ content: `remember ${secret} please` }),
  });
  assert.equal(posted.status, 202);

  const response = await fetch(`${state.base}/api/export`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(JSON.stringify(body).includes(secret), false);
  const names = body.bots.map((item) => item.name);
  assert.ok(names.includes("Ada"));
  assert.ok(names.includes("Kepler 2"));
  const exportedAda = body.bots.find((item) => item.id === ada.id);
  assert.equal(exportedAda.conversationId, ada.id);
  assert.equal(exportedAda.look, "slate");
  const remembered = exportedAda.messages.find((item) => item.kind === "pi.user" && item.text.includes("remember"));
  assert.ok(remembered);
  assert.equal(remembered.text, "remember [redacted] please");
  assert.equal(typeof remembered.id, "string");
  assert.equal(Number.isNaN(Date.parse(remembered.createdAt)), false);
  for (const hidden of ["apiKey", "xaiKey", "connectorId", "PI_API_SECRET", "XAI_API_KEY"]) {
    assert.equal(JSON.stringify(body).includes(hidden), false, hidden);
  }
});
