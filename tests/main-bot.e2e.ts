import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { installSimulatorReset, openRoster, POLL } from "./support.js";

installSimulatorReset();

test("Ada can be the Main Bot and check in", async ({ app, screen, browser }) => {
  await openRoster(app, screen);
  await screen.getByRole("button", "Edit Ada").tap();
  await screen.getByRole("button", "Make primary").tap();
  await expect(screen.getByRole("button", "Primary")).toBeVisible({ timeout: POLL });
  await expect(screen.getByRole("button", "Check in")).toBeVisible();

  await screen.getByRole("button", "Check in").tap();
  await expect(browser.locator("#log .msg.user").last()).toContainText("Call steer_peer in this turn", { timeout: POLL });
  await screen.getByRole("button", "Cancel").tap();

  await expect(screen.getByRole("button", "Message to Kepler")).toBeVisible({ timeout: POLL });
  await screen.getByRole("button", "Message to Kepler").tap();
  await expect(screen.getByText("Main Bot check-in. Continue your current work", { exact: false })).toBeVisible();
});
