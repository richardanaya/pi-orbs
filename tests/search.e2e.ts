import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { installSimulatorReset, openRoster, POLL } from "./support.js";

installSimulatorReset();

test("search finds a bot, a setting, and a quoted message", async ({ app, screen }) => {
  await openRoster(app, screen);
  await screen.getByRole("button", "Search").tap();
  await expect(screen.getByRole("dialog", "Search")).toBeVisible();

  const field = screen.getByLabel("Search bots, settings, and messages");
  await field.pressSequentially("Kepler");
  await expect(screen.getByRole("option", /^Kepler\b/)).toBeVisible({ timeout: POLL });

  await field.fill("");
  await field.pressSequentially("Voice");
  await expect(screen.getByRole("option", /^Voice\b/)).toBeVisible({ timeout: POLL });

  await field.fill("");
  await field.pressSequentially('"status.html"');
  await expect(screen.getByRole("option", /status\.html/)).toBeVisible({ timeout: POLL });
  await screen.getByRole("option", /status\.html/).tap();
  await expect(screen.getByRole("dialog", "Search")).toBeHidden({ timeout: POLL });
  await expect(screen.getByText("status.html is in the work directory", { exact: false, visible: true })).toBeVisible();
});

test("the agent opens Search", { tags: ["agent"] }, async ({ app, agent, screen }) => {
  await openRoster(app, screen);
  await agent.act("open Search");
  await expect(screen.getByRole("dialog", "Search")).toBeVisible();
  await expect(screen.getByLabel("Search bots, settings, and messages")).toBeVisible();
});
