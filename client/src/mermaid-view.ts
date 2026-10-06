// Browser-only Mermaid renderer. Loaded on demand from the chat page.
// Untrusted diagram text never runs as JavaScript: strict mode, locked config
// keys, and a DOMPurify pass before the page inserts the SVG.

import DOMPurify from "dompurify";
import mermaid from "mermaid";

const MAX_TEXT = 50_000;

const LOCKED = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "maxEdges",
  "htmlLabels",
  "suppressErrorRendering",
  "dompurifyConfig",
  "themeCSS",
];

let configured = false;
let sequence = 0;

function configure(): void {
  if (configured) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    suppressErrorRendering: true,
    maxTextSize: MAX_TEXT,
    logLevel: "fatal",
    theme: "dark",
    fontFamily: "Nunito, sans-serif",
    secure: LOCKED,
  });
  configured = true;
}

function allowedSvgUrl(value: string): boolean {
  const href = value.trim();
  if (!href || href.startsWith("#")) return true;
  if (/[\u0000-\u001F\u007F]/.test(href)) return false;
  const lower = href.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:") || lower.startsWith("blob:") || lower.startsWith("file:")) {
    return false;
  }
  if (href.startsWith("//") || href.startsWith("\\\\")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return lower.startsWith("https:") || lower.startsWith("http:");
  return true;
}

let hooked = false;

function hookPurify(): void {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    const el = node as { attributes: ArrayLike<{ name: string; value: string }>; removeAttribute(name: string): void };
    if (!el.attributes || typeof el.removeAttribute !== "function") return;
    for (let i = 0; i < el.attributes.length; i += 1) {
      const attr = el.attributes[i];
      if (!attr) continue;
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "href" || name === "src" || name.endsWith(":href")) {
        if (!allowedSvgUrl(attr.value)) el.removeAttribute(attr.name);
      }
    }
  });
}

export function sanitizeMermaidSvg(svg: string): string | null {
  hookPurify();
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject", "script", "iframe", "object", "embed", "audio", "video", "canvas", "link", "meta"],
  });
  if (!clean || !/<svg[\s>]/i.test(clean)) return null;
  if (/<\s*script/i.test(clean) || /javascript:/i.test(clean) || /\son[a-z]+\s*=/i.test(clean) || /<\s*foreignobject/i.test(clean)) {
    return null;
  }
  return clean;
}

function dropRenderNode(id: string): void {
  const doc = (globalThis as { document?: { getElementById(id: string): { remove(): void } | null } }).document;
  doc?.getElementById(id)?.remove();
}

export async function renderMermaidDiagram(source: string): Promise<{ ok: true; svg: string } | { ok: false; error: string }> {
  const text = source.replace(/\s+$/g, "");
  if (!text.trim()) return { ok: false, error: "This diagram is empty." };
  if (text.length > MAX_TEXT) return { ok: false, error: "This diagram is too large to draw." };
  const id = `piOrbsMermaid${sequence += 1}`;
  try {
    configure();
    const parsed = await mermaid.parse(text, { suppressErrors: true });
    if (parsed === false) return { ok: false, error: "This diagram could not be drawn." };
    const rendered = await mermaid.render(id, text);
    const clean = sanitizeMermaidSvg(rendered.svg);
    if (!clean) return { ok: false, error: "This diagram could not be drawn." };
    return { ok: true, svg: clean };
  } catch {
    return { ok: false, error: "This diagram could not be drawn." };
  } finally {
    dropRenderNode(id);
  }
}
