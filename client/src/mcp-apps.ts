// MCP Apps host support for SEP-1865 (`io.modelcontextprotocol/ui`, 2026-01-26).
// This is the chat host and its in-process peer. It is not the MCP event webhook path.

export const UI_EXTENSION = "io.modelcontextprotocol/ui";
export const UI_MIME = "text/html;profile=mcp-app";
export const UI_PROTOCOL = "2026-01-26";
export const MCP_SERVER_ID = "pi-orbs";
export const HOST_NAME = "pi-orbs";
export const HOST_VERSION = "0.3.0";

const HTML_MAX = 500_000;
const TEXT_MAX = 4_000;

export type UiVisibility = "model" | "app";

export type ResourceCsp = {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
};

export type UiPermissions = {
  camera?: Record<string, never>;
  microphone?: Record<string, never>;
  geolocation?: Record<string, never>;
  clipboardWrite?: Record<string, never>;
};

export type SensitivePermission = "camera" | "microphone" | "geolocation";

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  _meta?: {
    ui?: {
      resourceUri?: string;
      visibility?: UiVisibility[];
    };
    "ui/resourceUri"?: string;
  };
};

export type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type PublicApp = {
  id: string;
  messageId: string | null;
  serverId: string;
  tool: string;
  description: string;
  inputSchema: Record<string, unknown>;
  resourceUri: string;
  arguments: Record<string, unknown>;
  text: string;
  structuredContent?: Record<string, unknown>;
};

export type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

export type ConfirmKind = "tool" | "message" | "context" | "link";

export type ConfirmPrompt = {
  id: string;
  kind: ConfirmKind;
  title: string;
  detail: string;
};

export type BridgeSide =
  | { type: "tool"; name: string; arguments: Record<string, unknown>; rpcId: number | string }
  | { type: "read"; uri: string; rpcId: number | string }
  | { type: "message"; text: string; rpcId: number | string }
  | { type: "context"; text: string; rpcId: number | string }
  | { type: "link"; url: string; rpcId: number | string };

export type BridgeEvent = {
  posts: JsonRpcMessage[];
  confirm?: ConfirmPrompt;
  side?: BridgeSide;
  resize?: { width: number; height: number };
};

export type BridgeDecision = {
  posts: JsonRpcMessage[];
  side?: BridgeSide;
};

type UiResource = {
  name: string;
  description: string;
  html: string;
  csp?: ResourceCsp;
  permissions?: UiPermissions;
  prefersBorder?: boolean;
};

const RESTRICTIVE_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

export function resourceUriOf(tool: { _meta?: McpTool["_meta"] }): string | null {
  const modern = tool._meta?.ui?.resourceUri;
  if (typeof modern === "string" && modern.startsWith("ui://")) return modern;
  const legacy = tool._meta?.["ui/resourceUri"];
  if (typeof legacy === "string" && legacy.startsWith("ui://")) return legacy;
  return null;
}

export function visibilityOf(tool: { _meta?: McpTool["_meta"] }): UiVisibility[] {
  const listed = tool._meta?.ui?.visibility;
  if (!listed || listed.length === 0) return ["model", "app"];
  const clean = listed.filter((item): item is UiVisibility => item === "model" || item === "app");
  return clean.length > 0 ? clean : ["model", "app"];
}

export function acceptDomain(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || /\s/.test(trimmed)) return null;
  if (trimmed === "*" || trimmed.includes("..")) return null;
  const wildcard = trimmed.includes("://*.");
  if (trimmed.includes("*") && !wildcard) return null;
  const probe = wildcard ? trimmed.replace("://*.", "://star.") : trimmed;
  let url: URL;
  try {
    url = new URL(probe);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:" && url.protocol !== "wss:" && url.protocol !== "ws:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (wildcard) {
    const host = trimmed.slice(trimmed.indexOf("://") + 3);
    if (!host.startsWith("*.") || host.slice(2).includes("*")) return null;
  }
  return trimmed;
}

function sanitizeDomains(list: readonly string[] | undefined): string[] {
  if (!list || list.length === 0) return [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const accepted = acceptDomain(item);
    if (accepted && !out.includes(accepted)) out.push(accepted);
  }
  return out;
}

export function sanitizeCsp(csp: ResourceCsp | undefined): ResourceCsp {
  return {
    connectDomains: sanitizeDomains(csp?.connectDomains),
    resourceDomains: sanitizeDomains(csp?.resourceDomains),
    frameDomains: sanitizeDomains(csp?.frameDomains),
    baseUriDomains: sanitizeDomains(csp?.baseUriDomains),
  };
}

export function declaredDomains(csp: ResourceCsp | undefined): string[] {
  const clean = sanitizeCsp(csp);
  return [
    ...(clean.connectDomains ?? []),
    ...(clean.resourceDomains ?? []),
    ...(clean.frameDomains ?? []),
    ...(clean.baseUriDomains ?? []),
  ];
}

export function buildCsp(csp: ResourceCsp | undefined, domainsApproved: boolean): string {
  const clean = domainsApproved ? sanitizeCsp(csp) : sanitizeCsp(undefined);
  const resources = clean.resourceDomains ?? [];
  const connect = clean.connectDomains ?? [];
  const frames = clean.frameDomains ?? [];
  const bases = clean.baseUriDomains ?? [];
  const resourceList = resources.length > 0 ? ` ${resources.join(" ")}` : "";
  const connectSrc = connect.length === 0 ? "'none'" : `'self' ${connect.join(" ")}`;
  const frameSrc = frames.length === 0 ? "'none'" : frames.join(" ");
  const baseSrc = bases.length === 0 ? "'self'" : bases.join(" ");
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline'${resourceList}`,
    `style-src 'self' 'unsafe-inline'${resourceList}`,
    `img-src 'self' data:${resourceList}`,
    `font-src 'self'${resourceList}`,
    `media-src 'self' data:${resourceList}`,
    `connect-src ${connectSrc}`,
    `frame-src ${frameSrc}`,
    "object-src 'none'",
    `base-uri ${baseSrc}`,
  ].join("; ");
}

export function sandboxDocumentCsp(viewPolicy: string): string {
  if (!viewPolicy.includes("default-src 'none'") || !viewPolicy.includes("object-src 'none'")) return sandboxDocumentCsp(RESTRICTIVE_CSP);
  return viewPolicy.replace(/frame-src [^;]*/, "frame-src 'self'");
}

export function policyFromEnv(env: NodeJS.ProcessEnv = process.env): SensitivePermission[] {
  const allowed: SensitivePermission[] = [];
  for (const token of (env.PI_ORBS_MCP_APP_ALLOW ?? "").split(",")) {
    const item = token.trim();
    if ((item === "camera" || item === "microphone" || item === "geolocation") && !allowed.includes(item)) allowed.push(item);
  }
  return allowed;
}

export function grantedPermissions(requested: UiPermissions | undefined, policy: readonly SensitivePermission[]): UiPermissions {
  const granted: UiPermissions = {};
  const allowed = new Set(policy);
  if (requested?.camera && allowed.has("camera")) granted.camera = {};
  if (requested?.microphone && allowed.has("microphone")) granted.microphone = {};
  if (requested?.geolocation && allowed.has("geolocation")) granted.geolocation = {};
  if (requested?.clipboardWrite) granted.clipboardWrite = {};
  return granted;
}

export function allowAttribute(permissions: UiPermissions | undefined): string {
  const allow: string[] = [];
  if (permissions?.camera) allow.push("camera");
  if (permissions?.microphone) allow.push("microphone");
  if (permissions?.geolocation) allow.push("geolocation");
  if (permissions?.clipboardWrite) allow.push("clipboard-write");
  return allow.join(" ");
}

export function sandboxSrc(origin: string, hostOrigin: string, csp: ResourceCsp | undefined, domainsApproved: boolean, permissions?: UiPermissions): string {
  const url = new URL("/sandbox", origin);
  url.searchParams.set("host", hostOrigin);
  const clean = domainsApproved ? sanitizeCsp(csp) : sanitizeCsp(undefined);
  const set = (key: string, list: string[] | undefined) => {
    if (list && list.length > 0) url.searchParams.set(key, list.join(","));
  };
  set("connect", clean.connectDomains);
  set("resource", clean.resourceDomains);
  set("frame", clean.frameDomains);
  set("base", clean.baseUriDomains);
  const allow = allowAttribute(permissions);
  if (allow) url.searchParams.set("allow", allow);
  return url.toString();
}

export function permissionsPolicyHeader(search: URLSearchParams): string {
  const asked = new Set((search.get("allow") ?? "").split(/[\s,]+/).filter(Boolean));
  const feature = (name: string) => asked.has(name) ? `${name}=(self)` : `${name}=()`;
  return [feature("camera"), feature("microphone"), feature("geolocation")].join(", ");
}

export function cspFromSandboxQuery(search: URLSearchParams): string {
  const read = (key: string) => (search.get(key) ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return buildCsp({
    connectDomains: read("connect"),
    resourceDomains: read("resource"),
    frameDomains: read("frame"),
    baseUriDomains: read("base"),
  }, true);
}

function viewClientScript(afterResult: string): string {
  return `
const pending = new Map();
let nextId = 1;
function post(message) { parent.postMessage(message, "*"); }
function request(method, params) {
  const id = nextId++;
  post({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
function textOf(result) {
  const block = result && Array.isArray(result.content) ? result.content.find((item) => item && item.type === "text") : null;
  return block && typeof block.text === "string" ? block.text : "";
}
addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.jsonrpc !== "2.0") return;
  if (data.id !== undefined && pending.has(data.id)) {
    const wait = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) wait.reject(data.error);
    else wait.resolve(data.result);
    return;
  }
  if (data.method === "ui/notifications/tool-result") ${afterResult}
  if (data.method === "ui/resource-teardown") post({ jsonrpc: "2.0", id: data.id, result: {} });
});
function isolation() {
  let host = "blocked";
  try { if (parent.parent && parent.parent.location && parent.parent.location.origin) host = "leaked"; } catch (error) { host = "blocked"; }
  return host;
}
request("ui/initialize", {
  protocolVersion: ${JSON.stringify(UI_PROTOCOL)},
  capabilities: {},
  clientInfo: { name: "pi-orbs-fixture", version: ${JSON.stringify(HOST_VERSION)} },
  appCapabilities: { availableDisplayModes: ["inline"] },
  appInfo: { name: "pi-orbs-fixture", version: ${JSON.stringify(HOST_VERSION)} },
}).then(() => {
  post({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
  post({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { width: 360, height: 168 } });
});
`;
}

function statusHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Orb status</title>
<style>
  html, body { margin: 0; background: #111; color: #f5f5f5; font: 15px/1.4 sans-serif; }
  main { padding: 16px 18px 12px; }
  h1 { margin: 0 0 6px; font-size: 18px; }
  p { margin: 0 0 8px; }
  button { margin-right: 8px; }
</style>
</head>
<body>
<main>
  <h1 id="title">Orb status</h1>
  <p id="line">Waiting for the tool result</p>
  <p id="isolation"></p>
  <button id="refresh" type="button">Refresh</button>
  <button id="tell" type="button">Tell the chat</button>
</main>
<script>
${viewClientScript(`{
  const line = document.querySelector("#line");
  if (line) line.textContent = textOf(data.params);
}`)}
document.querySelector("#isolation").textContent = "host: " + isolation();
document.querySelector("#refresh").onclick = () => {
  request("tools/call", { name: "refresh_status", arguments: { sprite: "atlas" } }).then((result) => {
    document.querySelector("#line").textContent = textOf(result);
  }).catch(() => {});
};
document.querySelector("#tell").onclick = () => {
  request("ui/message", { role: "user", content: { type: "text", text: "The orb status is on the thread." } }).catch(() => {});
};
</script>
</body>
</html>`;
}

function hostileHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Probe</title></head>
<body>
<p id="probe">pending</p>
<script>
${viewClientScript("{ /* probe keeps its own text */ }")}
async function cameraState() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return "denied";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    for (const track of stream.getTracks()) track.stop();
    return "granted";
  } catch (error) {
    return "denied";
  }
}
async function connectState() {
  try {
    await fetch("https://evil.example/probe");
    return "open";
  } catch (error) {
    return "blocked";
  }
}
Promise.all([cameraState(), connectState()]).then(([camera, connect]) => {
  let top = "blocked";
  try { if (window.top.document.body) top = "leaked"; } catch (error) { top = "blocked"; }
  document.querySelector("#probe").textContent = "host: " + isolation() + " top: " + top + " camera: " + camera + " connect: " + connect;
});
</script>
</body>
</html>`;
}

const resources: Record<string, UiResource> = {
  "ui://pi-orbs/orb-status": {
    name: "Orb status",
    description: "Shows whether the sprite server answered.",
    html: statusHtml(),
    prefersBorder: true,
  },
  "ui://pi-orbs/hostile-probe": {
    name: "Hostile probe",
    description: "A probe that must stay inside the sandbox.",
    html: hostileHtml(),
    prefersBorder: true,
    csp: { connectDomains: ["https://evil.example"] },
    permissions: { camera: {}, microphone: {}, geolocation: {} },
  },
};

const tools: McpTool[] = [
  {
    name: "show_orb_status",
    description: "Show whether this sprite's server answered.",
    inputSchema: {
      type: "object",
      properties: { sprite: { type: "string" } },
    },
    _meta: { ui: { resourceUri: "ui://pi-orbs/orb-status", visibility: ["model", "app"] } },
  },
  {
    name: "refresh_status",
    description: "Refresh the orb status from this app.",
    inputSchema: { type: "object", properties: { sprite: { type: "string" } } },
    _meta: { ui: { resourceUri: "ui://pi-orbs/orb-status", visibility: ["app"] } },
  },
  {
    name: "show_hostile_probe",
    description: "Render a sandboxed probe. The text fallback still describes the result.",
    inputSchema: { type: "object", properties: {} },
    _meta: { ui: { resourceUri: "ui://pi-orbs/hostile-probe" } },
  },
  {
    name: "note_for_model",
    description: "A model-only note with no app.",
    inputSchema: { type: "object", properties: {} },
    _meta: { ui: { visibility: ["model"] } },
  },
  {
    name: "legacy_status",
    description: "Same status view, declared with the deprecated resource key.",
    inputSchema: { type: "object", properties: {} },
    _meta: { "ui/resourceUri": "ui://pi-orbs/orb-status" },
  },
];

function toolByName(name: string): McpTool | undefined {
  return tools.find((tool) => tool.name === name);
}

function asArguments(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function createMcpPeer() {
  return {
    serverId: MCP_SERVER_ID,
    initialize() {
      return {
        protocolVersion: "2024-11-05",
        capabilities: {
          extensions: {
            [UI_EXTENSION]: { mimeTypes: [UI_MIME] },
          },
        },
        serverInfo: { name: HOST_NAME, version: HOST_VERSION },
      };
    },
    listTools(audience: "model" | "app") {
      return tools
        .filter((tool) => visibilityOf(tool).includes(audience))
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool._meta ? { _meta: tool._meta } : {}),
        }));
    },
    callTool(name: string, args: unknown, fromApp: boolean): { ok: true; result: ToolResult; tool: McpTool } | { ok: false; error: string } {
      const tool = toolByName(name);
      if (!tool) return { ok: false, error: "tool not found" };
      const audience = fromApp ? "app" : "model";
      if (!visibilityOf(tool).includes(audience)) return { ok: false, error: "tool is not visible to this caller" };
      const input = asArguments(args) ?? {};
      if (name === "refresh_status") {
        return {
          ok: true,
          tool,
          result: {
            content: [{ type: "text", text: "Orb status: refreshed." }],
            structuredContent: { title: "Atlas", line: "Refreshed.", ok: true },
          },
        };
      }
      if (name === "show_hostile_probe") {
        return {
          ok: true,
          tool,
          result: {
            content: [{ type: "text", text: "Probe finished. Text fallback only." }],
            structuredContent: { probe: true },
          },
        };
      }
      if (name === "note_for_model") {
        return { ok: true, tool, result: { content: [{ type: "text", text: "Noted for the model." }] } };
      }
      const sprite = typeof input.sprite === "string" && input.sprite.trim() ? input.sprite.trim() : "atlas";
      return {
        ok: true,
        tool,
        result: {
          content: [{ type: "text", text: "Orb status: the server answered." }],
          structuredContent: { title: sprite, line: "The server answered.", ok: true },
        },
      };
    },
    readResource(uri: string): { ok: true; result: { contents: Record<string, unknown>[] } } | { ok: false; error: string } {
      if (!uri.startsWith("ui://")) return { ok: false, error: "resource URI must use the ui:// scheme" };
      const resource = resources[uri];
      if (!resource) return { ok: false, error: "resource not found" };
      if (resource.html.length > HTML_MAX) return { ok: false, error: "resource is too large" };
      return {
        ok: true,
        result: {
          contents: [{
            uri,
            mimeType: UI_MIME,
            text: resource.html,
            _meta: {
              ui: {
                ...(resource.csp ? { csp: resource.csp } : {}),
                ...(resource.permissions ? { permissions: resource.permissions } : {}),
                ...(resource.prefersBorder !== undefined ? { prefersBorder: resource.prefersBorder } : {}),
              },
            },
          }],
        },
      };
    },
  };
}

export type McpPeer = ReturnType<typeof createMcpPeer>;

export function readUiResource(result: unknown): {
  html: string;
  csp?: ResourceCsp;
  permissions?: UiPermissions;
  prefersBorder?: boolean;
} | { error: string } {
  if (!result || typeof result !== "object") return { error: "resource read failed" };
  const contents = (result as { contents?: unknown }).contents;
  if (!Array.isArray(contents) || !contents[0] || typeof contents[0] !== "object") return { error: "resource has no contents" };
  const entry = contents[0] as { uri?: unknown; mimeType?: unknown; text?: unknown; blob?: unknown; _meta?: { ui?: { csp?: ResourceCsp; permissions?: UiPermissions; prefersBorder?: boolean } } };
  if (typeof entry.uri !== "string" || !entry.uri.startsWith("ui://")) return { error: "resource URI must use the ui:// scheme" };
  if (entry.mimeType !== UI_MIME) return { error: "resource MIME type must be text/html;profile=mcp-app" };
  let html = "";
  if (typeof entry.text === "string") html = entry.text;
  else if (typeof entry.blob === "string") {
    try {
      html = Buffer.from(entry.blob, "base64").toString("utf8");
    } catch {
      return { error: "resource blob was not base64" };
    }
  }
  if (!html.trim()) return { error: "resource HTML is empty" };
  if (html.length > HTML_MAX) return { error: "resource is too large" };
  const ui = entry._meta?.ui;
  return {
    html,
    ...(ui?.csp ? { csp: ui.csp } : {}),
    ...(ui?.permissions ? { permissions: ui.permissions } : {}),
    ...(typeof ui?.prefersBorder === "boolean" ? { prefersBorder: ui.prefersBorder } : {}),
  };
}

export function appFromCall(id: string, messageId: string | null, call: { tool: McpTool; result: ToolResult }, args: Record<string, unknown>): PublicApp | { error: string } {
  const resourceUri = resourceUriOf(call.tool);
  if (!resourceUri) return { error: "tool has no UI resource" };
  const text = call.result.content.find((item) => item.type === "text")?.text ?? "";
  return {
    id,
    messageId,
    serverId: MCP_SERVER_ID,
    tool: call.tool.name,
    description: call.tool.description,
    inputSchema: call.tool.inputSchema,
    resourceUri,
    arguments: args,
    text,
    ...(call.result.structuredContent ? { structuredContent: call.result.structuredContent } : {}),
  };
}

function rpcError(id: number | string, code: number, message: string): JsonRpcMessage {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function messageText(params: unknown): string | null {
  if (!isRecord(params) || params.role !== "user" || !isRecord(params.content)) return null;
  if (params.content.type !== "text" || typeof params.content.text !== "string") return null;
  const text = params.content.text.trim();
  if (!text || text.length > TEXT_MAX) return null;
  return text;
}

export function contextText(params: unknown): string | null {
  if (!isRecord(params)) return null;
  const blocks = params.content;
  if (!Array.isArray(blocks)) return null;
  const lines: string[] = [];
  for (const block of blocks) {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") return null;
    lines.push(block.text);
  }
  const text = lines.join("\n").trim();
  if (!text || text.length > TEXT_MAX) return null;
  return text;
}

export function openableUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

type PendingConfirm = ConfirmPrompt & { side: BridgeSide; rpcId: number | string };

export class AppBridge {
  private phase: "open" | "down" = "open";
  private initialized = false;
  private sawToolInput = false;
  private nextConfirm = 1;
  private nextRpc = 1;
  private pending = new Map<string, PendingConfirm>();

  constructor(private readonly options: {
    app: PublicApp;
    html: string;
    csp?: ResourceCsp;
    permissions?: UiPermissions;
    domainsApproved: boolean;
    policy: readonly SensitivePermission[];
    locale?: string;
    timeZone?: string;
  }) {}

  resourceParams(): Record<string, unknown> {
    const approved = this.options.domainsApproved;
    const csp = approved ? sanitizeCsp(this.options.csp) : {};
    const permissions = grantedPermissions(this.options.permissions, this.options.policy);
    return {
      html: this.options.html,
      sandbox: "allow-scripts allow-same-origin",
      csp,
      permissions,
      policy: buildCsp(this.options.csp, approved),
    };
  }

  receive(data: unknown): BridgeEvent {
    if (this.phase === "down" || !isRecord(data) || data.jsonrpc !== "2.0") return { posts: [] };
    const message = data as JsonRpcMessage;
    if (message.method === "ui/notifications/sandbox-proxy-ready") {
      return { posts: [{ jsonrpc: "2.0", method: "ui/notifications/sandbox-resource-ready", params: this.resourceParams() }] };
    }
    if (typeof message.method === "string" && message.method.startsWith("ui/notifications/sandbox-")) return { posts: [] };
    if (message.id !== undefined && typeof message.method === "string") return this.onRequest(message.id, message.method, message.params);
    if (typeof message.method === "string") return this.onNotification(message.method, message.params);
    return { posts: [] };
  }

  decide(confirmId: string, allow: boolean): BridgeDecision {
    const pending = this.pending.get(confirmId);
    if (!pending) return { posts: [] };
    this.pending.delete(confirmId);
    if (!allow) return { posts: [rpcError(pending.rpcId, -32000, pending.kind === "link" ? "Link opening denied by user" : "Denied by user")] };
    if (pending.side.type === "read") return { posts: [], side: pending.side };
    return { posts: [], side: pending.side };
  }

  succeed(rpcId: number | string, result: unknown = {}): JsonRpcMessage[] {
    return [{ jsonrpc: "2.0", id: rpcId, result }];
  }

  fail(rpcId: number | string, message: string): JsonRpcMessage[] {
    return [rpcError(rpcId, -32000, message)];
  }

  finishTool(rpcId: number | string, args: Record<string, unknown>, result: ToolResult): JsonRpcMessage[] {
    return [
      { jsonrpc: "2.0", id: rpcId, result },
      { jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: args } },
      { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result },
    ];
  }

  teardown(reason: string): JsonRpcMessage {
    this.phase = "down";
    const id = this.nextRpc++;
    return { jsonrpc: "2.0", id, method: "ui/resource-teardown", params: { reason } };
  }

  private onNotification(method: string, params: unknown): BridgeEvent {
    if (method === "ui/notifications/initialized") {
      if (this.initialized) return { posts: [] };
      this.initialized = true;
      return { posts: this.initialToolData() };
    }
    if (method === "ui/notifications/size-changed" && isRecord(params)) {
      const width = typeof params.width === "number" && Number.isFinite(params.width) ? params.width : undefined;
      const height = typeof params.height === "number" && Number.isFinite(params.height) ? params.height : undefined;
      if (width === undefined && height === undefined) return { posts: [] };
      return { posts: [], resize: { width: width ?? 0, height: height ?? 0 } };
    }
    return { posts: [] };
  }

  private initialToolData(): JsonRpcMessage[] {
    if (!this.initialized || this.sawToolInput) return [];
    this.sawToolInput = true;
    const result: ToolResult = {
      content: [{ type: "text", text: this.options.app.text }],
      ...(this.options.app.structuredContent ? { structuredContent: this.options.app.structuredContent } : {}),
    };
    return [
      { jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: this.options.app.arguments } },
      { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result },
    ];
  }

  private onRequest(id: number | string, method: string, params: unknown): BridgeEvent {
    if (method === "ui/initialize") {
      const posts = [this.initializeResult(id)];
      return { posts };
    }
    if (method === "ping") return { posts: [{ jsonrpc: "2.0", id, result: {} }] };
    if (method === "tools/call") return this.confirmTool(id, params);
    if (method === "resources/read") return this.readResource(id, params);
    if (method === "ui/message") return this.confirmText(id, "message", messageText(params), "Send this to the chat?");
    if (method === "ui/update-model-context") return this.confirmText(id, "context", contextText(params), "Share this with the model on your next message?");
    if (method === "ui/open-link") return this.confirmLink(id, params);
    if (method === "ui/request-display-mode") return { posts: [{ jsonrpc: "2.0", id, result: { mode: "inline" } }] };
    return { posts: [rpcError(id, -32601, "method not found")] };
  }

  private initializeResult(id: number | string): JsonRpcMessage {
    const permissions = grantedPermissions(this.options.permissions, this.options.policy);
    const csp = this.options.domainsApproved ? sanitizeCsp(this.options.csp) : {};
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: UI_PROTOCOL,
        hostCapabilities: {
          openLinks: {},
          serverTools: {},
          serverResources: {},
          logging: {},
          sandbox: { permissions, csp },
        },
        hostInfo: { name: HOST_NAME, version: HOST_VERSION },
        hostContext: {
          toolInfo: {
            id: this.options.app.id,
            tool: {
              name: this.options.app.tool,
              description: this.options.app.description,
              inputSchema: this.options.app.inputSchema,
            },
          },
          theme: "dark",
          displayMode: "inline",
          availableDisplayModes: ["inline"],
          containerDimensions: { maxWidth: 560, maxHeight: 480 },
          locale: this.options.locale || "en-US",
          timeZone: this.options.timeZone || "UTC",
          platform: "web",
          userAgent: HOST_NAME,
        },
      },
    };
  }

  private confirmTool(id: number | string, params: unknown): BridgeEvent {
    if (!isRecord(params) || typeof params.name !== "string") return { posts: [rpcError(id, -32602, "Invalid tool call")] };
    const args = asArguments(params.arguments) ?? {};
    const prompt = this.queue(id, "tool", `Allow ${params.name}?`, params.name, {
      type: "tool",
      name: params.name,
      arguments: args,
      rpcId: id,
    });
    return { posts: [], confirm: prompt };
  }

  private readResource(id: number | string, params: unknown): BridgeEvent {
    if (!isRecord(params) || typeof params.uri !== "string" || !params.uri.startsWith("ui://")) {
      return { posts: [rpcError(id, -32602, "Invalid resource URI")] };
    }
    return { posts: [], side: { type: "read", uri: params.uri, rpcId: id } };
  }

  private confirmText(id: number | string, kind: "message" | "context", text: string | null, title: string): BridgeEvent {
    if (!text) return { posts: [rpcError(id, -32602, kind === "message" ? "Invalid message format" : "Invalid content format")] };
    const side: BridgeSide = kind === "message"
      ? { type: "message", text, rpcId: id }
      : { type: "context", text, rpcId: id };
    return { posts: [], confirm: this.queue(id, kind, title, text, side) };
  }

  private confirmLink(id: number | string, params: unknown): BridgeEvent {
    const url = openableUrl(isRecord(params) ? params.url : undefined);
    if (!url) return { posts: [rpcError(id, -32000, "Invalid URL")] };
    return { posts: [], confirm: this.queue(id, "link", "Open this link?", url, { type: "link", url, rpcId: id }) };
  }

  private queue(id: number | string, kind: ConfirmKind, title: string, detail: string, side: BridgeSide): ConfirmPrompt {
    const promptId = `${kind}-${this.nextConfirm++}`;
    const prompt = { id: promptId, kind, title, detail };
    this.pending.set(promptId, { ...prompt, side, rpcId: id });
    return prompt;
  }
}

export function sandboxPage(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>MCP app sandbox</title>
<style>
  html, body { margin: 0; height: 100%; background: transparent; }
  iframe { width: 100%; height: 100%; border: 0; background: transparent; }
</style>
</head>
<body>
<iframe id="mcp-view" title="MCP app view" sandbox="allow-scripts allow-same-origin"></iframe>
<script>
const host = (() => {
  try {
    const value = new URLSearchParams(location.search).get("host") || "";
    const url = new URL(value);
    if (url.origin !== value) return "";
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch (error) {
    return "";
  }
})();
const inner = document.getElementById("mcp-view");
const fallbackPolicy = ${JSON.stringify(RESTRICTIVE_CSP)};
function policyOf(params) {
  const policy = params && typeof params.policy === "string" ? params.policy : "";
  if (!policy.includes("default-src 'none'") || !policy.includes("object-src 'none'")) return fallbackPolicy;
  return policy;
}
function allowOf(permissions) {
  if (!permissions || typeof permissions !== "object") return "";
  const allow = [];
  if (permissions.camera) allow.push("camera");
  if (permissions.microphone) allow.push("microphone");
  if (permissions.geolocation) allow.push("geolocation");
  if (permissions.clipboardWrite) allow.push("clipboard-write");
  return allow.join(" ");
}
function inject(html, policy) {
  const meta = '<meta http-equiv="Content-Security-Policy" content="' + policy.replace(/"/g, "") + '">';
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (match) => match + meta);
  return "<!DOCTYPE html><html><head>" + meta + "</head>" + html + "</html>";
}
addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.jsonrpc !== "2.0") return;
  if (event.source === window.parent) {
    if (!host || event.origin !== host) return;
    if (data.method === "ui/notifications/sandbox-resource-ready") {
      const params = data.params || {};
      const policy = policyOf(params);
      const sandbox = typeof params.sandbox === "string" ? params.sandbox : "allow-scripts allow-same-origin";
      if (inner.getAttribute("sandbox") !== sandbox) inner.setAttribute("sandbox", sandbox);
      const allow = allowOf(params.permissions);
      if (allow) inner.setAttribute("allow", allow);
      else inner.removeAttribute("allow");
      inner.setAttribute("csp", policy);
      const html = typeof params.html === "string" ? params.html : "";
      const write = () => {
        const doc = inner.contentDocument || (inner.contentWindow && inner.contentWindow.document);
        if (!doc) return false;
        doc.open();
        doc.write(inject(html, policy));
        doc.close();
        return true;
      };
      if (!write()) inner.addEventListener("load", () => { write(); }, { once: true });
      return;
    }
    if (typeof data.method === "string" && data.method.indexOf("ui/notifications/sandbox-") === 0) return;
    if (inner.contentWindow) inner.contentWindow.postMessage(data, "*");
    return;
  }
  if (inner.contentWindow && event.source === inner.contentWindow) {
    if (typeof data.method === "string" && data.method.indexOf("ui/notifications/sandbox-") === 0) return;
    if (host) window.parent.postMessage(data, host);
  }
});
if (host) window.parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, host);
</script>
</body>
</html>`;
}
