/**
 * Template engine (R23) — Templates core-plugin parity: settings stores
 * (folder / date format / time format), picker mode, template enumeration and
 * {{title}}/{{date}}/{{time}} variable expansion. See ARCHITECTURE.md
 * "Round 23 additions" for the frozen contract.
 */
// Same specifier as compat/obsidian/util.ts — Vite dedupes to a single moment
// instance, so this adds zero bytes to the main chunk beyond what compat ships.
import moment from "moment/min/moment-with-locales";
import { Store } from "./store";
import type { Vault } from "./vault";

const FOLDER_KEY = "geode.templateFolder";
const DATE_KEY = "geode.templateDateFormat";
const TIME_KEY = "geode.templateTimeFormat";

/** Default template folder — Geode deviation from the official plugin (which
 *  ships unconfigured) for demo-vault usability. Empty setting still means
 *  "not configured" (listTemplates → null). */
const DEFAULT_FOLDER = "templates";
const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
const DEFAULT_TIME_FORMAT = "HH:mm";

function readInitial(key: string, fallback: string): string {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — session-only */
  }
}

/** Template folder setting (default "templates", persisted). Stored RAW —
 *  trimming happens at consumption (listTemplates); trimming here would fight
 *  the controlled settings input on every keystroke (R17 attachmentFolder
 *  precedent). */
export const templateFolder = new Store<string>(readInitial(FOLDER_KEY, DEFAULT_FOLDER));

export function setTemplateFolder(v: string): void {
  templateFolder.set(v);
  persist(FOLDER_KEY, v);
}

/** Date format for {{date}} (default "" = YYYY-MM-DD, persisted, stored RAW). */
export const templateDateFormat = new Store<string>(readInitial(DATE_KEY, ""));

export function setTemplateDateFormat(v: string): void {
  templateDateFormat.set(v);
  persist(DATE_KEY, v);
}

/** Time format for {{time}} (default "" = HH:mm, persisted, stored RAW). */
export const templateTimeFormat = new Store<string>(readInitial(TIME_KEY, ""));

export function setTemplateTimeFormat(v: string): void {
  templateTimeFormat.set(v);
  persist(TIME_KEY, v);
}

/** Picker open mode (one-shot semantics: the command sets this BEFORE
 *  openModal("templates"); the modal reads it on mount). Not persisted. */
export const templatePickerMode = new Store<"insert" | "create">("insert");

export interface TemplateInfo {
  /** vault-relative path of the template file */
  path: string;
  /** basename without the .md extension */
  name: string;
}

/**
 * Enumerate templates under the configured folder (recursive — subfolders
 * included via path-prefix filtering over vault.getMarkdownFiles()).
 *
 * Folder = templateFolder consumption form (trim + strip leading/trailing
 * slashes). Empty string or any ""/"."/".."/dot-prefixed segment → null
 * (= unconfigured/invalid; the picker shows a configuration hint — same
 * validation spirit as attachments.validateDir but returning null, not
 * throwing). Folder missing or holding no .md files → [] (picker shows an
 * empty hint). Sorted by name (localeCompare).
 */
export function listTemplates(vault: Vault): TemplateInfo[] | null {
  const folder = templateFolder.get().trim().replace(/^\/+|\/+$/g, "");
  if (folder === "") return null;
  for (const seg of folder.split("/")) {
    if (seg === "" || seg === "." || seg === ".." || seg.startsWith(".")) return null;
  }
  const prefix = `${folder}/`;
  return vault
    .getMarkdownFiles()
    .filter((f) => f.path.startsWith(prefix))
    .map((f) => ({ path: f.path, name: f.basename }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Frozen variable syntax: {{title}}, {{date}}, {{time}}, optional ":FMT"
 *  (format = everything after the colon up to the nearest "}}", no "}"
 *  characters — [^}]*, no longer-greedy matching). Names case-insensitive. */
const TEMPLATE_VAR = /\{\{(title|date|time)(?::([^}]*))?\}\}/gi;

/**
 * Expand template variables (frozen semantics — single-pass String.replace
 * callback, so replacement values are never re-scanned: a title containing
 * "{{date}}" is NOT expanded again; adversarial-input rule).
 *
 * - {{title}} → ctx.title (literal). {{title:...}} is NOT a variable — the
 *   regex matches it, but the callback returns the original text verbatim.
 * - {{date}} → moment(now).format(templateDateFormat consumption form;
 *   empty → YYYY-MM-DD). {{date:FMT}} → format(FMT); empty FMT ("{{date:}}")
 *   ≡ {{date}} (the consumption form — only an empty SETTING falls back to
 *   YYYY-MM-DD; contract amended per review R23-F1). {{time}}/{{time:FMT}}
 *   same via templateTimeFormat (empty → HH:mm).
 * - Pure text transform; never throws (moment.format is safe on any string).
 */
export function expandTemplate(content: string, ctx: { title: string; now: Date }): string {
  return content.replace(TEMPLATE_VAR, (match, name: string, fmt: string | undefined) => {
    const variable = name.toLowerCase();
    if (variable === "title") {
      // {{title:anything}} is not a variable — keep the source text.
      return fmt === undefined ? ctx.title : match;
    }
    const settingRaw = variable === "date" ? templateDateFormat.get() : templateTimeFormat.get();
    const fallback = variable === "date" ? DEFAULT_DATE_FORMAT : DEFAULT_TIME_FORMAT;
    const setting = settingRaw.trim() || fallback;
    const format = fmt !== undefined && fmt !== "" ? fmt : setting;
    return moment(ctx.now).format(format);
  });
}
