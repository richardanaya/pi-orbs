export const CONNECTORS = [
  { id: "xai", label: "xAI", baseApiUrl: "https://api.x.ai/v1", model: "grok-4.7", connectionName: "pi-orbs xAI" },
  { id: "openai", label: "OpenAI", baseApiUrl: "https://api.openai.com/v1", model: "gpt-4o", connectionName: "pi-orbs OpenAI" },
  { id: "openrouter", label: "OpenRouter", baseApiUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o", connectionName: "pi-orbs OpenRouter" },
  { id: "groq", label: "Groq", baseApiUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", connectionName: "pi-orbs Groq" },
  { id: "together", label: "Together AI", baseApiUrl: "https://api.together.ai/v1", model: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", connectionName: "pi-orbs Together AI" },
  { id: "deepseek", label: "DeepSeek", baseApiUrl: "https://api.deepseek.com", model: "deepseek-chat", connectionName: "pi-orbs DeepSeek" },
  { id: "mistral", label: "Mistral", baseApiUrl: "https://api.mistral.ai/v1", model: "mistral-large-latest", connectionName: "pi-orbs Mistral" },
  { id: "fireworks", label: "Fireworks", baseApiUrl: "https://api.fireworks.ai/inference/v1", model: "accounts/fireworks/models/llama-v3p1-70b-instruct", connectionName: "pi-orbs Fireworks" },
  { id: "custom", label: "Custom", baseApiUrl: "", model: "", connectionName: "" },
] as const;

const MODEL_MAX = 200;

export type ConnectorId = (typeof CONNECTORS)[number]["id"];
export type PublicConnector = { id: ConnectorId; label: string; baseApiUrl: string; model: string };
export type SpriteConnector = { connectorType: ConnectorId; baseApiUrl: string; model: string };

export function publicConnectors(): PublicConnector[] {
  return CONNECTORS.map(({ id, label, baseApiUrl, model }) => ({ id, label, baseApiUrl, model }));
}

export function connectorById(id: string): (typeof CONNECTORS)[number] | undefined {
  return CONNECTORS.find((item) => item.id === id);
}

export function defaultConnector(): SpriteConnector {
  const xai = CONNECTORS[0];
  return { connectorType: xai.id, baseApiUrl: xai.baseApiUrl, model: xai.model };
}

export function normalizeConnector(saved: { connectorType?: string; baseApiUrl?: string; model?: string } | undefined): SpriteConnector {
  const fallback = defaultConnector();
  const preset = connectorById(saved?.connectorType ?? "") ?? connectorById("xai");
  if (!preset || preset.id === "xai" && !saved?.connectorType) return {
    connectorType: "xai",
    baseApiUrl: saved?.baseApiUrl || fallback.baseApiUrl,
    model: saved?.model || fallback.model,
  };
  if (preset.id === "custom") {
    return {
      connectorType: "custom",
      baseApiUrl: saved?.baseApiUrl || "",
      model: saved?.model || "",
    };
  }
  return {
    connectorType: preset.id,
    baseApiUrl: preset.baseApiUrl,
    model: saved?.model || preset.model,
  };
}

export function connectionName(type: ConnectorId, baseApiUrl: string): string {
  const preset = connectorById(type);
  if (preset && preset.id !== "custom") return preset.connectionName;
  return `pi-orbs custom ${baseApiUrl}`;
}

export function providerApi(type: ConnectorId): "openai-responses" | "openai-completions" {
  return type === "xai" ? "openai-responses" : "openai-completions";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export type Setup = SpriteConnector & { name: string; apiKey: string };

export function readSetup(body: Record<string, unknown>): Setup | { error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const apiKey = typeof body.apiKey === "string" && body.apiKey.trim()
    ? body.apiKey.trim()
    : typeof body.xaiKey === "string" ? body.xaiKey.trim() : "";
  if (!name || !apiKey) return { error: "name and API key are required" };
  const typeRaw = typeof body.connectorType === "string" && body.connectorType.trim() ? body.connectorType.trim() : "xai";
  const preset = connectorById(typeRaw);
  if (!preset) return { error: "connector is not recognized" };
  let baseApiUrl = typeof body.baseApiUrl === "string" ? body.baseApiUrl.trim() : "";
  let model = typeof body.model === "string" ? body.model.trim() : "";
  if (preset.id === "custom") {
    if (!isHttpUrl(baseApiUrl)) return { error: "base URL is required" };
    if (!model) return { error: "model is required" };
  } else {
    baseApiUrl = preset.baseApiUrl;
    if (!model) model = preset.model;
  }
  if (model.length > MODEL_MAX) return { error: "model is too long" };
  return { name, apiKey, connectorType: preset.id, baseApiUrl, model };
}

export function readDeployUpdate(body: Record<string, unknown>, current: SpriteConnector): SpriteConnector | { error: string } {
  if (!("connectorType" in body) && !("baseApiUrl" in body) && !("model" in body)) return current;
  const typeRaw = typeof body.connectorType === "string" && body.connectorType.trim() ? body.connectorType.trim() : current.connectorType;
  const preset = connectorById(typeRaw);
  if (!preset) return { error: "connector is not recognized" };
  let baseApiUrl = typeof body.baseApiUrl === "string" && body.baseApiUrl.trim() ? body.baseApiUrl.trim() : current.baseApiUrl;
  if (preset.id !== "custom") baseApiUrl = preset.baseApiUrl;
  else if (!isHttpUrl(baseApiUrl)) return { error: "base URL is required" };
  const modelRaw = typeof body.model === "string" ? body.model.trim() : "";
  const model = modelRaw || (preset.id === "custom" ? current.model : preset.model);
  if (!model) return { error: "model is required" };
  if (model.length > MODEL_MAX) return { error: "model is too long" };
  if (preset.id !== current.connectorType || baseApiUrl !== current.baseApiUrl) {
    return { error: "API key is required to change the connector" };
  }
  return { connectorType: preset.id, baseApiUrl, model };
}
