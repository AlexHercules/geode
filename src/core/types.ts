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

/** Parsed metadata for a single markdown file. */
export interface NoteMetadata {
  path: string;
  links: LinkRef[];
  tags: TagRef[];
  headings: HeadingRef[];
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

/** Workspace */
export type ViewMode = "edit" | "preview";

export interface TabState {
  id: string;
  /** "markdown" tabs show a file; "graph" shows global graph */
  viewType: "markdown" | "graph";
  filePath: string | null;
  mode: ViewMode;
  title: string;
}

export type LeftPanelKind = "explorer" | "search";
export type ModalKind = "palette" | "switcher" | "settings" | null;
export type ThemeKind = "dark" | "light";

export interface WorkspaceState {
  tabs: TabState[];
  activeTabId: string | null;
  leftPanel: LeftPanelKind;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  modal: ModalKind;
  theme: ThemeKind;
  /** editor font size in px */
  fontSize: number;
}

export interface Command {
  id: string;
  name: string;
  /** e.g. "Ctrl+P" — display + matching key, Mod = Ctrl on Windows */
  hotkey?: string;
  callback: () => void;
}
