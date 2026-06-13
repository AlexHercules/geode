/**
 * Geode core types — the shared contract between all feature modules.
 * Paths are always vault-relative with forward slashes, e.g. "Notes/Welcome.md".
 */

export interface FileNode {
  kind: "file";
  /** vault-relative path, forward slashes */
  path: string;
  /** file name with extension */
  name: string;
  /** name without extension */
  basename: string;
  extension: string;
}

export interface FolderNode {
  kind: "folder";
  /** vault-relative path; "" for vault root */
  path: string;
  name: string;
  children: Array<FileNode | FolderNode>;
}

export type VaultNode = FileNode | FolderNode;

/** A wikilink or markdown link found inside a note. */
export interface LinkRef {
  /** raw link target as written, e.g. "Welcome" or "Notes/Welcome" */
  target: string;
  /** display alias if given via [[target|alias]] */
  alias?: string;
  /** character offset of the link in the file */
  from: number;
  to: number;
  /** surrounding-line snippet captured at parse time (for backlink context) */
  context?: string;
}

export interface HeadingRef {
  level: number;
  text: string;
  /** character offset */
  from: number;
}

export interface TagRef {
  /** without '#' */
  tag: string;
  from: number;
}

/** A `^block-id` reference target found inside a note (R13). */
export interface BlockRef {
  /** block id WITHOUT the '^' */
  id: string;
  /** span of the whole block (paragraph approximation) INCLUDING the marker */
  from: number;
  to: number;
}

/** Parsed metadata for a single markdown file. */
export interface NoteMetadata {
  path: string;
  links: LinkRef[];
  tags: TagRef[];
  headings: HeadingRef[];
  /** `^block-id` targets, document order; duplicate ids keep the LAST one */
  blocks: BlockRef[];
  /** YAML frontmatter, if the file starts with a --- block */
  frontmatter?: FrontmatterData;
  /** alternative names from frontmatter `aliases:` — participate in link resolution */
  aliases: string[];
  /** plain-text-ish content used for search previews */
  contentLength: number;
}

export interface BacklinkEntry {
  /** the file that links TO the queried file */
  sourcePath: string;
  /** snippet of surrounding text for each occurrence */
  contexts: Array<{ snippet: string; from: number }>;
}

export interface GraphNode {
  id: string; // path for resolved files, "unresolved:<name>" otherwise
  label: string;
  /** resolved = an existing file; unresolved = linked but missing */
  resolved: boolean;
  /** number of connections, useful for sizing */
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SearchResultItem {
  path: string;
  basename: string;
  matches: Array<{ line: number; text: string; from: number; to: number }>;
  score: number;
}

/** Frontmatter properties parsed from a leading YAML block. */
export interface FrontmatterData {
  /** raw key -> scalar/list (string values only; minimal YAML subset) */
  fields: Record<string, string | string[]>;
  /** character span of the whole block including both --- fences */
  from: number;
  to: number;
}

/** Workspace */
/**
 * "live"    — Obsidian-style live preview (default editing mode)
 * "source"  — plain markdown source editing
 * "preview" — rendered reading view
 */
export type ViewMode = "live" | "source" | "preview";

export interface TabState {
  id: string;
  /** "markdown" tabs show a file; "graph" shows global graph */
  viewType: "markdown" | "graph";
  filePath: string | null;
  mode: ViewMode;
  title: string;
  /** R39: a pinned tab is not replaced by openFile — links/navigation open a new
   *  tab instead. Persisted; absent = not pinned. */
  pinned?: boolean;
}

/** Built-in panel ids plus dynamic sidebar-panel ids (plugin contributions, R5).
 *  `(string & {})` keeps the literal autocomplete while accepting any string. */
export type LeftPanelKind = "explorer" | "search" | "bookmarks" | (string & {});
export type RightPanelKind = "backlinks" | "outline" | "allproperties" | (string & {});
export type ModalKind = "palette" | "switcher" | "settings" | "templates" | null;
export type ThemeKind = "dark" | "light";

/** Pane tree (split panes). "row" = children side by side, "column" = stacked. */
export type SplitDirection = "row" | "column";

export interface PaneLeaf {
  kind: "leaf";
  id: string;
  tabs: TabState[];
  activeTabId: string | null;
}

export interface PaneSplit {
  kind: "split";
  id: string;
  direction: SplitDirection;
  /** always >= 2 children once normalized */
  children: PaneNode[];
  /** flex fractions, same length as children, each in (0,1), summing to ~1 */
  sizes: number[];
}

export type PaneNode = PaneLeaf | PaneSplit;

export interface WorkspaceState {
  /** pane tree; always contains at least one leaf */
  root: PaneNode;
  /** id of the focused PaneLeaf — tab-level ops target this pane */
  activePaneId: string;
  leftPanel: LeftPanelKind;
  rightPanel: RightPanelKind;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  /** sidebar widths in px (user-resizable) */
  leftWidth: number;
  rightWidth: number;
  modal: ModalKind;
  theme: ThemeKind;
  /** editor font size in px */
  fontSize: number;
}

export interface Command {
  id: string;
  /** Display name. A thunk (R8) resolves through the i18n layer at render time —
   *  use `getCommandName(cmd)` from core/commands to read it. Plain strings stay
   *  valid (compat plugins register strings). */
  name: string | (() => string);
  /** e.g. "Ctrl+P" — display + matching key, Mod = Ctrl on Windows */
  hotkey?: string;
  callback: () => void;
  /**
   * Context check: when it returns false the palette hides the command and
   * hotkeys skip it (compat editorCallback variants). Must be side-effect free.
   */
  available?: () => boolean;
}
