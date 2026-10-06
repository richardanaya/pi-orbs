import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";
import { piOrbsAgent } from "./e2e/model.js";

const appUrl = process.env.APP_URL ?? "http://127.0.0.1:8787";

export default {
  timeout: 120_000,
  assertionTimeout: 12_000,
  // One in-memory simulator. Parallel files would share and clobber it.
  workers: 1,
  tests: ["tests/**/*.e2e.ts", "!tests/live/**"],
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
        env: { E2E_STACK: "simulator" },
        log: ".e2e/logs/app.log",
        startupTimeout: 60_000,
        shutdownTimeout: 10_000,
      },
    },
  }],
} satisfies E2EConfig;
