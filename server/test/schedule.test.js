import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { deleteCronJob, fetchCron, onceSchedule, parseCron, putCronJob, readHookBody, readScheduleRequest, setCronJobEnabled, tokensEqual } from "../dist/schedule.js";

test("onceSchedule turns an ISO time into a single UTC cron minute", () => {
  const at = "2026-10-06T15:04:00.000Z";
  const once = onceSchedule(at, Date.parse("2026-10-05T12:00:00.000Z"));
  assert.equal(once.cron, "4 15 6 10 *");
  assert.equal(once.at, at);
  assert.equal(once.schedule.expiresAt, Math.floor(Date.parse(at) / 1000) + 180);
  assert.deepEqual(once.schedule.minutes, [4]);
  assert.equal(onceSchedule("not-a-time").error, "time is invalid");
  assert.equal(onceSchedule("2020-01-01T00:00:00.000Z", Date.parse(at)).error, "time is in the past");
  const read = readScheduleRequest({ message: "Remind me.", at }, Date.parse("2026-10-05T12:00:00.000Z"));
  assert.equal(read.once, true);
  assert.equal(read.cron, "4 15 6 10 *");
  assert.equal(readScheduleRequest({ message: "Later." }).error, "cron is required");
});

test("parseCron accepts five fields and rejects a bad expression", () => {
  assert.deepEqual(parseCron("0 9 * * 1", "UTC"), {
    timezone: "UTC",
    expiresAt: 0,
    minutes: [0],
    hours: [9],
    mdays: [-1],
    months: [-1],
    wdays: [1],
  });
  assert.deepEqual(parseCron("*/15 * * * *").minutes, [0, 15, 30, 45]);
  assert.deepEqual(parseCron("0 9 * * 1-5").wdays, [1, 2, 3, 4, 5]);
  assert.deepEqual(parseCron("0 0 * * 7").wdays, [0]);
  assert.equal(parseCron("nope").error, "cron expression is invalid");
  assert.equal(parseCron("60 * * * *").error, "cron expression is invalid");
  assert.equal(parseCron("0 9 * * 1", "not a zone").error, "timezone is invalid");
});

test("webhook tokens compare in constant length and hook bodies need content", () => {
  const token = "ab".repeat(24);
  assert.equal(tokensEqual(token, token), true);
  assert.equal(tokensEqual(token, "cd".repeat(24)), false);
  assert.equal(tokensEqual("short", token), false);
  assert.deepEqual(readHookBody({ content: "  Check it.  " }), { content: "Check it." });
  assert.equal(readHookBody({}).error, "content is required");
  assert.equal(readHookBody({ content: "" }).error, "content is required");
});

test("putCronJob posts the webhook and delete removes that job", async () => {
  const seen = [];
  const jobs = new Map();
  let next = 1;
  const stub = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? JSON.parse(raw) : null;
    seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
    if (req.method === "PUT" && req.url === "/jobs") {
      const jobId = next++;
      jobs.set(jobId, body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jobId }));
      return;
    }
    if (req.method === "PATCH" && req.url === "/jobs/1") {
      const job = jobs.get(1);
      if (!job) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      job.job.enabled = body.job.enabled;
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    if (req.method === "DELETE" && req.url === "/jobs/1") {
      jobs.delete(1);
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const address = stub.address();
  const port = address && typeof address !== "string" ? address.port : 0;
  try {
    const call = fetchCron(`http://127.0.0.1:${port}`);
    const schedule = parseCron("0 9 * * 1");
    const created = await putCronJob(call, "cron-test-key", {
      url: "http://127.0.0.1/hooks/abc",
      title: "pi-orbs Ada",
      message: "Check the status page.",
      schedule,
    });
    assert.equal(created.jobId, 1);
    assert.equal(seen[0].method, "PUT");
    assert.equal(seen[0].authorization, "Bearer cron-test-key");
    assert.equal(seen[0].body.job.enabled, true);
    assert.equal(seen[0].body.job.requestMethod, 1);
    assert.equal(seen[0].body.job.saveResponses, false);
    assert.equal(seen[0].body.job.url, "http://127.0.0.1/hooks/abc");
    assert.equal(seen[0].body.job.extendedData.body, JSON.stringify({ content: "Check the status page." }));
    assert.equal(JSON.stringify(seen[0].body).includes("cron-test-key"), false);
    const paused = await setCronJobEnabled(call, "cron-test-key", 1, false);
    assert.deepEqual(paused, { ok: true });
    assert.equal(seen.at(-1).method, "PATCH");
    assert.equal(seen.at(-1).body.job.enabled, false);
    assert.equal(jobs.get(1).job.enabled, false);
    const resumed = await setCronJobEnabled(call, "cron-test-key", 1, true);
    assert.deepEqual(resumed, { ok: true });
    assert.equal(jobs.get(1).job.enabled, true);
    const removed = await deleteCronJob(call, "cron-test-key", 1);
    assert.deepEqual(removed, { ok: true });
    assert.equal(seen.at(-1).method, "DELETE");
    assert.equal(jobs.size, 0);
    const missing = await putCronJob(call, "", {
      url: "http://127.0.0.1/hooks/abc",
      title: "pi-orbs Ada",
      message: "Check the status page.",
      schedule,
    });
    assert.equal(missing.error, "cron-job.org API key is not configured");
  } finally {
    await new Promise((resolve, reject) => stub.close((error) => (error ? reject(error) : resolve())));
  }
});
