// Files, questions, and hang notes stored beside the roster. Bytes live under the work directory.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const UPLOAD_MAX = 8 * 1024 * 1024;

export type FileRecord = {
  id: string;
  botId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  relativePath: string;
  messageId?: string;
};

export type QuestionOption = { id: string; label: string };
export type QuestionRecord = {
  id: string;
  botId: string;
  prompt: string;
  options: QuestionOption[];
  createdAt: string;
  selected?: string[];
  answeredAt?: string;
};

export type NoteRecord = {
  id: string;
  botId: string;
  text: string;
  createdAt: string;
};

export type PublicFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  path: string;
  messageId?: string;
};

export type PublicQuestion = {
  id: string;
  prompt: string;
  options: QuestionOption[];
  createdAt: string;
  selected?: string[];
  answeredAt?: string;
};

const FILE_MARKER = /<!--\s*pi-orbs-files:([A-Za-z0-9,._-]+)\s*-->/g;

export function newId(prefix: string): string {
  return `${prefix}${randomBytes(4).toString("hex")}`;
}

export function safeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "file";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return cleaned || "file";
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

export function decodeUpload(body: Record<string, unknown>): { name: string; mime: string; bytes: Buffer } | { error: string } {
  const name = safeFileName(typeof body.name === "string" ? body.name : "file");
  const mime = typeof body.mime === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(body.mime) ? body.mime : "application/octet-stream";
  if (typeof body.data !== "string" || !body.data.trim()) return { error: "file data is required" };
  const compact = body.data.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(compact)) return { error: "file data is invalid" };
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length === 0) return { error: "file data is required" };
  if (bytes.length > UPLOAD_MAX) return { error: "file is too large" };
  return { name, mime, bytes };
}

export function readQuestionInput(body: Record<string, unknown>): { prompt: string; options: string[] } | { error: string } {
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

export function answerText(options: readonly QuestionOption[], selected: readonly string[]): string {
  const labels = selected.map((id) => options.find((option) => option.id === id)?.label ?? id);
  return `Selected: ${labels.join(", ")}`;
}

export function publicFile(file: FileRecord): PublicFile {
  return {
    id: file.id,
    name: file.name,
    mime: file.mime,
    size: file.size,
    createdAt: file.createdAt,
    path: file.relativePath,
    ...(file.messageId ? { messageId: file.messageId } : {}),
  };
}

export function publicQuestion(question: QuestionRecord): PublicQuestion {
  return {
    id: question.id,
    prompt: question.prompt,
    options: question.options,
    createdAt: question.createdAt,
    ...(question.selected ? { selected: question.selected } : {}),
    ...(question.answeredAt ? { answeredAt: question.answeredAt } : {}),
  };
}

async function readList<T>(path: string, key: string): Promise<T[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, unknown>)[key])) return [];
    return (parsed as Record<string, T[]>)[key] ?? [];
  } catch {
    return [];
  }
}

async function writeList(path: string, key: string, items: unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ [key]: items }, null, 2));
}

function asFile(item: unknown): FileRecord | null {
  if (!item || typeof item !== "object") return null;
  const record = item as FileRecord;
  if (typeof record.id !== "string" || typeof record.botId !== "string" || typeof record.name !== "string") return null;
  if (typeof record.mime !== "string" || typeof record.size !== "number" || typeof record.relativePath !== "string") return null;
  if (typeof record.createdAt !== "string") return null;
  return {
    id: record.id,
    botId: record.botId,
    name: record.name,
    mime: record.mime,
    size: record.size,
    createdAt: record.createdAt,
    relativePath: record.relativePath,
    ...(typeof record.messageId === "string" && record.messageId ? { messageId: record.messageId } : {}),
  };
}

export async function loadFiles(path: string): Promise<FileRecord[]> {
  const list = await readList<unknown>(path, "files");
  return list.map(asFile).filter((item): item is FileRecord => item !== null);
}

export async function saveFiles(path: string, files: FileRecord[]): Promise<void> {
  await writeList(path, "files", files);
}

function asQuestion(item: unknown): QuestionRecord | null {
  if (!item || typeof item !== "object") return null;
  const record = item as QuestionRecord;
  if (typeof record.id !== "string" || typeof record.botId !== "string" || typeof record.prompt !== "string") return null;
  if (!Array.isArray(record.options) || typeof record.createdAt !== "string") return null;
  const options = record.options.filter((option) => option && typeof option.id === "string" && typeof option.label === "string");
  if (options.length < 2) return null;
  return {
    id: record.id,
    botId: record.botId,
    prompt: record.prompt,
    options,
    createdAt: record.createdAt,
    ...(Array.isArray(record.selected) ? { selected: record.selected.filter((id) => typeof id === "string") } : {}),
    ...(typeof record.answeredAt === "string" ? { answeredAt: record.answeredAt } : {}),
  };
}

export async function loadQuestions(path: string): Promise<QuestionRecord[]> {
  const list = await readList<unknown>(path, "questions");
  return list.map(asQuestion).filter((item): item is QuestionRecord => item !== null);
}

export async function saveQuestions(path: string, questions: QuestionRecord[]): Promise<void> {
  await writeList(path, "questions", questions);
}

function asNote(item: unknown): NoteRecord | null {
  if (!item || typeof item !== "object") return null;
  const record = item as NoteRecord;
  if (typeof record.id !== "string" || typeof record.botId !== "string" || typeof record.text !== "string") return null;
  if (typeof record.createdAt !== "string") return null;
  return { id: record.id, botId: record.botId, text: record.text, createdAt: record.createdAt };
}

export async function loadNotes(path: string): Promise<NoteRecord[]> {
  const list = await readList<unknown>(path, "notes");
  return list.map(asNote).filter((item): item is NoteRecord => item !== null);
}

export async function saveNotes(path: string, notes: NoteRecord[]): Promise<void> {
  const kept = notes.length > 200 ? notes.slice(notes.length - 200) : notes;
  await writeList(path, "notes", kept);
}
