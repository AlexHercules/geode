/**
 * Obsidian UI primitives (API-REFERENCE area 5): Notice, Modal, Setting and
 * its component classes. Chainable per the reference; setValue NEVER fires
 * onChange (only user interaction does). Styling lives in compat.css and
 * reuses the host's .modal-overlay/.modal-panel classes + CSS variables.
 */
import { reportGap } from "./gaps";
import { setIcon, type IconName } from "./icons";
import type { App } from "./plugin";

/* ---------------- Scope (minimal — keyboard scopes are host-handled) ---------------- */

export class Scope {
  register(_modifiers: unknown, _key: unknown, _func: unknown): unknown {
    return null;
  }
  unregister(_handler: unknown): void {}
}

/* ---------------- Notice ---------------- */

const NOTICE_DEFAULT_MS = 5000;
let noticeHost: HTMLElement | null = null;

function getNoticeHost(): HTMLElement {
  if (!noticeHost || !noticeHost.isConnected) {
    noticeHost = document.createElement("div");
    noticeHost.className = "geode-notice-container";
    noticeHost.setAttribute("data-testid", "compat-notices");
    document.body.appendChild(noticeHost);
  }
  return noticeHost;
}

export class Notice {
  containerEl: HTMLElement;
  messageEl: HTMLElement;
  /** @deprecated Use `messageEl` instead (kept for old plugins). */
  noticeEl: HTMLElement;
  private timer: number | null = null;

  constructor(message: string | DocumentFragment, duration?: number) {
    this.containerEl = document.createElement("div");
    this.containerEl.className = "notice geode-notice";
    this.containerEl.setAttribute("data-testid", "compat-notice");
    this.messageEl = document.createElement("div");
    this.messageEl.className = "notice-message";
    this.containerEl.appendChild(this.messageEl);
    this.noticeEl = this.containerEl;
    this.setMessage(message);
    this.containerEl.addEventListener("click", () => this.hide());
    getNoticeHost().appendChild(this.containerEl);
    const ms = duration === undefined ? NOTICE_DEFAULT_MS : duration;
    // duration 0 = sticky until manually dismissed
    if (ms > 0) this.timer = window.setTimeout(() => this.hide(), ms);
  }

  setMessage(message: string | DocumentFragment): this {
    if (typeof message === "string") {
      this.messageEl.textContent = message;
    } else {
      this.messageEl.textContent = "";
      this.messageEl.appendChild(message);
    }
    return this;
  }

  hide(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.containerEl.remove();
  }
}

/* ---------------- Modal ---------------- */

export class Modal {
  app: App;
  scope: Scope = new Scope();
  containerEl: HTMLElement;
  modalEl: HTMLElement;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  shouldRestoreSelection = false;
  private closeCallback: (() => unknown) | null = null;
  private isOpen = false;
  private keydownHandler = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      this.close();
    }
  };

  constructor(app: App) {
    this.app = app;
    // hierarchy per reference: containerEl (overlay) > modalEl > titleEl + contentEl
    this.containerEl = document.createElement("div");
    this.containerEl.className = "modal-overlay geode-compat-modal-overlay";
    this.modalEl = document.createElement("div");
    this.modalEl.className = "modal-panel modal geode-compat-modal";
    this.modalEl.setAttribute("data-testid", "compat-modal");
    this.titleEl = document.createElement("div");
    this.titleEl.className = "modal-title";
    this.contentEl = document.createElement("div");
    this.contentEl.className = "modal-content";
    this.modalEl.append(this.titleEl, this.contentEl);
    this.containerEl.appendChild(this.modalEl);
    this.containerEl.addEventListener("click", (e) => {
      if (e.target === this.containerEl) this.close();
    });
  }

  /** 'Show the modal on the active window.' */
  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    document.body.appendChild(this.containerEl);
    document.addEventListener("keydown", this.keydownHandler, true);
    try {
      const r = this.onOpen();
      if (r instanceof Promise) {
        r.catch((err) => console.error("[obsidian-compat] Modal.onOpen failed", err));
      }
    } catch (err) {
      console.error("[obsidian-compat] Modal.onOpen threw", err);
    }
  }

  /** 'Hide the modal.' */
  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    document.removeEventListener("keydown", this.keydownHandler, true);
    this.containerEl.remove();
    try {
      this.onClose();
    } catch (err) {
      console.error("[obsidian-compat] Modal.onClose threw", err);
    }
    try {
      this.closeCallback?.();
    } catch (err) {
      console.error("[obsidian-compat] Modal close callback threw", err);
    }
  }

  onOpen(): Promise<void> | void {}
  onClose(): void {}

  setTitle(title: string): this {
    this.titleEl.textContent = title;
    return this;
  }

  setContent(content: string | DocumentFragment): this {
    if (typeof content === "string") {
      this.contentEl.textContent = content;
    } else {
      this.contentEl.textContent = "";
      this.contentEl.appendChild(content);
    }
    return this;
  }

  setCloseCallback(callback: () => unknown): this {
    this.closeCallback = callback;
    return this;
  }
}

/* ---------------- setting components ---------------- */

export abstract class BaseComponent {
  disabled = false;

  /** 'Facilitates chaining'. */
  then(cb: (component: this) => unknown): this {
    cb(this);
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    return this;
  }
}

export abstract class ValueComponent<T> extends BaseComponent {
  registerOptionListener(_listeners: Record<string, (value?: T) => T>, _key: string): this {
    reportGap("Setting", "ValueComponent.registerOptionListener");
    return this;
  }
  abstract getValue(): T;
  /** setValue updates the UI but does NOT fire onChange. */
  abstract setValue(value: T): this;
}

export class AbstractTextComponent<
  T extends HTMLInputElement | HTMLTextAreaElement,
> extends ValueComponent<string> {
  inputEl: T;
  private changeCallback: ((value: string) => unknown) | null = null;

  constructor(inputEl: T) {
    super();
    this.inputEl = inputEl;
    this.inputEl.addEventListener("input", () => this.onChanged());
  }

  override setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.inputEl.disabled = disabled;
    return this;
  }

  getValue(): string {
    return this.inputEl.value;
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  setPlaceholder(placeholder: string): this {
    this.inputEl.placeholder = placeholder;
    return this;
  }

  /** Manually trigger change handling (used after programmatic edits). */
  onChanged(): void {
    this.changeCallback?.(this.inputEl.value);
  }

  onChange(callback: (value: string) => unknown): this {
    this.changeCallback = callback;
    return this;
  }
}

export class TextComponent extends AbstractTextComponent<HTMLInputElement> {
  constructor(containerEl: HTMLElement) {
    const input = document.createElement("input");
    input.type = "text";
    containerEl.appendChild(input);
    super(input);
  }
}

export class TextAreaComponent extends AbstractTextComponent<HTMLTextAreaElement> {
  constructor(containerEl: HTMLElement) {
    const textarea = document.createElement("textarea");
    containerEl.appendChild(textarea);
    super(textarea);
  }
}

export class SearchComponent extends AbstractTextComponent<HTMLInputElement> {
  clearButtonEl: HTMLElement;

  constructor(containerEl: HTMLElement) {
    const wrapper = document.createElement("div");
    wrapper.className = "search-input-container";
    const input = document.createElement("input");
    input.type = "search";
    wrapper.appendChild(input);
    containerEl.appendChild(wrapper);
    super(input);
    this.clearButtonEl = document.createElement("div");
    this.clearButtonEl.className = "search-input-clear-button";
    this.clearButtonEl.addEventListener("click", () => {
      this.setValue("");
      this.onChanged();
    });
    wrapper.appendChild(this.clearButtonEl);
  }
}

export class MomentFormatComponent extends TextComponent {
  sampleEl: HTMLElement = document.createElement("span");

  setDefaultFormat(defaultFormat: string): this {
    this.inputEl.placeholder = defaultFormat;
    return this;
  }

  setSampleEl(sampleEl: HTMLElement): this {
    this.sampleEl = sampleEl;
    return this;
  }

  override setValue(value: string): this {
    super.setValue(value);
    return this;
  }

  override onChanged(): void {
    super.onChanged();
    this.updateSample();
  }

  /** moment is a T2 gap — the live sample shows the raw format string. */
  updateSample(): void {
    this.sampleEl.textContent = this.getValue();
  }
}

export class ToggleComponent extends ValueComponent<boolean> {
  toggleEl: HTMLElement;
  private value = false;
  private changeCallback: ((value: boolean) => unknown) | null = null;

  constructor(containerEl: HTMLElement) {
    super();
    this.toggleEl = document.createElement("div");
    this.toggleEl.className = "checkbox-container";
    this.toggleEl.setAttribute("role", "checkbox");
    this.toggleEl.setAttribute("aria-checked", "false");
    this.toggleEl.tabIndex = 0;
    containerEl.appendChild(this.toggleEl);
    this.toggleEl.addEventListener("click", () => {
      if (!this.disabled) this.onClick();
    });
  }

  override setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.toggleEl.classList.toggle("is-disabled", disabled);
    return this;
  }

  getValue(): boolean {
    return this.value;
  }

  setValue(on: boolean): this {
    this.value = on;
    this.toggleEl.classList.toggle("is-enabled", on);
    this.toggleEl.setAttribute("aria-checked", String(on));
    return this;
  }

  setTooltip(tooltip: string, _options?: unknown): this {
    this.toggleEl.setAttribute("aria-label", tooltip);
    return this;
  }

  /** Public click action: flips the value AND fires onChange (per reference). */
  onClick(): void {
    this.setValue(!this.value);
    this.changeCallback?.(this.value);
  }

  onChange(callback: (value: boolean) => unknown): this {
    this.changeCallback = callback;
    return this;
  }
}

export class ButtonComponent extends BaseComponent {
  buttonEl: HTMLButtonElement;
  private clickCallback: ((evt: MouseEvent) => unknown) | null = null;

  constructor(containerEl: HTMLElement) {
    super();
    this.buttonEl = document.createElement("button");
    containerEl.appendChild(this.buttonEl);
    this.buttonEl.addEventListener("click", (evt) => void this.clickCallback?.(evt));
  }

  override setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.buttonEl.disabled = disabled;
    return this;
  }

  setCta(): this {
    this.buttonEl.classList.add("mod-cta");
    return this;
  }

  removeCta(): this {
    this.buttonEl.classList.remove("mod-cta");
    return this;
  }

  /** @deprecated Use setDestructive */
  setWarning(): this {
    return this.setDestructive();
  }

  setDestructive(): this {
    this.buttonEl.classList.add("mod-destructive");
    return this;
  }

  removeDestructive(): this {
    this.buttonEl.classList.remove("mod-destructive");
    return this;
  }

  setTooltip(tooltip: string, _options?: unknown): this {
    this.buttonEl.setAttribute("aria-label", tooltip);
    return this;
  }

  setButtonText(name: string): this {
    this.buttonEl.textContent = name;
    return this;
  }

  setIcon(icon: IconName): this {
    setIcon(this.buttonEl, icon);
    return this;
  }

  setClass(cls: string): this {
    this.buttonEl.classList.add(...cls.split(/\s+/).filter(Boolean));
    return this;
  }

  /** Registers the click callback and returns this (chainable). */
  onClick(callback: (evt: MouseEvent) => unknown): this {
    this.clickCallback = callback;
    return this;
  }
}

export class ExtraButtonComponent extends BaseComponent {
  /** NOTE: named extraSettingsEl, not buttonEl (per reference). */
  extraSettingsEl: HTMLElement;
  private clickCallback: (() => unknown) | null = null;

  constructor(containerEl: HTMLElement) {
    super();
    this.extraSettingsEl = document.createElement("div");
    this.extraSettingsEl.className = "clickable-icon extra-setting-button";
    containerEl.appendChild(this.extraSettingsEl);
    this.extraSettingsEl.addEventListener("click", () => {
      if (!this.disabled) void this.clickCallback?.();
    });
  }

  override setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.extraSettingsEl.classList.toggle("is-disabled", disabled);
    return this;
  }

  setTooltip(tooltip: string, _options?: unknown): this {
    this.extraSettingsEl.setAttribute("aria-label", tooltip);
    return this;
  }

  setIcon(icon: IconName): this {
    setIcon(this.extraSettingsEl, icon);
    return this;
  }

  onClick(callback: () => unknown): this {
    this.clickCallback = callback;
    return this;
  }
}

export class DropdownComponent extends ValueComponent<string> {
  selectEl: HTMLSelectElement;
  private changeCallback: ((value: string) => unknown) | null = null;

  constructor(containerEl: HTMLElement) {
    super();
    this.selectEl = document.createElement("select");
    this.selectEl.className = "dropdown";
    containerEl.appendChild(this.selectEl);
    this.selectEl.addEventListener("change", () => this.changeCallback?.(this.selectEl.value));
  }

  override setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.selectEl.disabled = disabled;
    return this;
  }

  addOption(value: string, display: string): this {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = display;
    this.selectEl.appendChild(option);
    return this;
  }

  addOptions(options: Record<string, string>): this {
    for (const [value, display] of Object.entries(options)) this.addOption(value, display);
    return this;
  }

  getValue(): string {
    return this.selectEl.value;
  }

  setValue(value: string): this {
    this.selectEl.value = value;
    return this;
  }

  onChange(callback: (value: string) => unknown): this {
    this.changeCallback = callback;
    return this;
  }
}

export class SliderComponent extends ValueComponent<number> {
  sliderEl: HTMLInputElement;
  private changeCallback: ((value: number) => unknown) | null = null;
  private displayFormat: ((value: number) => string) | null = null;
  private instant = false;

  constructor(containerEl: HTMLElement) {
    super();
    this.sliderEl = document.createElement("input");
    this.sliderEl.type = "range";
    this.sliderEl.className = "slider";
    containerEl.appendChild(this.sliderEl);
    this.sliderEl.addEventListener("change", () => this.fire());
    this.sliderEl.addEventListener("input", () => {
      this.sliderEl.title = this.getValuePretty();
      if (this.instant) this.fire();
    });
  }

  private fire(): void {
    this.changeCallback?.(this.getValue());
  }

  override setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.sliderEl.disabled = disabled;
    return this;
  }

  /** onChange fires while dragging instead of only on release. */
  setInstant(instant: boolean): this {
    this.instant = instant;
    return this;
  }

  setLimits(min: number | null, max: number | null, step: number | "any"): this {
    if (min === null) this.sliderEl.removeAttribute("min");
    else this.sliderEl.min = String(min);
    if (max === null) this.sliderEl.removeAttribute("max");
    else this.sliderEl.max = String(max);
    this.sliderEl.step = String(step);
    return this;
  }

  getValue(): number {
    return parseFloat(this.sliderEl.value);
  }

  setValue(value: number): this {
    this.sliderEl.value = String(value);
    return this;
  }

  getValuePretty(): string {
    const value = this.getValue();
    return this.displayFormat ? this.displayFormat(value) : String(value);
  }

  setDisplayFormat(format: (value: number) => string): this {
    this.displayFormat = format;
    return this;
  }

  /** @deprecated The value is now always shown inline — kept chainable. */
  setDynamicTooltip(): this {
    this.sliderEl.title = this.getValuePretty();
    return this;
  }

  onChange(callback: (value: number) => unknown): this {
    this.changeCallback = callback;
    return this;
  }
}

/* ---------------- Setting ---------------- */

export class Setting {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  components: BaseComponent[] = [];
  errorEl: HTMLElement | null = null;

  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement("div");
    this.settingEl.className = "setting-item";
    this.settingEl.setAttribute("data-testid", "compat-setting-item");
    this.infoEl = document.createElement("div");
    this.infoEl.className = "setting-item-info";
    this.nameEl = document.createElement("div");
    this.nameEl.className = "setting-item-name";
    this.descEl = document.createElement("div");
    this.descEl.className = "setting-item-description";
    this.infoEl.append(this.nameEl, this.descEl);
    this.controlEl = document.createElement("div");
    this.controlEl.className = "setting-item-control";
    this.settingEl.append(this.infoEl, this.controlEl);
    containerEl.appendChild(this.settingEl);
  }

  private static fill(el: HTMLElement, content: string | DocumentFragment): void {
    if (typeof content === "string") {
      el.textContent = content;
    } else {
      el.textContent = "";
      el.appendChild(content);
    }
  }

  setName(name: string | DocumentFragment): this {
    Setting.fill(this.nameEl, name);
    return this;
  }

  setDesc(desc: string | DocumentFragment): this {
    Setting.fill(this.descEl, desc);
    return this;
  }

  setClass(cls: string): this {
    this.settingEl.classList.add(...cls.split(/\s+/).filter(Boolean));
    return this;
  }

  setTooltip(tooltip: string, _options?: unknown): this {
    this.settingEl.setAttribute("aria-label", tooltip);
    return this;
  }

  setHeading(): this {
    this.settingEl.classList.add("setting-item-heading");
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.settingEl.classList.toggle("is-disabled", disabled);
    for (const component of this.components) component.setDisabled(disabled);
    return this;
  }

  setErrorMessage(message: string | null): this {
    if (!message) {
      this.errorEl?.remove();
      this.errorEl = null;
      this.settingEl.classList.remove("is-invalid");
      return this;
    }
    if (!this.errorEl) {
      this.errorEl = document.createElement("div");
      this.errorEl.className = "setting-item-error";
      this.settingEl.appendChild(this.errorEl);
    }
    this.errorEl.textContent = message;
    this.settingEl.classList.add("is-invalid");
    return this;
  }

  private addControl<T extends BaseComponent>(component: T, cb: (component: T) => unknown): this {
    this.components.push(component);
    cb(component);
    return this;
  }

  addButton(cb: (component: ButtonComponent) => unknown): this {
    return this.addControl(new ButtonComponent(this.controlEl), cb);
  }

  addExtraButton(cb: (component: ExtraButtonComponent) => unknown): this {
    return this.addControl(new ExtraButtonComponent(this.controlEl), cb);
  }

  addToggle(cb: (component: ToggleComponent) => unknown): this {
    return this.addControl(new ToggleComponent(this.controlEl), cb);
  }

  addText(cb: (component: TextComponent) => unknown): this {
    return this.addControl(new TextComponent(this.controlEl), cb);
  }

  addSearch(cb: (component: SearchComponent) => unknown): this {
    return this.addControl(new SearchComponent(this.controlEl), cb);
  }

  addTextArea(cb: (component: TextAreaComponent) => unknown): this {
    return this.addControl(new TextAreaComponent(this.controlEl), cb);
  }

  addDropdown(cb: (component: DropdownComponent) => unknown): this {
    return this.addControl(new DropdownComponent(this.controlEl), cb);
  }

  addSlider(cb: (component: SliderComponent) => unknown): this {
    return this.addControl(new SliderComponent(this.controlEl), cb);
  }

  /** moment formats render as plain text inputs (moment is a T2 gap). */
  addMomentFormat(cb: (component: MomentFormatComponent) => unknown): this {
    reportGap("Setting", "addMomentFormat", "plain text input substitute (no live preview)");
    return this.addControl(new MomentFormatComponent(this.controlEl), cb);
  }

  addComponent<T extends BaseComponent>(cb: (el: HTMLElement) => T): this {
    this.components.push(cb(this.controlEl));
    return this;
  }

  addColorPicker(_cb: (component: never) => unknown): this {
    reportGap("Setting", "addColorPicker", "control omitted");
    return this;
  }

  addProgressBar(_cb: (component: never) => unknown): this {
    reportGap("Setting", "addProgressBar", "control omitted");
    return this;
  }

  addDisplayValue(_cb: (component: never) => unknown): this {
    reportGap("Setting", "addDisplayValue", "control omitted");
    return this;
  }

  then(cb: (setting: this) => unknown): this {
    cb(this);
    return this;
  }

  clear(): this {
    this.components = [];
    this.controlEl.textContent = "";
    return this;
  }
}
