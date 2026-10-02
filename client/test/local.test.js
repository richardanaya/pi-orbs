import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { handleLocal } from "../dist/local.js";

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(clientRoot, "..");
const statePath = join(homedir(), ".pi-orbs", "state.json");
const version = (await readFile(join(repoRoot, "server", "VERSION"), "utf8")).trim();

delete process.env.XAI_API_KEY;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
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

async function stateDigest() {
  try {
    const bytes = await readFile(statePath);
    return createHash("sha256").update(bytes).digest("hex");
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

const session = { base: "", server: /** @type {import("node:http").Server | null} */ (null), state: /** @type {string | null} */ (null) };

before(async () => {
  session.state = await stateDigest();
  const port = await freePort();
  session.server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    handleLocal(url, req, res).catch((error) => {
      if (res.headersSent) return;
      const message = error instanceof Error ? error.message : "error";
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    });
  });
  await new Promise((resolve) => session.server.listen(port, "127.0.0.1", resolve));
  session.base = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (session.server) {
    session.server.closeIdleConnections?.();
    session.server.closeAllConnections?.();
    await new Promise((resolve, reject) => {
      session.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  assert.equal(await stateDigest(), session.state);
});

test("the badge is hidden unless GET /api/sprites says simulator", async () => {
  const html = await readFile(join(clientRoot, "public", "index.html"), "utf8");
  const badge = html.indexOf('id="local-badge"');
  const setup = html.indexOf('id="setup"');
  const settings = html.indexOf('id="settings"');
  assert.ok(badge > 0);
  assert.ok(setup > badge);
  assert.ok(settings > setup);
  assert.match(html, />Local simulator<\/p>/);
  assert.match(html, /#local-badge \{\s*display:\s*none/);
  assert.match(html, /body\.simulator #local-badge \{\s*display:\s*block/);
  assert.match(html, /setSimulator\(body\.simulator === true\)/);

  const main = await readFile(join(clientRoot, "src", "main.ts"), "utf8");
  assert.doesNotMatch(main, /simulator:\s*true/);
});

describe("local simulator API", { concurrency: 1 }, () => {
  test("GET /api/sprites returns the seeded sprite and localVersion", async () => {
    const response = await fetch(`${session.base}/api/sprites`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      localVersion: version,
      simulator: true,
      sprite: {
        name: "atlas",
        url: "http://127.0.0.1:8787",
        remoteVersion: version,
        update: false,
        connectorType: "xai",
        baseApiUrl: "https://api.x.ai/v1",
        model: "grok-4.7",
      },
    });
  });

  test("GET /api/sprites/:name returns Ada, Kepler, and Nova", async () => {
    const response = await fetch(`${session.base}/api/sprites/atlas`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.bots.map((bot) => ({ id: bot.id, name: bot.name })), [
      { id: "ada", name: "Ada" },
      { id: "kepler", name: "Kepler" },
      { id: "nova", name: "Nova" },
    ]);
  });

  test("GET /api/sprites/:name/bots/:id returns seeded messages", async () => {
    const response = await fetch(`${session.base}/api/sprites/atlas/bots/ada`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.bot.id, "ada");
    assert.equal(body.bot.name, "Ada");
    assert.equal(body.messages.length, 4);
    assert.deepEqual(body.messages.map((message) => message.kind), ["pi.user", "pi.assistant", "pi.user", "pi.assistant"]);
    assert.match(body.messages[0].text, /status page/);
    assert.match(body.messages.at(-1).text, /status\.html/);
  });

  test("POST messages appends a user message and a canned assistant reply", async () => {
    const content = "Hello from the simulator test";
    const posted = await fetch(`${session.base}/api/sprites/atlas/bots/ada/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    assert.equal(posted.status, 202);
    const accepted = await posted.json();
    assert.equal(typeof accepted.submissionId, "string");
    assert.match(accepted.submissionId, /^local-/);
    assert.equal(accepted.model, undefined);

    const thread = await fetch(`${session.base}/api/sprites/atlas/bots/ada`);
    assert.equal(thread.status, 200);
    const body = await thread.json();
    const added = body.messages.slice(-2);
    assert.equal(added[0].kind, "pi.user");
    assert.equal(added[0].text, content);
    assert.deepEqual(Object.keys(added[1]).sort(), ["id", "kind", "text"]);
    assert.equal(added[1].kind, "pi.assistant");
    assert.equal(
      added[1].text,
      `“${content}” — noted. This is a canned reply from the local simulator. No model was called.`,
    );
  });

  test("POST bots creates a bot", async () => {
    const created = await fetch(`${session.base}/api/sprites/atlas/bots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Scribe" }),
    });
    assert.equal(created.status, 201);
    const bot = await created.json();
    assert.equal(bot.name, "Scribe");
    assert.equal(typeof bot.id, "string");
    assert.match(bot.id, /^bot-/);
    assert.equal(bot.conversationId, bot.id);

    const listed = await fetch(`${session.base}/api/sprites/atlas`);
    assert.equal(listed.status, 200);
    const body = await listed.json();
    assert.ok(body.bots.some((item) => item.id === bot.id && item.name === "Scribe"));
  });

  test("POST deploy and DELETE succeed without writing state.json", async () => {
    const beforeDigest = await stateDigest();
    assert.equal(beforeDigest, session.state);

    const deployed = await fetch(`${session.base}/api/sprites/atlas/deploy`, { method: "POST" });
    assert.equal(deployed.status, 200);
    assert.deepEqual(await deployed.json(), { ok: true, version });
    assert.equal(await stateDigest(), beforeDigest);

    const destroyed = await fetch(`${session.base}/api/sprites/atlas`, { method: "DELETE" });
    assert.equal(destroyed.status, 200);
    assert.deepEqual(await destroyed.json(), { ok: true });
    assert.equal(await stateDigest(), beforeDigest);
  });

  test("after destroy GET /api/sprites has sprite null and POST reseeds", async () => {
    const gone = await fetch(`${session.base}/api/sprites`);
    assert.equal(gone.status, 200);
    const empty = await gone.json();
    assert.equal(empty.sprite, null);
    assert.equal(empty.simulator, true);
    assert.equal(empty.localVersion, version);

    const created = await fetch(`${session.base}/api/sprites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "atlas", xaiKey: "local-simulator-test" }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.name, "atlas");
    assert.equal(createdBody.url, "http://127.0.0.1:8787");
    assert.equal(createdBody.remoteVersion, version);
    assert.equal(await stateDigest(), session.state);

    const home = await fetch(`${session.base}/api/sprites`);
    assert.equal(home.status, 200);
    const homeBody = await home.json();
    assert.equal(homeBody.sprite.name, "atlas");
    assert.equal(homeBody.simulator, true);

    const roster = await fetch(`${session.base}/api/sprites/atlas`);
    assert.equal(roster.status, 200);
    const rosterBody = await roster.json();
    assert.deepEqual(rosterBody.bots.map((bot) => bot.name), ["Ada", "Kepler", "Nova"]);

    const thread = await fetch(`${session.base}/api/sprites/atlas/bots/ada`);
    assert.equal(thread.status, 200);
    const threadBody = await thread.json();
    assert.equal(threadBody.messages.length, 4);
    assert.match(threadBody.messages[0].text, /status page/);
  });

  test("connector presets and setup choose one shared model", async () => {
    const presets = await fetch(`${session.base}/api/connector-presets`);
    assert.equal(presets.status, 200);
    const catalog = await presets.json();
    const ids = catalog.connectors.map((item) => item.id);
    assert.deepEqual(ids, ["xai", "openai", "openrouter", "groq", "together", "deepseek", "mistral", "fireworks", "custom"]);
    const xai = catalog.connectors.find((item) => item.id === "xai");
    assert.equal(xai.baseApiUrl, "https://api.x.ai/v1");
    assert.equal(xai.model, "grok-4.7");
    assert.equal(JSON.stringify(catalog).includes("sk-"), false);

    const created = await fetch(`${session.base}/api/sprites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "atlas",
        apiKey: "local-simulator-test",
        connectorType: "openai",
        baseApiUrl: "https://evil.example/v1",
        model: "gpt-4o-mini",
      }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.connectorType, "openai");
    assert.equal(createdBody.baseApiUrl, "https://api.openai.com/v1");
    assert.equal(createdBody.model, "gpt-4o-mini");
    assert.equal(createdBody.apiKey, undefined);
    assert.equal(createdBody.xaiKey, undefined);

    const home = await fetch(`${session.base}/api/sprites`);
    const homeBody = await home.json();
    assert.equal(homeBody.sprite.connectorType, "openai");
    assert.equal(homeBody.sprite.model, "gpt-4o-mini");
    assert.equal(homeBody.sprite.apiKey, undefined);

    const custom = await fetch(`${session.base}/api/sprites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "atlas", apiKey: "local-simulator-test", connectorType: "custom", model: "my-model" }),
    });
    assert.equal(custom.status, 400);

    const switched = await fetch(`${session.base}/api/sprites/atlas/deploy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectorType: "groq", baseApiUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" }),
    });
    assert.equal(switched.status, 400);

    const renamed = await fetch(`${session.base}/api/sprites/atlas/deploy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectorType: "openai", model: "gpt-4o" }),
    });
    assert.equal(renamed.status, 200);
    const after = await fetch(`${session.base}/api/sprites`);
    const afterBody = await after.json();
    assert.equal(afterBody.sprite.connectorType, "openai");
    assert.equal(afterBody.sprite.model, "gpt-4o");
    assert.equal(afterBody.sprite.baseApiUrl, "https://api.openai.com/v1");
  });

  test("bots accept instruction and look on create and edit", async () => {
    const roster = await fetch(`${session.base}/api/sprites/atlas`);
    const seeded = await roster.json();
    assert.deepEqual(seeded.bots.map((bot) => bot.look), ["tide", "pine", "amber"]);
    assert.equal(seeded.bots[0].instruction, "Sketch status pages on a black background.");
    assert.equal(new Set(seeded.bots.map((bot) => bot.look)).size, 3);

    const created = await fetch(`${session.base}/api/sprites/atlas/bots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Scribe", instruction: "  Write commit messages.  ", look: "plum" }),
    });
    assert.equal(created.status, 201);
    const bot = await created.json();
    assert.equal(bot.name, "Scribe");
    assert.equal(bot.instruction, "Write commit messages.");
    assert.equal(bot.look, "plum");
    assert.equal(bot.conversationId, bot.id);

    const unnamed = await fetch(`${session.base}/api/sprites/atlas/bots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: "no name" }),
    });
    assert.equal(unnamed.status, 400);

    const badLook = await fetch(`${session.base}/api/sprites/atlas/bots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope", look: "rainbow" }),
    });
    assert.equal(badLook.status, 400);

    const defaults = await fetch(`${session.base}/api/sprites/atlas/bots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Quill" }),
    });
    assert.equal(defaults.status, 201);
    const plain = await defaults.json();
    assert.equal(plain.instruction, "");
    assert.equal(plain.look, "slate");

    const patched = await fetch(`${session.base}/api/sprites/atlas/bots/${bot.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Scribe 2", instruction: "", look: "mist" }),
    });
    assert.equal(patched.status, 200);
    const updated = await patched.json();
    assert.equal(updated.name, "Scribe 2");
    assert.equal(updated.instruction, "");
    assert.equal(updated.look, "mist");

    const thread = await fetch(`${session.base}/api/sprites/atlas/bots/${bot.id}`);
    const threadBody = await thread.json();
    assert.equal(threadBody.bot.name, "Scribe 2");
    assert.equal(threadBody.bot.look, "mist");
    assert.equal(threadBody.bot.instruction, "");

    const rejected = await fetch(`${session.base}/api/sprites/atlas/bots/${bot.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ look: "nope" }),
    });
    assert.equal(rejected.status, 400);
    const unchanged = await fetch(`${session.base}/api/sprites/atlas/bots/${bot.id}`);
    assert.equal((await unchanged.json()).bot.look, "mist");
  });
});
