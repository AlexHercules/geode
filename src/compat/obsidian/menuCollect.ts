/**
 * R130: file-menu collection adapter. A plugin's `workspace.on('file-menu', (menu, file) => …)`
 * callback receives a `CollectorMenu` instead of the real popup Menu (ui.ts) — it records the
 * items the plugin adds as plain `MenuContribution[]` WITHOUT building any DOM, so the host
 * (Explorer) renders them into its own native context menu. Keeps the working popup Menu untouched
 * and avoids throwaway DOM on every right-click. File-menu callbacks only ever call addItem /
 * addSeparator / setNoIcon, so that surface is enough (other Menu methods aren't available during
 * collection — a documented limitation, never hit by real file-menu handlers).
 */
import type { MenuContribution } from "@core/plugins";

/** A MenuItem-shaped recorder — captures what the plugin's callback sets, builds no DOM. */
class CollectorMenuItem {
  /** @internal the accumulating contribution */
  readonly contribution: MenuContribution = { title: "", onClick: () => {} };

  setTitle(title: string | DocumentFragment): this {
    this.contribution.title = typeof title === "string" ? title : (title.textContent ?? "");
    return this;
  }
  setIcon(icon: string | null): this {
    if (icon) this.contribution.icon = icon;
    return this;
  }
  setSection(section: string): this {
    this.contribution.section = section;
    return this;
  }
  setDisabled(disabled: boolean): this {
    this.contribution.disabled = disabled;
    return this;
  }
  setWarning(warning: boolean): this {
    this.contribution.warning = warning;
    return this;
  }
  setChecked(checked: boolean): this {
    this.contribution.checked = checked;
    return this;
  }
  /** label rows carry no action; recorded as a plain (disabled-feeling) item — no-op marker. */
  setIsLabel(_isLabel: boolean): this {
    return this;
  }
  onClick(cb: () => void): this {
    this.contribution.onClick = cb;
    return this;
  }
}

/** The `menu` handed to a `file-menu` callback. `addItem` records a MenuContribution; the host
 *  renders `items` into its context menu. An item with an empty title is dropped (no-op callback). */
export class CollectorMenu {
  readonly items: MenuContribution[] = [];

  addItem(cb: (item: CollectorMenuItem) => void): this {
    const item = new CollectorMenuItem();
    cb(item);
    if (item.contribution.title) this.items.push(item.contribution);
    return this;
  }
  /** v1: contributed items render as one group after the native items behind a single separator
   *  (the host draws it); intra-group separators are dropped (section ordering deferred). */
  addSeparator(): this {
    return this;
  }
  setNoIcon(): this {
    return this;
  }
}
