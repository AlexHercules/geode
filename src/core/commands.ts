import type { Command } from "./types";
import { Store } from "./store";

/**
 * CommandRegistry — every user-facing action registers here so the command
 * palette, hotkeys, and plugins all share one source of truth.
 */
export class CommandRegistry {
  /** bumped when commands are (un)registered */
  readonly revision = new Store(0);
  private commands = new Map<string, Command>();

  register(command: Command): () => void {
    this.commands.set(command.id, command);
    this.revision.update((n) => n + 1);
    return () => {
      this.commands.delete(command.id);
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
    return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Match a KeyboardEvent against registered hotkeys.
   * Hotkey format: "Ctrl+Shift+P", "Ctrl+,", "F2" (Mod === Ctrl on Windows).
   */
  handleKeydown(e: KeyboardEvent): boolean {
    for (const cmd of this.commands.values()) {
      if (!cmd.hotkey) continue;
      if (matchHotkey(cmd.hotkey, e)) {
        if (cmd.available?.() === false) continue; // context-gated (e.g. needs an editor)
        e.preventDefault();
        e.stopPropagation();
        cmd.callback();
        return true;
      }
    }
    return false;
  }
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

export function matchHotkey(hotkey: string, e: KeyboardEvent): boolean {
  const parts = hotkey.split("+").map((p) => p.trim().toLowerCase());
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  const wantCtrl = mods.has("ctrl") || mods.has("mod");
  const wantShift = mods.has("shift");
  const wantAlt = mods.has("alt");
  if (e.ctrlKey !== wantCtrl || e.shiftKey !== wantShift || e.altKey !== wantAlt) return false;
  if (e.key.toLowerCase() === key) return true;
  return PUNCT_CODES[key] !== undefined && e.code === PUNCT_CODES[key];
}
