import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { installSimulatorReset, openRoster, POLL, spriteJson } from "./support.js";

// waitForDownload returns a path relative to the attempt artifacts directory.
async function savedDownload(relativePath: string): Promise<string> {
  const name = relativePath.split("/").pop();
  if (!name) throw new Error("download had no file name");
  const pending = [".e2e/artifacts"];
  while (pending.length > 0) {
    const dir = pending.pop();
    if (!dir) continue;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.name === name) return full;
    }
  }
  throw new Error("saved download was not found");
}

installSimulatorReset();

test("export and import copy a bot template", async ({ app, screen, browser }) => {
  await openRoster(app, screen);
  const name = `Scribe${Date.now().toString().slice(-6)}`;
  await screen.getByRole("button", "Add").tap();
  await screen.getByLabel("Name").fill(name);
  await screen.getByLabel("Instruction").fill("Suggest short bot names.");
  await screen.getByRole("button", "Create").tap();
  await expect(screen.getByRole("button", `Edit ${name}`)).toBeVisible();

  await screen.getByRole("button", `Edit ${name}`).tap();
  const download = await browser.waitForDownload(async () => {
    await screen.getByRole("button", "Export template").tap();
  });
  expect(download.suggestedFilename.endsWith(".pi-orbs.json")).toBe(true);
  await screen.getByRole("button", "Cancel").tap();

  await screen.getByRole("button", "Add").tap();
  await expect(screen.getByRole("heading", "New bot")).toBeVisible();
  await browser.locator("#bot-import-file").setInputFiles(await savedDownload(download.path));
  await expect(screen.getByRole("button", `Edit ${name} copy`)).toBeVisible({ timeout: POLL });
});

test("create_bot spawn adds a bot from Ada", async ({ app, screen }) => {
  await openRoster(app, screen);
  const base = app.baseUrl ?? "http://127.0.0.1:8787";
  const name = `Moss${Date.now().toString().slice(-6)}`;
  const spawned = await spriteJson(base, "/api/sprites/atlas/bots/ada/spawn", {
    method: "POST",
    body: JSON.stringify({
      name,
      instruction: "Watch the shared work directory.",
      look: "pine",
    }),
  });
  expect(spawned.status).toBe(201);
  await expect(screen.getByRole("button", `Edit ${name}`)).toBeVisible({ timeout: POLL });

  await screen.getByRole("button", `Edit ${name}`).tap();
  await expect(screen.getByLabel("Instruction")).toHaveValue("Watch the shared work directory.");
});
