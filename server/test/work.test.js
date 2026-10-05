import assert from "node:assert/strict";
import test from "node:test";
import { bashTimeoutSeconds, hangLimit, hangNote, isHung, workingOn } from "../dist/work.js";

test("a hung tool is named in the note and bash timeouts stay under the limit", () => {
  assert.equal(hangLimit({ PI_ORBS_HANG_MS: "1500" }), 1500);
  assert.equal(hangLimit({}), 90_000);
  assert.equal(isHung(1_000, 91_000, 90_000), true);
  assert.equal(isHung(1_000, 50_000, 90_000), false);
  assert.equal(workingOn("bash", { command: "sleep 99\nmore" }), "working on sleep 99");
  assert.equal(workingOn("ask_question"), "working on a question");
  assert.equal(hangNote(), "Stopped an unresponsive command so the next message can continue.");
  assert.equal(hangNote("edit"), "Stopped an unresponsive edit so the next message can continue.");
  assert.equal(bashTimeoutSeconds(300, 90_000), 90);
  assert.equal(bashTimeoutSeconds(10, 90_000), 10);
});
