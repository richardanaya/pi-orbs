import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { FAKE_CRON_KEY, installSimulatorReset, openRoster, POLL, spriteJson, visibleTextHas } from "./support.js";

installSimulatorReset();

test("schedules can be saved, paused, and deleted without showing the key", async ({ app, screen, browser }) => {
  await openRoster(app, screen);
  await screen.getByRole("button", "Settings").tap();
  await screen.getByLabel("Voice", { visible: true }).selectOption("OpenAI");
  await screen.getByLabel("cron-job.org API key", { visible: true }).fill(FAKE_CRON_KEY);
  await screen.getByRole("button", "Save cron key").tap();
  await expect(screen.getByText("Schedules are on. The key stays on this machine.")).toBeVisible({ timeout: POLL });
  await expect(screen.getByLabel("Voice", { visible: true })).toHaveValue("openai");
  expect(await visibleTextHas(browser, FAKE_CRON_KEY)).toBe(false);
  await screen.getByRole("button", "Close", { visible: true }).tap();

  const base = app.baseUrl ?? "http://127.0.0.1:8787";
  const created = await spriteJson(base, "/api/sprites/atlas/bots/ada/schedules", {
    method: "POST",
    body: JSON.stringify({
      message: "Standup note from the suite",
      cron: "15 9 * * 1",
      timezone: "UTC",
    }),
  });
  expect(created.status).toBe(201);

  await screen.getByRole("button", "Edit Ada").tap();
  await expect(screen.getByText("Standup note from the suite", { exact: false })).toBeVisible({ timeout: POLL });
  await browser.locator("#routines").getByRole("button", "Pause").tap();
  await expect(browser.locator("#routines").getByText("Paused", { exact: false })).toBeVisible({ timeout: POLL });
  await browser.locator("#routines").getByRole("button", "Delete").tap();
  await expect(screen.getByText("No schedules")).toBeVisible({ timeout: POLL });
});

test("a webhook posts into the bot thread and a bad token is refused", async ({ app, screen, browser }) => {
  await openRoster(app, screen);
  const base = app.baseUrl ?? "http://127.0.0.1:8787";
  await spriteJson(base, "/api/sprites/atlas/cron", {
    method: "POST",
    body: JSON.stringify({ cronApiKey: FAKE_CRON_KEY }),
  });

  const created = await spriteJson(base, "/api/sprites/atlas/bots/ada/schedules", {
    method: "POST",
    body: JSON.stringify({ message: "Reminder from the suite", cron: "0 12 * * *", timezone: "UTC" }),
  });
  expect(created.status).toBe(201);
  const hookUrl = created.body && typeof created.body === "object" && "url" in created.body
    ? (created.body as { url?: unknown }).url
    : undefined;
  if (typeof hookUrl !== "string" || !hookUrl.includes("/hooks/")) {
    throw new Error(`schedule did not return a webhook (${created.status})`);
  }

  const rejected = await fetch(new URL("/hooks/not-a-real-token", base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "should not land" }),
  });
  expect(rejected.status).toBe(401);

  const accepted = await fetch(hookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "Webhook ping from the suite" }),
  });
  expect(accepted.status).toBe(202);
  await expect(browser.locator("#log .msg.user").last()).toContainText("Webhook ping from the suite", { timeout: POLL });
});
