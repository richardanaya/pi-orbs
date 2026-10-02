// JSON transcripts packed as a stored (uncompressed) zip.
// The archive identifies bots. It does not carry API keys or connector secrets.

export type ExportKind = "pi.user" | "pi.assistant";

export type ExportMessage = {
  id: string;
  kind: ExportKind;
  text: string;
  createdAt: string | null;
};

export type ExportBot = {
  id: string;
  name: string;
  conversationId: string;
  instruction: string;
  look: string;
  messages: ExportMessage[];
};

export type ExportSnapshot = {
  sprite: string;
  exportedAt: string;
  bots: ExportBot[];
};

export type ConversationsArchive = {
  filename: string;
  zip: Buffer;
};

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let crc = n;
  for (let k = 0; k < 8; k += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  CRC_TABLE[n] = crc >>> 0;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(iso: string): { time: number; date: number } {
  const parsed = new Date(iso);
  const when = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const year = Math.min(2107, Math.max(1980, when.getUTCFullYear()));
  const time = (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | Math.floor(when.getUTCSeconds() / 2);
  const date = ((year - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate();
  return { time, date };
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  const needles = [...new Set(secrets.filter((item) => item.length >= 16))].sort((a, b) => b.length - a.length);
  let out = text;
  for (const needle of needles) out = out.split(needle).join("[redacted]");
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readMessage(value: unknown): ExportMessage | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = typeof record.id === "string" || typeof record.id === "number" ? String(record.id) : "";
  const kind = record.kind === "pi.user" || record.kind === "pi.assistant" ? record.kind : null;
  const text = typeof record.text === "string" ? record.text : null;
  if (!id || !kind || text === null || text.trim().length === 0) return null;
  const createdAt = typeof record.createdAt === "string" && !Number.isNaN(Date.parse(record.createdAt))
    ? new Date(record.createdAt).toISOString()
    : null;
  return { id, kind, text, createdAt };
}

function readBot(value: unknown): ExportBot | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = typeof record.id === "string" ? record.id : "";
  const name = typeof record.name === "string" ? record.name : "";
  const conversationId = typeof record.conversationId === "string" && record.conversationId ? record.conversationId : id;
  if (!id || !name) return null;
  if (record.messages !== undefined && !Array.isArray(record.messages)) return null;
  const messages: ExportMessage[] = [];
  for (const item of Array.isArray(record.messages) ? record.messages : []) {
    const message = readMessage(item);
    if (message) messages.push(message);
  }
  return {
    id,
    name,
    conversationId,
    instruction: typeof record.instruction === "string" ? record.instruction : "",
    look: typeof record.look === "string" ? record.look : "",
    messages,
  };
}

export function readExport(sprite: string, body: unknown): ExportSnapshot | null {
  const record = asRecord(body);
  if (!record || !Array.isArray(record.bots)) return null;
  const bots: ExportBot[] = [];
  for (const item of record.bots) {
    const bot = readBot(item);
    if (!bot) return null;
    bots.push(bot);
  }
  const exportedAt = typeof record.exportedAt === "string" && !Number.isNaN(Date.parse(record.exportedAt))
    ? new Date(record.exportedAt).toISOString()
    : new Date().toISOString();
  return { sprite, exportedAt, bots };
}

function safeToken(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
  return cleaned || fallback;
}

function botPath(id: string, used: Set<string>): string {
  const cleaned = id.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_").slice(0, 80) || "bot";
  let name = `bots/${cleaned}.json`;
  let n = 2;
  while (used.has(name)) {
    name = `bots/${cleaned}-${n}.json`;
    n += 1;
  }
  used.add(name);
  return name;
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readme(empty: boolean): string {
  const lines = [
    "Pi Orbs conversation export",
    "Format: pi-orbs-conversations version 1",
    "",
    "This zip is a backup of every bot conversation on the sprite.",
    "Each bot is one JSON transcript. Import is not supported.",
    "API keys and connector credentials are not included.",
    "",
    "manifest.json",
    "  format           \"pi-orbs-conversations\"",
    "  formatVersion    1",
    "  sprite           sprite name",
    "  exportedAt       ISO-8601 time of this export",
    "  bots[]           id, name, conversationId, instruction, look,",
    "                   file, messageCount, firstMessageAt, lastMessageAt",
    "",
    "bots/<id>.json",
    "  id, name, conversationId, instruction, look",
    "  messages[]       id, kind (\"pi.user\" or \"pi.assistant\"), text,",
    "                   createdAt (ISO-8601, or null when the transcript has no time)",
    "",
    "Messages are the user and assistant text the thread shows, oldest first.",
    "Tool traces and thinking text are omitted.",
    "",
  ];
  if (empty) {
    lines.push("This archive has no conversations. The sprite had no bots when it was created.");
    lines.push("");
  }
  return lines.join("\n");
}

function zipStore(files: { name: string; text: string }[], when: string): Buffer {
  const { time, date } = dosDateTime(when);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.from(file.text, "utf8");
    if (name.length > 0xffff || data.length > 0xffffffff) throw new Error("export is too large");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralDir, eocd]);
}

export function archiveHeaders(filename: string, byteLength: number): Record<string, string> {
  return {
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="${filename}"`,
    "content-length": String(byteLength),
    "cache-control": "no-store",
  };
}

export function conversationsArchive(snapshot: ExportSnapshot, secrets: readonly string[] = []): ConversationsArchive {
  const redact = (text: string) => redactSecrets(text, secrets);
  const used = new Set<string>();
  const listed = snapshot.bots.map((bot) => {
    const file = botPath(bot.id, used);
    const messages = bot.messages.map((message) => ({
      id: message.id,
      kind: message.kind,
      text: redact(message.text),
      createdAt: message.createdAt,
    }));
    const first = messages[0]?.createdAt ?? null;
    const last = messages.at(-1)?.createdAt ?? null;
    return {
      file,
      bot: {
        id: bot.id,
        name: redact(bot.name),
        conversationId: bot.conversationId,
        instruction: redact(bot.instruction),
        look: bot.look,
        messages,
      },
      summary: {
        id: bot.id,
        name: redact(bot.name),
        conversationId: bot.conversationId,
        instruction: redact(bot.instruction),
        look: bot.look,
        file,
        messageCount: messages.length,
        firstMessageAt: first,
        lastMessageAt: last,
      },
    };
  });
  const empty = listed.length === 0;
  const manifest: Record<string, unknown> = {
    format: "pi-orbs-conversations",
    formatVersion: 1,
    sprite: snapshot.sprite,
    exportedAt: snapshot.exportedAt,
    bots: listed.map((item) => item.summary),
  };
  if (empty) manifest.note = "This archive has no conversations. The sprite had no bots when it was created.";
  const files = [
    { name: "README.txt", text: readme(empty) },
    { name: "manifest.json", text: jsonText(manifest) },
    ...listed.map((item) => ({ name: item.file, text: jsonText(item.bot) })),
  ];
  const day = /^\d{4}-\d{2}-\d{2}/.exec(snapshot.exportedAt)?.[0] ?? "export";
  const filename = `pi-orbs-${safeToken(snapshot.sprite, "sprite")}-conversations-${day}.zip`;
  return { filename, zip: zipStore(files, snapshot.exportedAt) };
}
