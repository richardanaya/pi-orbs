import { createHmac } from "node:crypto";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { installSimulatorReset, openRoster, POLL, spriteJson, visibleTextHas } from "./support.js";

installSimulatorReset();

function sign(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const mac = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${mac}`;
}

test("a bot's configure dialog lists and disconnects its MCP event webhook", async ({ app, screen, browser }) => {
  await openRoster(app, screen);
  const base = app.baseUrl ?? "http://127.0.0.1:8787";
  const created = await spriteJson(base, "/api/sprites/atlas/bots/ada/mcp-events", {
    method: "POST",
    body: JSON.stringify({ label: "Docs events" }),
  });
  expect(created.status).toBe(201);
  const hook = created.body && typeof created.body === "object" ? created.body as { url?: unknown; secret?: unknown; id?: unknown } : {};
  if (typeof hook.url !== "string" || typeof hook.secret !== "string" || typeof hook.id !== "string") {
    throw new Error(`webhook was not minted (${created.status})`);
  }
  const token = hook.url.split("/").at(-1) ?? "";
  const stamp = String(Math.floor(Date.now() / 1000));
  const before = JSON.stringify({ eventId: "evt_ui_before", name: "docs.updated", data: { text: "visible before disconnect" } });
  const delivered = await fetch(hook.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": "evt_ui_before",
      "webhook-timestamp": stamp,
      "webhook-signature": sign(hook.secret, "evt_ui_before", stamp, before),
    },
    body: before,
  });
  expect(delivered.status).toBe(200);

  await screen.getByRole("button", "Edit Kepler").tap();
  await expect(screen.getByText("No MCP event webhooks")).toBeVisible({ timeout: POLL });
  expect(await visibleTextHas(browser, "Docs events")).toBe(false);
  await screen.getByRole("button", "Cancel").tap();

  await screen.getByRole("button", "Edit Ada").tap();
  await expect(screen.getByText("Docs events")).toBeVisible({ timeout: POLL });
  await expect(screen.getByText("into this bot", { exact: false })).toBeVisible();
  expect(await visibleTextHas(browser, hook.secret)).toBe(false);
  expect(await visibleTextHas(browser, token)).toBe(false);
  await browser.locator("#bot-dialog #mcp-events").getByRole("button", "Disconnect").tap();
  await expect(screen.getByText("No MCP event webhooks")).toBeVisible({ timeout: POLL });

  const after = JSON.stringify({ eventId: "evt_ui_after", name: "docs.updated", data: { text: "hidden after disconnect" } });
  const blocked = await fetch(hook.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": "evt_ui_after",
      "webhook-timestamp": stamp,
      "webhook-signature": sign(hook.secret, "evt_ui_after", stamp, after),
    },
    body: after,
  });
  expect(blocked.status).toBe(404);
  const thread = await spriteJson(base, "/api/sprites/atlas/bots/ada");
  const packed = JSON.stringify(thread.body);
  expect(packed.includes("visible before disconnect")).toBe(true);
  expect(packed.includes("hidden after disconnect")).toBe(false);
  expect(packed.includes(hook.secret)).toBe(false);
  expect(packed.includes(token)).toBe(false);
});
