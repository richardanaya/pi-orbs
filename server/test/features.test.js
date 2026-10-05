import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APPROVAL_TTL_MS,
  CHECK_IN_PROMPT,
  classifyCommand,
  copyName,
  expireApprovals,
  forgetMemory,
  fulfillSecret,
  guardRoster,
  guardSpawn,
  publicVault,
  readTemplate,
  redactText,
  requestSecret,
  resolveApproval,
  reviewAction,
  saveMemory,
  searchPalette,
  templateFrom,
} from "../dist/features.js";

test("search lists bots, settings, and actions before messages", () => {
  const bots = [
    { id: "ada", name: "Ada", look: "tide", instruction: "Sketch status pages." },
    { id: "kepler", name: "Kepler", look: "pine", instruction: "Answer questions." },
  ];
  const messages = [
    { botId: "ada", botName: "Ada", look: "tide", messageId: "m1", kind: "pi.user", text: "Keep the muted gray roster line.", createdAt: "2026-03-02T00:00:00.000Z" },
    { botId: "kepler", botName: "Kepler", look: "pine", messageId: "m2", kind: "pi.assistant", text: "The gray roster is shared.", createdAt: "2026-03-02T00:01:00.000Z" },
  ];
  const empty = searchPalette("  ", bots, messages);
  assert.deepEqual(Object.keys(empty), ["query", "quoted", "bots", "settings", "actions", "messages"]);
  assert.equal(empty.quoted, false);
  assert.equal(empty.messages.length, 0);
  assert.equal(empty.bots.length, 2);
  assert.equal(empty.settings[0].id, "voice");
  assert.equal(empty.actions.some((item) => item.id === "add-bot"), true);

  const words = searchPalette("gray roster", bots, messages);
  assert.equal(words.quoted, false);
  assert.deepEqual(words.messages.map((item) => item.messageId), ["m2", "m1"]);
  assert.equal(words.settings.length, 0);

  const quoted = searchPalette('"muted gray"', bots, messages);
  assert.equal(quoted.quoted, true);
  assert.deepEqual(quoted.messages.map((item) => item.messageId), ["m1"]);
  assert.equal(searchPalette('"gray muted"', bots, messages).messages.length, 0);
});

test("spawn guardrails and template copies", () => {
  const bots = [{ id: "ada" }, { id: "made", createdBy: "ada" }];
  assert.deepEqual(guardSpawn(bots, "ada"), { ok: true });
  assert.deepEqual(guardSpawn(bots, "missing"), { error: "bot not found" });
  const full = Array.from({ length: 24 }, (_, index) => ({ id: String(index) }));
  assert.deepEqual(guardRoster(full.length), { error: "roster is full" });
  const made = [{ id: "ada" }, ...Array.from({ length: 8 }, (_, index) => ({ id: `c${index}`, createdBy: "ada" }))];
  assert.deepEqual(guardSpawn(made, "ada"), { error: "this bot has created enough bots" });
  assert.equal(copyName("Ada", ["Ada"]), "Ada copy");
  assert.equal(copyName("Ada", ["Ada", "Ada copy"]), "Ada copy 2");

  const template = templateFrom({ name: "Ada", instruction: "Be brief.", look: "tide" });
  assert.equal(template.format, "pi-orbs-bot-template");
  assert.equal(template.formatVersion, 1);
  assert.deepEqual(readTemplate(template), { name: "Ada", instruction: "Be brief.", look: "tide" });
  assert.equal(readTemplate({ template }).name, "Ada");
  assert.deepEqual(readTemplate({ format: "other", formatVersion: 1, name: "Ada", instruction: "", look: "tide" }), { error: "template format is not recognized" });
  assert.deepEqual(readTemplate({ ...template, look: "rainbow" }), { error: "look is not recognized" });
});

test("memory save is local to the bot and forgets one match", () => {
  const first = saveMemory([], "ada", "  The roster is black.  ");
  assert.equal("error" in first, false);
  if ("error" in first) return;
  const again = saveMemory(first.memories, "ada", "the roster is black.");
  assert.equal(again.memory.id, first.memory.id);
  const other = saveMemory(first.memories, "kepler", "The roster is black.");
  assert.notEqual(other.memory.id, first.memory.id);
  const two = saveMemory(other.memories, "ada", "Faces are pastel.");
  const ambiguous = forgetMemory(two.memories, "ada", { query: "e" });
  assert.deepEqual(ambiguous, { error: "matches more than one memory; pass an id" });
  const forgotten = forgetMemory(two.memories, "ada", { id: first.memory.id });
  assert.equal(forgotten.forgotten.length, 1);
  assert.equal(forgotten.memories.some((item) => item.botId === "kepler"), true);
});

test("secret cards never return the typed value", () => {
  const opened = requestSecret({ secrets: [], requests: [] }, "ada", "GITHUB_TOKEN", "push the sprite");
  assert.equal(opened.created, true);
  const value = "super-secret-value-123456";
  const saved = fulfillSecret(opened.vault, "ada", { requestId: opened.request.id, value });
  assert.equal(saved.name, "GITHUB_TOKEN");
  assert.equal(saved.vault.secrets[0].value, value);
  const listed = publicVault(saved.vault, "ada", [value]);
  assert.deepEqual(listed.secrets, [{ name: "GITHUB_TOKEN", updatedAt: saved.vault.secrets[0].updatedAt }]);
  assert.deepEqual(listed.requests, []);
  assert.equal(JSON.stringify(listed).includes(value), false);
  assert.equal(redactText(`remember ${value} please`, [value]), "remember [redacted] please");
  const again = requestSecret(saved.vault, "ada", "GITHUB_TOKEN", "");
  assert.equal(again.created, true);
});

test("approval cards gate shell, network, and browser, and an expired card can always allow", () => {
  assert.equal(classifyCommand("ls"), "shell");
  assert.equal(classifyCommand("curl https://example.com"), "network");
  assert.equal(classifyCommand("chromium --headless"), "browser");
  const now = Date.parse("2026-10-05T00:00:00.000Z");
  const first = reviewAction({ cards: [], grants: [] }, { botId: "ada", command: "curl https://example.com", now });
  assert.equal(first.decision, "pending");
  assert.equal(first.action, "network");
  assert.equal(first.card.status, "pending");
  const waiting = reviewAction(first.state, { botId: "ada", command: "curl https://example.com", now: now + 1000 });
  assert.equal(waiting.card.id, first.card.id);
  const expired = expireApprovals(first.state, now + APPROVAL_TTL_MS + 1);
  assert.equal(expired.cards[0].status, "expired");
  const allowed = resolveApproval(expired, { botId: "ada", cardId: first.card.id, decision: "always", now: now + APPROVAL_TTL_MS + 1 });
  assert.equal(allowed.card.decision, "always");
  assert.match(allowed.note, /always allows network/);
  const next = reviewAction(allowed.state, { botId: "ada", command: "wget https://example.com", now: now + APPROVAL_TTL_MS + 2 });
  assert.equal(next.decision, "allow");
  const shell = reviewAction(next.state, { botId: "ada", command: "ls", now });
  assert.equal(shell.decision, "pending");
  assert.equal(shell.action, "shell");
  const once = resolveApproval(shell.state, { botId: "ada", cardId: shell.card.id, decision: "once", now });
  const ran = reviewAction(once.state, { botId: "ada", command: "ls", now: now + 10 });
  assert.equal(ran.decision, "allow");
  const again = reviewAction(ran.state, { botId: "ada", command: "ls", now: now + 20 });
  assert.equal(again.decision, "pending");
  const sprite = reviewAction({ cards: [], grants: [] }, { botId: "ada", command: "sync", action: "sprite", now });
  assert.equal(sprite.action, "sprite");
  assert.match(CHECK_IN_PROMPT, /steer_peer/);
});
