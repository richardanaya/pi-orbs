import assert from "node:assert/strict";
import test from "node:test";
import {
  answerText,
  codeViewer,
  continueList,
  emojiQuery,
  faviconUrl,
  fileMarker,
  filterEmoji,
  groupLibrary,
  layoutDiagram,
  libraryItems,
  parseSheet,
  quoteBlock,
  readAnswerInput,
  readQuestionInput,
  segments,
  spellRanges,
  takeFileMarker,
  viewerKind,
  zipStore,
} from "../dist/thread-view.js";
import { hangNote, workingOn } from "../dist/work.js";

test("quote, lists, emoji, and spellcheck stay in the composer helpers", () => {
  assert.equal(quoteBlock("  status line\nsecond  "), "> status line\n> second\n\n");
  assert.equal(quoteBlock("   "), "");
  const listed = continueList("- sketch", 8);
  assert.equal(listed.value, "- sketch\n- ");
  assert.equal(listed.caret, 11);
  const numbered = continueList("1. first", 8);
  assert.equal(numbered.value, "1. first\n2. ");
  assert.equal(numbered.caret, 12);
  const exit = continueList("- \nkeep", 2);
  assert.equal(exit.value, "\nkeep");
  assert.equal(continueList("plain", 5), null);

  assert.deepEqual(emojiQuery("see :ro", 7), { start: 4, query: "ro" });
  assert.equal(emojiQuery("see :", 5).query, "");
  assert.equal(emojiQuery("smile", 5), null);
  assert.equal(filterEmoji("roc")[0].name, "rocket");
  assert.ok(filterEmoji("").length <= 8);

  const ranges = spellRanges("The staatus page");
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].word, "staatus");
  assert.ok(ranges[0].suggestions.includes("status"));
  assert.equal(spellRanges("The status page").length, 0);
  assert.equal(spellRanges("staatus", ["staatus"]).length, 0);
  assert.equal(spellRanges("OK").length, 0);
});

test("links use a generic favicon and fences split from prose", () => {
  const parts = segments("See https://example.com/status.html, and [notes](https://example.com/notes).");
  assert.equal(parts[1].type, "link");
  assert.equal(parts[1].href, "https://example.com/status.html");
  assert.equal(faviconUrl(parts[1].href), "https://www.google.com/s2/favicons?domain=example.com&sz=32");
  assert.equal(faviconUrl("not a url"), null);
  const fenced = segments("Before\n```html\n<p>Hi</p>\n```\nAfter");
  assert.equal(fenced.some((part) => part.type === "code" && part.lang === "html" && part.text === "<p>Hi</p>"), true);
  assert.equal(codeViewer("html", "<p>Hi</p>"), "html");
  assert.equal(codeViewer("csv", "a,b"), "sheet");
});

test("sheets, diagrams, viewers, and the library group by age", () => {
  const sheet = parseSheet('name,note\nAda,"a, line"\n');
  assert.deepEqual(sheet.rows, [["name", "note"], ["Ada", "a, line"]]);
  const diagram = layoutDiagram("Ada -> Kepler: status\nKepler --> Nova");
  assert.ok(diagram);
  assert.deepEqual(diagram.edges.map((edge) => edge.label), ["status", ""]);
  assert.equal(diagram.nodes.length, 3);
  const mermaid = layoutDiagram("graph TD\nA-->|yes|B");
  assert.equal(mermaid.edges[0].from, "A");
  assert.equal(mermaid.edges[0].to, "B");
  assert.equal(mermaid.edges[0].label, "yes");
  assert.equal(codeViewer("mermaid", "A-->B"), "diagram");
  assert.equal(viewerKind("shot.png", "application/octet-stream"), "image");
  assert.equal(viewerKind("clip.mp4", ""), "video");
  assert.equal(viewerKind("rows.csv", "text/plain"), "sheet");
  assert.equal(viewerKind("page.html", "text/plain"), "html");

  const now = new Date(2026, 9, 5, 18, 0, 0);
  const items = libraryItems({
    messages: [
      { text: "Done. status.html is in the work directory. See https://example.com/a", createdAt: new Date(2026, 9, 5, 12).toISOString() },
      { text: "Older note https://example.com/old", createdAt: new Date(2026, 8, 1, 12).toISOString() },
      { text: "```html\n<p>Week</p>\n```", createdAt: new Date(2026, 9, 2, 12).toISOString() },
    ],
    files: [{ id: "f1", name: "sheet.csv", mime: "text/csv", createdAt: new Date(2026, 9, 5, 16).toISOString() }],
  });
  const groups = groupLibrary(items, now);
  assert.ok(groups.today.some((item) => item.title === "status.html" && item.kind === "page"));
  assert.ok(groups.today.some((item) => item.kind === "link" && item.url === "https://example.com/a"));
  assert.ok(groups.today.some((item) => item.fileId === "f1" && item.kind === "file"));
  assert.ok(groups.week.some((item) => item.kind === "page"));
  assert.ok(groups.older.some((item) => item.url === "https://example.com/old"));
});

test("file markers, questions, and a zip of downloads", () => {
  const marked = `See the sheet.\n\nAttached: uploads/ada/f1-status.csv\n${fileMarker(["f1"])}`;
  const taken = takeFileMarker(marked);
  assert.deepEqual(taken.fileIds, ["f1"]);
  assert.equal(taken.text.includes("pi-orbs-files"), false);
  assert.match(taken.text, /Attached: uploads\/ada\/f1-status.csv/);
  const question = readQuestionInput({ prompt: "Which pages?", options: ["Status", "Roster"] });
  assert.equal(question.options.length, 2);
  assert.equal(readQuestionInput({ prompt: "One", options: ["Only"] }).error, "choose between 2 and 12 options");
  assert.deepEqual(readAnswerInput(["o1", "o2"], ["o1", "o2"]), ["o1", "o2"]);
  assert.equal(answerText([{ id: "o1", label: "Status" }, { id: "o2", label: "Roster" }], ["o1", "o2"]), "Selected: Status, Roster");
  const zip = zipStore([
    { name: "a.txt", data: new TextEncoder().encode("one") },
    { name: "a.txt", data: new TextEncoder().encode("two") },
  ], "2026-10-05T00:00:00.000Z");
  assert.equal(zip[0], 0x50);
  assert.equal(zip[1], 0x4b);
  assert.ok(zip.length > 40);
});

test("working status and hang notes name the step", () => {
  assert.equal(workingOn("bash", { command: "ls -la" }), "working on ls -la");
  assert.equal(workingOn("read", { path: "uploads/ada/status.html" }), "working on reading status.html");
  assert.equal(workingOn("update_self"), "working on its name and face");
  assert.equal(hangNote("bash"), "Stopped an unresponsive command so the next message can continue.");
  assert.equal(hangNote("read"), "Stopped an unresponsive read so the next message can continue.");
});
