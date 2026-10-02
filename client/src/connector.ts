import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sprite, spriteJson } from "./sprite.js";

type Connection = {
  id: string;
  provider: string;
  provider_account_name?: string;
};

export function gatewayBaseUrl(connectionId: string): string {
  return `https://api.sprites.dev/v1/gateway/custom_api/${connectionId}`;
}

export async function ensureConnector(options: { name: string; baseApiUrl: string; apiKey: string }): Promise<string> {
  const listed = spriteJson<{ connections?: Connection[] }>(await sprite(["api", "/v1/oauth/connections"]));
  const existing = (listed.connections ?? []).find((item) => item.provider === "custom_api" && item.provider_account_name === options.name);
  if (existing) return existing.id;
  const dir = await mkdtemp(join(tmpdir(), "pi-orbs-connector-"));
  const bodyPath = join(dir, "body.json");
  try {
    await writeFile(bodyPath, JSON.stringify({
      name: options.name,
      base_api_url: options.baseApiUrl,
      access_token: options.apiKey,
      auth_method: "header",
      auth_header_prefix: "Bearer",
      test_url: "/models",
      access_policy: { allow_all: true, allowed_endpoints: ["/*"] },
    }));
    const created = spriteJson<{ connection: Connection }>(await sprite([
      "api", "/v1/oauth/connections/custom_api", "--",
      "-sS", "-X", "POST", "-H", "content-type: application/json", "--data-binary", `@${bodyPath}`,
    ]));
    if (!created.connection?.id) throw new Error("sprites did not return a connector id");
    return created.connection.id;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function deleteConnector(connectionId: string): Promise<void> {
  try {
    await sprite(["api", `/v1/oauth/connections/${connectionId}`, "--", "-sS", "-f", "-X", "DELETE"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/\b404\b/.test(message)) throw error;
  }
}
