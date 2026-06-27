/**
 * R22 — Properties (frontmatter) typed model + byte-preserving edit builders.
 *
 * Contract: docs/ARCHITECTURE.md "Round 22 additions". Key invariants:
 * - parseProperties block boundaries are FROZEN identical to
 *   metadata.parseFrontmatter (first line exactly "---", close at line-start
 *   "---"); only the first 20_000 chars are parsed (livePreview口径) — a block
 *   that does not close inside that prefix counts as "no block".
 * - Every edit builder returns a SINGLE splice touching only the target
 *   entry's lines; all other bytes (other entries, opaque rows, comments)
 *   are preserved verbatim. Unsafe situations return null — never guess.
 * - Entries outside the supported subset (nested maps, |/> block scalars,
 *   duplicate keys, comments, unrecognized lines) become OPAQUE entries:
 *   raw lines preserved, read-only in the panel, never rewritten.
 * - Internal keyed collections are Map / null-prototype objects only
 *   (`__proto__` / `constructor` property names must not pollute prototypes —
 *   frozen requirement).
 */
import { Store } from "./store";
import type { Vault } from "./vault";

export type PropertyType =
  | "text"
  | "multitext"
  | "number"
  | "checkbox"
  | "date"
  | "datetime"
  | "tags"
  | "aliases";

export type PropertyValue = string | number | boolean | string[] | null;

export interface PropertyEntry {
  /** authored casing */
  key: string;
  /** null = bare `key:` (empty value) */
  value: PropertyValue;
  /** full line span [from, to) of this entry incl. trailing \n */
  from: number;
  to: number;
  /** opaque: raw lines preserved, value meaningless, read-only in panel */
  opaque?: boolean;
  /** raw source (incl. newlines) when opaque */
  raw?: string;
}

export interface ParsedProperties {
  /** document order */
  entries: PropertyEntry[];
  /** whole-block span incl. both --- fences and trailing newline */
  from: number;
  to: number;
}

export interface PropertyEdit {
  from: number;
  to: number;
  insert: string;
}

/* ---------------- block boundaries (frozen = metadata.parseFrontmatter) ---- */

/** Only the first 20_000 chars are considered (livePreview口径). */
const PARSE_LIMIT = 20_000;

/** Key charset — frozen identical to metadata.parseFrontmatter's kv regex. */
const KV_RE = /^([A-Za-z0-9_\-. ]+):(.*)$/;
/** Block-list item continuation: `- item` (any indentation). */
const ITEM_RE = /^[ \t]*-[ \t]+(.*)$/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

interface BlockBounds {
  /** offset just after the opening `---\n` (start of body) */
  bodyFrom: number;
  /** offset of the closing fence line start (body end, exclusive) */
  bodyTo: number;
  /** whole-block end (after the closing fence line incl. its \n, or EOF) */
  to: number;
}

function findBlock(content: string): BlockBounds | null {
  if (!content.startsWith("---")) return null;
  const head = content.length > PARSE_LIMIT ? content.slice(0, PARSE_LIMIT) : content;
  const firstLineEnd = head.indexOf("\n");
  if (firstLineEnd === -1 || head.slice(0, firstLineEnd).trim() !== "---") return null;
  // close fence must be found INSIDE the parsed prefix; otherwise: no block
  const close = head.indexOf("\n---", firstLineEnd);
  if (close === -1) return null;
  const closeLineEnd = content.indexOf("\n", close + 1);
  const to = closeLineEnd === -1 ? content.length : closeLineEnd + 1;
  return { bodyFrom: firstLineEnd + 1, bodyTo: close + 1, to };
}

/* ---------------- value parsing (frozen subset) ---------------- */

/** Unescape inside double quotes — contract set: `\"`→`"`, `\\`→`\`; any
 *  other backslash sequence is kept literally. */
function unescapeDoubleQuoted(s: string): string {
  let out = "";
  let esc = false;
  for (const ch of s) {
    if (esc) {
      out += ch === '"' || ch === "\\" ? ch : "\\" + ch;
      esc = false;
    } else if (ch === "\\") {
      esc = true;
    } else {
      out += ch;
    }
  }
  if (esc) out += "\\";
  return out;
}

/** Strip one layer of matching quotes (quoted scalars are ALWAYS strings). */
function unquoteScalar(t: string): string {
  if (t.length >= 2) {
    if (t.startsWith('"') && t.endsWith('"')) return unescapeDoubleQuoted(t.slice(1, -1));
    if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  }
  return t;
}

/** Unquoted scalar inference: true/false → boolean, null/~ → null, finite
 *  decimal number literal → number, everything else → string. */
function parseScalar(raw: string): PropertyValue {
  if (
    (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
    (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)
  ) {
    return unquoteScalar(raw);
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null" || raw === "~") return null;
  if (NUMBER_RE.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

/** Split an inline list body on commas, respecting quoted segments.
 *  Returns null when the body contains an UNQUOTED bracket/brace — a nested
 *  flow sequence/map is outside the parse subset and the whole entry must go
 *  opaque instead of being flattened (R22 review fix: `[[a, b], c]` used to
 *  parse as ["[a","b]","c"] and one edit would shred the nested structure). */
function splitInlineList(inner: string): string[] | null {
  const parts: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let esc = false;
  for (const ch of inner) {
    if (quote === '"') {
      cur += ch;
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') quote = null;
    } else if (quote === "'") {
      cur += ch;
      if (ch === "'") quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === "[" || ch === "]" || ch === "{" || ch === "}") {
      return null; // nested flow construct — out of subset
    } else if (ch === ",") {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

/** List items are TEXT: strip quotes only, no bool/number inference (frozen). */
function parseListItem(raw: string): string {
  return unquoteScalar(raw.trim());
}

/** Inline `[a, b]` list → string[] (empty slots dropped, quoted "" kept).
 *  null = nested flow construct inside — caller makes the entry opaque. */
function parseInlineList(raw: string): string[] | null {
  const inner = raw.slice(1, -1);
  const parts = splitInlineList(inner);
  if (parts === null) return null;
  const out: string[] = [];
  for (const part of parts) {
    const t = part.trim();
    if (t === "") continue; // truly empty slot
    out.push(unquoteScalar(t));
  }
  return out;
}

/* ---------------- parsing ---------------- */

interface ParsedInternal extends ParsedProperties {
  bodyFrom: number;
  bodyTo: number;
}

function parseInternal(content: string): ParsedInternal | null {
  const block = findBlock(content);
  if (!block) return null;
  const { bodyFrom, bodyTo, to } = block;

  // body line spans (every body line ends with \n — the body always ends with
  // the \n that precedes the closing fence)
  const lines: Array<{ from: number; to: number; text: string }> = [];
  let pos = bodyFrom;
  while (pos < bodyTo) {
    let nl = content.indexOf("\n", pos);
    if (nl === -1 || nl >= bodyTo) nl = bodyTo - 1;
    lines.push({ from: pos, to: nl + 1, text: content.slice(pos, nl) });
    pos = nl + 1;
  }

  const entries: PropertyEntry[] = [];
  const seenKeys = new Set<string>(); // lowercased visible/keyed entry names

  const pushOpaque = (key: string, from: number, end: number): void => {
    entries.push({
      key,
      value: null,
      from,
      to: end,
      opaque: true,
      raw: content.slice(from, end),
    });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const text = line.text;
    const trimmed = text.trim();

    // blank line → anonymous opaque row
    if (trimmed === "") {
      pushOpaque("", line.from, line.to);
      i++;
      continue;
    }
    // whole-line comment → opaque row
    if (trimmed.startsWith("#")) {
      pushOpaque("", line.from, line.to);
      i++;
      continue;
    }
    // stray list item with no owning key (or after a broken list) → opaque.
    // Checked before KV: "- foo: bar" must not parse as key "- foo".
    if (/^-([ \t]|$)/.test(text)) {
      pushOpaque("", line.from, line.to);
      i++;
      continue;
    }

    const kv = /^\S/.test(text) ? KV_RE.exec(text) : null;
    if (kv) {
      const key = kv[1].trim();
      const rawValue = kv[2].trim();
      const lower = key.toLowerCase();
      const duplicate = seenKeys.has(lower);
      seenKeys.add(lower);

      // |/> block scalar → whole entry opaque (absorb indented continuation)
      if (/^[|>]/.test(rawValue)) {
        let end = i;
        while (
          end + 1 < lines.length &&
          /^[ \t]/.test(lines[end + 1].text) &&
          lines[end + 1].text.trim() !== ""
        ) {
          end++;
        }
        pushOpaque(key, line.from, lines[end].to);
        i = end + 1;
        continue;
      }

      if (rawValue === "") {
        // bare `key:` — may be followed by block-list items; any other
        // indented continuation makes the WHOLE entry an opaque nested map.
        // R22 review fix (F1): YAML allows blank/comment lines INSIDE a
        // block sequence but our subset does not — a gap followed by another
        // item line means the construct is out of subset, so the WHOLE run
        // (key through the last item, gaps included) becomes one opaque
        // entry instead of a half-parsed list that an edit would shred.
        let end = i;
        let nested = false;
        const items: string[] = [];
        let j = i + 1;
        let pendingGap = false; // blank/comment lines seen since the last item
        while (j < lines.length) {
          const itemText = lines[j].text;
          const trimmedItem = itemText.trim();
          if (trimmedItem === "" || trimmedItem.startsWith("#")) {
            pendingGap = true; // belongs to the list only if an item follows
            j++;
            continue;
          }
          const m = ITEM_RE.exec(itemText);
          if (m && m[1].trim() !== "") {
            if (pendingGap) nested = true; // gap inside the sequence
            pendingGap = false;
            items.push(parseListItem(m[1]));
            end = j;
            j++;
            continue;
          }
          if (/^[ \t]/.test(itemText)) {
            if (pendingGap) break; // gap then a non-item indented line: stop
            nested = true;
            end = j;
            j++;
            continue;
          }
          break;
        }
        if (nested || duplicate) {
          pushOpaque(key, line.from, lines[end].to);
        } else if (items.length > 0) {
          entries.push({ key, value: items, from: line.from, to: lines[end].to });
        } else {
          entries.push({ key, value: null, from: line.from, to: line.to });
        }
        i = end + 1;
        continue;
      }

      // scalar / inline list — any indented follower means a nested construct
      // (the follower belongs to this entry in YAML): whole entry opaque
      let end = i;
      let nested = false;
      let j = i + 1;
      while (
        j < lines.length &&
        /^[ \t]/.test(lines[j].text) &&
        lines[j].text.trim() !== ""
      ) {
        nested = true;
        end = j;
        j++;
      }
      if (nested || duplicate) {
        pushOpaque(key, line.from, lines[end].to);
        i = end + 1;
        continue;
      }
      if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
        const list = parseInlineList(rawValue);
        if (list === null) {
          // nested flow sequence/map — out of subset, never rewritten
          pushOpaque(key, line.from, line.to);
        } else {
          entries.push({ key, value: list, from: line.from, to: line.to });
        }
        i++;
        continue;
      }
      entries.push({ key, value: parseScalar(rawValue), from: line.from, to: line.to });
      i++;
      continue;
    }

    // anything else (indented orphan, unicode/quoted keys, free text, `{`…)
    // → anonymous opaque row
    pushOpaque("", line.from, line.to);
    i++;
  }

  return { entries, from: 0, to, bodyFrom, bodyTo };
}

/** null = no frontmatter block. Block boundaries frozen identical to
 *  metadata.parseFrontmatter; only the first 20_000 chars are parsed. */
export function parseProperties(content: string): ParsedProperties | null {
  const parsed = parseInternal(content);
  if (!parsed) return null;
  return { entries: parsed.entries, from: parsed.from, to: parsed.to };
}

/* ---------------- value serialization (frozen) ---------------- */

/** A string needs double quotes iff (frozen contract list). */
function stringNeedsQuotes(s: string): boolean {
  if (s === "") return true;
  if (/^\s|\s$/.test(s)) return true;
  // first char in the frozen "ambiguous YAML opener" set
  if ('[{"\'#&*!|>%@`-?'.includes(s[0])) return true;
  if (s.includes(": ")) return true;
  // trailing colon (R22 review fix): `k: draft:` is invalid YAML for real
  // parsers (js-yaml errors on the whole block) and `- draft:` silently
  // becomes a nested map — our own subset round-trips it, which masked it
  if (/:$/.test(s)) return true;
  if (/\s#/.test(s)) return true; // `#` after whitespace = inline comment
  if (s === "true" || s === "false" || s === "null" || s === "~") return true;
  if (NUMBER_RE.test(s)) return true;
  // NOTE (chief ruling, R22 dev): date/datetime literals are NOT quoted —
  // they re-parse as the identical string either way (we never coerce them
  // to a non-string type), and Obsidian writes them bare.
  if (s.includes("[[")) return true;
  return false;
}

function quoteString(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function serializeScalarString(s: string): string {
  return stringNeedsQuotes(s) ? quoteString(s) : s;
}

/** Serialize one full entry (incl. trailing \n). Returns null when the value
 *  cannot be written safely on serialized lines (embedded newlines, non-finite
 *  numbers) — callers surface this as a refused edit. */
function serializeEntry(key: string, value: PropertyValue): string | null {
  if (value === null) return `${key}:\n`;
  if (typeof value === "boolean") return `${key}: ${value ? "true" : "false"}\n`;
  if (typeof value === "number") {
    // round-trip guard (frozen: set → re-parse must yield an equal value):
    // refuse numbers whose canonical form leaves our parse subset (NaN,
    // ±Infinity, exponent notation like 1e+21 — would re-parse as string)
    if (!Number.isFinite(value) || !NUMBER_RE.test(String(value))) return null;
    return `${key}: ${String(value)}\n`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []\n`;
    let out = `${key}:\n`;
    for (const item of value) {
      // ALL line terminators break the single-line invariant (R22 review
      // fix: \r / U+2028 / U+2029 survive quoting but kill the KV regex on
      // re-parse — the entry would come back as an anonymous opaque row)
      if (/[\n\r\u2028\u2029]/.test(item)) return null;
      out += `  - ${serializeScalarString(item)}\n`;
    }
    return out;
  }
  if (/[\n\r\u2028\u2029]/.test(value)) return null;
  return `${key}: ${serializeScalarString(value)}\n`;
}

/* ---------------- edit builders (single splice, byte-preserving) ---------- */

/** New keys created by buildSetProperty must round-trip through our own
 *  parser as VISIBLE entries (frozen round-trip), so they are restricted to
 *  the parseFrontmatter key charset, without leading/trailing whitespace.
 *  R22 review fix (critical): keys starting with "-" are rejected — a "---"
 *  prefix would serialize into a CLOSING FENCE line (truncating the block)
 *  and "- x" re-parses as a stray list item (anonymous opaque row). */
function isInsertableKey(key: string): boolean {
  return (
    key === key.trim() &&
    key !== "" &&
    !key.startsWith("-") &&
    /^[A-Za-z0-9_\-. ]+$/.test(key)
  );
}

/** Numbers whose canonical String() form round-trips through the decimal
 *  parse subset — exponent forms (1e21, 1e-7) do NOT and would re-parse as
 *  strings; the panel falls back to a text-string commit for those (R22
 *  review fix SEC-02). */
export function canSerializeNumber(n: number): boolean {
  return Number.isFinite(n) && NUMBER_RE.test(String(n));
}

/** Round-trip self-verification (defense in depth, R22 review): a serialized
 *  entry must re-parse as exactly one VISIBLE entry with the same key and an
 *  equal value — any class of fence/item/terminator collision we have not
 *  enumerated fails here instead of corrupting the document. */
function entryRoundTrips(entryText: string, key: string, value: PropertyValue): boolean {
  const reparsed = parseInternal(`---\n${entryText}---\n`);
  if (!reparsed || reparsed.entries.length !== 1) return false;
  const e = reparsed.entries[0];
  if (e.opaque || e.key !== key) return false;
  const a = e.value;
  if (Array.isArray(value)) {
    return (
      Array.isArray(a) && a.length === value.length && a.every((x, i) => x === value[i])
    );
  }
  return a === value;
}

/** True when a properties block may be SAFELY created at offset 0. When the
 *  content starts with a "---" line but findBlock saw no block, the closing
 *  fence may simply lie beyond the 20k parse limit — metadata.parseFrontmatter
 *  (no cap) still sees a block there, and prepending a second block would
 *  semantically orphan every existing property (R22 review SEC-01/F6). Safe
 *  only when NO closing fence exists anywhere (both layers then agree). */
export function canCreatePropertiesBlock(content: string): boolean {
  if (!content.startsWith("---")) return true;
  const firstLineEnd = content.indexOf("\n");
  if (firstLineEnd === -1) return true; // single "---" line, no newline: metadata sees no block either
  if (content.slice(0, firstLineEnd).trim() !== "---") return true;
  return content.indexOf("\n---", firstLineEnd) === -1; // mirror metadata's close detection
}

/** First entry whose key matches case-insensitively (anonymous rows never
 *  match). Returns the index or -1. */
function findEntry(entries: PropertyEntry[], key: string): number {
  const lower = key.toLowerCase();
  for (let i = 0; i < entries.length; i++) {
    const k = entries[i].key;
    if (k !== "" && k.toLowerCase() === lower) return i;
  }
  return -1;
}

export function buildSetProperty(
  content: string,
  key: string,
  value: PropertyValue,
): PropertyEdit | null {
  const parsed = parseInternal(content);
  if (!parsed) {
    // no frontmatter block → create one at offset 0 — but ONLY when the
    // 20k-capped view and metadata agree there is no block (R22 review fix)
    if (!canCreatePropertiesBlock(content)) return null;
    if (!isInsertableKey(key)) return null;
    const entry = serializeEntry(key, value);
    if (entry === null || !entryRoundTrips(entry, key, value)) return null;
    return { from: 0, to: 0, insert: `---\n${entry}---\n` };
  }
  const idx = findEntry(parsed.entries, key);
  if (idx !== -1) {
    const entry = parsed.entries[idx];
    if (entry.opaque) return null; // opaque entries are never rewritten
    const insert = serializeEntry(entry.key, value); // keep authored key casing
    if (insert === null || !entryRoundTrips(insert, entry.key, value)) return null;
    return { from: entry.from, to: entry.to, insert };
  }
  // new key → insert just before the closing fence
  if (!isInsertableKey(key)) return null;
  const insert = serializeEntry(key, value);
  if (insert === null || !entryRoundTrips(insert, key, value)) return null;
  return { from: parsed.bodyTo, to: parsed.bodyTo, insert };
}

export function buildRenameProperty(
  content: string,
  key: string,
  newKey: string,
): PropertyEdit | null {
  // chief ruling (R22 dev): newKey must round-trip as a VISIBLE entry, so it
  // is restricted to the same insertable charset as buildSetProperty — the
  // original contract regex /^[^\s:][^:]*$/ admitted keys (unicode/emoji)
  // that would re-parse as anonymous opaque rows after the rename.
  if (!isInsertableKey(newKey)) return null;
  const parsed = parseInternal(content);
  if (!parsed) return null;
  const idx = findEntry(parsed.entries, key);
  if (idx === -1) return null;
  const entry = parsed.entries[idx];
  if (entry.opaque) return null;
  // case-insensitive collision with any OTHER keyed entry (incl. opaque)
  const lower = newKey.toLowerCase();
  for (let i = 0; i < parsed.entries.length; i++) {
    if (i === idx) continue;
    const k = parsed.entries[i].key;
    if (k !== "" && k.toLowerCase() === lower) return null;
  }
  // locate the exact key text span on the entry's first line — value bytes
  // (everything from the colon on) are untouched
  const lineEnd = content.indexOf("\n", entry.from);
  const firstLine = content.slice(entry.from, lineEnd === -1 ? entry.to : lineEnd);
  const m = KV_RE.exec(firstLine);
  if (!m) return null; // defensive: visible entries always re-match
  return { from: entry.from, to: entry.from + m[1].length, insert: newKey };
}

export function buildRemoveProperty(content: string, key: string): PropertyEdit | null {
  const parsed = parseInternal(content);
  if (!parsed) return null;
  const idx = findEntry(parsed.entries, key);
  if (idx === -1) return null;
  const entry = parsed.entries[idx];
  if (entry.opaque) return null;
  // last remaining entry (counting opaque rows) → remove the whole block
  if (parsed.entries.length === 1) {
    return { from: parsed.from, to: parsed.to, insert: "" };
  }
  return { from: entry.from, to: entry.to, insert: "" };
}

/**
 * R194: clear all note properties (Obsidian editor:clear-metadata-properties) by removing
 * the WHOLE frontmatter block. Mirrors buildRemoveProperty's last-entry path; reuses the
 * R22-vetted parseInternal/findBlock bounds. Returns null (no-op) when there is no
 * parseable block or it has no entries — nothing to clear. Only `[from, to)` (the block)
 * is removed; the note body is byte-preserved.
 */
export function buildClearProperties(content: string): PropertyEdit | null {
  const parsed = parseInternal(content);
  if (!parsed || parsed.entries.length === 0) return null;
  return { from: parsed.from, to: parsed.to, insert: "" };
}

/* ---------------- type inference ---------------- */

export function inferPropertyType(value: PropertyValue): PropertyType {
  if (Array.isArray(value)) return "multitext";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    if (DATE_RE.test(value)) return "date";
    if (DATETIME_RE.test(value)) return "datetime";
  }
  return "text";
}

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  "text",
  "multitext",
  "number",
  "checkbox",
  "date",
  "datetime",
  "tags",
  "aliases",
]);

export function effectivePropertyType(
  key: string,
  value: PropertyValue,
  assigned?: string,
): PropertyType {
  const lower = key.toLowerCase();
  if (lower === "tags") return "tags";
  if (lower === "aliases") return "aliases";
  if (lower === "cssclasses") return "multitext";
  if (assigned !== undefined && KNOWN_TYPES.has(assigned)) return assigned as PropertyType;
  return inferPropertyType(value);
}

/* ---------------- property type registry (.obsidian/types.json) ----------- */

/** Vault-wide property-name → type assignments (.obsidian/types.json). */
export interface PropertyTypeRegistry {
  revision: Store<number>;
  /** case-insensitive lookup; unknown stored values are passed through */
  get(key: string): string | undefined;
  /** R268: all assigned properties (lowercased name → stored type) as a COPY — backs the
   *  compat MetadataTypeManager.getAllProperties() (e.g. Tasks reads it to register its dates). */
  getAll(): Map<string, string>;
  assign(key: string, type: PropertyType): Promise<void>;
  /** reads .obsidian/types.json (missing/bad JSON → empty, warn once) */
  init(vault: Vault): Promise<void>;
}

const TYPES_CONFIG = "types.json";

let regVault: Vault | null = null;
/** lowercased property name → stored type string (Map: prototype-safe) */
let regMap = new Map<string, string>();
let regWarnedOnce = false;

/** Every registry mutation (init + assign RMW) is serialized on one module
 *  promise chain (R20 themes.ts opChain precedent) — a re-init can never
 *  interleave with a running read-modify-write. */
let regChain: Promise<void> = Promise.resolve();

function regEnqueue(label: string, op: () => Promise<void> | void): Promise<void> {
  const run = regChain.then(async () => {
    try {
      await op();
    } catch (err) {
      console.warn(`[properties] ${label} failed`, err);
    }
  });
  regChain = run;
  return run;
}

function regWarn(message: string, err?: unknown): void {
  if (regWarnedOnce) return;
  regWarnedOnce = true;
  if (err !== undefined) console.warn(`[properties] ${message}`, err);
  else console.warn(`[properties] ${message}`);
}

/** Copy own enumerable string keys onto a null-prototype object — assignment
 *  on a null-proto target cannot reach Object.prototype (`__proto__` safe). */
function toNullProto(src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const k of Object.keys(src)) out[k] = src[k];
  return out;
}

async function regRunInit(vault: Vault): Promise<void> {
  regVault = vault;
  const map = new Map<string, string>();
  if (vault.isOpen) {
    let raw: string | null = null;
    try {
      raw = await vault.adapter.readConfig(TYPES_CONFIG);
    } catch (err) {
      regWarn(`failed to read ${TYPES_CONFIG} — property types empty`, err);
    }
    if (raw === null) {
      regWarn(`${TYPES_CONFIG} missing — property types empty`);
    } else {
      try {
        const parsed: unknown = JSON.parse(raw);
        const types =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>).types
            : undefined;
        if (types && typeof types === "object" && !Array.isArray(types)) {
          for (const k of Object.keys(types)) {
            const v = (types as Record<string, unknown>)[k];
            // unknown type STRINGS are kept verbatim (get() passes them
            // through; effectivePropertyType falls back to inference)
            if (typeof v === "string") map.set(k.toLowerCase(), v);
          }
        } else {
          regWarn(`${TYPES_CONFIG} has no "types" object — property types empty`);
        }
      } catch (err) {
        regWarn(`${TYPES_CONFIG} is not valid JSON — property types empty`, err);
      }
    }
  }
  regMap = map;
  propertyTypes.revision.update((n) => n + 1);
}

async function regRunAssign(key: string, type: PropertyType): Promise<void> {
  // in-memory first: the UI reflects the assignment even if the write fails
  regMap.set(key.toLowerCase(), type);
  propertyTypes.revision.update((n) => n + 1);

  const vault = regVault;
  if (!vault || !vault.isOpen) return;
  // vault-switch race guard (R22 review fix): openVaultFlow re-points
  // vault.adapter in place — if that happens between our read and write,
  // the old vault's types would be merged INTO the new vault's types.json.
  // Capture the adapter identity and verify it before writing.
  const adapterBefore = vault.adapter;

  // RMW: preserve sibling keys outside "types" and unknown keys inside it.
  // A missing file is created from scratch, but a MALFORMED existing file
  // aborts the write (R20 appearance.json precedent — never erase what
  // Obsidian itself wrote). Throw → chain catches + warns (fail visible).
  let root: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const raw = await vault.adapter.readConfig(TYPES_CONFIG);
  if (raw !== null) {
    const parsed: unknown = JSON.parse(raw); // throws → abort
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${TYPES_CONFIG} is not a JSON object — refusing to overwrite`);
    }
    root = toNullProto(parsed as Record<string, unknown>);
  }
  const typesVal = root.types;
  const types =
    typesVal && typeof typesVal === "object" && !Array.isArray(typesVal)
      ? toNullProto(typesVal as Record<string, unknown>)
      : (Object.create(null) as Record<string, unknown>);
  // case-insensitive: an existing entry keeps its authored key casing
  const lower = key.toLowerCase();
  let target = key;
  for (const k of Object.keys(types)) {
    if (k.toLowerCase() === lower) {
      target = k;
      break;
    }
  }
  types[target] = type;
  root.types = types;
  if (vault.adapter !== adapterBefore || !vault.isOpen) {
    console.warn(`[properties] vault switched mid-assign — ${TYPES_CONFIG} write skipped`);
    return; // the queued re-init rebuilds the in-memory map from the new vault
  }
  await vault.adapter.writeConfig(TYPES_CONFIG, JSON.stringify(root, null, 2));
}

export const propertyTypes: PropertyTypeRegistry = {
  revision: new Store(0),
  get: (key: string) => regMap.get(key.toLowerCase()),
  getAll: () => new Map(regMap),
  assign: (key: string, type: PropertyType) =>
    regEnqueue("assign", () => regRunAssign(key, type)),
  // idempotent + reentrant: serialized on the module chain, re-reads fresh
  init: (vault: Vault) => regEnqueue("init", () => regRunInit(vault)),
};
