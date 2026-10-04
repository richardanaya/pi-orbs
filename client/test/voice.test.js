import assert from "node:assert/strict";
import { test } from "node:test";
import { mintClientSecret, readVoice, voiceInstructions, voiceTools, VOICE_TOOL_NAMES } from "../dist/voice.js";

const apiKey = "voice-key-not-for-the-page";

test("the voice agent has exactly three function tools", () => {
  const tools = voiceTools();
  assert.deepEqual(tools.map((tool) => tool.name), [...VOICE_TOOL_NAMES]);
  assert.equal(tools.length, 3);
  assert.deepEqual([...new Set(tools.map((tool) => tool.type))], ["function"]);
  const instructions = voiceInstructions("Ada");
  for (const name of VOICE_TOOL_NAMES) assert.match(instructions, new RegExp(name));
  assert.doesNotMatch(instructions, /steer_peer|web_search|mcp/);
});

test("readVoice stores a provider and key without treating a blank key as a new secret", () => {
  const current = { provider: "grok", apiKey };
  assert.deepEqual(readVoice({ voiceProvider: "grok", voiceApiKey: "  " }, current), { voice: current });
  assert.equal(readVoice({ voiceProvider: "openai" }, current).error, "voice API key is required");
  assert.deepEqual(readVoice({ voiceProvider: "" }, current), { voice: null });
  assert.deepEqual(readVoice({ name: "atlas" }, current), { unchanged: true });
  assert.equal(readVoice({ voiceProvider: "anthropic", voiceApiKey: "x" }, null).error, "voice provider is not recognized");
  assert.deepEqual(readVoice({ voiceProvider: "OpenAI", voiceApiKey: apiKey }, null), {
    voice: { provider: "openai", apiKey },
  });
});

test("mintClientSecret returns a short-lived token and keeps the API key in the request header", async () => {
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(JSON.stringify(body).includes(apiKey), false);
    assert.equal(init.headers.authorization, `Bearer ${apiKey}`);
    assert.deepEqual(body.session.tools.map((tool) => tool.name), ["search_messages", "send_task", "stop_voice"]);
    assert.equal(body.session.tools.every((tool) => tool.type === "function"), true);
    if (String(url).includes("api.x.ai")) {
      assert.equal(body.session.model, "grok-voice-latest");
      return new Response(JSON.stringify({ value: "xai-realtime-client-secret-test", expires_at: 1750000000 }), { status: 200 });
    }
    assert.equal(body.session.type, "realtime");
    assert.equal(body.session.model, "gpt-realtime");
    return new Response(JSON.stringify({ value: "ek_test_token", expires_at: 1750000001 }), { status: 200 });
  };

  const grok = await mintClientSecret({ provider: "grok", apiKey, instructions: "Be brief.", fetchImpl });
  assert.equal(grok.clientSecret, "xai-realtime-client-secret-test");
  assert.equal(grok.expiresAt, 1750000000);
  assert.equal(grok.realtime.transport, "websocket");
  assert.equal(grok.realtime.url, "wss://api.x.ai/v1/realtime?model=grok-voice-latest");
  assert.equal(grok.realtime.protocol, "xai-client-secret.");
  assert.equal(JSON.stringify(grok).includes(apiKey), false);

  const openai = await mintClientSecret({ provider: "openai", apiKey, instructions: "Be brief.", fetchImpl });
  assert.equal(openai.clientSecret, "ek_test_token");
  assert.equal(openai.realtime.transport, "webrtc");
  assert.equal(openai.realtime.url, "https://api.openai.com/v1/realtime/calls");
  assert.equal(openai.realtime.model, "gpt-realtime");
  assert.equal(JSON.stringify(openai).includes(apiKey), false);
});

test("a grok mint that rejects session config retries once without that field", async () => {
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    calls += 1;
    const body = JSON.parse(init.body);
    if (calls === 1) {
      assert.ok(body.session);
      return new Response(JSON.stringify({ error: "session is not supported" }), { status: 400 });
    }
    assert.equal(body.session, undefined);
    assert.equal(JSON.stringify(body).includes(apiKey), false);
    return new Response(JSON.stringify({ value: "ephemeral-2", expires_at: 5 }), { status: 200 });
  };
  const minted = await mintClientSecret({ provider: "grok", apiKey, instructions: "Be brief.", fetchImpl });
  assert.equal(calls, 2);
  assert.equal(minted.clientSecret, "ephemeral-2");
  assert.equal(JSON.stringify(minted).includes(apiKey), false);
});

test("mintClientSecret redacts the API key from provider errors and refuses to return the key itself", async () => {
  const leaked = await mintClientSecret({
    provider: "openai",
    apiKey,
    instructions: "Be brief.",
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: `bad ${apiKey}` } }), { status: 401 }),
  });
  assert.equal(leaked.clientSecret, undefined);
  assert.equal(leaked.error.includes(apiKey), false);
  assert.match(leaked.error, /bad \[redacted\]/);

  const echoed = await mintClientSecret({
    provider: "grok",
    apiKey,
    instructions: "Be brief.",
    fetchImpl: async () => new Response(JSON.stringify({ value: apiKey, expires_at: 1 }), { status: 200 }),
  });
  assert.equal(echoed.error, "voice provider did not return a session token");
  assert.equal(JSON.stringify(echoed).includes(apiKey), false);
});
