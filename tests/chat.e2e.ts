import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { installSimulatorReset, openRoster, POLL } from "./support.js";

installSimulatorReset();

test("sending a message shows the seeded thread and a canned reply", async ({ app, screen, browser }) => {
  await openRoster(app, screen);
  await expect(screen.getByText("status.html is in the work directory", { exact: false })).toBeVisible();

  const note = `e2e ping ${Date.now()}`;
  await screen.getByLabel("Message").fill(note);
  await screen.getByRole("button", "Send").tap();

  // The canned reply quotes the note, so a page-wide text query matches twice.
  await expect(browser.locator("#log .msg.user").last()).toContainText(note, { timeout: POLL });
  await expect(browser.locator("#log .msg.bot").last()).toContainText("canned reply from the local simulator", { timeout: POLL });
});
