/**
 * Obsidian hover/popover type chain (obsidian.d.ts top-level exports) — added in
 * R221 (F2 type alignment) so plugins can `import type { MarkdownFileInfo,
 * HoverParent, HoverPopover, Point, PopoverState }` (and value-import HoverPopover /
 * PopoverState) and compile consistently against the Geode shim.
 *
 * Geode renders NO hover preview (the runtime gap is recorded in plugin.ts:
 * "plugin self-rendered previews (hoverPopover / HoverParent)"). HoverPopover is
 * therefore an INERT shim: construction succeeds (so `new HoverPopover(...)` and
 * `instanceof HoverPopover` work), but it never renders or positions a preview.
 */
import { Component } from "./component";

/** d.ts:5179 — a 2D point (used by HoverPopover's static-position arg, Menu, etc.). */
export interface Point {
  x: number;
  y: number;
}

/** d.ts:5193 — opaque popover lifecycle state (empty enum in the official d.ts). */
export enum PopoverState {}

/** d.ts:3464 — anything that can own a hover popover. */
export interface HoverParent {
  hoverPopover: HoverPopover | null;
}

/**
 * d.ts:3476 — `class HoverPopover extends Component`. Inert in Geode (no hover
 * preview): the element is created but never mounted/positioned, the constructor
 * args are accepted and ignored.
 */
export class HoverPopover extends Component {
  hoverEl: HTMLElement;
  state: PopoverState;

  constructor(
    _parent: HoverParent,
    _targetEl: HTMLElement | null,
    _waitTime?: number,
    _staticPos?: Point | null,
  ) {
    super();
    this.hoverEl = document.createElement("div");
    this.state = 0 as PopoverState;
  }
}
