import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";
import { piOrbsAgent } from "./e2e/model.js";

const appUrl = process.env.APP_URL ?? "http://127.0.0.1:8787";

function liveCommandEnv(): Record<string, string> {
  const env: Record<string, string> = { E2E_STACK: "live" };
  if (process.env.XAI_API_KEY) env.XAI_API_KEY = process.env.XAI_API_KEY;
  if (process.env.PIORBS_XAI_API_KEY) env.PIORBS_XAI_API_KEY = process.env.PIORBS_XAI_API_KEY;
  return env;
}

export default {
  timeout: 180_000,
  assertionTimeout: 15_000,
  workers: 1,
  tests: ["tests/live/**/*.e2e.ts"],
  agents: {
    default: piOrbsAgent,
  },
  targets: [{
    name: "chromium",
    engine: web(),
    app: {
      url: appUrl,
      command: {
        executable: process.execPath,
        args: ["scripts/e2e-serve.mjs"],
        env: liveCommandEnv(),
        log: ".e2e/logs/live.log",
        startupTimeout: 120_000,
        shutdownTimeout: 15_000,
      },
    },
  }],
} satisfies E2EConfig;
