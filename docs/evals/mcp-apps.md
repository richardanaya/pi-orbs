# MCP Apps in Pi Orbs

**Recommendation: skip a host in this change. Try a spec-shaped host later only after the open questions below are decided.**

Do not ship a partial widget, a same-origin iframe, or “render whatever HTML a tool returned.” That would look like MCP Apps support and would be the wrong security model.

## What MCP Apps means

MCP Apps is the stable extension `io.modelcontextprotocol/ui` (SEP-1865, 2026-01-26). It is how an MCP server delivers an interactive UI to a host such as Claude or Cursor.

- A tool declares `_meta.ui.resourceUri` pointing at a predeclared `ui://` resource.
- The host fetches that resource with `resources/read`. The MVP content type is `text/html;profile=mcp-app`.
- Client and server negotiate the extension during MCP `initialize`. Servers are expected to keep a text result even when a UI exists.
- The view runs in a sandboxed iframe and talks to the host with JSON-RPC over `postMessage` (`ui/initialize`, tool input and result, `tools/call`, `ui/message`, size changes, teardown).
- A **web** host must use the double-iframe sandbox: an outer sandbox proxy on a **different origin**, then the view inside that. The host forwards messages. It does not give the view the chat page’s origin, cookies, or DOM.
- The resource’s `_meta.ui.csp` lists connect, resource, and frame origins. Empty means none. Permissions (camera, microphone, geolocation, clipboard) are requests the host may refuse.

Sources: [MCP Apps overview](https://modelcontextprotocol.org/extensions/apps/overview) and the [2026-01-26 apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx).

## What Pi Orbs does today

Pi Orbs is a chat client for Pi conversations, not an MCP host.

- Each bot is one Pi thread. The page shows user and assistant text, notes, and peer steers. Tool traces are omitted from the thread and from the conversation zip.
- The only MCP feature is inbound event delivery. `create_mcp_event_webhook` mints `POST /api/mcp-events/:token` plus a `whsec_` secret. A signed `events/subscribe` webhook becomes a plain text user message. The bot’s edit dialog can list those hooks and disconnect one. Disconnect makes a later post fail closed. There is no `tools/list`, no `resources/read`, and nowhere a `ui://` document is stored.
- ```html fences already open in a preview iframe with an empty `sandbox` attribute (no scripts). That is a static preview. An MCP App needs scripts to speak JSON-RPC, so this iframe cannot host one.
- Uploaded SVG stays an attachment, with `nosniff` and a sandboxed content security policy on the file response. That path must not be reused to execute app HTML.

## Options

| Option | Verdict | What it would take |
| --- | --- | --- |
| Skip for now | **Adopt this.** | Leave MCP as signed event webhooks. Chat keeps markdown, media, and Mermaid. Text tool results stay text. |
| Spec-shaped host later | **Try only after the questions below.** | Negotiate `io.modelcontextprotocol/ui`. Fetch predeclared `ui://` resources. Render through a different-origin sandbox proxy. Bridge JSON-RPC. Ask before an app calls a tool or updates model context. Enforce declared CSP with an empty-means-none default. Refuse camera, microphone, and geolocation unless a person allows them. Tear the iframe down when the thread repaints. |
| Limited widgets or inline HTML | **Skip.** | Stuffing tool HTML into the chat origin, or into the existing HTML preview, is origin confusion. It is not the extension, and a script there can read the page. |

## Open questions

1. Who is the MCP peer? A bot’s own Pi tools, an external server the person connects, or both? Today neither side exposes UI resources to the page.
2. Where does the sandbox origin live? The client is one origin (`:8787` or the sprite URL). The spec wants the proxy on another origin. A path on the same host is not that.
3. Will the thread keep tool results? Apps are tied to a tool call’s arguments and result. Those entries are not on the page now.
4. What may an app do without another confirmation? `tools/call`, `ui/message` (which can start a follow-up turn), and `ui/update-model-context` all change the conversation.
5. Who is allowed to name `connectDomains` and `resourceDomains`? An empty list is the safe default. A bot-controlled list is a network exfiltration choice.
6. What happens on the local simulator, which has no Pi harness and no MCP client?

Until those are answered, the safe display for bot and tool output remains the text already admitted into the thread.
