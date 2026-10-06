import { beforeEach } from "@e2e-dev/web";
import { expect } from "e2e";

export const SITE_URL = "http://127.0.0.1:8790/";
export const POLL = 15_000;

// Placeholders for the local simulator. They are not credentials.
export const FAKE_SETUP_KEY = "local-setup-key-not-real";
export const FAKE_VOICE_KEY = "local-voice-not-real";
export const FAKE_CRON_KEY = "local-cron-not-real";
export const FAKE_SECRET_VALUE = "e2e-vault-value-00001";

type AppLike = { baseUrl?: string; open(path?: string): Promise<void> };
type ScreenLike = {
  getByRole(role: string, name?: string | RegExp, options?: { exact?: boolean; visible?: boolean }): {
    tap(): Promise<void>;
  };
  getByText(text: string | RegExp, options?: { exact?: boolean }): {
    waitFor(options?: { timeout?: number }): Promise<void>;
  };
};

export async function reseedSimulator(baseUrl: string): Promise<void> {
  const response = await fetch(new URL("/api/sprites", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "atlas",
      connectorType: "xai",
      apiKey: FAKE_SETUP_KEY,
      model: "grok-4.7",
    }),
  });
  if (response.status !== 201) {
    throw new Error(`simulator reset failed with status ${response.status}`);
  }
}

export function installSimulatorReset(): void {
  beforeEach(async ({ app }) => {
    await reseedSimulator(app.baseUrl ?? "http://127.0.0.1:8787");
  });
}

export async function openRoster(app: AppLike, screen: ScreenLike): Promise<void> {
  await app.open("/");
  await expect(screen.getByText("Local simulator")).toBeVisible();
  await expect(screen.getByRole("button", "Edit Ada")).toBeVisible({ timeout: POLL });
}

export async function spriteJson(baseUrl: string, path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body: unknown = await response.json().catch(() => null);
  return { status: response.status, body };
}

export async function visibleTextHas(browser: { evaluate(pageFunction: (needle: string) => boolean, arg: string): Promise<boolean> }, needle: string): Promise<boolean> {
  return browser.evaluate((value) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if ((node.textContent ?? "").includes(value)) return true;
      node = walker.nextNode();
    }
    return false;
  }, needle);
}
