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
export { Component } from "./component";
export { TAbstractFile, TFile, TFolder, type FileStats } from "./files";
export { Vault, CompatDataAdapter, type DataAdapter, type DataWriteOptions } from "./vault";
export {
  MetadataCache,
  type CachedMetadata,
  type CacheItem,
  type EmbedCache,
  type FrontMatterCache,
  type HeadingCache,
  type LinkCache,
  type Loc,
  type Pos,
  type Reference,
  type ReferenceCache,
  type TagCache,
} from "./metadata";
export {
  MarkdownView,
  Workspace,
  WorkspaceLeaf,
  type PaneType,
  type SplitDirection,
} from "./workspace";
export { FileView, ItemView, View, type ViewStateResult } from "./view";
export {
  EditorSuggest,
  PopoverSuggest,
  type EditorSuggestContext,
  type EditorSuggestTriggerInfo,
} from "./suggest";
export { Editor, type EditorPosition } from "./editor";
export {
  App,
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
  DropdownComponent,
  ExtraButtonComponent,
  FuzzySuggestModal,
  Keymap,
  Menu,
  MenuItem,
  Modal,
  MomentFormatComponent,
  Notice,
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
  type Instruction,
  type SearchResult,
  type UserEvent,
} from "./ui";
export { addIcon, setIcon, setTooltip, type IconName } from "./icons";
export {
  apiVersion,
  debounce,
  getAllTags,
  getLinkpath,
  htmlToMarkdown,
  MarkdownRenderer,
  moment,
  normalizePath,
  parseFrontMatterAliases,
  parseFrontMatterEntry,
  parseFrontMatterStringArray,
  parseFrontMatterTags,
  Platform,
  request,
  requestUrl,
  requireApiVersion,
  type Debouncer,
  type RequestUrlParam,
  type RequestUrlResponse,
  type RequestUrlResponsePromise,
} from "./util";
