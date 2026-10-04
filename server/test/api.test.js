import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      PI_PEERS: join(state.dir, "peers.json"),
      PI_CWD: state.dir,
      PI_HOOKS: join(state.dir, "mcp-events.json"),
      PI_PUBLIC_URL: "https://sprite.example",
      PI_BASE_URL: "http://127.0.0.1:9",
      PI_XAI_BASE_URL: "http://127.0.0.1:9",
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

  const activity = await fetch(`${state.base}/api/bots/activity`);
  assert.equal(activity.status, 401);

  const steer = await fetch(`${state.base}/api/bots/1/steer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: "1", content: "hi" }),
  });
  assert.equal(steer.status, 401);
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

test("activity returns busy bot ids", async () => {
  const response = await fetch(`${state.base}/api/bots/activity`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.busy));
  assert.equal(body.busy.every((id) => typeof id === "string"), true);
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

  const extra = await fetch(`${state.base}/api/bots`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Temp" }),
  });
  const temp = await extra.json();
  const removed = await fetch(`${state.base}/api/bots/${temp.id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(removed.status, 200);
  const after = await fetch(`${state.base}/api/bots`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  const names = (await after.json()).bots.map((item) => item.name);
  assert.equal(names.includes("Temp"), false);
  assert.equal(names.includes("Kepler 2"), true);
  const gone = await fetch(`${state.base}/api/bots/${temp.id}`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(gone.status, 404);
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

test("one bot can steer another without putting it on the open thread", async () => {
  const headers = {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  };
  async function create(name) {
    const response = await fetch(`${state.base}/api/bots`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name }),
    });
    assert.equal(response.status, 201);
    return response.json();
  }
  const lumen = await create("Lumen");
  const moss = await create("Moss");

  const visible = await fetch(`${state.base}/api/bots/${moss.id}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content: "visible-user-line" }),
  });
  assert.equal(visible.status, 202);

  const steered = await fetch(`${state.base}/api/bots/${lumen.id}/steer`, {
    method: "POST",
    headers,
    body: JSON.stringify({ from: moss.id, content: "hidden-peer-line" }),
  });
  assert.equal(steered.status, 202);
  const steerBody = await steered.json();
  assert.equal(steerBody.from, moss.id);
  assert.equal(steerBody.to, lumen.id);
  assert.equal(steerBody.fromName, "Moss");
  assert.equal(steerBody.toName, "Lumen");
  assert.equal(steerBody.content, "hidden-peer-line");
  assert.equal(steerBody.delivery, "steer");
  assert.equal(typeof steerBody.submissionId, "string");
  assert.equal(typeof steerBody.entryId, "string");

  const back = await fetch(`${state.base}/api/bots/${moss.id}/steer`, {
    method: "POST",
    headers,
    body: JSON.stringify({ from: lumen.id, content: "hidden-reply-line" }),
  });
  assert.equal(back.status, 202);

  const lumenThread = await fetch(`${state.base}/api/bots/${lumen.id}`, { headers });
  const lumenBody = await lumenThread.json();
  assert.equal(lumenBody.messages.some((item) => item.kind === "pi.peer" && item.text === "hidden-peer-line" && item.fromName === "Moss"), true);
  assert.equal(JSON.stringify(lumenBody.messages).includes("Message from bot"), false);

  const mossThread = await fetch(`${state.base}/api/bots/${moss.id}`, { headers });
  const mossBody = await mossThread.json();
  assert.equal(JSON.stringify(mossBody.messages).includes("visible-user-line"), true);
  assert.equal(mossBody.messages.some((item) => item.kind === "pi.peer" && item.text === "hidden-reply-line"), true);
  assert.equal(mossBody.messages.some((item) => item.kind === "pi.user" && item.text === "hidden-reply-line"), false);

  const lumenPeers = await fetch(`${state.base}/api/bots/${lumen.id}/peers`, { headers });
  assert.equal(lumenPeers.status, 200);
  const lumenPeerBody = await lumenPeers.json();
  assert.equal(lumenPeerBody.peers.some((item) => item.from === moss.id && item.content === "hidden-peer-line" && item.delivery === "steer"), true);
  assert.equal(lumenPeerBody.peers.some((item) => item.from === lumen.id && item.content === "hidden-reply-line"), true);

  const self = await fetch(`${state.base}/api/bots/${lumen.id}/steer`, {
    method: "POST",
    headers,
    body: JSON.stringify({ from: lumen.id, content: "nope" }),
  });
  assert.equal(self.status, 400);

  const missing = await fetch(`${state.base}/api/bots/${lumen.id}/steer`, {
    method: "POST",
    headers,
    body: JSON.stringify({ from: "missing-bot", content: "nope" }),
  });
  assert.equal(missing.status, 404);
});

test("a webhook token delivers a normal message and the cron key is not returned", async () => {
  const headers = {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  };
  const created = await fetch(`${state.base}/api/bots`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Herald" }),
  });
  assert.equal(created.status, 201);
  const bot = await created.json();
  assert.equal(bot.hookToken, undefined);
  assert.equal(JSON.stringify(bot).includes("hookToken"), false);

  const roster = JSON.parse(await readFile(join(state.dir, "bots.json"), "utf8"));
  const stored = roster.bots.find((item) => item.id === bot.id);
  assert.match(stored.hookToken, /^[0-9a-f]{48}$/);

  const cronKey = "cron-key-not-for-the-page-xx";
  const saved = await fetch(`${state.base}/api/cron-key`, {
    method: "POST",
    headers,
    body: JSON.stringify({ apiKey: cronKey }),
  });
  assert.equal(saved.status, 200);
  const savedText = await saved.text();
  assert.equal(savedText.includes(cronKey), false);
  assert.deepEqual(JSON.parse(savedText), { configured: true });
  const file = JSON.parse(await readFile(join(state.dir, "cron.json"), "utf8"));
  assert.equal(file.apiKey, cronKey);

  const wrong = await fetch(`${state.base}/hooks/${cronKey}`, {
    method: "POST",
    headers: { authorization: `Bearer ${cronKey}`, "content-type": "application/json" },
    body: JSON.stringify({ content: "should not run" }),
  });
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), { error: "unauthorized" });

  const fired = await fetch(`${state.base}/hooks/${stored.hookToken}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "Check the status page." }),
  });
  assert.equal(fired.status, 202);
  const thread = await fetch(`${state.base}/api/bots/${bot.id}`, { headers });
  const threadBody = await thread.json();
  assert.equal(threadBody.bot.hookToken, undefined);
  const user = threadBody.messages.find((item) => item.kind === "pi.user" && item.text === "Check the status page.");
  assert.ok(user);
  assert.equal(JSON.stringify(threadBody).includes("pi-orbs-peer-hop"), false);
  assert.equal(JSON.stringify(threadBody).includes(cronKey), false);

  const cleared = await fetch(`${state.base}/api/cron-key`, {
    method: "POST",
    headers,
    body: JSON.stringify({ apiKey: "" }),
  });
  assert.equal(cleared.status, 200);
  assert.deepEqual(await cleared.json(), { configured: false });
  const clearedFile = JSON.parse(await readFile(join(state.dir, "cron.json"), "utf8"));
  assert.equal(clearedFile.apiKey, "");
});

test("a signed MCP event webhook enters the bot conversation", async () => {
  const { createHmac } = await import("node:crypto");
  const headers = { authorization: `Bearer ${secret}`, "content-type": "application/json" };
  const created = await fetch(`${state.base}/api/bots`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Hook" }),
  });
  assert.equal(created.status, 201);
  const bot = await created.json();
  const token = "abc123hooktoken";
  const secretKey = Buffer.alloc(32, 7);
  const whsec = `whsec_${secretKey.toString("base64")}`;
  await writeFile(join(state.dir, "mcp-events.json"), JSON.stringify({
    hooks: [{ token, botId: bot.id, secret: whsec, label: "docs", createdAt: "2026-10-04T00:00:00.000Z", seen: [] }],
  }));
  const challengeBody = JSON.stringify({ type: "verification", challenge: "nonce-1" });
  const stamp = String(Math.floor(Date.now() / 1000));
  function sign(id, body) {
    const mac = createHmac("sha256", secretKey).update(`${id}.${stamp}.${body}`).digest("base64");
    return `v1,${mac}`;
  }
  const challenge = await fetch(`${state.base}/api/mcp-events/${token}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": "msg_verification_1",
      "webhook-timestamp": stamp,
      "webhook-signature": sign("msg_verification_1", challengeBody),
    },
    body: challengeBody,
  });
  assert.equal(challenge.status, 200);
  assert.deepEqual(await challenge.json(), { challenge: "nonce-1" });

  const eventBody = JSON.stringify({
    eventId: "evt_1",
    name: "comment.created",
    timestamp: "2026-10-04T12:00:00Z",
    data: { text: "ship it" },
  });
  const delivered = await fetch(`${state.base}/api/mcp-events/${token}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": "evt_1",
      "webhook-timestamp": stamp,
      "webhook-signature": sign("evt_1", eventBody),
      "x-mcp-subscription-id": "sub_1",
    },
    body: eventBody,
  });
  assert.equal(delivered.status, 200);
  assert.deepEqual(await delivered.json(), { ok: true });

  const thread = await fetch(`${state.base}/api/bots/${bot.id}`, { headers });
  const threadBody = await thread.json();
  assert.equal(threadBody.messages.some((item) => item.kind === "pi.user" && item.text.includes("comment.created") && item.text.includes("ship it")), true);

  const again = await fetch(`${state.base}/api/mcp-events/${token}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": "evt_1",
      "webhook-timestamp": stamp,
      "webhook-signature": sign("evt_1", eventBody),
    },
    body: eventBody,
  });
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { ok: true, duplicate: true });

  const bad = await fetch(`${state.base}/api/mcp-events/${token}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": "evt_2",
      "webhook-timestamp": stamp,
      "webhook-signature": "v1,aaaa",
    },
    body: eventBody,
  });
  assert.equal(bad.status, 401);
});
