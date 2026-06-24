import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useStore } from "@core/store";
import { useI18n } from "@core/i18n";
import type { BacklinkEntry, LinkRef } from "@core/types";
import { findActiveTab } from "@core/workspace";
import { sortAndFilterLinks, type LinkSortKey } from "@core/linkPanel";
import { createNewNote } from "@core/newNote";
import {
  deriveMentionTerms,
  findUnlinkedMentions,
  linkAllMentionsInFile,
  linkOneMention,
  type MentionLinkDeps,
  type MentionLinkResult,
  type MentionSpan,
} from "@core/unlinkedMentions";
import "./backlinks.css";

type OutgoingEntry = { link: LinkRef; resolvedPath: string | null };

interface PanelData {
  backlinks: BacklinkEntry[];
  outgoing: OutgoingEntry[];
  tags: string[];
}

const EMPTY_DATA: PanelData = { backlinks: [], outgoing: [], tags: [] };

function fileTitle(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

/* ---------------- unlinked mentions scan types/helpers ---------------- */

/** One unlinked mention prepared for display: the raw span plus a trimmed,
 *  highlight-ready snippet built from the source content. */
interface UnlinkedItem {
  from: number;
  to: number;
  text: string;
  snippet: string;
  /** mark offsets into `snippet` */
  markFrom: number;
  markTo: number;
  /** R98: paragraph snippet + its mark offsets, shown when "more context" is on */
  paragraph: string;
  paraMarkFrom: number;
  paraMarkTo: number;
}

interface UnlinkedGroup {
  sourcePath: string;
  items: UnlinkedItem[];
}

const SNIPPET_RADIUS = 36;
const SNIPPET_MAX = 110;

/**
 * Build a trimmed one-line snippet from `content` anchored on [from,to),
 * mirroring SearchPanel.sliceLine. Returns the display text and the match
 * offsets remapped into that text.
 */
function buildSnippet(
  content: string,
  from: number,
  to: number,
): { text: string; markFrom: number; markTo: number } {
  const lineStart = content.lastIndexOf("\n", from - 1) + 1;
  let lineEnd = content.indexOf("\n", to);
  if (lineEnd === -1) lineEnd = content.length;
  const line = content.slice(lineStart, lineEnd);
  const leading = line.length - line.trimStart().length;
  const trimmedLeft = lineStart + leading;
  const trimmed = line.trim();
  let mf = Math.max(0, Math.min(from - trimmedLeft, trimmed.length));
  let mt = Math.max(0, Math.min(to - trimmedLeft, trimmed.length));
  if (trimmed.length <= SNIPPET_MAX) return { text: trimmed, markFrom: mf, markTo: mt };
  const start = Math.max(0, mf - SNIPPET_RADIUS);
  const end = Math.min(trimmed.length, mt + SNIPPET_RADIUS * 2);
  const prefix = start > 0 ? "…" : "";
  const text = prefix + trimmed.slice(start, end) + (end < trimmed.length ? "…" : "");
  return { text, markFrom: mf - start + prefix.length, markTo: mt - start + prefix.length };
}

const PARA_MAX = 500;
const PARA_RADIUS = 240;

/**
 * R98 (㊷ 续): "Show more context" — the PARAGRAPH (run of consecutive non-blank
 * lines, blank-line delimited) containing [from,to), trimmed, with the match offsets
 * remapped. Capped at PARA_MAX (truncated around the match) so a giant block stays
 * readable. `to` defaults to `from` (no highlight — linked mentions render plain).
 */
export function buildParagraph(
  content: string,
  from: number,
  to: number = from,
): { text: string; markFrom: number; markTo: number } {
  let start = content.lastIndexOf("\n", from - 1) + 1;
  while (start > 0) {
    const prevStart = content.lastIndexOf("\n", start - 2) + 1;
    if (content.slice(prevStart, start - 1).trim() === "") break;
    start = prevStart;
  }
  let end = content.indexOf("\n", to);
  if (end === -1) end = content.length;
  while (end < content.length) {
    let nextEnd = content.indexOf("\n", end + 1);
    if (nextEnd === -1) nextEnd = content.length;
    if (content.slice(end + 1, nextEnd).trim() === "") break;
    end = nextEnd;
  }
  const block = content.slice(start, end);
  const leading = block.length - block.trimStart().length;
  const trimmedLeft = start + leading;
  const trimmed = block.trim();
  const mf = Math.max(0, Math.min(from - trimmedLeft, trimmed.length));
  const mt = Math.max(0, Math.min(to - trimmedLeft, trimmed.length));
  if (trimmed.length <= PARA_MAX) return { text: trimmed, markFrom: mf, markTo: mt };
  const s = Math.max(0, mf - PARA_RADIUS);
  const e = Math.min(trimmed.length, mt + PARA_RADIUS);
  const prefix = s > 0 ? "…" : "";
  const text = prefix + trimmed.slice(s, e) + (e < trimmed.length ? "…" : "");
  return { text, markFrom: mf - s + prefix.length, markTo: mt - s + prefix.length };
}

/** Wrap [markFrom,markTo) of `text` in a single <mark>. */
function highlightMention(text: string, markFrom: number, markTo: number): ReactNode {
  if (markTo <= markFrom) return text;
  return (
    <>
      {text.slice(0, markFrom)}
      <mark>{text.slice(markFrom, markTo)}</mark>
      {text.slice(markTo)}
    </>
  );
}

/* ---------------- collapsible section ---------------- */

function Section({
  title,
  count,
  collapsed,
  onToggle,
  testid,
  children,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  testid: string;
  children: ReactNode;
}) {
  return (
    <section className="bl-section">
      <button
        className="bl-section-title"
        onClick={onToggle}
        aria-expanded={!collapsed}
        data-testid={testid}
      >
        <Icon
          name={collapsed ? "chevron-right" : "chevron-down"}
          size={14}
          className="bl-chevron"
        />
        <span className="bl-section-label">{title}</span>
        <span className="bl-count">{count}</span>
      </button>
      {!collapsed && <div className="bl-section-body">{children}</div>}
    </section>
  );
}

/* ---------------- panel ---------------- */

export function BacklinksPanel() {
  const app = useApp();
  const t = useI18n();
  const ws = useStore(app.workspace.state);
  const rev = useStore(app.metadata.revision);
  // R211: when the active tab is NOT markdown (the graph or main-area backlinks
  // tab), fall back to the last active markdown file so the panel keeps showing
  // its backlinks (Obsidian-faithful; required for the main-area backlinks view).
  const lastActive = useStore(app.workspace.lastActiveFile);

  const activeTab = findActiveTab(ws);
  const activePath = activeTab?.viewType === "markdown" ? activeTab.filePath : lastActive;

  // unlinked starts collapsed (Obsidian default); seeding it true means the
  // toggle's `!c[key]` flips it to false on the first click (an unseeded
  // `?? true` default would compute `!undefined === true` and no-op).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ unlinked: true });
  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  // R82 (㊷) linked-mentions toolbar: sort + filter + per-source collapse.
  const [blSort, setBlSort] = useState<LinkSortKey>("default");
  const [blFilter, setBlFilter] = useState("");
  const [collapsedSources, setCollapsedSources] = useState<Set<string>>(new Set());
  // Reset the toolbar when the active file changes — otherwise a stale filter
  // makes a different note's real backlinks look empty (Obsidian clears its
  // backlinks search box on file switch). Also drops the per-source collapse set.
  useEffect(() => {
    setBlSort("default");
    setBlFilter("");
    setCollapsedSources(new Set());
  }, [activePath]);
  const toggleSource = (path: string) =>
    setCollapsedSources((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // R98 (㊷ 续): "Show more context" — show the surrounding paragraph instead of the
  // matched line. A GLOBAL persistent preference (not reset per-file, unlike the R82
  // toolbar above), mirroring SearchPanel's localStorage-backed moreContext.
  const [moreContext, setMoreContext] = useState(() => {
    try {
      return localStorage.getItem("geode.backlinksContext") === "1";
    } catch {
      return false;
    }
  });
  const toggleMoreContext = () =>
    setMoreContext((v) => {
      const next = !v;
      try {
        localStorage.setItem("geode.backlinksContext", next ? "1" : "0");
      } catch {
        /* storage unavailable — session-only */
      }
      return next;
    });

  const data = useMemo<PanelData>(() => {
    void rev; // re-derive whenever the metadata index changes
    if (!activePath) return EMPTY_DATA;
    const backlinks = app.metadata.getBacklinks(activePath);
    // dedupe outgoing links by destination
    const seen = new Set<string>();
    const outgoing = app.metadata.getOutgoingLinks(activePath).filter(({ link, resolvedPath }) => {
      const key = resolvedPath ?? `unresolved:${link.target.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const tags = [...new Set((app.metadata.getMetadata(activePath)?.tags ?? []).map((t) => t.tag))];
    return { backlinks, outgoing, tags };
  }, [app, activePath, rev]);

  // linked-mention sources after sort + name filter (㊷); "default" preserves
  // getBacklinks' source-path order → zero regression on the default.
  const shownBacklinks = useMemo(
    () => sortAndFilterLinks(data.backlinks, (b) => fileTitle(b.sourcePath), blSort, blFilter),
    [data.backlinks, blSort, blFilter],
  );
  const shownMentionCount = useMemo(
    () => shownBacklinks.reduce((n, b) => n + b.contexts.length, 0),
    [shownBacklinks],
  );
  const allSourcesCollapsed =
    shownBacklinks.length > 0 && shownBacklinks.every((b) => collapsedSources.has(b.sourcePath));
  const toggleCollapseAll = () =>
    setCollapsedSources((prev) =>
      shownBacklinks.some((b) => !prev.has(b.sourcePath))
        ? new Set(shownBacklinks.map((b) => b.sourcePath))
        : new Set(),
    );

  /* ---------- unlinked mentions: async vault scan ---------- */

  const [unlinked, setUnlinked] = useState<UnlinkedGroup[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    void rev; // re-scan whenever the metadata index changes (e.g. after Link)
    if (!activePath) {
      setUnlinked([]);
      setScanning(false);
      return;
    }
    const activeMeta = app.metadata.getMetadata(activePath);
    const terms = activeMeta ? deriveMentionTerms(activeMeta) : [];
    if (terms.length === 0) {
      setUnlinked([]);
      setScanning(false);
      return;
    }
    let cancelled = false;
    setScanning(true);
    void (async () => {
      const sources = app.metadata
        .getAll()
        .filter((m) => m.path !== activePath)
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
        const items: UnlinkedItem[] = spans.map((s) => {
          const snip = buildSnippet(content, s.from, s.to);
          const para = buildParagraph(content, s.from, s.to); // R98: content already in hand
          return {
            from: s.from,
            to: s.to,
            text: s.text,
            snippet: snip.text,
            markFrom: snip.markFrom,
            markTo: snip.markTo,
            paragraph: para.text,
            paraMarkFrom: para.markFrom,
            paraMarkTo: para.markTo,
          };
        });
        groups.push({ sourcePath: sourceMeta.path, items });
      }
      if (cancelled) return;
      // stale guard: discard if the active file changed mid-scan. Must mirror the render
      // fallback (line ~193) — use lastActiveFile when the active tab is non-markdown, else
      // following lastActive on a graph/main-area-view tab makes livePath null !== activePath
      // and the scan never completes (stuck "Scanning…"). R213: align with the render path.
      const liveTab = findActiveTab(app.workspace.state.get());
      const livePath = liveTab?.viewType === "markdown" ? liveTab.filePath : app.workspace.lastActiveFile.get();
      if (livePath !== activePath) return;
      setUnlinked(groups);
      setScanning(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [app, activePath, rev]);

  /* ---------- linked-mention paragraphs (R98, only when "more context" is on) ---------- */
  // getBacklinks gives a one-line snippet + the link offset but NOT the source content,
  // so the paragraph is built panel-side by re-reading each source — but ONLY when the
  // toggle is on (off = the index line snippet, no read, zero regression).
  // Tagged with the activePath it was built for (review F1): on a file switch the
  // stale map is rejected by the render guard until the new read lands — a shared
  // source then falls back to its (correct) line snippet, never the old file's paragraph.
  const [linkedParas, setLinkedParas] = useState<{ path: string | null; map: Map<string, string[]> }>({
    path: null,
    map: new Map(),
  });
  useEffect(() => {
    if (!moreContext) {
      setLinkedParas({ path: null, map: new Map() });
      return;
    }
    let cancelled = false;
    void (async () => {
      const map = new Map<string, string[]>();
      // build for ALL backlinks (not the filtered set) so filter/sort keystrokes don't
      // re-read from disk (review F2); the render still gates display by filter
      for (const b of data.backlinks) {
        let content: string;
        try {
          content = await app.vault.read(b.sourcePath);
        } catch {
          continue;
        }
        if (cancelled) return;
        map.set(
          b.sourcePath,
          b.contexts.map((c) => buildParagraph(content, c.from).text),
        );
      }
      if (!cancelled) setLinkedParas({ path: activePath, map });
    })();
    return () => {
      cancelled = true;
    };
  }, [app.vault, moreContext, data.backlinks, activePath]);

  const unlinkedCount = useMemo(
    () => unlinked.reduce((n, g) => n + g.items.length, 0),
    [unlinked],
  );

  /* ---------- unlinked mentions: link write ops (busy-guarded) ---------- */

  const busyRef = useRef<Set<string>>(new Set());
  const [, bumpBusy] = useState(0);

  const runLink = useCallback(
    async (key: string, op: (deps: MentionLinkDeps) => Promise<MentionLinkResult>) => {
      if (busyRef.current.has(key)) return; // re-entrancy / double-write guard
      busyRef.current.add(key);
      bumpBusy((n) => n + 1);
      try {
        const result = await op({
          vault: app.vault,
          metadata: app.metadata,
          documents: app.documents,
        });
        if (result.skipped.length > 0) {
          console.warn("[backlinks] unlinked-mention link skipped", result.skipped);
        }
      } catch (err) {
        console.warn("[backlinks] unlinked-mention link failed", err);
      } finally {
        busyRef.current.delete(key);
        bumpBusy((n) => n + 1);
      }
      // metadata revision bump auto-triggers re-scan; no manual refresh needed
    },
    [app],
  );

  const createAndOpen = useCallback(
    (name: string) => {
      void createNewNote(app.vault, name, app.workspace.getActiveFile()).then(
        (path) => app.workspace.openFile(path),
        (err) => console.error("[backlinks] failed to create note", err),
      );
    },
    [app],
  );

  return (
    <div className="backlinks-panel" data-testid="backlinks-panel">
      <div className="panel-header">{t("backlinks.title")}</div>
      {!activePath ? (
        <div className="bl-empty" data-testid="bl-empty">
          {t("backlinks.empty")}
        </div>
      ) : (
        <div className="bl-scroll">
          <Section
            title={t("backlinks.linkedMentions")}
            count={shownMentionCount}
            collapsed={!!collapsed.mentions}
            onToggle={() => toggle("mentions")}
            testid="bl-section-mentions"
          >
            {data.backlinks.length === 0 ? (
              <div className="bl-empty-sub">{t("backlinks.noBacklinks")}</div>
            ) : (
              <>
                <div className="bl-toolbar" data-testid="bl-toolbar">
                  <select
                    className="bl-sort"
                    data-testid="bl-sort"
                    value={blSort}
                    aria-label={t("backlinks.sortBy")}
                    onChange={(e) => setBlSort(e.target.value as LinkSortKey)}
                  >
                    <option value="default">{t("backlinks.sortDefault")}</option>
                    <option value="name-asc">{t("backlinks.sortNameAsc")}</option>
                    <option value="name-desc">{t("backlinks.sortNameDesc")}</option>
                  </select>
                  <button
                    className={"bl-tool-btn" + (allSourcesCollapsed ? " is-active" : "")}
                    data-testid="bl-collapse-toggle"
                    onClick={toggleCollapseAll}
                    aria-label={t(allSourcesCollapsed ? "backlinks.expandAll" : "backlinks.collapseAll")}
                    title={t(allSourcesCollapsed ? "backlinks.expandAll" : "backlinks.collapseAll")}
                  >
                    <Icon name={allSourcesCollapsed ? "chevron-right" : "chevron-down"} size={14} />
                  </button>
                  <button
                    className={"bl-tool-btn" + (moreContext ? " is-active" : "")}
                    data-testid="bl-context-toggle"
                    onClick={toggleMoreContext}
                    aria-pressed={moreContext}
                    aria-label={t("backlinks.moreContext")}
                    title={t("backlinks.moreContext")}
                  >
                    <Icon name="list" size={14} />
                  </button>
                  <input
                    className="bl-filter"
                    data-testid="bl-filter"
                    value={blFilter}
                    placeholder={t("backlinks.filterPlaceholder")}
                    aria-label={t("backlinks.filterPlaceholder")}
                    onChange={(e) => setBlFilter(e.target.value)}
                  />
                </div>
                {shownBacklinks.length === 0 ? (
                  <div className="bl-empty-sub">{t("backlinks.noMatch")}</div>
                ) : (
                  shownBacklinks.map((b) => {
                    const srcCollapsed = collapsedSources.has(b.sourcePath);
                    return (
                      <div className="bl-source" key={b.sourcePath}>
                        <div className="bl-source-head">
                          <button
                            className="bl-source-toggle"
                            data-testid="bl-source-toggle"
                            aria-expanded={!srcCollapsed}
                            onClick={() => toggleSource(b.sourcePath)}
                          >
                            <Icon
                              name={srcCollapsed ? "chevron-right" : "chevron-down"}
                              size={13}
                              className="bl-chevron"
                            />
                          </button>
                          <button
                            className="bl-source-name"
                            title={b.sourcePath}
                            data-testid="bl-source"
                            data-hover-path={b.sourcePath}
                            onClick={() => app.workspace.openFile(b.sourcePath)}
                          >
                            <Icon name="file-text" size={13} />
                            <span className="bl-ellipsis">{fileTitle(b.sourcePath)}</span>
                            <span className="bl-count">{b.contexts.length}</span>
                          </button>
                        </div>
                        {!srcCollapsed && (
                          <div className="bl-contexts">
                            {b.contexts.map((c, i) => (
                              <button
                                key={`${c.from}-${i}`}
                                className={"bl-snippet" + (moreContext ? " is-paragraph" : "")}
                                data-testid="bl-snippet"
                                onClick={() => app.workspace.openFile(b.sourcePath)}
                              >
                                {/* R98: paragraph when more-context is on AND the map is
                                    for the current file (F1 stale-guard), else the line snippet */}
                                {(moreContext &&
                                  linkedParas.path === activePath &&
                                  linkedParas.map.get(b.sourcePath)?.[i]) ||
                                  c.snippet}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </>
            )}
          </Section>

          <Section
            title={t("backlinks.unlinkedMentions")}
            count={unlinkedCount}
            collapsed={!!collapsed.unlinked}
            onToggle={() => toggle("unlinked")}
            testid="bl-section-unlinked"
          >
            {scanning && unlinked.length === 0 ? (
              <div className="bl-empty-sub">{t("backlinks.scanning")}</div>
            ) : unlinked.length === 0 ? (
              <div className="bl-empty-sub">{t("backlinks.noUnlinked")}</div>
            ) : (
              unlinked.map((g) => {
                const allKey = `all:${g.sourcePath}`;
                const allBusy = busyRef.current.has(allKey);
                return (
                  <div className="bl-source bl-unlinked-group" key={g.sourcePath}>
                    <div className="bl-unlinked-head">
                      <button
                        className="bl-source-name"
                        title={g.sourcePath}
                        data-testid="bl-source"
                        data-hover-path={g.sourcePath}
                        onClick={() => app.workspace.openFile(g.sourcePath)}
                      >
                        <Icon name="file-text" size={13} />
                        <span className="bl-ellipsis">{fileTitle(g.sourcePath)}</span>
                        <span className="bl-count">{g.items.length}</span>
                      </button>
                      <button
                        className="bl-link-btn bl-link-all"
                        data-testid="bl-link-all"
                        disabled={allBusy}
                        onClick={() =>
                          void runLink(allKey, (deps) =>
                            linkAllMentionsInFile(deps, activePath, g.sourcePath),
                          )
                        }
                      >
                        {t("backlinks.linkAll")}
                      </button>
                    </div>
                    <div className="bl-contexts">
                      {g.items.map((it, i) => {
                        const oneKey = `one:${g.sourcePath}:${it.from}`;
                        const oneBusy = busyRef.current.has(oneKey);
                        const target: MentionSpan = { from: it.from, to: it.to, text: it.text };
                        return (
                          <div className="bl-mention-row" key={`${it.from}-${i}`}>
                            <button
                              className={"bl-snippet" + (moreContext ? " is-paragraph" : "")}
                              data-testid="bl-snippet"
                              title={g.sourcePath}
                              onClick={() => app.workspace.openFile(g.sourcePath)}
                            >
                              {moreContext
                                ? highlightMention(it.paragraph, it.paraMarkFrom, it.paraMarkTo)
                                : highlightMention(it.snippet, it.markFrom, it.markTo)}
                            </button>
                            <button
                              className="bl-link-btn bl-link-one"
                              data-testid="bl-link-one"
                              disabled={oneBusy || allBusy}
                              onClick={() =>
                                void runLink(oneKey, (deps) =>
                                  linkOneMention(deps, activePath, g.sourcePath, target),
                                )
                              }
                            >
                              {t("backlinks.linkMention")}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </Section>

          <Section
            title={t("backlinks.outgoingLinks")}
            count={data.outgoing.length}
            collapsed={!!collapsed.outgoing}
            onToggle={() => toggle("outgoing")}
            testid="bl-section-outgoing"
          >
            {data.outgoing.length === 0 ? (
              <div className="bl-empty-sub">{t("backlinks.noOutgoing")}</div>
            ) : (
              <div className="bl-out-list">
                {data.outgoing.map(({ link, resolvedPath }) => (
                  <button
                    key={resolvedPath ?? `unresolved:${link.target.toLowerCase()}`}
                    className={"bl-out" + (resolvedPath ? "" : " is-unresolved")}
                    title={resolvedPath ?? t("backlinks.createTitle", { name: link.target })}
                    data-testid="bl-outgoing"
                    data-hover-path={resolvedPath ?? undefined}
                    onClick={() =>
                      resolvedPath
                        ? app.workspace.openFile(resolvedPath)
                        : createAndOpen(link.target)
                    }
                  >
                    <Icon name="link" size={13} />
                    <span className="bl-ellipsis">{link.target}</span>
                    {!resolvedPath && <span className="bl-new">{t("backlinks.newBadge")}</span>}
                  </button>
                ))}
              </div>
            )}
          </Section>

          <Section
            title={t("backlinks.tags")}
            count={data.tags.length}
            collapsed={!!collapsed.tags}
            onToggle={() => toggle("tags")}
            testid="bl-section-tags"
          >
            {data.tags.length === 0 ? (
              <div className="bl-empty-sub">{t("backlinks.noTags")}</div>
            ) : (
              <div className="bl-tags">
                {data.tags.map((t) => (
                  <span key={t} className="bl-tag" data-testid="bl-tag">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
