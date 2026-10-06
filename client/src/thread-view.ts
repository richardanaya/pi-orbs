// Pure helpers for the thread page: composer, links, viewers, and the library.
// No DOM and no Node APIs, so the built file can load in the browser.
import { Marked } from "marked";
import { WORD_LIST } from "./words.js";

export type Segment =
  | { type: "text"; text: string }
  | { type: "link"; href: string; text: string }
  | { type: "code"; lang: string; text: string };

export type SpellRange = { start: number; end: number; word: string; suggestions: string[] };

export type Emoji = { name: string; emoji: string };

export type Sheet = { rows: string[][]; truncated: boolean };

export type DiagramNode = { id: string; x: number; y: number; w: number; h: number };
export type DiagramEdge = { from: string; to: string; label: string };
export type Diagram = { width: number; height: number; nodes: DiagramNode[]; edges: DiagramEdge[] };

export type LibraryKind = "page" | "file" | "link";
export type LibraryItem = {
  id: string;
  kind: LibraryKind;
  title: string;
  createdAt: string;
  url?: string;
  fileId?: string;
};

export type ViewerKind = "image" | "video" | "sheet" | "html" | "diagram" | "file";

const WORDS = new Set(WORD_LIST.split("\n"));

export const EMOJI: Emoji[] = [
  { name: "smile", emoji: "🙂" },
  { name: "grin", emoji: "😁" },
  { name: "joy", emoji: "😂" },
  { name: "wink", emoji: "😉" },
  { name: "heart", emoji: "❤️" },
  { name: "thumbsup", emoji: "👍" },
  { name: "thumbsdown", emoji: "👎" },
  { name: "clap", emoji: "👏" },
  { name: "wave", emoji: "👋" },
  { name: "eyes", emoji: "👀" },
  { name: "fire", emoji: "🔥" },
  { name: "sparkles", emoji: "✨" },
  { name: "tada", emoji: "🎉" },
  { name: "check", emoji: "✅" },
  { name: "x", emoji: "❌" },
  { name: "warning", emoji: "⚠️" },
  { name: "bulb", emoji: "💡" },
  { name: "rocket", emoji: "🚀" },
  { name: "star", emoji: "⭐" },
  { name: "pin", emoji: "📌" },
  { name: "link", emoji: "🔗" },
  { name: "paperclip", emoji: "📎" },
  { name: "folder", emoji: "📁" },
  { name: "page", emoji: "📄" },
  { name: "memo", emoji: "📝" },
  { name: "book", emoji: "📖" },
  { name: "mag", emoji: "🔍" },
  { name: "gear", emoji: "⚙️" },
  { name: "lock", emoji: "🔒" },
  { name: "key", emoji: "🔑" },
  { name: "clock", emoji: "🕐" },
  { name: "calendar", emoji: "📅" },
  { name: "speech", emoji: "💬" },
  { name: "thought", emoji: "💭" },
  { name: "coffee", emoji: "☕" },
  { name: "pizza", emoji: "🍕" },
  { name: "cake", emoji: "🍰" },
  { name: "sun", emoji: "☀️" },
  { name: "moon", emoji: "🌙" },
  { name: "cloud", emoji: "☁️" },
  { name: "rain", emoji: "🌧️" },
  { name: "zap", emoji: "⚡" },
  { name: "bug", emoji: "🐛" },
  { name: "robot", emoji: "🤖" },
  { name: "computer", emoji: "💻" },
  { name: "phone", emoji: "📱" },
  { name: "mail", emoji: "✉️" },
  { name: "package", emoji: "📦" },
  { name: "chart", emoji: "📊" },
  { name: "art", emoji: "🎨" },
  { name: "music", emoji: "🎵" },
  { name: "white_check_mark", emoji: "✅" },
  { name: "hourglass", emoji: "⏳" },
  { name: "question", emoji: "❓" },
  { name: "plus", emoji: "➕" },
  { name: "ok", emoji: "👌" },
];

const FILE_MARKER = /<!--\s*pi-orbs-files:([A-Za-z0-9,._-]+)\s*-->/g;

export function quoteBlock(text: string): string {
  const cleaned = text.replace(/\s+$/g, "").replace(/^\s+/g, "");
  if (!cleaned) return "";
  return cleaned.split("\n").map((line) => `> ${line}`).join("\n") + "\n\n";
}

export function continueList(value: string, caret: number): { value: string; caret: number } | null {
  const start = value.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  const line = value.slice(start, caret);
  const bullet = /^(\s*)([-+])\s+(.*)$/.exec(line);
  const numbered = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
  const matched = bullet ?? numbered;
  if (!matched) return null;
  const indent = matched[1] ?? "";
  const body = matched[3] ?? "";
  if (!body.trim()) {
    const next = value.slice(0, start) + value.slice(caret);
    return { value: next, caret: start };
  }
  const marker = bullet ? `${bullet[2]} ` : `${Number(numbered?.[2] ?? "1") + 1}. `;
  const insert = `\n${indent}${marker}`;
  return { value: value.slice(0, caret) + insert + value.slice(caret), caret: caret + insert.length };
}

export function emojiQuery(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const match = /(?:^|[\s])(:([a-z0-9_+]{0,24}))$/i.exec(before);
  if (!match || match[1] === undefined) return null;
  const query = (match[2] ?? "").toLowerCase();
  return { start: caret - match[1].length, query };
}

export function mentionQuery(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const match = /(?:^|\s)(@([^\s@]{0,40}))$/.exec(before);
  if (!match || match[1] === undefined) return null;
  return { start: caret - match[1].length, query: match[2] ?? "" };
}

export function filterMentions(names: readonly string[], query: string): string[] {
  const needle = query.toLowerCase();
  return names
    .filter((name) => name.trim() && name.toLowerCase().startsWith(needle))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 8);
}

export function filterEmoji(query: string): Emoji[] {
  const needle = query.toLowerCase();
  const ranked = EMOJI.filter((item) => !needle || item.name.includes(needle));
  ranked.sort((left, right) => {
    const leftHit = left.name.startsWith(needle) ? 0 : 1;
    const rightHit = right.name.startsWith(needle) ? 0 : 1;
    return leftHit - rightHit || left.name.localeCompare(right.name);
  });
  return ranked.slice(0, 8);
}

function editDistance(left: string, right: string): number {
  if (Math.abs(left.length - right.length) > 2) return 3;
  const row = new Array<number>(right.length + 1);
  for (let j = 0; j <= right.length; j += 1) row[j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    let previous = i - 1;
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const saved = row[j] ?? 0;
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      row[j] = Math.min((row[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, previous + cost);
      previous = saved;
    }
  }
  return row[right.length] ?? 3;
}

const buckets = new Map<string, string[]>();
for (const word of WORDS) {
  const key = word.slice(0, 1);
  const list = buckets.get(key);
  if (list) list.push(word);
  else buckets.set(key, [word]);
}

export function spellRanges(text: string, extra: readonly string[] = []): SpellRange[] {
  const known = new Set(extra.map((word) => word.toLowerCase()));
  const ranges: SpellRange[] = [];
  const pattern = /[A-Za-z][A-Za-z']+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const word = match[0];
    if (word.length < 3) continue;
    if (/[A-Z]/.test(word.slice(1))) continue;
    const lower = word.toLowerCase().replace(/'/g, "");
    if (WORDS.has(lower) || known.has(lower)) continue;
    const pool = buckets.get(lower.slice(0, 1)) ?? [];
    const suggestions: string[] = [];
    for (const candidate of pool) {
      if (Math.abs(candidate.length - lower.length) > 2) continue;
      if (editDistance(lower, candidate) > 2) continue;
      suggestions.push(candidate);
      if (suggestions.length === 5) break;
    }
    ranges.push({ start: match.index, end: match.index + word.length, word, suggestions });
  }
  return ranges;
}

export function segments(text: string): Segment[] {
  const blocks: Segment[] = [];
  const fence = /```([A-Za-z0-9_+-]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text))) {
    if (match.index > cursor) blocks.push(...linkify(text.slice(cursor, match.index)));
    blocks.push({ type: "code", lang: (match[1] ?? "").toLowerCase(), text: (match[2] ?? "").replace(/\n$/, "") });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) blocks.push(...linkify(text.slice(cursor)));
  return blocks;
}

function linkify(text: string): Segment[] {
  const out: Segment[] = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>)\]]+/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) out.push({ type: "text", text: text.slice(cursor, match.index) });
    if (match[2]) {
      out.push({ type: "link", href: trimUrl(match[2]), text: match[1] ?? match[2] });
    } else {
      const href = trimUrl(match[0]);
      out.push({ type: "link", href, text: href.replace(/^https?:\/\//, "") });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) out.push({ type: "text", text: text.slice(cursor) });
  if (out.length === 0) out.push({ type: "text", text });
  return out;
}

function trimUrl(href: string): string {
  return href.replace(/[.,!?;:]+$/g, "");
}

const VIDEO_EXT = /\.(mp4|webm|mov|ogv)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function mediaPath(url: string): string {
  const bare = url.split(/[?#]/, 1)[0] ?? url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(bare)) {
    try {
      return new URL(bare).pathname;
    } catch {
      return bare;
    }
  }
  return bare;
}

// Remote http(s) URLs and app-relative paths. Rejects javascript:, data:, and other schemes.
export function safeChatUrl(raw: string): string | null {
  const href = raw.trim();
  if (!href || href.length > 2048) return null;
  if (/[\u0000-\u001F\u007F]/.test(href)) return null;
  if (href.startsWith("//") || href.startsWith("\\\\")) return null;
  const lower = href.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:") || lower.startsWith("file:") || lower.startsWith("blob:")) {
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    try {
      const url = new URL(href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url.href;
    } catch {
      return null;
    }
  }
  if (/["'<>\s]/.test(href)) return null;
  return href;
}

export function chatMediaKind(url: string): "image" | "video" | null {
  const path = mediaPath(url);
  if (VIDEO_EXT.test(path)) return "video";
  if (IMAGE_EXT.test(path)) return "image";
  return null;
}

function bareMediaLabel(label: string, href: string): boolean {
  const plain = label.trim();
  if (!plain) return true;
  return plain === href || plain === href.replace(/^https?:\/\//, "");
}

function videoHtml(src: string, caption: string): string {
  const video = `<video class="chat-video" controls playsinline preload="metadata" src="${escapeHtml(src)}"></video>`;
  if (bareMediaLabel(caption, src)) return video;
  return `<span class="chat-media">${video}<span class="media-caption">${escapeHtml(caption)}</span></span>`;
}

function imageHtml(src: string, alt: string, title?: string | null): string {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return `<img class="chat-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"${titleAttr}>`;
}

export function fenceLang(lang: string | null | undefined): string {
  return (lang ?? "").match(/^[A-Za-z0-9_+-]+/)?.[0]?.toLowerCase() ?? "";
}

const chatMarked = new Marked({ gfm: true, breaks: true });
chatMarked.use({
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    code({ text, lang, escaped }) {
      const langName = fenceLang(lang);
      const body = `${(escaped ? text : escapeHtml(text)).replace(/\n$/, "")}\n`;
      const klass = langName ? ` class="language-${langName}"` : "";
      const data = langName ? ` data-lang="${langName}"` : "";
      return `<pre class="fence"${data}><code${klass}>${body}</code></pre>\n`;
    },
    link(token) {
      const label = this.parser.parseInline(token.tokens);
      const safe = safeChatUrl(token.href);
      if (!safe) return label;
      const kind = chatMediaKind(safe);
      if (kind === "video") return videoHtml(safe, token.text);
      if (kind === "image" && bareMediaLabel(token.text, token.href)) return imageHtml(safe, "");
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      return `<a href="${escapeHtml(safe)}"${title}>${label}</a>`;
    },
    image(token) {
      const alt = token.tokens ? this.parser.parseInline(token.tokens, this.parser.textRenderer) : token.text;
      const safe = safeChatUrl(token.href);
      if (!safe) return escapeHtml(alt || token.text || "");
      if (chatMediaKind(safe) === "video") return videoHtml(safe, alt);
      return imageHtml(safe, alt, token.title);
    },
  },
  hooks: {
    postprocess(html) {
      return html.replaceAll("<table>", '<div class="table-scroll"><table>').replaceAll("</table>", "</table></div>");
    },
  },
});

export function renderChatMarkdown(text: string): string {
  const html = chatMarked.parse(text, { async: false });
  return html;
}

export function faviconUrl(href: string): string | null {
  try {
    const host = new URL(href).hostname;
    if (!host) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
  } catch {
    return null;
  }
}

export function parseSheet(text: string, limit = 10_000): Sheet {
  const sample = text.slice(0, 4000);
  const commas = (sample.match(/,/g) ?? []).length;
  const tabs = (sample.match(/\t/g) ?? []).length;
  const delimiter = tabs > commas ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let truncated = false;
  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    if (row.length === 1 && row[0] === "" && rows.length > 0) {
      row = [];
      return;
    }
    if (rows.length >= limit) {
      truncated = true;
      row = [];
      return;
    }
    rows.push(row.slice(0, 40));
    if (row.length > 40) truncated = true;
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? "";
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell.length === 0) {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      pushCell();
      continue;
    }
    if (char === "\n") {
      pushCell();
      pushRow();
      if (truncated && rows.length >= limit) break;
      continue;
    }
    if (char === "\r") continue;
    cell += char;
  }
  if (!truncated && (cell.length > 0 || row.length > 0)) {
    pushCell();
    pushRow();
  }
  return { rows, truncated };
}

export function layoutDiagram(source: string): Diagram | null {
  const edges: DiagramEdge[] = [];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("%%") || /^(graph|flowchart)\b/i.test(line) || line === "end") continue;
    const mermaid = /^([A-Za-z0-9_]+)\s*-->(?:\|([^|]*)\|)?\s*([A-Za-z0-9_]+)\s*$/.exec(line);
    const plain = /^(.+?)\s*-{1,2}>\s*(.+?)(?:\s*:\s*(.+))?$/.exec(line);
    if (mermaid?.[1] && mermaid[3]) {
      edges.push({ from: mermaid[1], to: mermaid[3], label: (mermaid[2] ?? "").trim() });
    } else if (plain?.[1] && plain[2]) {
      edges.push({ from: plain[1].trim(), to: plain[2].trim(), label: (plain[3] ?? "").trim() });
    }
  }
  if (edges.length === 0) return null;
  const order: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
  };
  for (const edge of edges) {
    add(edge.from);
    add(edge.to);
  }
  const incoming = new Map<string, number>();
  for (const id of order) incoming.set(id, 0);
  for (const edge of edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  const depth = new Map<string, number>();
  const pending = order.filter((id) => (incoming.get(id) ?? 0) === 0);
  if (pending.length === 0 && order[0]) pending.push(order[0]);
  for (const id of pending) depth.set(id, 0);
  const guard = order.length * order.length + 4;
  let steps = 0;
  while (pending.length && steps < guard) {
    steps += 1;
    const id = pending.shift();
    if (!id) break;
    const nextDepth = (depth.get(id) ?? 0) + 1;
    for (const edge of edges) {
      if (edge.from !== id) continue;
      const prior = depth.get(edge.to);
      if (prior === undefined || prior < nextDepth) {
        depth.set(edge.to, nextDepth);
        pending.push(edge.to);
      }
    }
  }
  for (const id of order) if (!depth.has(id)) depth.set(id, 0);
  const columns = new Map<number, string[]>();
  let maxDepth = 0;
  for (const id of order) {
    const column = depth.get(id) ?? 0;
    maxDepth = Math.max(maxDepth, column);
    const list = columns.get(column);
    if (list) list.push(id);
    else columns.set(column, [id]);
  }
  const nodes: DiagramNode[] = [];
  const gapX = 36;
  const gapY = 18;
  let x = 16;
  let height = 48;
  for (let column = 0; column <= maxDepth; column += 1) {
    const ids = columns.get(column) ?? [];
    let y = 16;
    let columnWidth = 72;
    for (const id of ids) {
      const w = Math.max(72, Math.min(220, 18 + id.length * 8));
      const h = 36;
      nodes.push({ id, x, y, w, h });
      columnWidth = Math.max(columnWidth, w);
      y += h + gapY;
    }
    height = Math.max(height, y);
    x += columnWidth + gapX;
  }
  return { width: Math.max(120, x - gapX + 16), height, nodes, edges };
}

export function viewerKind(name: string, mime: string): ViewerKind {
  const lower = name.toLowerCase();
  const type = mime.toLowerCase();
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|heic|heif|avif)$/.test(lower)) return "image";
  if (type.startsWith("video/") || /\.(mp4|webm|mov|ogv)$/.test(lower)) return "video";
  if (type.includes("csv") || type.includes("spreadsheet") || type.includes("tab-separated") || /\.(csv|tsv)$/.test(lower)) return "sheet";
  if (type === "text/html" || lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  return "file";
}

export function codeViewer(lang: string, source: string): "sheet" | "html" | "diagram" | "mermaid" | null {
  const name = fenceLang(lang);
  if (name === "csv" || name === "tsv") return "sheet";
  if (name === "html" || name === "htm") return "html";
  // Official Mermaid drawings. ```diagram and ```graph stay the small arrow sketch.
  if (name === "mermaid") return "mermaid";
  if (name === "diagram" || name === "graph") return layoutDiagram(source) ? "diagram" : null;
  return null;
}

export function libraryItems(input: {
  messages: { text?: string; createdAt?: string | null; kind?: string }[];
  files: { id: string; name: string; mime?: string; createdAt: string }[];
}): LibraryItem[] {
  const items: LibraryItem[] = [];
  const seen = new Set<string>();
  const push = (item: LibraryItem) => {
    const key = `${item.kind}\n${item.title}\n${item.url ?? ""}\n${item.fileId ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };
  for (const file of input.files) {
    const kind = viewerKind(file.name, file.mime ?? "") === "html" ? "page" : "file";
    push({
      id: `file:${file.id}`,
      kind,
      title: file.name,
      createdAt: file.createdAt,
      fileId: file.id,
    });
  }
  for (const message of input.messages) {
    const text = message.text ?? "";
    const createdAt = message.createdAt || "";
    if (!createdAt) continue;
    for (const segment of segments(text)) {
      if (segment.type === "link") {
        push({ id: `link:${segment.href}`, kind: "link", title: segment.text || segment.href, url: segment.href, createdAt });
      }
      if (segment.type === "code" && (segment.lang === "html" || segment.lang === "htm")) {
        const title = segment.text.trim().slice(0, 48) || "HTML page";
        push({ id: `page:${message.createdAt}:${title}`, kind: "page", title, createdAt });
      }
    }
    const pages = text.match(/\b[\w./-]+\.html?\b/gi) ?? [];
    for (const page of pages) {
      const title = page.split("/").pop() || page;
      push({ id: `page:${title}`, kind: "page", title, createdAt });
    }
  }
  items.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.title.localeCompare(right.title));
  return items;
}

export function groupLibrary(items: readonly LibraryItem[], now = new Date()): { today: LibraryItem[]; week: LibraryItem[]; older: LibraryItem[] } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const week = 7 * 24 * 60 * 60 * 1000;
  const groups = { today: [] as LibraryItem[], week: [] as LibraryItem[], older: [] as LibraryItem[] };
  for (const item of items) {
    const when = new Date(item.createdAt);
    if (Number.isNaN(when.getTime())) {
      groups.older.push(item);
      continue;
    }
    const day = new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime();
    const age = start - day;
    if (age <= 0) groups.today.push(item);
    else if (age < week) groups.week.push(item);
    else groups.older.push(item);
  }
  return groups;
}

export function fileMarker(ids: readonly string[]): string {
  return `<!-- pi-orbs-files:${ids.join(",")} -->`;
}

export function takeFileMarker(text: string): { text: string; fileIds: string[] } {
  const fileIds: string[] = [];
  const cleaned = text.replace(FILE_MARKER, (_all, raw: string) => {
    for (const id of raw.split(",")) {
      const trimmed = id.trim();
      if (trimmed) fileIds.push(trimmed);
    }
    return "";
  }).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: cleaned, fileIds };
}

export function safeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "file";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return cleaned || "file";
}

export function decodeBase64(data: string, limit = 8 * 1024 * 1024): Uint8Array | { error: string } {
  const trimmed = data.trim();
  if (!trimmed) return { error: "file data is required" };
  if (!/^[A-Za-z0-9+/=\s]+$/.test(trimmed)) return { error: "file data is invalid" };
  let binary: string;
  try {
    binary = atob(trimmed.replace(/\s/g, ""));
  } catch {
    return { error: "file data is invalid" };
  }
  if (binary.length === 0) return { error: "file data is required" };
  if (binary.length > limit) return { error: "file is too large" };
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let crc = n;
  for (let k = 0; k < 8; k += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  CRC_TABLE[n] = crc >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = (CRC_TABLE[(crc ^ (data[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function u32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

export function zipStore(files: { name: string; data: Uint8Array }[], iso = new Date().toISOString()): Uint8Array {
  const when = new Date(iso);
  const date = Number.isNaN(when.getTime()) ? new Date() : when;
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const used = new Set<string>();
  for (const file of files) {
    let name = file.name.replace(/\\/g, "/").split("/").pop() || "file";
    if (used.has(name)) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let n = 2;
      while (used.has(`${stem}-${n}${ext}`)) n += 1;
      name = `${stem}-${n}${ext}`;
    }
    used.add(name);
    const nameBytes = new TextEncoder().encode(name);
    const data = file.data;
    const crc = crc32(data);
    const local = new Uint8Array(30);
    const localView = new DataView(local.buffer);
    u32(localView, 0, 0x04034b50);
    u16(localView, 4, 20);
    u32(localView, 14, crc);
    u32(localView, 18, data.length);
    u32(localView, 22, data.length);
    u16(localView, 26, nameBytes.length);
    u16(localView, 10, time);
    u16(localView, 12, dosDate);
    parts.push(local, nameBytes, data);
    const central = new Uint8Array(46);
    const centralView = new DataView(central.buffer);
    u32(centralView, 0, 0x02014b50);
    u16(centralView, 4, 20);
    u16(centralView, 6, 20);
    u16(centralView, 12, time);
    u16(centralView, 14, dosDate);
    u32(centralView, 16, crc);
    u32(centralView, 20, data.length);
    u32(centralView, 24, data.length);
    u16(centralView, 28, nameBytes.length);
    u32(centralView, 42, offset);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  u32(eocdView, 0, 0x06054b50);
  u16(eocdView, 8, files.length);
  u16(eocdView, 10, files.length);
  u32(eocdView, 12, centralSize);
  u32(eocdView, 16, offset);
  const total = offset + centralSize + eocd.length;
  const zip = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...parts, ...centrals, eocd]) {
    zip.set(part, cursor);
    cursor += part.length;
  }
  return zip;
}

export function readQuestionInput(body: { prompt?: unknown; options?: unknown }): { prompt: string; options: string[] } | { error: string } {
  if (typeof body.prompt !== "string" || !body.prompt.trim()) return { error: "prompt is required" };
  const prompt = body.prompt.trim();
  if (prompt.length > 500) return { error: "prompt is too long" };
  if (!Array.isArray(body.options)) return { error: "options are required" };
  const options: string[] = [];
  for (const option of body.options) {
    if (typeof option !== "string" || !option.trim()) return { error: "options are required" };
    const label = option.trim();
    if (label.length > 80) return { error: "option is too long" };
    options.push(label);
  }
  if (options.length < 2 || options.length > 12) return { error: "choose between 2 and 12 options" };
  return { prompt, options };
}

export function answerText(options: readonly { id: string; label: string }[], selected: readonly string[]): string {
  const labels = selected.map((id) => options.find((option) => option.id === id)?.label ?? id);
  return `Selected: ${labels.join(", ")}`;
}

export function readAnswerInput(selected: unknown, optionIds: readonly string[]): string[] | { error: string } {
  if (!Array.isArray(selected) || selected.length === 0) return { error: "select at least one option" };
  const allowed = new Set(optionIds);
  const picked: string[] = [];
  for (const item of selected) {
    if (typeof item !== "string" || !allowed.has(item) || picked.includes(item)) return { error: "option is not recognized" };
    picked.push(item);
  }
  return picked;
}
