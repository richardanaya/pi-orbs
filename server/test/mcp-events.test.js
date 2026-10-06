import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMcpHook, disconnectMcpHook, listMcpHooks, receiveMcpWebhook, signWebhook } from "../dist/mcp-events.js";

test("create_mcp_event_webhook material is a public url and a whsec_ secret", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-orbs-hooks-"));
  try {
    const path = join(dir, "mcp-events.json");
    const missing = await createMcpHook(path, "bot-1", "", "docs");
    assert.equal(missing.error, "PI_PUBLIC_URL is not set, so this bot cannot mint a callback URL");
    const created = await createMcpHook(path, "bot-1", "https://sprite.example/", " docs ");
    assert.equal(created.label, "docs");
    assert.match(created.url, /^https:\/\/sprite\.example\/api\/mcp-events\/[a-f0-9]{48}$/);
    assert.match(created.secret, /^whsec_/);
    const token = created.url.split("/").at(-1);
    const body = JSON.stringify({ type: "verification", challenge: "abc" });
    const stamp = "1700000000";
    const signature = signWebhook(created.secret, "msg_1", stamp, body);
    const ok = await receiveMcpWebhook(path, token, body, {
      "webhook-id": "msg_1",
      "webhook-timestamp": stamp,
      "webhook-signature": signature,
    }, 1700000000);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { challenge: "abc" });
    const stale = await receiveMcpWebhook(path, token, body, {
      "webhook-id": "msg_1",
      "webhook-timestamp": stamp,
      "webhook-signature": signature,
    }, 1700000000 + 301);
    assert.equal(stale.status, 401);

    const listed = await listMcpHooks(path, "bot-1");
    assert.equal(listed.length, 1);
    assert.equal(Object.hasOwn(listed[0], "secret"), false);
    assert.equal(Object.hasOwn(listed[0], "token"), false);
    const packed = JSON.stringify(listed);
    if (packed.includes(created.secret) || packed.includes(token) || packed.includes("whsec_")) {
      throw new Error("mcp event list leaked a webhook secret or token");
    }
    assert.match(listed[0].endpoint, /^\/api\/mcp-events\/[a-f0-9]{4}…[a-f0-9]{4}$/);
    const removed = await disconnectMcpHook(path, "bot-1", listed[0].id);
    assert.deepEqual(removed, { ok: true });
    const after = await receiveMcpWebhook(path, token, body, {
      "webhook-id": "msg_1",
      "webhook-timestamp": stamp,
      "webhook-signature": signature,
    }, 1700000000);
    assert.equal(after.status, 404);
    assert.equal(after.deliver, undefined);
    const again = await disconnectMcpHook(path, "bot-1", listed[0].id);
    assert.equal(again.error, "webhook not found");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a hook with no seen list still verifies, and disconnect leaves other bots alone", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-orbs-hooks-"));
  try {
    const path = join(dir, "mcp-events.json");
    const first = await createMcpHook(path, "bot-1", "https://sprite.example", "docs");
    const second = await createMcpHook(path, "bot-2", "https://sprite.example", "other");
    const token = first.url.split("/").at(-1);
    const raw = JSON.parse(await readFile(path, "utf8"));
    delete raw.hooks[0].seen;
    await writeFile(path, JSON.stringify(raw));
    const body = JSON.stringify({ type: "verification", challenge: "z" });
    const stamp = "1700000000";
    const signature = signWebhook(first.secret, "msg_z", stamp, body);
    const ok = await receiveMcpWebhook(path, token, body, {
      "webhook-id": "msg_z",
      "webhook-timestamp": stamp,
      "webhook-signature": signature,
    }, 1700000000);
    assert.equal(ok.status, 200);
    const listed = await listMcpHooks(path, "bot-1");
    await disconnectMcpHook(path, "bot-1", listed[0].id);
    const other = await listMcpHooks(path, "bot-2");
    assert.equal(other.length, 1);
    assert.equal(other[0].label, "other");
    const still = await receiveMcpWebhook(path, second.url.split("/").at(-1), body, {
      "webhook-id": "msg_z",
      "webhook-timestamp": stamp,
      "webhook-signature": signWebhook(second.secret, "msg_z", stamp, body),
    }, 1700000000);
    assert.equal(still.status, 200);
    const gone = await receiveMcpWebhook(path, token, body, {
      "webhook-id": "msg_z",
      "webhook-timestamp": stamp,
      "webhook-signature": signature,
    }, 1700000000);
    assert.equal(gone.status, 404);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
