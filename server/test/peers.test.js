import assert from "node:assert/strict";
import test from "node:test";
import { hiddenThreadEntryIds, normalizePeers, publicPeer, readSteer, resolvePeerTarget } from "../dist/peers.js";

const bots = [
  { id: "1", name: "Ada" },
  { id: "2", name: "Kepler" },
  { id: "3", name: "Ada" },
];

test("readSteer trims content and rejects an empty sender", () => {
  assert.deepEqual(readSteer({ from: " ada ", content: "  hello  " }), { from: "ada", content: "hello" });
  assert.deepEqual(readSteer({ content: "hello" }), { error: "from is required" });
  assert.deepEqual(readSteer({ from: "ada", content: "   " }), { error: "content is required" });
  assert.deepEqual(readSteer({ from: "ada", content: "x".repeat(8001) }), { error: "content is too long" });
});

test("resolvePeerTarget finds an id or a unique name", () => {
  assert.deepEqual(resolvePeerTarget(bots, "1", "2"), { id: "2" });
  assert.deepEqual(resolvePeerTarget(bots, "1", "Kepler"), { id: "2" });
  assert.deepEqual(resolvePeerTarget(bots, "1", "1"), { error: "a bot cannot steer itself" });
  assert.deepEqual(resolvePeerTarget(bots, "2", "Ada"), { error: "bot name is ambiguous" });
  assert.deepEqual(resolvePeerTarget(bots, "1", "missing"), { error: "bot not found" });
  assert.deepEqual(resolvePeerTarget(bots, "1", "  "), { error: "bot is required" });
});

test("a peer-only turn is hidden and a shared human turn keeps its answer", () => {
  const peerOnly = hiddenThreadEntryIds([
    { id: "u1", kind: "pi.user" },
    { id: "a1", kind: "pi.assistant" },
    { id: "t1", kind: "pi.tool" },
    { id: "a2", kind: "pi.assistant" },
  ], new Set(["u1"]));
  assert.deepEqual([...peerOnly].sort(), ["a1", "a2", "t1", "u1"]);

  const shared = hiddenThreadEntryIds([
    { id: "human", kind: "pi.user" },
    { id: "peer", kind: "pi.user" },
    { id: "answer", kind: "pi.assistant" },
  ], new Set(["peer"]));
  assert.deepEqual([...shared], ["peer"]);

  const later = hiddenThreadEntryIds([
    { id: "peer", kind: "pi.user" },
    { id: "reply", kind: "pi.assistant" },
    { id: "human", kind: "pi.user" },
    { id: "answer", kind: "pi.assistant" },
  ], new Set(["peer"]));
  assert.equal(later.has("peer"), true);
  assert.equal(later.has("reply"), true);
  assert.equal(later.has("human"), false);
  assert.equal(later.has("answer"), false);
});

test("normalizePeers drops broken rows and publicPeer marks delivery", () => {
  const peers = normalizePeers({
    peers: [
      { id: "p1", from: "1", to: "2", content: "hi", requestId: "peer:p1", submissionId: "9", createdAt: "2026-10-02T00:00:00.000Z", entryId: "4" },
      { id: "", from: "1", to: "2", content: "nope", requestId: "peer:x", submissionId: "1", createdAt: "2026-10-02T00:00:00.000Z" },
    ],
  });
  assert.equal(peers.length, 1);
  assert.equal(peers[0].fromName, "1");
  assert.equal(peers[0].entryId, "4");
  const view = publicPeer(peers[0]);
  assert.equal(view.delivery, "steer");
  assert.equal(view.content, "hi");
  assert.equal(view.requestId, undefined);
});