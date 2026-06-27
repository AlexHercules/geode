/**
 * The `require("obsidian")` module surface — the loader hands this namespace
 * object to plugin bundles. Implemented strictly against
 * .calibration/API-REFERENCE.md (T0 + T1 + T1.5 per docs/OBSIDIAN-COMPAT.md);
 * out-of-tier APIs are warn-stubs recorded in the loader's gap report.
 */
import "./compat.css";
import { installDomAugmentation } from "./dom";

// prototypes must exist before any plugin code touches the DOM
installDomAugmentation();

export { Events, type EventRef } from "./events";
export { Component, MarkdownRenderChild } from "./component";
export { TAbstractFile, TFile, TFolder, type FileStats } from "./files";
export { Vault, CompatDataAdapter, type DataAdapter, type DataWriteOptions } from "./vault";
export {
  MetadataCache,
  type BlockCache,
  type CachedMetadata,
  type CacheItem,
  type EmbedCache,
  type FootnoteCache,
  type FootnoteRefCache,
  type FrontMatterCache,
  type FrontmatterLinkCache,
  type HeadingCache,
  type LinkCache,
  type ListItemCache,
  type Loc,
  type Pos,
  type Reference,
  type ReferenceCache,
  type SectionCache,
  type TagCache,
} from "./metadata";
export {
  MarkdownView,
  Workspace,
  WorkspaceLeaf,
  type MarkdownFileInfo,
  type PaneType,
  type SplitDirection,
} from "./workspace";
export { HoverPopover, PopoverState, type HoverParent, type Point } from "./hover";
export { FileView, ItemView, View, type ViewStateResult } from "./view";
// R260: CM6 editor StateFields (plugins read them from their own CM6 extensions)
export { editorEditorField, editorInfoField, editorLivePreviewField, editorViewField } from "./editorFields";
// R261: general-purpose YAML (js-yaml-backed) — Dataview/Templater/Tasks read inline fields with it
export { parseYaml, stringifyYaml } from "./yaml";
export {
  AbstractInputSuggest,
  EditorSuggest,
  PopoverSuggest,
  type EditorSuggestContext,
  type EditorSuggestTriggerInfo,
} from "./suggest";
export {
  Editor,
  type EditorChange,
  type EditorCommandName,
  type EditorPosition,
  type EditorRange,
  type EditorRangeOrCaret,
  type EditorSelection,
  type EditorSelectionOrCaret,
  type EditorTransaction,
} from "./editor";
export {
  App,
  MarkdownPreviewRenderer,
  Plugin,
  PluginSettingTab,
  SettingTab,
  type Command,
  type Hotkey,
  type Modifier,
  type PluginManifest,
} from "./plugin";
export {
  AbstractTextComponent,
  BaseComponent,
  ButtonComponent,
  ColorComponent,
  DropdownComponent,
  ExtraButtonComponent,
  FuzzySuggestModal,
  Keymap,
  Menu,
  MenuItem,
  Modal,
  MomentFormatComponent,
  Notice,
  prepareFuzzySearch,
  prepareSimpleSearch,
  Scope,
  SearchComponent,
  Setting,
  SliderComponent,
  SuggestModal,
  TextAreaComponent,
  TextComponent,
  ToggleComponent,
  ValueComponent,
  type FuzzyMatch,
  type HexString,
  type HSL,
  type Instruction,
  type RGB,
  type SearchMatches,
  type SearchMatchPart,
  type SearchResult,
  type UserEvent,
} from "./ui";
export { addIcon, getIcon, getIconIds, setIcon, setTooltip, type IconName } from "./icons";
export { loadMermaid } from "@core/mermaid";
export { finishRenderMath, loadMathJax, renderMath } from "./math";
export { sanitizeHTMLToDom } from "./sanitize";
export {
  apiVersion,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  debounce,
  getAllTags,
  getBlobArrayBuffer,
  getLanguage,
  getLinkpath,
  htmlToMarkdown,
  MarkdownRenderer,
  moment,
  normalizePath,
  parseFrontMatterAliases,
  parseFrontMatterEntry,
  parseFrontMatterStringArray,
  parseFrontMatterTags,
  parseLinktext,
  Platform,
  request,
  requestUrl,
  requireApiVersion,
  type Debouncer,
  type RequestUrlParam,
  type RequestUrlResponse,
  type RequestUrlResponsePromise,
} from "./util";
