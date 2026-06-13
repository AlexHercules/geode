import type { Command } from "./types";
import { Store } from "./store";

const OVERRIDES_KEY = "geode.hotkeyOverrides";

/**
 * Platform primary-modifier resolution (R32). Obsidian's `Mod` modifier is Cmd
 * (metaKey) on macOS and Ctrl (ctrlKey) everywhere else; `Ctrl` always means the
 * physical Control key (even on a Mac) and `Meta` always means the ⌘/Win key.
 * Detected once at module load — the host platform does not change at runtime.
 * (core may not import features/compat, so this intentionally duplicates
 * features/hover/hoverController.isApplePlatform and compat/util.isMacOS.)
 */
function detectMacPlatform(): boolean {
  try {
    if (typeof navigator === "undefined") return false;
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
  } catch {
    return false;
  }
}

export const isMacPlatform = detectMacPlatform();

/**
 * CommandRegistry — every user-facing action registers here so the command
 * palette, hotkeys, and plugins all share one source of truth.
 *
 * R6: user hotkey overrides. An override maps a command id to a hotkey string
 * (rebound) or null (explicitly unbound); absence means the command default
 * applies. Overrides persist globally to localStorage (same pattern as the
 * plugin enabled-set) and survive for commands that register later.
 */
export class CommandRegistry {
  /** bumped when commands are (un)registered or an override changes */
  readonly revision = new Store(0);
  private commands = new Map<string, Command>();
  private overrides = new Map<string, string | null>();
  /** hot-path cache: command id -> parsed effective hotkey (null = rebuild) */
  private parsedCache: Map<string, ParsedHotkey> | null = null;

  constructor() {
    this.loadOverrides();
  }

  register(command: Command): () => void {
    this.commands.set(command.id, command);
    this.parsedCache = null;
    this.revision.update((n) => n + 1);
    return () => {
      this.commands.delete(command.id);
      this.parsedCache = null;
      this.revision.update((n) => n + 1);
    };
  }

  execute(id: string): boolean {
    const cmd = this.commands.get(id);
    if (!cmd) return false;
    cmd.callback();
    return true;
  }

  list(): Command[] {
    return [...this.commands.values()].sort((a, b) =>
      getCommandName(a).localeCompare(getCommandName(b)),
    );
  }

  /* ---------------- hotkey overrides (R6) ---------------- */

  /** The hotkey that actually fires: override ?? command default ?? null. */
  getEffectiveHotkey(id: string): string | null {
    if (this.overrides.has(id)) return this.overrides.get(id) ?? null;
    return this.commands.get(id)?.hotkey ?? null;
  }

  hasHotkeyOverride(id: string): boolean {
    return this.overrides.has(id);
  }

  /** Rebind (string) or explicitly unbind (null) a command. Persists. */
  setHotkeyOverride(id: string, hotkey: string | null): void {
    this.overrides.set(id, hotkey === null ? null : normalizeHotkey(hotkey));
    this.parsedCache = null;
    this.saveOverrides();
    this.revision.update((n) => n + 1);
  }

  /** Back to the command's default hotkey. Persists. */
  clearHotkeyOverride(id: string): void {
    if (!this.overrides.delete(id)) return;
    this.parsedCache = null;
    this.saveOverrides();
    this.revision.update((n) => n + 1);
  }

  /** Registered commands whose EFFECTIVE hotkey equals `hotkey` (normalized). */
  findHotkeyConflicts(hotkey: string, excludeId?: string): Command[] {
    const wanted = normalizeHotkey(hotkey);
    const out: Command[] = [];
    for (const cmd of this.commands.values()) {
      if (cmd.id === excludeId) continue;
      const eff = this.getEffectiveHotkey(cmd.id);
      if (eff !== null && normalizeHotkey(eff) === wanted) out.push(cmd);
    }
    return out;
  }

  /**
   * Match a KeyboardEvent against registered hotkeys (effective: overrides win).
   * Hotkey format: "Mod+Shift+P", "Mod+,", "F2". `Mod` resolves to Cmd (metaKey)
   * on macOS and Ctrl (ctrlKey) elsewhere (R32); `Ctrl` is always physical Control.
   * Hotkeys are parsed once per registry change (hot path: every keystroke).
   */
  handleKeydown(e: KeyboardEvent): boolean {
    const editable = isEditableTarget(e.target);
    for (const [id, parsed] of this.parsedHotkeys()) {
      // a binding without a non-typing modifier (bare key / Shift+key) would
      // swallow normal typing — never fire those while an editable element has
      // focus. Mod/Ctrl/Meta/Alt all count (R32: Mod = Cmd on macOS).
      const hasModifier =
        parsed.wantMod || parsed.wantCtrl || parsed.wantMeta || parsed.wantAlt;
      if (editable && !hasModifier && !parsed.isFunctionKey) continue;
      if (!matchParsedHotkey(parsed, e, isMacPlatform)) continue;
      const cmd = this.commands.get(id);
      if (!cmd) continue;
      if (cmd.available?.() === false) continue; // context-gated (e.g. needs an editor)
      e.preventDefault();
      e.stopPropagation();
      cmd.callback();
      return true;
    }
    return false;
  }

  /** command id -> parsed EFFECTIVE hotkey, rebuilt after registry changes. */
  private parsedHotkeys(): Map<string, ParsedHotkey> {
    if (this.parsedCache) return this.parsedCache;
    const map = new Map<string, ParsedHotkey>();
    for (const cmd of this.commands.values()) {
      const hotkey = this.getEffectiveHotkey(cmd.id);
      if (hotkey) map.set(cmd.id, parseHotkey(hotkey));
    }
    this.parsedCache = map;
    return map;
  }

  private loadOverrides(): void {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (value === null) this.overrides.set(id, null);
          else if (typeof value === "string") this.overrides.set(id, normalizeHotkey(value));
        }
      }
    } catch {
      // corrupted storage — start clean
    }
  }

  private saveOverrides(): void {
    const map: Record<string, string | null> = {};
    for (const [id, value] of this.overrides) map[id] = value;
    try {
      localStorage.setItem(OVERRIDES_KEY, JSON.stringify(map));
    } catch {
      // storage unavailable — overrides stay session-local
    }
  }
}

/** Resolve a command's display name (R8: names may be locale-aware thunks). */
export function getCommandName(cmd: Command): string {
  return typeof cmd.name === "function" ? cmd.name() : cmd.name;
}

/**
 * Canonical hotkey spelling: modifiers ordered Mod, Ctrl, Meta, Alt, Shift, key
 * cased like KeyboardEvent.key for named keys and uppercased for single
 * characters: "shift+mod+p" → "Mod+Shift+P", "ctrl+arrowright" → "Ctrl+ArrowRight".
 * `Mod` (platform primary) is preserved DISTINCT from physical `Ctrl` (R32) — so
 * "Mod+P" and "Ctrl+P" are different canonical strings (on macOS they resolve to
 * Cmd vs physical Control, two different physical keys).
 */
export function normalizeHotkey(hotkey: string): string {
  const parts = hotkey.split("+").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return "";
  const rawKey = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()));
  const out: string[] = [];
  if (mods.has("mod")) out.push("Mod");
  if (mods.has("ctrl") || mods.has("control")) out.push("Ctrl");
  if (mods.has("meta")) out.push("Meta");
  if (mods.has("alt") || mods.has("option")) out.push("Alt");
  if (mods.has("shift")) out.push("Shift");
  out.push(normalizeKeyName(rawKey));
  return out.join("+");
}

const NAMED_KEYS: Record<string, string> = {
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  pageup: "PageUp",
  pagedown: "PageDown",
  home: "Home",
  end: "End",
  enter: "Enter",
  tab: "Tab",
  escape: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  // a literal " " key would not survive split("+")+trim — use the name "Space"
  space: "Space",
  " ": "Space",
};

function normalizeKeyName(key: string): string {
  const lower = key.toLowerCase();
  if (NAMED_KEYS[lower]) return NAMED_KEYS[lower];
  if (/^f\d{1,2}$/.test(lower)) return lower.toUpperCase(); // F1..F12
  if (key.length === 1) return key.toUpperCase();
  // unknown named key — keep caller's casing
  return key;
}

/**
 * Punctuation hotkeys must also match by physical key (KeyboardEvent.code):
 * with Shift held, e.key becomes the shifted character ("\" -> "|"), so
 * "Ctrl+Shift+\" would otherwise never fire.
 */
const PUNCT_CODES: Record<string, string> = {
  "\\": "Backslash",
  "/": "Slash",
  ",": "Comma",
  ".": "Period",
  ";": "Semicolon",
  "'": "Quote",
  "[": "BracketLeft",
  "]": "BracketRight",
  "`": "Backquote",
  "-": "Minus",
  "=": "Equal",
};

export interface ParsedHotkey {
  /** platform primary modifier (Cmd on macOS, Ctrl elsewhere) */
  wantMod: boolean;
  /** physical Control (any platform) */
  wantCtrl: boolean;
  /** ⌘/Win key (any platform) */
  wantMeta: boolean;
  wantShift: boolean;
  wantAlt: boolean;
  /** lowercased key name */
  key: string;
  isFunctionKey: boolean;
}

/** Structural subset of KeyboardEvent that hotkey matching reads — lets the R32
 *  `__geodeHotkey` probe pass a plain object. A real KeyboardEvent satisfies it. */
export interface KeyEventLike {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  key: string;
  code?: string;
}

/** Parse a canonical hotkey string into its modifier requirements (platform-agnostic). */
export function parseHotkey(hotkey: string): ParsedHotkey {
  const parts = hotkey.split("+").map((p) => p.trim().toLowerCase());
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  return {
    wantMod: mods.has("mod"),
    wantCtrl: mods.has("ctrl") || mods.has("control"),
    wantMeta: mods.has("meta"),
    wantShift: mods.has("shift"),
    wantAlt: mods.has("alt") || mods.has("option"),
    key,
    isFunctionKey: /^f\d{1,2}$/.test(key),
  };
}

/**
 * Four-state exact modifier compare (R32). `Mod` resolves per platform:
 *  - mac:    Mod → metaKey      (Ctrl stays physical ctrlKey)
 *  - others: Mod → ctrlKey      (Meta stays physical metaKey)
 * Requiring exact equality means e.g. mac `Ctrl+P` does NOT fire a `Mod+P`
 * binding (needCtrl=false but e.ctrlKey=true) — mirrors Obsidian.
 */
export function matchParsedHotkey(p: ParsedHotkey, e: KeyEventLike, isMac: boolean): boolean {
  const needMeta = (isMac && p.wantMod) || p.wantMeta;
  const needCtrl = (!isMac && p.wantMod) || p.wantCtrl;
  if (e.metaKey !== needMeta || e.ctrlKey !== needCtrl) return false;
  if (e.shiftKey !== p.wantShift || e.altKey !== p.wantAlt) return false;
  if (e.key.toLowerCase() === p.key) return true;
  if (p.key === "space" && e.key === " ") return true;
  return PUNCT_CODES[p.key] !== undefined && e.code === PUNCT_CODES[p.key];
}

export function matchHotkey(hotkey: string, e: KeyboardEvent): boolean {
  return matchParsedHotkey(parseHotkey(hotkey), e, isMacPlatform);
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

const MODIFIER_KEY_NAMES = new Set(["Control", "Shift", "Alt", "Meta"]);

/** physical-code -> base character, the reverse of PUNCT_CODES: a captured
 * Shift+punct event reports the shifted char in e.key ("\" -> "|"), which
 * would never equal the default bindings' spelling. */
const CODE_TO_BASE: Record<string, string> = Object.fromEntries(
  Object.entries(PUNCT_CODES).map(([ch, code]) => [code, ch]),
);

/**
 * Build a candidate hotkey from a captured KeyboardEvent (settings capture
 * mode), or null when the event must NOT become a binding:
 *  - modifier-only chords never bind
 *  - bare printable keys (no Ctrl/Alt/Meta) would swallow normal typing — only
 *    function keys may bind without a non-typing modifier
 * The platform primary modifier records as portable `Mod` (mac: metaKey → Mod;
 * elsewhere: ctrlKey → Mod) so a binding captured on one OS resolves correctly
 * on another. A *separate* physical Ctrl on mac (ctrl held without Cmd) records
 * as `Ctrl`; the Win/Super key on non-mac records as `Meta`. (R32)
 * Shifted punctuation is normalized back to the physical base character via
 * e.code so the candidate matches default bindings (PUNCT_CODES grammar) and
 * conflict detection compares like with like.
 */
export function hotkeyFromEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_KEY_NAMES.has(e.key)) return null;
  let key = e.key === " " ? "Space" : e.key;
  const base = CODE_TO_BASE[e.code];
  if (base !== undefined) key = base;
  if (key === "+") return null; // not representable in the "+"-separated grammar
  if (!e.ctrlKey && !e.altKey && !e.metaKey && !/^f\d{1,2}$/i.test(key)) return null;
  const parts: string[] = [];
  if (isMacPlatform) {
    if (e.metaKey) parts.push("Mod"); // ⌘ = platform primary
    if (e.ctrlKey) parts.push("Ctrl"); // physical Control, distinct from ⌘
  } else {
    if (e.ctrlKey) parts.push("Mod"); // Ctrl = platform primary
    if (e.metaKey) parts.push("Meta"); // Win/Super key (rare)
  }
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return normalizeHotkey(parts.join("+"));
}

/**
 * Format a canonical hotkey for display (R32). Non-mac: `Mod` → `Ctrl`, keep the
 * "+"-separated spelling ("Mod+Shift+E" → "Ctrl+Shift+E"). Mac: Apple-HIG glyphs
 * in order ⌃⌥⇧⌘ then the key, no separator ("Mod+P" → "⌘P", "Mod+Alt+ArrowRight"
 * → "⌥⌘→"). Display only — never written to storage.
 */
export function formatHotkey(hotkey: string, isMac: boolean = isMacPlatform): string {
  const canonical = normalizeHotkey(hotkey);
  if (!canonical) return "";
  const parts = canonical.split("+");
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (!isMac) {
    return [...mods.map((m) => (m === "Mod" ? "Ctrl" : m)), key].join("+");
  }
  const ordered = MAC_MOD_ORDER.filter((m) => mods.includes(m)).map((m) => MAC_MOD_GLYPH[m]);
  return ordered.join("") + (MAC_KEY_GLYPH[key] ?? key);
}

/** Apple-HIG modifier order: Control, Option, Shift, Command. */
const MAC_MOD_ORDER = ["Ctrl", "Alt", "Shift", "Mod", "Meta"] as const;
const MAC_MOD_GLYPH: Record<string, string> = {
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Mod: "⌘",
  Meta: "⌘",
};
const MAC_KEY_GLYPH: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "↵",
  Backspace: "⌫",
  Delete: "⌦",
  Space: "␣",
  Escape: "⎋",
  Tab: "⇥",
  PageUp: "⇞",
  PageDown: "⇟",
  Home: "↖",
  End: "↘",
};
