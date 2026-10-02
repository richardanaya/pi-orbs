import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { conversationsArchive } from "../dist/archive.js";
import { handleLocal } from "../dist/local.js";

const exec = promisify(execFile);

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

async function unzip(bytes) {
  const dir = await mkdtemp(join(tmpdir(), "pi-orbs-zip-"));
  const file = join(dir, "conversations.zip");
  try {
    await writeFile(file, Buffer.from(bytes));
    const { stdout } = await exec("python3", ["-c", `
import json, sys, zipfile
archive = zipfile.ZipFile(sys.argv[1])
bad = archive.testzip()
if bad:
    raise SystemExit("bad zip member " + bad)
print(json.dumps({name: archive.read(name).decode("utf-8") for name in archive.namelist()}))
`, file], { maxBuffer: 8_000_000 });
    return JSON.parse(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

test("settings offers a zip of every conversation", async () => {
  const html = await readFile(join(clientRoot, "public", "index.html"), "utf8");
  const settingsStart = html.indexOf('<div id="settings">');
  const settingsEnd = html.indexOf("</div>", html.indexOf('id="destroy"'));
  const settings = html.slice(settingsStart, settingsEnd);
  assert.match(settings, /id="export"/);
  assert.match(settings, /Download all conversations/);
  assert.match(settings, /JSON transcripts with id, name, and timestamps/);
  assert.match(html, /conversations\.zip/);
  assert.match(html, /Preparing…/);
  assert.doesNotMatch(html, /location\s*=/);

  const main = await readFile(join(clientRoot, "src", "main.ts"), "utf8");
  assert.match(main, /conversations\\\.zip/);
  assert.match(main, /spriteFetch\(saved, "\/api\/export"\)/);
  assert.match(main, /conversationsArchive\(snapshot, \[/);
  assert.match(main, /saved\.secret/);
  assert.match(main, /saved\.apiKey \?\? ""/);
  assert.match(main, /saved\.connectorId \?\? ""/);
});

test("an empty roster is a zip that says there are no conversations", async () => {
  const archive = conversationsArchive({
    sprite: "atlas",
    exportedAt: "2026-03-02T15:04:00.000Z",
    bots: [],
  });
  assert.equal(archive.filename, "pi-orbs-atlas-conversations-2026-03-02.zip");
  const files = await unzip(archive.zip);
  assert.match(files["README.txt"], /no conversations/);
  const manifest = JSON.parse(files["manifest.json"]);
  assert.equal(manifest.format, "pi-orbs-conversations");
  assert.equal(manifest.formatVersion, 1);
  assert.deepEqual(manifest.bots, []);
  assert.match(manifest.note, /no conversations/);
  assert.equal(Object.keys(files).some((name) => name.startsWith("bots/")), false);
});

test("the zip redacts api keys and connector secrets from transcript text", async () => {
  const secret = "pi-orbs-test-secret";
  const archive = conversationsArchive({
    sprite: "atlas",
    exportedAt: "2026-03-02T15:04:00.000Z",
    bots: [{
      id: "ada",
      name: "Ada",
      conversationId: "ada",
      instruction: `keep ${secret} private`,
      look: "tide",
      messages: [{
        id: "m1",
        kind: "pi.user",
        text: `token ${secret} end`,
        createdAt: "2026-03-02T15:04:00.000Z",
      }],
    }],
  }, [secret, "https://api.sprites.dev/v1/gateway/custom_api/conn-12345678"]);
  const files = await unzip(archive.zip);
  const packed = JSON.stringify(files);
  assert.equal(packed.includes(secret), false);
  assert.equal(packed.includes("conn-12345678"), false);
  const bot = JSON.parse(files["bots/ada.json"]);
  assert.equal(bot.instruction, "keep [redacted] private");
  assert.equal(bot.messages[0].text, "token [redacted] end");
  assert.equal(bot.id, "ada");
  assert.equal(bot.name, "Ada");
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

  test("GET conversations.zip packs the seeded transcripts", async () => {
    const missing = await fetch(`${session.base}/api/sprites/other/conversations.zip`);
    assert.equal(missing.status, 404);

    const response = await fetch(`${session.base}/api/sprites/atlas/conversations.zip`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/zip/);
    assert.match(response.headers.get("content-disposition") ?? "", /pi-orbs-atlas-conversations-/);
    const files = await unzip(await response.arrayBuffer());
    assert.match(files["README.txt"], /pi-orbs-conversations version 1/);
    const manifest = JSON.parse(files["manifest.json"]);
    assert.equal(manifest.format, "pi-orbs-conversations");
    assert.equal(manifest.sprite, "atlas");
    assert.deepEqual(manifest.bots.map((bot) => bot.id), ["ada", "kepler", "nova"]);
    const ada = JSON.parse(files["bots/ada.json"]);
    assert.equal(ada.name, "Ada");
    assert.equal(ada.conversationId, "ada");
    assert.equal(ada.look, "tide");
    assert.match(ada.instruction, /status pages/);
    assert.equal(ada.messages.length, 4);
    assert.equal(ada.messages[0].kind, "pi.user");
    assert.match(ada.messages[0].text, /status page/);
    assert.equal(ada.messages[0].createdAt, "2026-03-02T15:04:00.000Z");
    assert.ok(Date.parse(ada.messages.at(-1).createdAt) > Date.parse(ada.messages[0].createdAt));
    const kepler = JSON.parse(files["bots/kepler.json"]);
    assert.equal(kepler.name, "Kepler");
    assert.match(kepler.messages[0].text, /other bots/);
    const nova = JSON.parse(files["bots/nova.json"]);
    assert.equal(nova.name, "Nova");
    const packed = JSON.stringify(files);
    for (const hidden of ["apiKey", "xaiKey", "connectorId", "PI_API_SECRET", "XAI_API_KEY", "OPENAI_API_KEY"]) {
      assert.equal(packed.includes(hidden), false, hidden);
    }
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

    const missing = await fetch(`${session.base}/api/sprites/atlas/conversations.zip`);
    assert.equal(missing.status, 404);
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

    const exported = await fetch(`${session.base}/api/sprites/atlas/conversations.zip`);
    assert.equal(exported.status, 200);
    const files = await unzip(await exported.arrayBuffer());
    const packed = JSON.stringify(files);
    assert.equal(packed.includes("local-simulator-test"), false);
    assert.match(JSON.parse(files["bots/ada.json"]).messages[0].text, /status page/);
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

  test("two bots exchange steered messages outside the open thread", async () => {
    const seeded = await fetch(`${session.base}/api/sprites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "atlas", apiKey: "local-simulator-test" }),
    });
    assert.equal(seeded.status, 201);

    async function thread(id) {
      const response = await fetch(`${session.base}/api/sprites/atlas/bots/${id}`);
      assert.equal(response.status, 200);
      return response.json();
    }
    const adaBefore = await thread("ada");
    const keplerBefore = await thread("kepler");

    const toKepler = await fetch(`${session.base}/api/sprites/atlas/bots/kepler/steer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "ada", content: "token-ada-to-kepler" }),
    });
    assert.equal(toKepler.status, 202);
    const steerBody = await toKepler.json();
    assert.equal(steerBody.from, "ada");
    assert.equal(steerBody.to, "kepler");
    assert.equal(steerBody.fromName, "Ada");
    assert.equal(steerBody.toName, "Kepler");
    assert.equal(steerBody.content, "token-ada-to-kepler");
    assert.equal(steerBody.delivery, "steer");
    assert.match(steerBody.submissionId, /^local-peer-/);

    const toAda = await fetch(`${session.base}/api/sprites/atlas/bots/ada/steer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "kepler", content: "token-kepler-to-ada" }),
    });
    assert.equal(toAda.status, 202);

    const adaAfter = await thread("ada");
    const keplerAfter = await thread("kepler");
    assert.deepEqual(adaAfter.messages, adaBefore.messages);
    assert.deepEqual(keplerAfter.messages, keplerBefore.messages);
    assert.equal(JSON.stringify(adaAfter.messages).includes("token-ada-to-kepler"), false);
    assert.equal(JSON.stringify(keplerAfter.messages).includes("token-kepler-to-ada"), false);

    const adaPeers = await fetch(`${session.base}/api/sprites/atlas/bots/ada/peers`);
    const keplerPeers = await fetch(`${session.base}/api/sprites/atlas/bots/kepler/peers`);
    assert.equal(adaPeers.status, 200);
    assert.equal(keplerPeers.status, 200);
    const adaList = (await adaPeers.json()).peers;
    const keplerList = (await keplerPeers.json()).peers;
    assert.deepEqual(adaList.map((item) => item.content), ["token-ada-to-kepler", "token-kepler-to-ada"]);
    assert.deepEqual(keplerList.map((item) => item.content), ["token-ada-to-kepler", "token-kepler-to-ada"]);
    assert.equal(adaList.every((item) => item.delivery === "steer"), true);

    const noted = await fetch(`${session.base}/api/sprites/atlas/bots/ada/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "still a human message" }),
    });
    assert.equal(noted.status, 202);
    const adaHuman = await thread("ada");
    assert.equal(adaHuman.messages.at(-2).text, "still a human message");
    assert.equal(adaHuman.messages.some((item) => item.text === "token-kepler-to-ada"), false);

    const self = await fetch(`${session.base}/api/sprites/atlas/bots/ada/steer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "ada", content: "nope" }),
    });
    assert.equal(self.status, 400);
    const missing = await fetch(`${session.base}/api/sprites/atlas/bots/ada/steer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "missing", content: "nope" }),
    });
    assert.equal(missing.status, 404);
    const empty = await fetch(`${session.base}/api/sprites/atlas/bots/kepler/steer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "ada", content: "   " }),
    });
    assert.equal(empty.status, 400);
  });
});

test("the open thread does not treat peer traffic as user messages", async () => {
  const html = await readFile(join(clientRoot, "public", "index.html"), "utf8");
  assert.match(html, /function visibleThreadMessages/);
  assert.match(html, /message\.peer !== true && message\.source !== "peer"/);
  assert.match(html, /signature === threadView && log\.childElementCount > 0\) return/);
});
