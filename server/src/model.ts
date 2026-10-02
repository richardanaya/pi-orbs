import { createModels, createProvider, type MutableModels } from "@earendil-works/pi-ai/models";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";

export const SHARED_PROVIDER = "pi-orbs";

export function sharedModel(): { provider: string; modelId: string } {
  return { provider: SHARED_PROVIDER, modelId: process.env.PI_MODEL?.trim() || "grok-4.7" };
}

function connectorKeyAuth() {
  return {
    apiKey: {
      name: "Connector API key",
      resolve: async ({ ctx, credential, signal }: {
        ctx: { env(name: string): Promise<string | undefined> };
        credential?: { key?: string };
        signal: AbortSignal;
      }) => {
        signal.throwIfAborted();
        if (credential?.key) return { auth: { apiKey: credential.key }, source: "stored credential" };
        for (const envVar of ["OPENAI_API_KEY", "XAI_API_KEY"]) {
          const value = await ctx.env(envVar);
          signal.throwIfAborted();
          if (value) return { auth: { apiKey: value }, source: envVar };
        }
        return undefined;
      },
    },
  };
}

export function installSharedModel(models: MutableModels): void {
  const { modelId } = sharedModel();
  const completions = process.env.PI_API === "openai-completions";
  const baseUrl = process.env.PI_BASE_URL?.trim() || process.env.PI_XAI_BASE_URL?.trim() || "https://api.x.ai/v1";
  if (!completions) {
    const catalog = createModels();
    catalog.setProvider(xaiProvider());
    const template = catalog.getModel("xai", modelId) ?? catalog.getModel("xai", "grok-4.7");
    const model = template
      ? {
          ...template,
          id: modelId,
          name: template.id === modelId ? template.name : modelId,
          provider: SHARED_PROVIDER,
          baseUrl,
          compat: { ...template.compat, supportsMidConvoSystemMessages: true },
        }
      : {
          id: modelId,
          name: modelId,
          api: "openai-responses" as const,
          provider: SHARED_PROVIDER,
          baseUrl,
          reasoning: true,
          input: ["text" as const],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 8192,
          compat: { supportsMidConvoSystemMessages: true },
        };
    models.setProvider(createProvider({
      id: SHARED_PROVIDER,
      name: "Pi Orbs",
      baseUrl,
      auth: connectorKeyAuth(),
      models: [model],
      api: openAIResponsesApi(),
    }));
    return;
  }
  models.setProvider(createProvider({
    id: SHARED_PROVIDER,
    name: "Pi Orbs",
    baseUrl,
    auth: connectorKeyAuth(),
    models: [{
      id: modelId,
      name: modelId,
      api: "openai-completions",
      provider: SHARED_PROVIDER,
      baseUrl,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
      // Same mid-conversation system path as Grok, so an instruction edit applies on the next turn.
      compat: { supportsMidConvoSystemMessages: true },
    }],
    api: openAICompletionsApi(),
  }));
}
