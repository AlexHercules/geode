/**
 * PopoverSuggest / EditorSuggest skeletons — suite-driven R4 addition.
 * Constructing a subclass (super(app) then this.scope.register([...], ...))
 * must not throw at plugin-load time. Triggering/rendering never happens this
 * round: Plugin.registerEditorSuggest stays a warn-stub (recorded gap), so
 * open/close are inert no-ops.
 */
import type { Editor, EditorPosition } from "./editor";
import type { TFile } from "./files";
import type { App } from "./plugin";
import { Scope } from "./ui";

export interface EditorSuggestTriggerInfo {
  /** The start position of the triggering text. */
  start: EditorPosition;
  /** The end position of the triggering text. */
  end: EditorPosition;
  /** The query string (usually the text between start and end). */
  query: string;
}

export interface EditorSuggestContext extends EditorSuggestTriggerInfo {
  editor: Editor;
  file: TFile;
}

export abstract class PopoverSuggest<T> {
  app: App;
  scope: Scope;

  constructor(app: App, scope?: Scope) {
    this.app = app;
    this.scope = scope ?? new Scope();
  }

  open(): void {}
  close(): void {}

  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void;
}

export abstract class EditorSuggest<T> extends PopoverSuggest<T> {
  /** Result of onTrigger; null whenever the suggest is not supposed to run. */
  context: EditorSuggestContext | null = null;
  limit = 100;

  constructor(app: App) {
    super(app);
  }

  setInstructions(_instructions: unknown[]): void {}

  abstract onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    file: TFile | null,
  ): EditorSuggestTriggerInfo | null;

  abstract getSuggestions(context: EditorSuggestContext): T[] | Promise<T[]>;
}
