import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { installSimulatorReset, openRoster, POLL } from "./support.js";

installSimulatorReset();

test("a seeded reply renders markdown, an image, and a video", async ({ app, screen, browser }) => {
  await openRoster(app, screen);
  await expect(screen.getByRole("heading", "Sketch")).toBeVisible({ timeout: POLL });
  await expect(screen.getByRole("link", "notes")).toBeVisible();
  await expect(screen.getByRole("image", "Pi orb")).toBeVisible();
  await expect(screen.getByRole("button", "Preview")).toBeVisible();

  const rendered = await browser.evaluate(() => {
    const bubble = [...document.querySelectorAll("#log .bubble")].find((node) => node.querySelector("h2"));
    const video = bubble?.querySelector("video.chat-video");
    const image = bubble?.querySelector("img.chat-image");
    const link = bubble?.querySelector("a");
    return {
      strong: bubble?.querySelector("strong")?.textContent ?? "",
      em: bubble?.querySelector("em")?.textContent ?? "",
      del: bubble?.querySelector("del")?.textContent ?? "",
      bullets: bubble?.querySelectorAll(":scope > ul > li").length ?? 0,
      nested: bubble?.querySelector("ul ul li")?.textContent ?? "",
      steps: bubble?.querySelectorAll(":scope > ol > li").length ?? 0,
      quote: bubble?.querySelector("blockquote")?.textContent ?? "",
      href: link?.getAttribute("href") ?? "",
      rel: link?.getAttribute("rel") ?? "",
      target: link?.getAttribute("target") ?? "",
      image: image?.getAttribute("src") ?? "",
      alt: image?.getAttribute("alt") ?? "",
      lazy: image?.getAttribute("loading") ?? "",
      video: video?.getAttribute("src") ?? "",
      playsinline: video?.hasAttribute("playsinline") ?? false,
      controls: video?.hasAttribute("controls") ?? false,
      autoplay: video?.hasAttribute("autoplay") ?? false,
      caption: bubble?.querySelector(".media-caption")?.textContent ?? "",
      code: bubble?.querySelector("code.language-html")?.textContent ?? "",
      table: !!bubble?.querySelector("table"),
      rule: !!bubble?.querySelector("hr"),
    };
  });
  expect(rendered.strong).toBe("black");
  expect(rendered.em).toBe("muted");
  expect(rendered.del).toBe("red");
  expect(rendered.bullets).toBe(3);
  expect(rendered.nested).toBe("Sprite name");
  expect(rendered.steps).toBe(2);
  expect(rendered.quote).toContain("muted gray");
  expect(rendered.href).toBe("https://example.com/notes");
  expect(rendered.rel).toBe("noopener noreferrer");
  expect(rendered.target).toBe("_blank");
  expect(rendered.image).toBe("/logo.png");
  expect(rendered.alt).toBe("Pi orb");
  expect(rendered.lazy).toBe("lazy");
  expect(rendered.video).toBe("/orb-clip.mp4");
  expect(rendered.playsinline).toBe(true);
  expect(rendered.controls).toBe(true);
  expect(rendered.autoplay).toBe(false);
  expect(rendered.caption).toBe("Walkthrough");
  expect(rendered.code).toContain("<p>Hi</p>");
  expect(rendered.table).toBe(true);
  expect(rendered.rule).toBe(true);
});

test("unsafe links are not clickable and a broken image is labeled", async ({ app, screen, browser }) => {
  const base = app.baseUrl ?? "http://127.0.0.1:8787";
  const posted = await fetch(new URL("/api/sprites/atlas/bots/ada/messages", base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: "See [click](javascript:alert(1)) and ![Gone](/no-such-orb.png)",
    }),
  });
  expect(posted.status).toBe(202);
  await openRoster(app, screen);
  await expect.poll(async () => browser.evaluate(() => {
    const mine = [...document.querySelectorAll("#log .msg.user")].at(-1);
    return mine?.querySelector(".media-fallback")?.textContent ?? "";
  }), { timeout: POLL }).toContain("Image unavailable");
  const safety = await browser.evaluate(() => {
    const mine = [...document.querySelectorAll("#log .msg.user")].at(-1);
    return {
      anchors: mine?.querySelectorAll("a").length ?? -1,
      javascript: (mine?.innerHTML ?? "").includes("javascript:"),
      fallback: mine?.querySelector(".media-fallback")?.textContent ?? "",
    };
  });
  expect(safety.anchors).toBe(0);
  expect(safety.javascript).toBe(false);
  expect(safety.fallback).toContain("Image unavailable");
});

test("attached images and videos play inline without replacing the file chip", async ({ app, screen, browser }) => {
  const base = app.baseUrl ?? "http://127.0.0.1:8787";
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const clipResponse = await fetch(new URL("/orb-clip.mp4", base));
  expect(clipResponse.status).toBe(200);
  const clip = Buffer.from(await clipResponse.arrayBuffer()).toString("base64");
  const imageUp = await fetch(new URL("/api/sprites/atlas/bots/ada/files", base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "dot.png", mime: "image/png", data: png }),
  });
  expect(imageUp.status).toBe(201);
  const image = await imageUp.json() as { id: string };
  const videoUp = await fetch(new URL("/api/sprites/atlas/bots/ada/files", base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "walk.mp4", mime: "video/mp4", data: clip }),
  });
  expect(videoUp.status).toBe(201);
  const videoFile = await videoUp.json() as { id: string };
  const sent = await fetch(new URL("/api/sprites/atlas/bots/ada/messages", base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "Photo and clip attached.", fileIds: [image.id, videoFile.id] }),
  });
  expect(sent.status).toBe(202);

  await openRoster(app, screen);
  await expect(screen.getByRole("button", "dot.png")).toBeVisible({ timeout: POLL });
  await expect(screen.getByRole("button", "walk.mp4")).toBeVisible();
  await expect(screen.getByText("Photo and clip attached.")).toBeVisible();
  const media = await browser.evaluate(() => {
    const mine = [...document.querySelectorAll("#log .msg.user")].find((node) => (node.textContent ?? "").includes("Photo and clip attached."));
    const img = mine?.querySelector("img.chat-image");
    const video = mine?.querySelector("video.chat-video");
    return {
      image: img?.getAttribute("src") ?? "",
      video: video?.getAttribute("src") ?? "",
      playsinline: video?.hasAttribute("playsinline") ?? false,
      controls: video?.hasAttribute("controls") ?? false,
      autoplay: video?.hasAttribute("autoplay") ?? false,
      downloads: mine?.querySelectorAll("a").length ?? 0,
    };
  });
  expect(media.image).toBe(`/api/sprites/atlas/bots/ada/files/${image.id}`);
  expect(media.video).toBe(`/api/sprites/atlas/bots/ada/files/${videoFile.id}`);
  expect(media.playsinline).toBe(true);
  expect(media.controls).toBe(true);
  expect(media.autoplay).toBe(false);
  expect(media.downloads).toBeGreaterThan(0);

  const imageHeaders = await fetch(new URL(`/api/sprites/atlas/bots/ada/files/${image.id}`, base));
  expect(imageHeaders.headers.get("content-disposition") ?? "").toMatch(/^inline;/);
  const videoHeaders = await fetch(new URL(`/api/sprites/atlas/bots/ada/files/${videoFile.id}`, base));
  expect(videoHeaders.headers.get("content-disposition") ?? "").toMatch(/^inline;/);
});

test("tables and code stay inside a phone-width thread", async ({ app, browser }) => {
  const base = app.baseUrl ?? "http://127.0.0.1:8787";
  const wide = [
    "```text",
    "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz",
    "```",
    "",
    "| Name | Notes |",
    "| --- | --- |",
    `| Ada | ${"narrow-column ".repeat(8)} |`,
  ].join("\n");
  const posted = await fetch(new URL("/api/sprites/atlas/bots/ada/messages", base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: wide }),
  });
  expect(posted.status).toBe(202);

  await browser.setViewport({ width: 390, height: 844 });
  await app.open("/");
  await expect.poll(async () => browser.evaluate(() => {
    const bubble = [...document.querySelectorAll("#log .msg.user")].at(-1)?.querySelector(".bubble");
    return !!bubble?.querySelector("table");
  }), { timeout: POLL }).toBe(true);

  const fit = await browser.evaluate(() => {
    const log = document.querySelector("#log");
    const bubble = [...document.querySelectorAll("#log .msg.user")].at(-1)?.querySelector(".bubble");
    if (!log || !bubble) return false;
    const logRight = log.getBoundingClientRect().right;
    const within = (node) => !node || node.getBoundingClientRect().right <= logRight + 1;
    const pre = bubble.querySelector("pre");
    const table = bubble.querySelector(".table-scroll");
    const preScrolls = !!pre && pre.scrollWidth > pre.clientWidth + 1;
    return within(bubble) && within(pre) && within(table) && preScrolls;
  });
  expect(fit).toBe(true);
});
