import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { FAKE_SETUP_KEY, installSimulatorReset, openRoster, visibleTextHas } from "./support.js";

installSimulatorReset();

test("setup offers connectors and deploys the simulator", async ({ app, screen, browser }) => {
  await openRoster(app, screen);
  await screen.getByRole("button", "Settings").tap();
  await expect(screen.getByRole("heading", "Settings")).toBeVisible();
  await browser.onDialog("accept");
  await screen.getByRole("button", "Destroy sprite").tap();

  await expect(screen.getByRole("button", "Create and deploy")).toBeVisible();
  await expect(screen.getByRole("button", "Save token")).toBeHidden();
  await expect(screen.getByText("Local simulator")).toBeVisible();

  await screen.getByLabel("Connector").selectOption("OpenAI");
  await expect(screen.getByLabel("Base URL")).toHaveValue("https://api.openai.com/v1");
  await expect(screen.getByLabel("Model")).toHaveValue("gpt-4o");

  await screen.getByLabel("Connector").selectOption("Anthropic");
  await expect(screen.getByLabel("Base URL")).toHaveValue("https://api.anthropic.com");
  await expect(screen.getByLabel("Model")).toHaveValue("claude-sonnet-5");

  await screen.getByLabel("Connector").selectOption("Custom");
  await expect(screen.getByLabel("Base URL")).toHaveValue("");

  await screen.getByLabel("Connector").selectOption("xAI");
  await expect(screen.getByLabel("Base URL")).toHaveValue("https://api.x.ai/v1");
  await screen.getByLabel("Sprite name").fill("atlas");
  await screen.getByLabel("API key").fill(FAKE_SETUP_KEY);
  await screen.getByLabel("Model").fill("grok-4.7");
  await screen.getByRole("button", "Create and deploy").tap();

  await expect(screen.getByRole("button", "Edit Ada")).toBeVisible();
  await expect(screen.getByRole("button", "Edit Kepler")).toBeVisible();
  await expect(screen.getByRole("button", "Edit Nova")).toBeVisible();
  expect(await visibleTextHas(browser, FAKE_SETUP_KEY)).toBe(false);
});
