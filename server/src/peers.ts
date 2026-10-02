export const PEER_CONTENT_MAX = 8_000;
export const PEER_REQUEST_PREFIX = "peer:";
export const PEER_LEDGER_MAX = 1_000;

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

export function peerPrompt(fromName: string, fromId: string, content: string): string {
  return [
    `Message from bot ${fromName} (id ${fromId}).`,
    "This is another bot on this sprite, not the human user.",
    "It was steered into this conversation. The human's thread does not show it.",
    "",
    content,
  ].join("\n");
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
      createdAt,
    });
  }
  return peers;
}

// Peer steers are Pi user inputs on the target conversation. Hide those entries.
// Hide the following assistant turn only when the turn has no human user entry.
// A steer that joins an in-flight human turn shares that answer, so it stays.
export function hiddenThreadEntryIds(entriesOldestFirst: readonly ThreadEntry[], peerEntryIds: ReadonlySet<string>): Set<string> {
  const hidden = new Set<string>();
  let peerUsers: string[] = [];
  let human = false;
  let rest: string[] = [];
  const flush = () => {
    for (const id of peerUsers) hidden.add(id);
    if (peerUsers.length > 0 && !human) {
      for (const id of rest) hidden.add(id);
    }
    peerUsers = [];
    human = false;
    rest = [];
  };
  for (const entry of entriesOldestFirst) {
    if (entry.kind === "pi.user") {
      if (rest.length > 0) flush();
      if (peerEntryIds.has(entry.id)) peerUsers.push(entry.id);
      else human = true;
      continue;
    }
    rest.push(entry.id);
  }
  flush();
  return hidden;
}
