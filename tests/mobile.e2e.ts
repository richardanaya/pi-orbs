import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { installSimulatorReset } from "./support.js";

installSimulatorReset();

test("the roster stacks above the thread on a phone", async ({ app, screen, browser }) => {
  await browser.setViewport({ width: 390, height: 844 });
  await app.open("/");
  await expect(screen.getByText("Local simulator")).toBeVisible();
  await expect(screen.getByRole("button", "Edit Ada")).toBeVisible();
  await expect(screen.getByLabel("Message")).toBeVisible();

  const layout = await browser.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return { columns: 0, rows: "" };
    const style = getComputedStyle(main);
    const columns = style.gridTemplateColumns.split(" ").filter(Boolean).length;
    return { columns, rows: style.gridTemplateRows };
  });
  expect(layout.columns).toBe(1);
  expect(layout.rows.includes(" ")).toBe(true);
});
