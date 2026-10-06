import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { handleLocal } from "../dist/local.js";
import {
  AppBridge,
  acceptDomain,
  allowAttribute,
  buildCsp,
  createMcpPeer,
  declaredDomains,
  grantedPermissions,
  readUiResource,
  resourceUriOf,
  sandboxDocumentCsp,
  sandboxSrc,
} from "../dist/mcp-apps.js";
import { createServer } from "node:http";

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("empty CSP means no external origins, and undeclared domains are dropped", () => {
  const empty = buildCsp(undefined, true);
  assert.match(empty, /connect-src 'none'/);
  assert.match(empty, /frame-src 'none'/);
  assert.match(empty, /object-src 'none'/);
  assert.equal(buildCsp({ connectDomains: [], resourceDomains: [] }, true), empty);
  assert.equal(buildCsp({ connectDomains: ["https://evil.example"] }, false), empty);
  const approved = buildCsp({
    connectDomains: ["https://evil.example", "javascript:alert(1)", "*", "https://*.cdn.example"],
    resourceDomains: ["https://cdn.example"],
  }, true);
  assert.match(approved, /connect-src 'self' https:\/\/evil\.example https:\/\/\*\.cdn\.example/);
  assert.doesNotMatch(approved, /javascript/);
  assert.match(approved, /script-src 'self' 'unsafe-inline' https:\/\/cdn\.example/);
  assert.equal(acceptDomain("https://evil.example/steal"), null);
  assert.equal(declaredDomains({ connectDomains: ["https://evil.example"], frameDomains: [] }).join(","), "https://evil.example");
});

test("camera, microphone, and geolocation stay refused unless policy allows them", () => {
  const requested = { camera: {}, microphone: {}, geolocation: {}, clipboardWrite: {} };
  assert.equal(allowAttribute(grantedPermissions(requested, [])), "clipboard-write");
  assert.equal(allowAttribute(grantedPermissions(requested, ["camera"])), "camera clipboard-write");
  assert.equal(allowAttribute(grantedPermissions(undefined, ["camera", "microphone", "geolocation"])), "");
});

test("deprecated ui/resourceUri still resolves, and the peer serves mcp-app HTML", () => {
  assert.equal(resourceUriOf({ _meta: { "ui/resourceUri": "ui://pi-orbs/orb-status" } }), "ui://pi-orbs/orb-status");
  assert.equal(resourceUriOf({ _meta: { ui: { resourceUri: "ui://pi-orbs/orb-status" } } }), "ui://pi-orbs/orb-status");
  const peer = createMcpPeer();
  assert.equal(peer.listTools("model").some((tool) => tool.name === "refresh_status"), false);
  assert.equal(peer.listTools("app").some((tool) => tool.name === "refresh_status"), true);
  assert.equal(peer.listTools("model").some((tool) => tool.name === "note_for_model"), true);
  const denied = peer.callTool("note_for_model", {}, true);
  assert.equal(denied.ok, false);
  const refresh = peer.callTool("refresh_status", { sprite: "atlas" }, true);
  assert.equal(refresh.ok, true);
  const read = peer.readResource("ui://pi-orbs/hostile-probe");
  assert.equal(read.ok, true);
  const ui = readUiResource(read.result);
  assert.equal("error" in ui, false);
  if ("error" in ui) return;
  assert.match(ui.html, /host:/);
  assert.deepEqual(ui.permissions, { camera: {}, microphone: {}, geolocation: {} });
  assert.deepEqual(ui.csp, { connectDomains: ["https://evil.example"] });
  const wrong = readUiResource({ contents: [{ uri: "ui://pi-orbs/orb-status", mimeType: "text/html", text: "<p>x</p>" }] });
  assert.equal(wrong.error, "resource MIME type must be text/html;profile=mcp-app");
});

test("the bridge withholds tool data until initialized and confirms tool calls", () => {
  const peer = createMcpPeer();
  const call = peer.callTool("show_orb_status", { sprite: "atlas" }, false);
  assert.equal(call.ok, true);
  if (!call.ok) return;
  const bridge = new AppBridge({
    app: {
      id: "app-seed-status",
      messageId: "m4",
      serverId: "pi-orbs",
      tool: "show_orb_status",
      description: call.tool.description,
      inputSchema: call.tool.inputSchema,
      resourceUri: "ui://pi-orbs/orb-status",
      arguments: { sprite: "atlas" },
      text: "Orb status: the server answered.",
      structuredContent: { ok: true },
    },
    html: "<p>status</p>",
    domainsApproved: true,
    policy: [],
    permissions: { camera: {} },
  });
  const ready = bridge.receive({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready" });
  assert.equal(ready.posts[0].method, "ui/notifications/sandbox-resource-ready");
  assert.equal(ready.posts.some((item) => item.method === "ui/notifications/tool-result"), false);
  assert.equal(ready.posts[0].params.permissions.camera, undefined);
  assert.match(ready.posts[0].params.policy, /connect-src 'none'/);
  const init = bridge.receive({ jsonrpc: "2.0", id: 7, method: "ui/initialize", params: {} });
  assert.equal(init.result === undefined, true);
  assert.equal(init.posts[0].result.protocolVersion, "2026-01-26");
  assert.equal(init.posts.some((item) => item.method === "ui/notifications/tool-input"), false);
  const live = bridge.receive({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
  assert.deepEqual(live.posts.map((item) => item.method), ["ui/notifications/tool-input", "ui/notifications/tool-result"]);
  assert.equal(live.posts[1].params.content[0].text, "Orb status: the server answered.");
  const asked = bridge.receive({
    jsonrpc: "2.0",
    id: 9,
    method: "tools/call",
    params: { name: "refresh_status", arguments: { sprite: "atlas" } },
  });
  assert.equal(asked.posts.length, 0);
  assert.equal(asked.confirm.detail, "refresh_status");
  const denied = bridge.decide(asked.confirm.id, false);
  assert.equal(denied.side, undefined);
  assert.equal(denied.posts[0].error.message, "Denied by user");
  const again = bridge.receive({
    jsonrpc: "2.0",
    id: 10,
    method: "tools/call",
    params: { name: "refresh_status", arguments: { sprite: "atlas" } },
  });
  const allowed = bridge.decide(again.confirm.id, true);
  assert.equal(allowed.side.name, "refresh_status");
  assert.equal(allowed.posts.length, 0);
  const src = sandboxSrc("http://127.0.0.1:9", "http://127.0.0.1:8787", { connectDomains: ["https://evil.example"] }, false);
  assert.equal(new URL(src).origin, "http://127.0.0.1:9");
  assert.equal(new URL(src).searchParams.get("connect"), null);
  assert.match(sandboxDocumentCsp(buildCsp(undefined, true)), /frame-src 'self'/);
});

test("the HTML preview iframe stays scriptless and is not the app frame", async () => {
  const html = await readFile(join(clientRoot, "public", "index.html"), "utf8");
  assert.match(html, /frame\.sandbox = ""/);
  assert.match(html, /frame\.srcdoc = text/);
  const appSection = html.slice(html.indexOf("function appCard"), html.indexOf("async function refreshThread"));
  assert.match(appSection, /mcp-app-sandbox/);
  assert.match(appSection, /allow-scripts allow-same-origin/);
  assert.doesNotMatch(appSection, /srcdoc/);
});

test("simulator threads attach an app without adding a tool trace", async () => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    handleLocal(url, req, res).catch((error) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : "error" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sprites/atlas/bots/ada`);
    const body = await response.json();
    assert.equal(body.messages.length, 7);
    assert.equal(body.messages.some((item) => item.kind === "pi.tool" || item.tool), false);
    assert.equal(body.apps.length, 1);
    assert.equal(body.apps[0].resourceUri, "ui://pi-orbs/orb-status");
    assert.equal(body.apps[0].text, "Orb status: the server answered.");
    assert.equal(body.apps[0].html, undefined);
    assert.equal(JSON.stringify(body).includes("text/html;profile=mcp-app"), false);
    const read = await fetch(`http://127.0.0.1:${port}/api/sprites/atlas/bots/ada/mcp-apps/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uri: body.apps[0].resourceUri }),
    });
    const resource = await read.json();
    assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
    const hidden = await fetch(`http://127.0.0.1:${port}/api/sprites/atlas/bots/ada/mcp-apps/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "note_for_model", arguments: {} }),
    });
    assert.equal(hidden.status, 403);
    const probe = await fetch(`http://127.0.0.1:${port}/api/sprites/atlas/bots/ada/mcp-apps`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "show_hostile_probe", arguments: {} }),
    });
    assert.equal(probe.status, 201);
    const after = await (await fetch(`http://127.0.0.1:${port}/api/sprites/atlas/bots/ada`)).json();
    assert.equal(after.apps.length, 2);
    assert.match(after.messages.at(-1).text, /Text fallback only/);
    assert.equal(after.messages.some((item) => String(item.text).includes("<script>")), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
