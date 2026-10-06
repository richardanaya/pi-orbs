import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { installSimulatorReset, openRoster, POLL, spriteJson } from "./support.js";

installSimulatorReset();

test("a person can add, edit, and delete a bot", async ({ app, screen, browser }) => {
  await openRoster(app, screen);
  const name = `Quill${Date.now().toString().slice(-6)}`;

  await screen.getByRole("button", "Add").tap();
  await expect(screen.getByRole("heading", "New bot")).toBeVisible();
  await screen.getByLabel("Name").fill(name);
  await screen.getByLabel("Instruction").fill("Write short commit messages.");
  await screen.getByRole("button", "Create").tap();

  await expect(screen.getByRole("button", `Edit ${name}`)).toBeVisible();

  await screen.getByRole("button", `Edit ${name}`).tap();
  await expect(screen.getByRole("heading", "Edit bot")).toBeVisible();
  await screen.getByLabel("Instruction").fill("Write commit messages and nothing else.");
  await screen.getByRole("button", "Save").tap();
  await expect(screen.getByRole("dialog", "Edit bot")).toBeHidden({ timeout: POLL });
  await expect(screen.getByText("Write commit messages and nothing else.", { exact: false })).toBeVisible();

  await screen.getByRole("button", `Edit ${name}`).tap();
  await browser.onDialog("accept");
  await screen.getByRole("button", "Delete").tap();
  await expect(screen.getByRole("button", `Edit ${name}`)).toBeHidden({ timeout: POLL });
});

test("a steer from Ada shows up in Kepler's thread", async ({ app, screen }) => {
  await openRoster(app, screen);
  const base = app.baseUrl ?? "http://127.0.0.1:8787";
  const steered = await spriteJson(base, "/api/sprites/atlas/bots/kepler/steer", {
    method: "POST",
    body: JSON.stringify({ from: "ada", content: "The status line is muted gray." }),
  });
  expect(steered.status).toBe(202);

  await screen.getByRole("button", /^Kepler\b/).tap();
  await expect(screen.getByRole("button", "Message from Ada")).toBeVisible({ timeout: POLL });
  await screen.getByRole("button", "Message from Ada").tap();
  await expect(screen.getByText("The status line is muted gray.")).toBeVisible();
});

test("the agent opens Ada's edit dialog", { tags: ["agent"] }, async ({ app, agent, screen }) => {
  await openRoster(app, screen);
  await agent.act("open the edit dialog for Ada");
  await expect(screen.getByRole("heading", "Edit bot")).toBeVisible();
  await expect(screen.getByLabel("Name")).toHaveValue("Ada");
});

test("settings downloads a conversation zip", async ({ app, screen, browser }) => {
  await openRoster(app, screen);
  await screen.getByRole("button", "Settings").tap();
  const download = await browser.waitForDownload(async () => {
    await screen.getByRole("button", "Download all conversations").tap();
  });
  expect(download.suggestedFilename).toContain("conversations");
  expect(download.suggestedFilename.endsWith(".zip")).toBe(true);
  await expect(screen.getByRole("button", "Download all conversations")).toBeVisible();
});
