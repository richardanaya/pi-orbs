import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMcpHook, receiveMcpWebhook, signWebhook } from "../dist/mcp-events.js";

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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
