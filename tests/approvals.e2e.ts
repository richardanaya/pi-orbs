import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { installSimulatorReset, openRoster, POLL, spriteJson } from "./support.js";

installSimulatorReset();

async function review(base: string, command: string): Promise<{ status: number; body: unknown }> {
  return spriteJson(base, "/api/sprites/atlas/bots/ada/actions", {
    method: "POST",
    body: JSON.stringify({ command }),
  });
}

test("an approval card can allow a command once", async ({ app, screen, browser }) => {
  await openRoster(app, screen);
  const base = app.baseUrl ?? "http://127.0.0.1:8787";
  const pending = await review(base, "ls /home/sprite/work");
  expect(pending.status).toBe(202);

  await expect(screen.getByRole("heading", "Review an action · Shell")).toBeVisible({ timeout: POLL });
  await expect(screen.getByText("ls /home/sprite/work")).toBeVisible();
  await screen.getByRole("button", "Allow once").tap();

  await expect(screen.getByRole("heading", "Review an action · Shell")).toBeHidden({ timeout: POLL });
  await expect(browser.locator("#log .msg.user").last()).toContainText("allowed the pending shell action once", { timeout: POLL });

  const again = await review(base, "ls /home/sprite/work");
  expect(again.status).toBe(200);
  const decision = again.body && typeof again.body === "object" && "decision" in again.body
    ? (again.body as { decision?: unknown }).decision
    : undefined;
  expect(decision).toBe("allow");
});

test("always allow covers the next command in that class", async ({ app, screen }) => {
  await openRoster(app, screen);
  const base = app.baseUrl ?? "http://127.0.0.1:8787";
  const pending = await review(base, "curl https://example.test/health");
  expect(pending.status).toBe(202);

  await expect(screen.getByRole("heading", "Review an action · Network")).toBeVisible({ timeout: POLL });
  await screen.getByRole("button", "Always allow").tap();
  await expect(screen.getByRole("heading", "Review an action · Network")).toBeHidden({ timeout: POLL });

  const next = await review(base, "curl https://example.test/ready");
  expect(next.status).toBe(200);
});

test("deny closes the card", async ({ app, screen, browser }) => {
  await openRoster(app, screen);
  const base = app.baseUrl ?? "http://127.0.0.1:8787";
  const pending = await review(base, "ls /tmp");
  expect(pending.status).toBe(202);
  await expect(screen.getByRole("heading", "Review an action · Shell")).toBeVisible({ timeout: POLL });
  await screen.getByRole("button", "Deny").tap();
  await expect(screen.getByRole("heading", "Review an action · Shell")).toBeHidden({ timeout: POLL });
  await expect(browser.locator("#log .msg.user").last()).toContainText("denied the pending shell action", { timeout: POLL });
});
