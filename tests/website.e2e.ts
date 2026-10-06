import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SITE_URL } from "./support.js";

test("the homepage explains Pi Orbs and copies the install command", async ({ app, screen, browser }) => {
  await app.open(SITE_URL);
  await expect(screen.getByRole("heading", "Pi Orbs")).toBeVisible();
  await expect(screen.getByRole("heading", "What Pi Orbs is")).toBeVisible();
  await expect(screen.getByRole("heading", "Run")).toBeVisible();
  await expect(screen.getByRole("heading", "The app")).toBeVisible();
  await expect(screen.getByText("npx pi-orbs", { exact: true }).first()).toBeVisible();
  await expect(screen.getByRole("link", "What it is")).toBeVisible();
  await expect(screen.getByRole("navigation", "Page")).toBeVisible();

  // Headless Chromium does not grant clipboard write, so the page's
  // writeText call is recorded here. A real click still runs the site handler.
  await browser.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          document.documentElement.dataset.copied = value;
        },
      },
    });
  });
  await screen.getByRole("button", "Copy").first().tap();
  await expect(screen.getByRole("button", "Copied")).toBeVisible();
  const copied = await browser.evaluate(() => document.documentElement.dataset.copied ?? "");
  expect(copied).toBe("npx pi-orbs");
});

test("the phone nav opens and jumps to a section", async ({ app, screen, browser }) => {
  await browser.setViewport({ width: 390, height: 844 });
  await app.open(SITE_URL);
  await expect(screen.getByRole("button", "Menu")).toBeVisible();
  await expect(screen.getByRole("link", "What it is")).toBeHidden();

  await screen.getByRole("button", "Menu").tap();
  await expect(screen.getByRole("button", "Close", { visible: true })).toBeVisible();
  await expect(screen.getByRole("link", "What it is")).toBeVisible();
  await screen.getByRole("link", "What it is").tap();
  await expect(browser).toHaveURL(/#product/);
  await expect(screen.getByRole("heading", "What Pi Orbs is")).toBeVisible();
});
