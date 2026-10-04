import { spritesJson } from "./sprite.js";

type Connection = {
  id: string;
  provider: string;
  provider_account_name?: string;
};

export function gatewayBaseUrl(connectionId: string): string {
  return `https://api.sprites.dev/v1/gateway/custom_api/${connectionId}`;
}

export async function ensureConnector(options: { name: string; baseApiUrl: string; apiKey: string }): Promise<string> {
  const listed = await spritesJson<{ connections?: Connection[] }>("GET", "/v1/oauth/connections");
  const existing = (listed.connections ?? []).find((item) => item.provider === "custom_api" && item.provider_account_name === options.name);
  if (existing) return existing.id;
  const created = await spritesJson<{ connection: Connection }>("POST", "/v1/oauth/connections/custom_api", {
    name: options.name,
    base_api_url: options.baseApiUrl,
    access_token: options.apiKey,
    auth_method: "header",
    auth_header_prefix: "Bearer",
    test_url: "/models",
    access_policy: { allow_all: true, allowed_endpoints: ["/*"] },
  });
  if (!created.connection?.id) throw new Error("sprites did not return a connector id");
  return created.connection.id;
}

export async function deleteConnector(connectionId: string): Promise<void> {
  await spritesJson("DELETE", `/v1/oauth/connections/${encodeURIComponent(connectionId)}`, undefined, [404]);
}
