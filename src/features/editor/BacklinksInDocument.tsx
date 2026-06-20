import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useApp } from "@app/AppContext";
import { useI18n } from "@core/i18n";
import { useStore } from "@core/store";
import { deriveMentionTerms, findUnlinkedMentions } from "@core/unlinkedMentions";
import { basename, stripExtension } from "@core/vault";

/** One source note's unlinked mentions of the active note (R157). */
interface UnlinkedGroup {
  sourcePath: string;
  snippets: string[];
}

/** The trimmed line of `content` that contains offset `from` — a lightweight snippet that
 *  mirrors the line-level context R154 shows for linked mentions (BacklinksPanel's richer
 *  buildSnippet is feature-local and can't cross the layering boundary). */
function lineSnippet(content: string, from: number): string {
  const start = content.lastIndexOf("\n", from - 1) + 1;
  let end = content.indexOf("\n", from);
  if (end === -1) end = content.length;
  return content.slice(start, end).trim();
}

/** R154 (㊷): Obsidian's "Backlink in document" — the note's linked mentions rendered at the
 *  bottom of the reading view. R157 adds the "Unlinked mentions" section below (plain-text
 *  occurrences of the note's title/aliases that aren't links), an eager async vault scan
 *  mirroring BacklinksPanel (reusing core `deriveMentionTerms`/`findUnlinkedMentions`, NOT
 *  importing features/backlinks). Read-only: getBacklinks + vault.read + click → openFile.
 *  EditorPane renders this AFTER `.preview-content`, so it never touches the markdown render
 *  pipeline (§C byte invariant untouched). Gated by `showBacklinksInDocument` + reading mode. */
export function BacklinksInDocument({ path }: { path: string }) {
  const app = useApp();
  const t = useI18n();
  // re-render + recompute when the metadata index changes (a backlink added/removed elsewhere)
  const rev = useStore(app.metadata.revision);
  const linked = useMemo(
    () => app.metadata.getBacklinks(path),
    [app.metadata, path, rev],
  );

  // unlinked mentions: an async scan of every other note's text for this note's title/aliases
  const [unlinked, setUnlinked] = useState<UnlinkedGroup[]>([]);
  useEffect(() => {
    let cancelled = false;
    const meta = app.metadata.getMetadata(path);
    const terms = meta ? deriveMentionTerms(meta) : [];
    if (terms.length === 0) {
      setUnlinked([]);
      return;
    }
    void (async () => {
      const sources = app.metadata
        .getAll()
        .filter((m) => m.path !== path)
        .sort((a, b) => a.path.localeCompare(b.path));
      const groups: UnlinkedGroup[] = [];
      for (const sourceMeta of sources) {
        let content: string;
        try {
          content = await app.vault.read(sourceMeta.path);
        } catch {
          continue;
        }
        if (cancelled) return;
        const spans = findUnlinkedMentions(content, sourceMeta, terms);
        if (spans.length === 0) continue;
        groups.push({ sourcePath: sourceMeta.path, snippets: spans.map((s) => lineSnippet(content, s.from)) });
      }
      if (!cancelled) setUnlinked(groups);
    })();
    return () => {
      cancelled = true;
    };
  }, [app, path, rev]);

  if (linked.length === 0 && unlinked.length === 0) return null;

  // both sections render the same shape: a source title + its snippet lines, click → openFile.
  const linkedGroups: UnlinkedGroup[] = linked.map((g) => ({
    sourcePath: g.sourcePath,
    snippets: g.contexts.map((c) => c.snippet).filter((s) => s !== ""),
  }));
  const linkedTotal = linked.reduce((n, g) => n + g.contexts.length, 0);
  const unlinkedTotal = unlinked.reduce((n, g) => n + g.snippets.length, 0);
  const navProps = (target: string) => ({
    role: "button" as const,
    tabIndex: 0,
    onClick: () => app.workspace.openFile(target),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        app.workspace.openFile(target);
      }
    },
  });
  const renderGroups = (groups: UnlinkedGroup[], testidPrefix: string) =>
    groups.map((g) => (
      <div className="ebl-source" key={g.sourcePath} data-testid={testidPrefix + g.sourcePath}>
        <div className="ebl-source-title" {...navProps(g.sourcePath)}>
          {stripExtension(basename(g.sourcePath))}
        </div>
        {g.snippets.map((s, i) => (
          <div className="ebl-snippet" key={i} {...navProps(g.sourcePath)}>
            {s}
          </div>
        ))}
      </div>
    ));

  return (
    <div className="embedded-backlinks" data-testid="embedded-backlinks">
      {linked.length > 0 && (
        <>
          <div className="embedded-backlinks-title">
            {t("backlinks.linkedMentions")}
            <span className="embedded-backlinks-count">{linkedTotal}</span>
          </div>
          <div className="embedded-backlinks-list">{renderGroups(linkedGroups, "ebl-source-")}</div>
        </>
      )}
      {unlinked.length > 0 && (
        <div className="embedded-unlinked" data-testid="embedded-unlinked">
          <div className="embedded-backlinks-title">
            {t("backlinks.unlinkedMentions")}
            <span className="embedded-backlinks-count">{unlinkedTotal}</span>
          </div>
          <div className="embedded-backlinks-list">{renderGroups(unlinked, "eul-source-")}</div>
        </div>
      )}
    </div>
  );
}
