import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { installSimulatorReset, openRoster, POLL, spriteJson } from "./support.js";

installSimulatorReset();

test("an MCP app renders in a different-origin sandbox and keeps text fallback", async ({ app, screen, browser }) => {
  await openRoster(app, screen);
  await expect(screen.getByText("Orb status: the server answered.")).toBeVisible({ timeout: POLL });
  await expect(screen.getByText("MCP app")).toBeVisible();

  const frame = browser.frameLocator('[data-app-id="app-seed-status"] iframe.mcp-app-sandbox').frameLocator("#mcp-view");
  await expect(frame.getByText("Orb status: the server answered.")).toBeVisible({ timeout: POLL });
  await expect(frame.getByText("host: blocked")).toBeVisible();

  const boundary = await browser.evaluate(() => {
    const node = document.querySelector('[data-app-id="app-seed-status"] iframe.mcp-app-sandbox');
    const preview = document.querySelector("#viewer-body iframe");
    return {
      page: location.origin,
      src: node ? new URL(node.src).origin : "",
      sandbox: node?.getAttribute("sandbox") ?? "",
      allow: node?.allow ?? "",
      srcdoc: node?.srcdoc ?? "",
      previewSandbox: preview?.getAttribute("sandbox") ?? "absent",
    };
  });
  expect(boundary.src).not.toBe("");
  expect(boundary.src).not.toBe(boundary.page);
  expect(boundary.sandbox).toBe("allow-scripts allow-same-origin");
  expect(boundary.allow).not.toContain("camera");
  expect(boundary.allow).not.toContain("microphone");
  expect(boundary.allow).not.toContain("geolocation");
  expect(boundary.srcdoc).toBe("");
  expect(boundary.previewSandbox).toBe("absent");

  await frame.getByRole("button", "Refresh").tap();
  await screen.getByRole("button", "Allow refresh_status").tap();
  await expect(frame.getByText("Orb status: refreshed.")).toBeVisible({ timeout: POLL });
});

test("a hostile app cannot read the chat origin and cannot open camera or its connect domain", async ({ app, screen, browser }) => {
  await openRoster(app, screen);
  const created = await spriteJson(app.baseUrl ?? "http://127.0.0.1:8787", "/api/sprites/atlas/bots/ada/mcp-apps", {
    method: "POST",
    body: JSON.stringify({ tool: "show_hostile_probe", arguments: {} }),
  });
  expect(created.status).toBe(201);

  await expect(browser.locator('[data-app-id="app-1"] .mcp-app-fallback')).toContainText("Probe finished. Text fallback only.", { timeout: POLL });
  await expect(browser.locator('[data-app-id="app-1"]')).toContainText("https://evil.example");
  await screen.getByRole("button", "Keep connections off").tap();

  const frame = browser.frameLocator('[data-app-id="app-1"] iframe.mcp-app-sandbox').frameLocator("#mcp-view");
  await expect(frame.getByText("host: blocked", { exact: false })).toBeVisible({ timeout: POLL });
  await expect(frame.getByText("top: blocked", { exact: false })).toBeVisible();
  await expect(frame.getByText("camera: denied", { exact: false })).toBeVisible();
  await expect(frame.getByText("connect: blocked", { exact: false })).toBeVisible();

  const allow = await browser.evaluate(() => {
    const node = document.querySelector('[data-app-id="app-1"] iframe.mcp-app-sandbox');
    return node?.allow ?? "missing";
  });
  expect(allow).not.toContain("camera");
  expect(allow).not.toContain("microphone");
  expect(allow).not.toContain("geolocation");
});
