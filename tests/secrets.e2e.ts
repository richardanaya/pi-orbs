import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { FAKE_SECRET_VALUE, installSimulatorReset, openRoster, POLL, spriteJson, visibleTextHas } from "./support.js";

installSimulatorReset();

test("a secret card saves a value that stays off the page", async ({ app, screen, browser }) => {
  await openRoster(app, screen);
  const base = app.baseUrl ?? "http://127.0.0.1:8787";
  const opened = await spriteJson(base, "/api/sprites/atlas/bots/ada/secrets", {
    method: "POST",
    body: JSON.stringify({ request: true, name: "E2EVault", reason: "Needed for the status page." }),
  });
  expect(opened.status).toBe(201);

  await expect(screen.getByRole("heading", "Secret · E2EVault")).toBeVisible({ timeout: POLL });
  await expect(screen.getByText("Needed for the status page.")).toBeVisible();
  await screen.getByPlaceholder("E2EVault").fill(FAKE_SECRET_VALUE);
  await screen.getByRole("button", "Save").tap();
  await expect(screen.getByRole("heading", "Secret · E2EVault")).toBeHidden({ timeout: POLL });

  const listed = await spriteJson(base, "/api/sprites/atlas/bots/ada/secrets");
  expect(listed.status).toBe(200);
  const packed = JSON.stringify(listed.body);
  expect(packed.includes(FAKE_SECRET_VALUE)).toBe(false);
  expect(packed.includes("E2EVault")).toBe(true);
  expect(await visibleTextHas(browser, FAKE_SECRET_VALUE)).toBe(false);

  const thread = await spriteJson(base, "/api/sprites/atlas/bots/ada");
  expect(JSON.stringify(thread.body).includes(FAKE_SECRET_VALUE)).toBe(false);
});

test("dismiss closes a secret card without saving", async ({ app, screen }) => {
  await openRoster(app, screen);
  const base = app.baseUrl ?? "http://127.0.0.1:8787";
  const opened = await spriteJson(base, "/api/sprites/atlas/bots/ada/secrets", {
    method: "POST",
    body: JSON.stringify({ request: true, name: "E2EOther", reason: "Optional token." }),
  });
  expect(opened.status).toBe(201);
  await expect(screen.getByRole("heading", "Secret · E2EOther")).toBeVisible({ timeout: POLL });
  await screen.getByRole("button", "Dismiss").tap();
  await expect(screen.getByRole("heading", "Secret · E2EOther")).toBeHidden({ timeout: POLL });

  const listed = await spriteJson(base, "/api/sprites/atlas/bots/ada/secrets");
  const packed = JSON.stringify(listed.body);
  expect(packed.includes("E2EOther")).toBe(false);
});
