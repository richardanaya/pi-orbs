import { xai } from "@ai-sdk/xai";

// In-process only. The value is never written or logged from this file.
if (process.env.PIORBS_XAI_API_KEY && !process.env.XAI_API_KEY) {
  process.env.XAI_API_KEY = process.env.PIORBS_XAI_API_KEY;
}

export const piOrbsAgent = {
  model: xai("grok-4.7"),
  system: "You are a thorough QA agent. Use the labels on screen. Stop when the goal is done. Do not type into password fields.",
  context: [
    "Pi Orbs is a dark roster of named bots.",
    "Search, Add, and Settings are buttons in the sidebar.",
    "Each bot has an Edit button.",
    "The composer is labeled Message.",
    "Dialog titles include New bot, Edit bot, Settings, and Search.",
    "The local simulator shows a Local simulator badge.",
  ].join(" "),
  providerOptions: {
    xai: { reasoningEffort: "low" },
  },
};
