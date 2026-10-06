import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { installSimulatorReset, openRoster, POLL, spriteJson } from "./support.js";

installSimulatorReset();

test("a running tool shows a working line", async ({ app, screen }) => {
  await openRoster(app, screen);
  const base = app.baseUrl ?? "http://127.0.0.1:8787";
  const posted = await spriteJson(base, "/api/sprites/atlas/bots/ada/work", {
    method: "POST",
    body: JSON.stringify({ tool: "read", detail: "status.html" }),
  });
  expect(posted.status).toBe(200);

  await expect(screen.getByText("working on reading status.html")).toBeVisible({ timeout: POLL });
  await expect(screen.getByRole("button", "Ada, working")).toBeVisible({ timeout: POLL });
});

test("a question card can be answered from the thread", async ({ app, screen, browser }) => {
  await openRoster(app, screen);
  const base = app.baseUrl ?? "http://127.0.0.1:8787";
  const posted = await spriteJson(base, "/api/sprites/atlas/bots/ada/questions", {
    method: "POST",
    body: JSON.stringify({
      prompt: "Which orb should the status page use?",
      options: ["Tide", "Pine"],
    }),
  });
  expect(posted.status).toBe(201);

  await expect(screen.getByText("Which orb should the status page use?")).toBeVisible({ timeout: POLL });
  await screen.getByRole("checkbox", "Pine").check();
  await screen.getByRole("button", "Submit").tap();
  await expect(browser.locator("#log .msg.user").last()).toContainText("Selected: Pine", { timeout: POLL });
});
