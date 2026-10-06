import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { installSimulatorReset, openRoster, POLL } from "./support.js";

installSimulatorReset();

const FLOW = [
  "Sprite handoff.",
  "",
  "```mermaid",
  "flowchart LR",
  "  Ada --> Kepler",
  "```",
].join("\n");

const HOSTILE = [
  "Hostile diagram.",
  "",
  "```mermaid",
  "%%{init: {\"securityLevel\": \"loose\", \"htmlLabels\": true}}%%",
  "flowchart TD",
  "  X[\"<img src=x onerror=alert(1)>\"]",
  "```",
].join("\n");

const SKETCH = [
  "Arrow sketch.",
  "",
  "```diagram",
  "Ada -> Kepler: status",
  "```",
].join("\n");

const BROKEN = [
  "Broken diagram.",
  "",
  "```mermaid",
  "this is not a diagram",
  "```",
].join("\n");

async function post(base: string, content: string): Promise<void> {
  const posted = await fetch(new URL("/api/sprites/atlas/bots/ada/messages", base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  expect(posted.status).toBe(202);
}

test("a mermaid fence draws in the bubble and a bad fence keeps its source", async ({ app, screen, browser }) => {
  const base = app.baseUrl ?? "http://127.0.0.1:8787";
  await post(base, FLOW);
  await post(base, HOSTILE);
  await post(base, BROKEN);
  await post(base, SKETCH);
  await openRoster(app, screen);

  await expect.poll(async () => browser.evaluate(() => {
    const bubble = [...document.querySelectorAll("#log .msg.user")].find((node) => (node.textContent ?? "").includes("Sprite handoff."));
    const svg = bubble?.querySelector(".mermaid-slot svg");
    return svg?.getAttribute("aria-label") ?? "";
  }), { timeout: POLL }).toBe("Diagram");

  await expect(screen.getByRole("button", "Preview")).toBeVisible();

  const drawn = await browser.evaluate(() => {
    const bubble = [...document.querySelectorAll("#log .msg.user")].find((node) => (node.textContent ?? "").includes("Sprite handoff."));
    const slot = bubble?.querySelector(".mermaid-slot");
    const svg = slot?.querySelector("svg");
    const source = bubble?.querySelector(".mermaid-source pre");
    return {
      label: svg?.getAttribute("aria-label") ?? "",
      role: svg?.getAttribute("role") ?? "",
      script: slot?.querySelector("script") != null,
      foreign: slot?.querySelector("foreignObject") != null,
      source: source?.textContent ?? "",
      png: [...(bubble?.querySelectorAll("button") ?? [])].some((button) => button.textContent === "Download PNG"),
    };
  });
  expect(drawn.label).toBe("Diagram");
  expect(drawn.role).toBe("img");
  expect(drawn.script).toBe(false);
  expect(drawn.foreign).toBe(false);
  expect(drawn.source).toContain("Ada --> Kepler");
  expect(drawn.png).toBe(true);

  await expect.poll(async () => browser.evaluate(() => {
    const bubble = [...document.querySelectorAll("#log .msg.user")].find((node) => (node.textContent ?? "").includes("Hostile diagram."));
    return bubble?.querySelector(".mermaid-slot svg") != null;
  }), { timeout: POLL }).toBe(true);
  // The message and the simulator's quoted echo each draw the flow and the hostile fence.
  await expect(screen.getByRole("image", "Diagram")).toHaveCount(4);

  const hostile = await browser.evaluate(() => {
    const bubble = [...document.querySelectorAll("#log .msg.user")].find((node) => (node.textContent ?? "").includes("Hostile diagram."));
    const slot = bubble?.querySelector(".mermaid-slot");
    const html = slot?.innerHTML ?? "";
    const badAttr = [...(slot?.querySelectorAll("*") ?? [])].some((el) => [...el.attributes].some((attr) => {
      const name = attr.name.toLowerCase();
      return name.startsWith("on") || /javascript:/i.test(attr.value);
    }));
    return {
      badAttr,
      script: /<\s*script/i.test(html),
      img: /<\s*img[\s>]/i.test(html),
      foreign: /<\s*foreignobject/i.test(html),
      source: bubble?.querySelector(".mermaid-source pre")?.textContent ?? "",
    };
  });
  expect(hostile.badAttr).toBe(false);
  expect(hostile.script).toBe(false);
  expect(hostile.img).toBe(false);
  expect(hostile.foreign).toBe(false);
  expect(hostile.source).toContain("securityLevel");

  await expect.poll(async () => browser.evaluate(() => {
    const bubble = [...document.querySelectorAll("#log .msg.user")].find((node) => (node.textContent ?? "").includes("Broken diagram."));
    return bubble?.querySelector(".mermaid-status")?.textContent ?? "";
  }), { timeout: POLL }).toBe("This diagram could not be drawn.");

  const broken = await browser.evaluate(() => {
    const bubble = [...document.querySelectorAll("#log .msg.user")].find((node) => (node.textContent ?? "").includes("Broken diagram."));
    const pre = bubble?.querySelector("pre.fence");
    return {
      svg: bubble?.querySelector(".mermaid-slot svg") != null,
      hidden: pre?.hasAttribute("hidden") ?? false,
      source: pre?.textContent ?? "",
    };
  });
  expect(broken.svg).toBe(false);
  expect(broken.hidden).toBe(false);
  expect(broken.source).toContain("this is not a diagram");

  const sketch = await browser.evaluate(() => {
    const bubble = [...document.querySelectorAll("#log .msg.user")].find((node) => (node.textContent ?? "").includes("Arrow sketch."));
    return {
      slot: bubble?.querySelector(".mermaid-slot") != null,
      source: bubble?.querySelector("pre.fence")?.textContent ?? "",
      png: [...(bubble?.querySelectorAll("button") ?? [])].some((button) => button.textContent === "Download PNG"),
      preview: [...(bubble?.querySelectorAll("button") ?? [])].some((button) => button.textContent === "Preview"),
    };
  });
  expect(sketch.slot).toBe(false);
  expect(sketch.source).toContain("Ada -> Kepler: status");
  expect(sketch.png).toBe(true);
  expect(sketch.preview).toBe(false);
});

test("a mermaid diagram stays inside a phone-width thread", async ({ app, browser }) => {
  const base = app.baseUrl ?? "http://127.0.0.1:8787";
  await post(base, FLOW);
  await browser.setViewport({ width: 390, height: 844 });
  await app.open("/");
  await expect.poll(async () => browser.evaluate(() => {
    const bubble = [...document.querySelectorAll("#log .msg.user")].find((node) => (node.textContent ?? "").includes("Sprite handoff."));
    return bubble?.querySelector(".mermaid-slot svg") != null;
  }), { timeout: POLL }).toBe(true);

  const fit = await browser.evaluate(() => {
    const log = document.querySelector("#log");
    const bubble = [...document.querySelectorAll("#log .msg.user")].find((node) => (node.textContent ?? "").includes("Sprite handoff."));
    const slot = bubble?.querySelector(".mermaid-slot");
    const svg = slot?.querySelector("svg");
    if (!log || !bubble || !slot || !svg) return false;
    const logRight = log.getBoundingClientRect().right;
    const within = (node) => node.getBoundingClientRect().right <= logRight + 1;
    const box = slot.getBoundingClientRect();
    return within(bubble) && within(slot) && within(svg) && box.height <= 440 + 1 && box.height > 20;
  });
  expect(fit).toBe(true);
});
