import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { installSimulatorReset, openRoster, POLL } from "./support.js";

installSimulatorReset();

test("a bot can save and forget a fact", async ({ app, screen }) => {
  await openRoster(app, screen);
  await screen.getByRole("button", "Edit Ada").tap();
  await expect(screen.getByRole("heading", "Memory")).toBeVisible();

  const fact = `Prefers black status pages ${Date.now().toString().slice(-4)}`;
  await screen.getByLabel("Fact").fill(fact);
  await screen.getByRole("button", "Save memory").tap();
  await expect(screen.getByText(fact)).toBeVisible({ timeout: POLL });

  await screen.getByRole("button", "Forget").tap();
  await expect(screen.getByText(fact)).toBeHidden({ timeout: POLL });
});
