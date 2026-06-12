import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  buildRemoveProperty,
  buildRenameProperty,
  buildSetProperty,
  canCreatePropertiesBlock,
  canSerializeNumber,
  effectivePropertyType,
  parseProperties,
  propertyTypes,
} from "@core/properties";
import type { PropertyEdit, PropertyEntry, PropertyType, PropertyValue } from "@core/properties";
import { useI18n } from "@core/i18n";
import type { I18nKey } from "@core/i18n";
import { useStore } from "@core/store";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";

/**
 * PropertiesPanel (R22) — structured frontmatter editor rendered at the top of
 * a note (live preview: portaled into the CM PropertiesHostWidget container;
 * reading view: rendered before .preview-content).
 *
 * Contract (docs/ARCHITECTURE.md "Round 22 additions"):
 * - renders parseProperties(getDoc()) in document order; opaque entries are
 *   read-only raw rows and are NEVER rewritten;
 * - focused row keeps a local draft, commits on blur/Enter, restores on
 *   Escape; every commit recomputes the builder against getDoc()'s CURRENT
 *   text — a null builder result abandons the edit (loud console.warn) and
 *   re-renders;
 * - exactly one splice per commit (one undo step in live mode);
 * - type menu assigns vault-wide via propertyTypes.assign (display follows
 *   effectivePropertyType; values are not eagerly converted);
 * - listens for window "geode:add-property" (detail.tabId must be the active
 *   tab pointing at this panel's path); creates "---\n---\n" at offset 0 when
 *   the note has no frontmatter block, then focuses the add-name input.
 */

const ALL_TYPES: readonly PropertyType[] = [
  "text",
  "multitext",
  "number",
  "checkbox",
  "date",
  "datetime",
  "tags",
  "aliases",
];

const TYPE_LABEL_KEY = {
  text: "editor.typeText",
  multitext: "editor.typeMultitext",
  number: "editor.typeNumber",
  checkbox: "editor.typeCheckbox",
  date: "editor.typeDate",
  datetime: "editor.typeDatetime",
  tags: "editor.typeTags",
  aliases: "editor.typeAliases",
} as const satisfies Record<PropertyType, I18nKey>;

/** built-in keys whose type is fixed by effectivePropertyType (case-insensitive) */
const BUILTIN_KEYS = new Set(["tags", "aliases", "cssclasses"]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/* ---------------- tiny local icon set (lucide-style, currentColor) ---------------- */

const TYPE_ICON_PATHS: Record<PropertyType, string[]> = {
  text: ["M17 6.1H3", "M21 12.1H3", "M15.1 18H3"],
  multitext: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  number: ["M4 9h16", "M4 15h16", "M10 3L8 21", "M16 3l-2 18"],
  checkbox: ["M9 11l3 3L22 4", "M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"],
  date: [
    "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    "M16 2v4",
    "M8 2v4",
    "M3 10h18",
  ],
  datetime: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  tags: [
    "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z",
    "M7 7h.01",
  ],
  aliases: ["M9 14L4 9l5-5", "M20 20v-7a4 4 0 0 0-4-4H4"],
};

function TypeIcon({ type, size = 14 }: { type: PropertyType; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {TYPE_ICON_PATHS[type].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/* ---------------- leaf editors (top-level so React keeps input identity) ---------------- */

/** single-line scalar editor with draft / blur-Enter commit / Escape restore */
function ScalarInput(props: {
  keyName: string;
  inputType: "text" | "number";
  stored: string;
  placeholder: string;
  ariaLabel: string;
  /** returns false when the edit was rejected — the draft resets to stored */
  commitText: (raw: string) => boolean;
}) {
  const { stored } = props;
  const [draft, setDraft] = useState(stored);
  const ref = useRef<HTMLInputElement | null>(null);
  // resync the draft when the stored value changes under us (external edit /
  // another pane) — but never while the user is typing in this input
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(stored);
  }, [stored]);
  // unmount flush (R22 review fix INT-6): React unmount never dispatches
  // blur, so a focused draft would be silently dropped on mode switch / tab
  // close — flush it through the same commit path. useLayoutEffect: the
  // cleanup must run BEFORE the DOM detaches (activeElement still points at
  // the input there; a passive effect cleanup runs too late).
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = () => {
    if (document.activeElement === ref.current && draft !== stored) {
      props.commitText(draft);
    }
  };
  useLayoutEffect(() => () => flushRef.current(), []);
  return (
    <input
      ref={ref}
      className="property-input"
      type={props.inputType}
      value={draft}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel}
      data-testid={`property-value-${props.keyName}`}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur(); // commit via onBlur (exactly one commit path)
        } else if (e.key === "Escape") {
          setDraft(stored); // restore draft (frozen contract semantics)
        }
      }}
      onBlur={() => {
        // rejected commit → resync the draft so the input never keeps
        // showing a value that was not written (R22 review fix F3)
        if (draft !== stored && !props.commitText(draft)) setDraft(stored);
      }}
    />
  );
}

function CheckboxValue(props: {
  keyName: string;
  value: PropertyValue;
  ariaLabel: string;
  commit: (value: PropertyValue) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const isBool = typeof props.value === "boolean";
  // non-boolean stored value renders indeterminate; clicking lands true
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !isBool;
  }, [isBool]);
  return (
    <input
      ref={ref}
      className="property-checkbox"
      type="checkbox"
      checked={props.value === true}
      aria-label={props.ariaLabel}
      data-testid={`property-value-${props.keyName}`}
      onChange={() => props.commit(isBool ? !(props.value as boolean) : true)}
    />
  );
}

/** native date / datetime-local input — draft + blur/Enter commit (frozen
 *  contract semantics). R22 review fix (F2/05): per-change commit destroyed
 *  stored dates mid-edit — keyboard-clearing one segment fires change with
 *  "" and the stored value was instantly rewritten to null. */
function DateValue(props: {
  keyName: string;
  kind: "date" | "datetime";
  stored: string;
  ariaLabel: string;
  commit: (value: PropertyValue) => void;
}) {
  const { stored } = props;
  const [draft, setDraft] = useState(stored);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(stored);
  }, [stored]);
  return (
    <input
      ref={ref}
      className="property-input property-input-date"
      type={props.kind === "date" ? "date" : "datetime-local"}
      value={draft}
      aria-label={props.ariaLabel}
      data-testid={`property-value-${props.keyName}`}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur(); // commit via onBlur (one commit path)
        } else if (e.key === "Escape") {
          setDraft(stored);
        }
      }}
      onBlur={() => {
        if (draft !== stored) props.commit(draft === "" ? null : draft);
      }}
    />
  );
}

/** chips + append input for multitext / tags / aliases */
function ChipsValue(props: {
  keyName: string;
  items: readonly string[];
  placeholder: string;
  ariaLabel: string;
  removeLabel: string;
  listId?: string;
  stripHash: boolean;
  commit: (items: string[]) => void;
}) {
  const { items } = props;
  const [draft, setDraft] = useState("");
  const add = (text: string) => {
    let v = text.trim();
    if (props.stripHash) v = v.replace(/^#+/, "");
    setDraft("");
    if (!v) return;
    props.commit([...items, v]);
  };
  return (
    <div className="property-chips">
      {items.map((item, i) => (
        <span
          className="property-chip"
          key={`${i}:${item}`}
          data-testid={`property-chip-${props.keyName}-${i}`}
        >
          <span className="property-chip-text">{item}</span>
          <button
            className="property-chip-remove"
            type="button"
            aria-label={props.removeLabel}
            title={props.removeLabel}
            onClick={() => props.commit(items.filter((_, j) => j !== i))}
          >
            <Icon name="x" size={10} />
          </button>
        </span>
      ))}
      <input
        className="property-input property-chip-input"
        value={draft}
        list={props.listId}
        placeholder={items.length === 0 ? props.placeholder : undefined}
        aria-label={props.ariaLabel}
        data-testid={`property-value-${props.keyName}`}
        spellCheck={false}
        onChange={(e) => {
          const v = e.target.value;
          // a trailing comma commits the pending item (chips口径)
          if (v.endsWith(",")) add(v.slice(0, -1));
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && draft === "" && items.length > 0) {
            e.preventDefault();
            props.commit(items.slice(0, -1)); // empty input + Backspace removes last
          } else if (e.key === "Escape") {
            setDraft("");
          }
        }}
        onBlur={() => {
          if (draft.trim()) add(draft);
        }}
      />
    </div>
  );
}

/** key-name editor — rename commits via buildRenameProperty on blur/Enter */
function NameInput(props: {
  keyName: string;
  listId: string;
  ariaLabel: string;
  /** returns false when the rename was rejected (draft snaps back) */
  rename: (key: string, newKey: string) => boolean;
}) {
  const { keyName } = props;
  const [draft, setDraft] = useState(keyName);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(keyName);
  }, [keyName]);
  return (
    <input
      ref={ref}
      className="property-name-input"
      value={draft}
      list={props.listId}
      aria-label={props.ariaLabel}
      data-testid={`property-name-${keyName}`}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(keyName);
        }
      }}
      onBlur={() => {
        const next = draft.trim();
        if (next === "" || next === keyName) {
          setDraft(keyName);
          return;
        }
        if (!props.rename(keyName, next)) setDraft(keyName);
      }}
    />
  );
}

/* ---------------- per-entry value editor dispatch ---------------- */

function valueAsString(value: PropertyValue): string {
  if (value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function valueAsItems(value: PropertyValue): string[] {
  if (value === null) return [];
  if (Array.isArray(value)) return value;
  return [String(value)];
}

function ValueEditor(props: {
  entry: PropertyEntry;
  effType: PropertyType;
  tagListId: string;
  /** returns false when the edit was rejected (builder null) */
  commitValue: (key: string, value: PropertyValue) => boolean;
}) {
  const t = useI18n();
  const { entry, effType } = props;
  const key = entry.key;
  const commit = (v: PropertyValue) => props.commitValue(key, v);
  const placeholder = t("editor.propertyValuePlaceholder");
  const ariaLabel = key;

  switch (effType) {
    case "checkbox":
      return <CheckboxValue keyName={key} value={entry.value} ariaLabel={ariaLabel} commit={commit} />;
    case "number":
      return (
        <ScalarInput
          keyName={key}
          inputType="number"
          stored={valueAsString(entry.value)}
          placeholder={placeholder}
          ariaLabel={ariaLabel}
          commitText={(raw) => {
            const trimmed = raw.trim();
            if (trimmed === "") return commit(null);
            const n = Number(trimmed);
            // non-finite OR non-round-trippable numbers (exponent forms like
            // 1e21 / 1e-7 — R22 review fix SEC-02) fall back to a text string
            // so the input always has a landing spot (frozen口径)
            return commit(Number.isFinite(n) && canSerializeNumber(n) ? n : raw);
          }}
        />
      );
    case "date":
    case "datetime": {
      const re = effType === "date" ? DATE_RE : DATETIME_RE;
      const valid = entry.value === null || (typeof entry.value === "string" && re.test(entry.value));
      if (valid) {
        return (
          <DateValue
            keyName={key}
            kind={effType}
            stored={typeof entry.value === "string" ? entry.value : ""}
            ariaLabel={ariaLabel}
            commit={commit}
          />
        );
      }
      // stored value doesn't fit the native input format → plain text editing
      break;
    }
    case "multitext":
    case "tags":
    case "aliases":
      return (
        <ChipsValue
          keyName={key}
          items={valueAsItems(entry.value)}
          placeholder={placeholder}
          ariaLabel={ariaLabel}
          removeLabel={t("editor.deleteProperty")}
          listId={effType === "tags" ? props.tagListId : undefined}
          stripHash={effType === "tags"}
          commit={(items) => commit(items)}
        />
      );
    default:
      break;
  }
  // text + fallbacks (invalid date formats, unknown)
  return (
    <ScalarInput
      keyName={key}
      inputType="text"
      stored={valueAsString(entry.value)}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      commitText={(raw) => commit(raw === "" ? null : raw)}
    />
  );
}

/* ---------------- the panel ---------------- */

type FocusRequest = { kind: "add" } | { kind: "value"; key: string };

export function PropertiesPanel(props: {
  /** current document text (commit recomputes against getDoc(), never a render-time snapshot) */
  getDoc: () => string;
  /** apply one splice: live mode = CM dispatch; preview mode = setText+modify */
  applyEdit: (edit: PropertyEdit, focusAfter?: boolean) => void;
  path: string; // tag/key autocompletion + registry
  revision: number; // handle.revision mirror — triggers re-render
}): JSX.Element | null {
  const app = useApp();
  const t = useI18n();
  // re-render on vault-wide type assignments and on metadata index changes
  // (datalist suggestions); props.revision covers document text changes
  useStore(propertyTypes.revision);
  const metaRev = useStore(app.metadata.revision);

  const [, setBumpCount] = useState(0);
  const [adding, setAdding] = useState(false);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pendingFocusRef = useRef<FocusRequest | null>(null);
  /** latest props for window-event handlers / commit closures */
  const latest = useRef(props);
  latest.current = props;

  const rerender = () => setBumpCount((n) => n + 1);

  const uid = useId();
  const nameListId = `${uid}-prop-names`;
  const tagListId = `${uid}-prop-tags`;

  /* ---- datalist suggestions ---- */
  const propertyNames = useMemo(
    () => app.metadata.getPropertyKeys(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app, metaRev],
  );
  const tagNames = useMemo(
    () => Array.from(app.metadata.getTagMap().keys()).sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app, metaRev],
  );

  /* ---- commit handlers (always recompute against getDoc()'s current text) ---- */

  const commitValue = (key: string, value: PropertyValue): boolean => {
    const edit = buildSetProperty(latest.current.getDoc(), key, value);
    if (!edit) {
      console.warn(`[properties] set "${key}" rejected (unserializable value or conflicting frontmatter) in ${latest.current.path}`);
      rerender();
      return false;
    }
    latest.current.applyEdit(edit);
    return true;
  };

  const renameKey = (key: string, newKey: string): boolean => {
    const edit = buildRenameProperty(latest.current.getDoc(), key, newKey);
    if (!edit) {
      console.warn(`[properties] rename "${key}" → "${newKey}" rejected in ${latest.current.path}`);
      rerender();
      return false;
    }
    latest.current.applyEdit(edit);
    return true;
  };

  const removeKey = (key: string) => {
    const edit = buildRemoveProperty(latest.current.getDoc(), key);
    if (!edit) {
      console.warn(`[properties] remove "${key}" rejected in ${latest.current.path}`);
      rerender();
      return;
    }
    latest.current.applyEdit(edit);
  };

  const assignType = (key: string, type: PropertyType) => {
    setMenuKey(null);
    void propertyTypes.assign(key, type).catch((err) => {
      console.warn(`[properties] type assignment failed for "${key}"`, err);
    });
  };

  const submitAdd = (name: string) => {
    setAdding(false);
    const doc = latest.current.getDoc();
    const current = parseProperties(doc);
    const existing = current?.entries.find(
      (en) => !en.opaque && en.key.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      // already present — just focus its value editor instead of rewriting it
      pendingFocusRef.current = { kind: "value", key: existing.key };
      rerender();
      return;
    }
    const edit = buildSetProperty(doc, name, null);
    if (!edit) {
      console.warn(`[properties] add "${name}" rejected in ${latest.current.path}`);
      rerender();
      return;
    }
    pendingFocusRef.current = { kind: "value", key: name };
    latest.current.applyEdit(edit);
  };

  /* ---- editor:add-property broadcast (App.tsx command) ---- */

  useEffect(() => {
    // One-shot consume (revealTarget R14 shape): the command may fire while
    // this panel is not mounted yet (source → live flip) — checking on mount
    // AND on every store change makes whichever side arrives last consume it.
    const tryConsume = () => {
      const req = app.workspace.addPropertyRequest.get();
      if (!req) return;
      const active = app.workspace.getActiveTab();
      if (!active || active.id !== req.tabId) return;
      // stale request: the tab navigated to ANOTHER file since the command
      // fired — discard instead of writing into a file the user never
      // touched (R22 review fix INT-2/SEC-03)
      if (active.filePath !== req.filePath) {
        app.workspace.addPropertyRequest.set(null);
        return;
      }
      // props carry no tab id (frozen signature) — match via the active tab
      // (dual-pane same-file: first consumer wins, 已录口径)
      if (latest.current.path !== req.filePath) return;
      app.workspace.addPropertyRequest.set(null); // consume
      const doc = latest.current.getDoc();
      if (parseProperties(doc) === null) {
        // no frontmatter block yet — create an empty one at offset 0, but
        // only when the 20k-capped view and metadata agree there is no block
        // (R22 review fix SEC-01: a block closing beyond the parse limit
        // must not be shadowed by a prepended second block)
        if (!canCreatePropertiesBlock(doc)) {
          console.warn(`[properties] cannot create a block in ${latest.current.path} — unparsable frontmatter`);
          return;
        }
        latest.current.applyEdit({ from: 0, to: 0, insert: "---\n---\n" });
      }
      pendingFocusRef.current = { kind: "add" };
      setAdding(true);
      rerender();
    };
    tryConsume();
    return app.workspace.addPropertyRequest.subscribe(tryConsume);
  }, [app]);

  /* ---- deferred focus (rows/add input exist only after the next render) ---- */

  useEffect(() => {
    const want = pendingFocusRef.current;
    if (!want) return;
    const root = rootRef.current;
    // live mode: the host container attaches to the CM DOM with the widget;
    // stay pending until connected (the block-creation edit re-renders us)
    if (!root || !root.isConnected) return;
    let el: HTMLElement | null = null;
    if (want.kind === "add") {
      el = root.querySelector<HTMLElement>('[data-testid="property-add-input"]');
    } else {
      const target = `property-value-${want.key}`;
      for (const cand of Array.from(root.querySelectorAll<HTMLElement>("input"))) {
        if (cand.dataset.testid === target) {
          el = cand;
          break;
        }
      }
    }
    if (el) {
      pendingFocusRef.current = null;
      el.focus();
    }
  });

  /* ---- type menu click-away ---- */

  useEffect(() => {
    if (menuKey === null) return;
    const close = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target || !target.closest(".property-type-wrap")) setMenuKey(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuKey]);

  /* ---- render ---- */

  const parsed = parseProperties(props.getDoc());
  if (!parsed) return null;

  return (
    <div className="properties-panel" data-testid="properties-panel" ref={rootRef}>
      <datalist id={nameListId}>
        {propertyNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id={tagListId}>
        {tagNames.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>

      {parsed.entries.map((entry, idx) => {
        if (entry.opaque) {
          return (
            <div
              className="property-row property-row-opaque"
              data-testid="property-row-opaque"
              key={`opaque-${idx}`}
              title={t("editor.propertiesOpaqueHint")}
            >
              <span className="property-opaque-raw">{(entry.raw ?? "").replace(/\n$/, "")}</span>
            </div>
          );
        }
        const assigned = propertyTypes.get(entry.key);
        const effType = effectivePropertyType(entry.key, entry.value, assigned);
        const builtin = BUILTIN_KEYS.has(entry.key.toLowerCase());
        const typeLabel = t(TYPE_LABEL_KEY[effType]);
        return (
          // "k-" prefix: a property literally named "opaque-0" must not
          // collide with the opaque rows' "opaque-<idx>" React keys
          <div className="property-row" data-testid={`property-row-${entry.key}`} key={`k-${entry.key}`}>
            <div className="property-key">
              <span
                className="property-type-wrap"
                // keyboard support (R22 review fix INT-4): Escape closes and
                // returns focus to the trigger; arrows move between items;
                // focus leaving the wrap (Tab) closes the menu
                onKeyDown={(e) => {
                  if (menuKey !== entry.key) return;
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenuKey(null);
                    e.currentTarget.querySelector<HTMLElement>(".property-type-btn")?.focus();
                  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const items = Array.from(
                      e.currentTarget.querySelectorAll<HTMLElement>(".property-type-item"),
                    );
                    if (items.length === 0) return;
                    const at = items.indexOf(document.activeElement as HTMLElement);
                    const next =
                      e.key === "ArrowDown"
                        ? items[(at + 1) % items.length]
                        : items[(at - 1 + items.length) % items.length];
                    next.focus();
                  }
                }}
                onBlur={(e) => {
                  if (
                    menuKey === entry.key &&
                    !(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))
                  ) {
                    setMenuKey(null);
                  }
                }}
              >
                <button
                  className="property-icon-btn property-type-btn"
                  type="button"
                  disabled={builtin}
                  aria-haspopup="menu"
                  aria-expanded={menuKey === entry.key}
                  aria-label={t("editor.propertyTypeAria", { type: typeLabel })}
                  title={t("editor.propertyTypeAria", { type: typeLabel })}
                  data-testid={`property-type-${entry.key}`}
                  onClick={() => setMenuKey(menuKey === entry.key ? null : entry.key)}
                >
                  <TypeIcon type={effType} />
                </button>
                {menuKey === entry.key && (
                  <div className="property-type-menu" role="menu">
                    {ALL_TYPES.map((tp) => (
                      <button
                        key={tp}
                        className={"property-type-item" + (tp === effType ? " is-active" : "")}
                        type="button"
                        role="menuitemradio"
                        aria-checked={tp === effType}
                        onClick={() => assignType(entry.key, tp)}
                      >
                        <TypeIcon type={tp} />
                        <span>{t(TYPE_LABEL_KEY[tp])}</span>
                      </button>
                    ))}
                  </div>
                )}
              </span>
              <NameInput
                keyName={entry.key}
                listId={nameListId}
                ariaLabel={t("editor.propertyNamePlaceholder")}
                rename={renameKey}
              />
            </div>
            <div className="property-value">
              <ValueEditor
                entry={entry}
                effType={effType}
                tagListId={tagListId}
                commitValue={commitValue}
              />
            </div>
            <button
              className="property-icon-btn property-delete"
              type="button"
              aria-label={t("editor.deleteProperty")}
              title={t("editor.deleteProperty")}
              data-testid={`property-delete-${entry.key}`}
              onClick={() => removeKey(entry.key)}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        );
      })}

      {adding ? (
        <div className="property-row property-row-add">
          <AddNameInput
            listId={nameListId}
            placeholder={t("editor.propertyNamePlaceholder")}
            onSubmit={submitAdd}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : (
        <button
          className="property-add"
          type="button"
          data-testid="property-add"
          onClick={() => {
            pendingFocusRef.current = { kind: "add" };
            setAdding(true);
          }}
        >
          <Icon name="plus" size={13} />
          <span>{t("editor.addProperty")}</span>
        </button>
      )}
    </div>
  );
}

/** the add-row name input — Enter/blur with a name commits `key:` (null value) */
function AddNameInput(props: {
  listId: string;
  placeholder: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <input
      className="property-input property-add-name"
      value={draft}
      list={props.listId}
      placeholder={props.placeholder}
      aria-label={props.placeholder}
      data-testid="property-add-input"
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const name = draft.trim();
          if (name) props.onSubmit(name);
          else props.onCancel();
        } else if (e.key === "Escape") {
          props.onCancel();
        }
      }}
      onBlur={() => {
        const name = draft.trim();
        if (name) props.onSubmit(name);
        else props.onCancel();
      }}
    />
  );
}
