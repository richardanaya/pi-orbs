# MCP Apps host

MCP Apps is the chat host for extension `io.modelcontextprotocol/ui` (SEP-1865, stable 2026-01-26). It is not the MCP event webhook.

Event webhooks stay as they are. `create_mcp_event_webhook`, `mcp-events.json`, `POST /api/mcp-events/:token`, the bot dialog's list and Disconnect (`GET` and `DELETE /api/bots/:id/mcp-events`), and signed `events/subscribe` delivery are an inbound path: an MCP server pushes events into a bot conversation. Nothing in that path renders UI, reads `ui://` resources, or speaks the Apps `postMessage` bridge.

Apps is the other direction. A tool declares a UI resource. The host fetches it and renders it in the thread. Mermaid fences are a separate drawing path in the same bubble. They are not Apps.

Sources followed for the host behavior:

- [SEP-1865 / 2026-01-26 apps spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
- [MCP Apps overview](https://modelcontextprotocol.org/extensions/apps/overview)

## What the host does

Tools with `_meta.ui.resourceUri`, or the deprecated `_meta["ui/resourceUri"]`, point at a `ui://` resource. The host calls `resources/read`. The content type must be `text/html;profile=mcp-app`. Any other MIME type is not rendered. The tool's text content stays on the thread so a host that does not render UI still has a result.

The view runs in a nested iframe:

1. The chat page (host origin) frames a sandbox proxy.
2. The proxy listens on `127.0.0.1` on its own port. That port is a different origin from the page.
3. The outer iframe is `sandbox="allow-scripts allow-same-origin"`, which is what the spec requires so the proxy keeps its own origin and can relay `postMessage`.
4. The proxy writes the resource HTML into an inner iframe and forwards every method that does not start with `ui/notifications/sandbox-`.
5. The view speaks JSON-RPC: `ui/initialize`, `ui/notifications/initialized`, `ui/notifications/tool-input`, `ui/notifications/tool-result`, `tools/call`, `resources/read`, `ui/message`, `ui/update-model-context`, `ui/open-link`, `ui/notifications/size-changed`, and `ui/resource-teardown`.

The host does not send tool input or the tool result until it has seen `ui/notifications/initialized`.

A thread repaint, a bot change, or the app leaving the payload sends `ui/resource-teardown` and then drops the iframe and its listener. The HTML fence preview is a different iframe: `sandbox=""` and no scripts. Apps do not use it. File and SVG responses are not used to execute app HTML.

Declared `_meta.ui.csp` is enforced with empty-means-none. Omitted or empty domain lists become `connect-src 'none'`, `frame-src 'none'` on the view, and no extra script, image, or style origins. The host does not add domains the resource did not name. A non-empty list is not applied until the person in the chat allows it. Until then the view is loaded with the empty policy.

Camera, microphone, and geolocation are refused unless `PI_ORBS_MCP_APP_ALLOW` lists them. The resource asking for those permissions is not enough. The sandbox response also sends `Permissions-Policy` with those features closed unless that same allow list granted them. Clipboard write is granted only when the resource requests `permissions.clipboardWrite`.

`tools/call`, `ui/message`, `ui/update-model-context`, and `ui/open-link` wait for a button outside the iframe. Deny returns a JSON-RPC error and does not call the peer. `resources/read` is proxied only for `ui://` on this peer, without a second confirm. App-only tools (`visibility` without `"model"`) stay out of the model tool list. A view cannot call a tool whose visibility omits `"app"`.

The local simulator's peer is in-process (`serverId` `pi-orbs`). Ada's thread starts with `show_orb_status` attached to her last assistant message. The attachment is an `apps` entry: tool name, resource URI, arguments, and text fallback. It is not a tool trace. `POST /api/sprites/:name/bots/:id/mcp-apps` runs another model-visible tool and appends the text fallback as an assistant line. `.../mcp-apps/call` and `.../mcp-apps/read` are the view's proxy. `GET /api/mcp-apps/sandbox` returns the sandbox origin.

## Decisions

1. **Who is the MCP peer?** The chat page is the host. The peer it speaks MCP to is an in-process server bundled with the client, not a bot's Pi tool list and not an event webhook. Both the model path (`fromApp: false`, used by the seeded call and the invoke route) and the view path (`fromApp: true`, used by `tools/call` from the iframe) hit that same peer. External stdio or HTTP MCP servers are not connected.

2. **Where does the sandbox origin live?** On a second listener, `http://127.0.0.1:<ephemeral>/sandbox`. The page and the proxy are different origins because the ports differ. This matches the spec's web-host rule and the basic-host example (host port and sandbox port). It is not a dedicated public suffix such as `claudemcpcontent.com`. The proxy document's own `frame-src` is `'self'` so it can embed the view; the view policy still sets `frame-src 'none'` unless the resource declared `frameDomains`. If a browser inherits the proxy header onto the inner document and ignores the injected meta policy, a view could frame the sandbox origin itself. The sandbox origin only serves the proxy document.

3. **How apps attach when tool results are hidden.** `GET` of a bot gains an `apps` array. Messages stay user, assistant, note, and peer lines. The page draws the iframe after the message named by `messageId`. Text fallback is `apps[].text` and, for a later invoke, an assistant line with that same text. Full tool traces are not added to the thread or the export.

4. **What needs confirmation?** `tools/call`, `ui/message`, `ui/update-model-context`, and `ui/open-link` (http and https only). The buttons are in the chat page, not in the view. Domain lists need their own allow step before they enter CSP. `resources/read` of a `ui://` resource on this peer does not ask again. Display-mode requests other than inline are answered with `inline`.

5. **Who may name connectDomains and resourceDomains?** Only the resource `_meta.ui.csp` returned by `resources/read`. Empty or omitted means no external origins. The view cannot add origins. The person at the keyboard must allow a non-empty list. There is no separate operator allowlist yet, so a confirmed list is used as declared after each entry is checked (https, http, wss, or ws origin, optional `*.` label, no paths or wildcards alone).

6. **Local simulator.** It is the working peer. Resetting the simulator restores Ada's seeded status app and drops any probe created in a test. It does not open a socket to a third-party MCP server. The same page code renders `apps` if a sprite thread ever includes them. Today's sprite server does not emit `apps`.

## Remaining gaps

- No external MCP client (stdio, Streamable HTTP, or OAuth). A sprite bot cannot yet call an outside server's UI tools.
- The sprite process does not record app attachments from Pi tool calls. Tool traces on a sprite stay omitted, and no app is attached.
- Sandbox origins are per client process and per ephemeral port, not a stable registered domain. `domain` on the resource (`_meta.ui.domain`) is ignored.
- `ui/notifications/tool-input-partial` and `ui/notifications/tool-cancelled` are not sent. Tools are complete before the view is shown.
- Fullscreen and picture-in-picture are declined. The host reports `inline` only.
- `PI_ORBS_MCP_APP_ALLOW` is process-wide. There is no per-app permission grant in the UI.
- The proxy and the view share the sandbox origin (`allow-same-origin` on the inner frame) so the proxy can `document.write` the HTML, which is the pattern in the spec's basic host. The security boundary that is tested is the host origin: the view must not read the chat page.
