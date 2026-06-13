/**
 * Named workspace layouts (R45) — Obsidian-compatible
 * `.obsidian/workspaces.json` store.
 *
 * Persists to `<vault>/.obsidian/workspaces.json` — the SAME file Obsidian's
 * core Workspaces plugin reads/writes. Layouts are stored opaquely (`name` →
 * arbitrary JSON) so a Geode-captured layout round-trips, and any Obsidian
 * `workspaces` entry (or sibling top-level keys like `active`) is preserved
 * untouched. Data-safety mirrors `core/bookmarks.ts` to the letter: a single
 * serialized read-modify-write queue, a `vault.isOpen` guard, an adapter-
 * identity race guard around the vault switch, preserve unknown keys, and
 * abort on malformed JSON rather than overwrite Obsidian's data.
 *
 * Contract frozen in docs/ARCHITECTURE.md "Round 45 additions".
 */
import { Store } from "./store";
import type { Vault } from "./vault";

// `readConfig`/`writeConfig` already resolve relative to `<vault>/.obsidian/`
// (see VaultAdapter contract + bookmarks.ts using "bookmarks.json"). The path
// here must therefore be bare — a literal ".obsidian/workspaces.json" would
// target the wrong file `<vault>/.obsidian/.obsidian/workspaces.json`.
export const WORKSPACES_CONFIG = "workspaces.json";

/** name → opaque layout. Preserves Obsidian's original entries verbatim. */
export const workspacesStore = new Store<Record<string, unknown>>({});

let wsVault: Vault | null = null;

/** Every mutation (init + each persist RMW) is serialized on one module
 *  promise chain (bookmarks.ts precedent) so writes never interleave and a
 *  re-init can never race a running write. */
let wsChain: Promise<void> = Promise.resolve();

function enqueue<T>(task: () => Promise<T> | T): Promise<T> {
  // wrap so any failure (malformed-file refusal / writeConfig reject) leaves a
  // diagnostic — else `void save/deleteWorkspaceLayout(...)` callers swallow it
  // and the store silently diverges from disk (R45 review; bookmarks parity).
  const guarded = async (): Promise<T> => {
    try {
      return await task();
    } catch (err) {
      console.warn(`[workspaces] ${WORKSPACES_CONFIG} operation failed`, err);
      throw err;
    }
  };
  const run = wsChain.then(guarded, guarded);
  wsChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run as Promise<T>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Load `.obsidian/workspaces.json` into the in-memory store. A missing file is
 *  normal (no saved layouts yet); malformed JSON or a non-object shape resets to
 *  empty in memory but never writes anything. */
export function initWorkspaces(vault: Vault): Promise<void> {
  return enqueue(async () => {
    wsVault = vault;
    if (!vault.isOpen) {
      workspacesStore.set({});
      return;
    }
    let raw: string | null = null;
    try {
      raw = await vault.adapter.readConfig(WORKSPACES_CONFIG);
    } catch (err) {
      console.warn(`[workspaces] failed to read ${WORKSPACES_CONFIG}`, err);
      workspacesStore.set({});
      return;
    }
    if (raw === null) {
      workspacesStore.set({});
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn(`[workspaces] ${WORKSPACES_CONFIG} is not valid JSON`, err);
      workspacesStore.set({});
      return;
    }
    const ws =
      isPlainObject(parsed) && isPlainObject(parsed.workspaces)
        ? parsed.workspaces
        : {};
    workspacesStore.set({ ...ws });
  });
}

/** Saved layout names, sorted by locale. */
export function listWorkspaceNames(): string[] {
  return Object.keys(workspacesStore.get()).sort((a, b) => a.localeCompare(b));
}

/** The opaque layout stored under `name`, or null if absent. */
export function getWorkspaceLayout(name: string): unknown | null {
  return workspacesStore.get()[name] ?? null;
}

/** Save (create or overwrite) the layout for `name`, then persist. */
export function saveWorkspaceLayout(
  vault: Vault,
  name: string,
  layout: unknown,
): Promise<void> {
  workspacesStore.set({ ...workspacesStore.get(), [name]: layout });
  return persist(vault);
}

/** Remove the layout for `name` (no-op if absent), then persist. */
export function deleteWorkspaceLayout(vault: Vault, name: string): Promise<void> {
  const next = { ...workspacesStore.get() };
  delete next[name];
  workspacesStore.set(next);
  return persist(vault);
}

/** Enqueue a write of the current in-memory layouts into workspaces.json,
 *  preserving unknown top-level keys via a fresh read-modify-write. A malformed
 *  existing file aborts the write (never erase Obsidian's data). */
function persist(vault: Vault): Promise<void> {
  return enqueue(async () => {
    if (!vault.isOpen) {
      console.warn(`[workspaces] vault closed — ${WORKSPACES_CONFIG} write skipped`);
      return;
    }
    // vault-switch race guard: openVaultFlow re-points vault.adapter in place;
    // if that happens between read and write, this vault's layouts would be
    // written into the new vault's file. Capture identity, verify before write.
    const adapterBefore = vault.adapter;

    let root: Record<string, unknown> = {};
    const raw = await vault.adapter.readConfig(WORKSPACES_CONFIG);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw); // throws → chain catches + warns
      if (!isPlainObject(parsed)) {
        throw new Error(
          `${WORKSPACES_CONFIG} is not a JSON object — refusing to overwrite`,
        );
      }
      // an existing file with a non-object `workspaces` is malformed: abort
      // rather than blow away whatever structure Obsidian put there.
      if ("workspaces" in parsed && !isPlainObject(parsed.workspaces)) {
        throw new Error(
          `${WORKSPACES_CONFIG} "workspaces" is not an object — refusing to overwrite`,
        );
      }
      root = { ...parsed };
    }

    // an empty in-memory store + a non-empty on-disk `workspaces` almost always
    // means a transient init read failed (not the user emptying everything) —
    // refuse to wipe the saved/Obsidian layouts (R45 review).
    const store = workspacesStore.get();
    if (
      Object.keys(store).length === 0 &&
      isPlainObject(root.workspaces) &&
      Object.keys(root.workspaces).length > 0
    ) {
      console.warn(
        `[workspaces] in-memory store empty but ${WORKSPACES_CONFIG} has entries — skipping write to avoid erasing saved layouts`,
      );
      return;
    }

    root.workspaces = store;

    if (vault.adapter !== adapterBefore || !vault.isOpen) {
      console.warn(`[workspaces] vault switched mid-write — ${WORKSPACES_CONFIG} skipped`);
      return; // a queued re-init rebuilds in-memory layouts from the new vault
    }
    await vault.adapter.writeConfig(WORKSPACES_CONFIG, JSON.stringify(root, null, 2));
  });
}
