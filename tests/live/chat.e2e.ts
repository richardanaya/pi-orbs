import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("a new bot receives a non-empty reply from the model", { timeout: 180_000 }, async ({ app, screen, browser }) => {
  test.skip(!process.env.XAI_API_KEY, "Set XAI_API_KEY or PIORBS_XAI_API_KEY to run the live chat.");
  await app.open("/");
  await expect(screen.getByText("Local simulator")).toBeHidden();
  await expect(screen.getByRole("button", "Add")).toBeVisible();

  const name = `Live${Date.now().toString().slice(-6)}`;
  await screen.getByRole("button", "Add").tap();
  await expect(screen.getByRole("heading", "New bot")).toBeVisible();
  await screen.getByLabel("Name").fill(name);
  await screen.getByLabel("Instruction").fill("Reply in one short sentence.");
  await screen.getByRole("button", "Create").tap();
  await expect(screen.getByRole("button", `Edit ${name}`)).toBeVisible();

  const note = `e2e note ${Date.now()}`;
  await screen.getByLabel("Message").fill(`Reply with one short sentence acknowledging this note: ${note}`);
  await screen.getByRole("button", "Send").tap();
  await expect(browser.locator("#log .msg.user").last()).toContainText(note, { timeout: 20_000 });

  await expect.poll(async () => browser.evaluate(() => {
    return [...document.querySelectorAll("#log .msg.bot")]
      .map((node) => (node.textContent ?? "").trim())
      .some((text) => text.length > 0 && !text.includes("canned reply") && !text.includes("No model was called"));
  }), { timeout: 150_000 }).toBe(true);
});
