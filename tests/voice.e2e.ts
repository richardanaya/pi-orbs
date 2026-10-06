import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { FAKE_VOICE_KEY, installSimulatorReset, openRoster, POLL, visibleTextHas } from "./support.js";

installSimulatorReset();

// The local simulator has no microphone and does not call Grok or OpenAI.
// A hardware mic call is not part of this suite.
test("local voice can take a typed line and stop", async ({ app, screen, browser }) => {
  await openRoster(app, screen);
  await screen.getByRole("button", "Settings").tap();
  await screen.getByLabel("Voice", { visible: true }).selectOption("Grok");
  await screen.getByLabel("Voice API key", { visible: true }).fill(FAKE_VOICE_KEY);
  await screen.getByRole("button", "Save voice").tap();
  await expect(screen.getByText("Voice is on (Grok). The key stays on this machine.")).toBeVisible({ timeout: POLL });
  expect(await visibleTextHas(browser, FAKE_VOICE_KEY)).toBe(false);
  await screen.getByRole("button", "Close", { visible: true }).tap();

  await expect(screen.getByRole("button", "Start voice")).toBeVisible();
  await screen.getByRole("button", "Start voice").tap();
  await expect(screen.getByText("Local call. No microphone.", { exact: false })).toBeVisible({ timeout: POLL });
  await expect(screen.getByText("search this chat", { exact: false })).toBeVisible();

  await screen.getByLabel("Say").fill("Status page is black");
  await screen.getByRole("button", "Say").tap();
  await expect(screen.getByText("You: Status page is black", { exact: false })).toBeVisible({ timeout: POLL });

  await screen.getByRole("button", "Stop").tap();
  await expect(screen.getByText("Local call. No microphone.", { exact: false })).toBeHidden({ timeout: POLL });
});
