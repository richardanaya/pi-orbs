export const PEER_CONTENT_MAX = 8_000;
export const PEER_REQUEST_PREFIX = "peer:";
export const PEER_LEDGER_MAX = 1_000;
// A human turn may steer once (hop 1). That recipient may steer once more (hop 2). The next steer is refused.
export const PEER_HOP_MAX = 2;

export const PEER_INSTRUCTION = [
  "Cross-bot messages are need-to-know.",
  "When the human asks you to tell, ask, or have another bot do something, call steer_peer in that same turn. Saying you will does not send it. The tool content is the request itself.",
  "When another bot asks you for something, do the work and steer the result back to that bot once. That result is what they need to know. Do not answer only in your own thread.",
  "Do not steer acknowledgements, status pings, or a second follow-up. The server closes the chain after one forward. A refused steer is final.",
].join("\n");

export type ThreadEntry = {
  id: string;
  kind: string;
};

export type PeerRecord = {
  id: string;
  from: string;
  to: string;
  fromName: string;
  toName: string;
  content: string;
  requestId: string;
  submissionId: string;
  entryId?: string;
  hop?: number;
  parentId?: string;
  createdAt: string;
};

export type PublicPeer = {
  id: string;
  from: string;
  to: string;
  fromName: string;
  toName: string;
  content: string;
  submissionId: string;
  entryId?: string;
  createdAt: string;
  delivery: "steer";
};

type NamedBot = { id: string; name: string };

export function withPeerInstruction(instruction: string): string {
  const own = instruction.trim();
  return own ? `${own}\n\n${PEER_INSTRUCTION}` : PEER_INSTRUCTION;
}

export function peerPrompt(fromName: string, fromId: string, content: string, hop: number, peerId: string): string {
  return [
    `pi-orbs-peer-hop: ${hop}`,
    `pi-orbs-peer-id: ${peerId}`,
    `Message from bot ${fromName} (id ${fromId}).`,
    "This is another bot on this sprite, not the human user.",
    "It was steered into this conversation. The human's thread does not show it.",
    "If this message asks you for something, steer that result back to the sender once. Do not send thanks or a second message.",
    "",
    content,
  ].join("\n");
}

export function peerTurn(userText: string | undefined): { hop: number; id: string } | null {
  if (!userText) return null;
  const hopLine = /^pi-orbs-peer-hop: (\d+)$/m.exec(userText);
  const idLine = /^pi-orbs-peer-id: (\S+)$/m.exec(userText);
  if (!hopLine || !idLine) return null;
  const hop = Number(hopLine[1]);
  if (!Number.isInteger(hop) || hop < 1) return null;
  return { hop, id: idLine[1] ?? "" };
}

export function outgoingHop(turn: { hop: number } | null): { hop: number } | { error: string } {
  const hop = turn ? turn.hop + 1 : 1;
  if (hop > PEER_HOP_MAX) return { error: "peer chain is closed" };
  return { hop };
}

export function peerChainUsed(peers: readonly { from: string; parentId?: string }[], fromId: string, parentId: string): boolean {
  return peers.some((item) => item.from === fromId && item.parentId === parentId);
}

export function readSteer(body: unknown): { from: string; content: string } | { error: string } {
  const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const from = record.from;
  const content = record.content;
  if (typeof from !== "string" || from.trim().length === 0) return { error: "from is required" };
  if (typeof content !== "string" || content.trim().length === 0) return { error: "content is required" };
  const trimmed = content.trim();
  if (trimmed.length > PEER_CONTENT_MAX) return { error: "content is too long" };
  return { from: from.trim(), content: trimmed };
}

export function resolvePeerTarget(bots: readonly NamedBot[], fromId: string, bot: string): { id: string } | { error: string } {
  const needle = bot.trim();
  if (!needle) return { error: "bot is required" };
  const byId = bots.find((item) => item.id === needle);
  if (byId) {
    if (byId.id === fromId) return { error: "a bot cannot steer itself" };
    return { id: byId.id };
  }
  const byName = bots.filter((item) => item.name === needle);
  if (byName.length > 1) return { error: "bot name is ambiguous" };
  if (byName.length === 1) {
    const match = byName[0];
    if (!match || match.id === fromId) return { error: "a bot cannot steer itself" };
    return { id: match.id };
  }
  return { error: "bot not found" };
}

export function publicPeer(record: PeerRecord): PublicPeer {
  return {
    id: record.id,
    from: record.from,
    to: record.to,
    fromName: record.fromName,
    toName: record.toName,
    content: record.content,
    submissionId: record.submissionId,
    ...(record.entryId ? { entryId: record.entryId } : {}),
    createdAt: record.createdAt,
    delivery: "steer",
  };
}

export function normalizePeers(parsed: unknown): PeerRecord[] {
  const list = parsed && typeof parsed === "object" && Array.isArray((parsed as { peers?: unknown }).peers)
    ? (parsed as { peers: unknown[] }).peers
    : [];
  const peers: PeerRecord[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const from = typeof record.from === "string" ? record.from : "";
    const to = typeof record.to === "string" ? record.to : "";
    const content = typeof record.content === "string" ? record.content : "";
    const requestId = typeof record.requestId === "string" ? record.requestId : "";
    const submissionId = typeof record.submissionId === "string" ? record.submissionId : "";
    const createdAt = typeof record.createdAt === "string" ? record.createdAt : "";
    if (!id || !from || !to || !content || !requestId || !submissionId || !createdAt) continue;
    const entryId = typeof record.entryId === "string" && record.entryId ? record.entryId : undefined;
    const hop = typeof record.hop === "number" && Number.isInteger(record.hop) && record.hop >= 1 ? record.hop : undefined;
    const parentId = typeof record.parentId === "string" && record.parentId ? record.parentId : undefined;
    peers.push({
      id,
      from,
      to,
      fromName: typeof record.fromName === "string" && record.fromName ? record.fromName : from,
      toName: typeof record.toName === "string" && record.toName ? record.toName : to,
      content,
      requestId,
      submissionId,
      ...(entryId ? { entryId } : {}),
      ...(hop ? { hop } : {}),
      ...(parentId ? { parentId } : {}),
      createdAt,
    });
  }
  return peers;
}

// Peer steers are Pi user inputs on the target conversation. Hide those entries.
// The assistant reply stays. That is how a result steered back reaches the human.
export type ThreadLine = {
  id: string;
  kind: string;
  text: string;
  createdAt: string | null;
  from?: string;
  to?: string;
  fromName?: string;
  toName?: string;
};

// Steers for this bot only, placed by time among its own messages.
export function withPeerLines(
  messages: readonly { id: string; kind: string; text: string; createdAt: string | null }[],
  peers: readonly PublicPeer[],
): ThreadLine[] {
  const lines: ThreadLine[] = messages.map((item) => ({ ...item }));
  const ordered = [...peers].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const peer of ordered) {
    const line: ThreadLine = {
      id: `peer:${peer.id}`,
      kind: "pi.peer",
      text: peer.content,
      createdAt: peer.createdAt,
      from: peer.from,
      to: peer.to,
      fromName: peer.fromName,
      toName: peer.toName,
    };
    const index = lines.findIndex((item) => item.createdAt !== null && item.createdAt > peer.createdAt);
    if (index < 0) lines.push(line);
    else lines.splice(index, 0, line);
  }
  return lines;
}

export function hiddenThreadEntryIds(entriesOldestFirst: readonly ThreadEntry[], peerEntryIds: ReadonlySet<string>): Set<string> {
  const hidden = new Set<string>();
  for (const entry of entriesOldestFirst) {
    if (entry.kind === "pi.user" && peerEntryIds.has(entry.id)) hidden.add(entry.id);
  }
  return hidden;
}
