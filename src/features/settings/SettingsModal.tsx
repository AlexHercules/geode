import { useEffect, useRef, useState } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { getCommandName, hotkeyFromEvent } from "@core/commands";
import { locale, setLocale, useI18n, type I18nKey } from "@core/i18n";
import type { PluginManager, PluginSettingsSection, PluginSource } from "@core/plugins";
import { useStore } from "@core/store";
import "./settings.css";

type SectionId = "appearance" | "plugins" | "hotkeys" | "about";

/* labels are i18n keys, resolved at render time via useI18n() */
const SECTIONS: Array<{ id: SectionId; labelKey: I18nKey; icon: string }> = [
  { id: "appearance", labelKey: "settings.section.appearance", icon: "sun" },
  { id: "plugins", labelKey: "settings.section.plugins", icon: "puzzle" },
  { id: "hotkeys", labelKey: "settings.section.hotkeys", icon: "command" },
  { id: "about", labelKey: "settings.section.about", icon: "book-open" },
];

export function SettingsModal() {
  const app = useApp();
  const t = useI18n();
  const [section, setSection] = useState<SectionId>("appearance");
  const close = () => app.workspace.closeModal();
  const panelRef = useRef<HTMLDivElement>(null);

  /* take focus away from the editor so keystrokes don't keep editing the note behind */
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div
      className="modal-overlay"
      data-testid="settings-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="modal-panel settings-panel"
        role="dialog"
        aria-label={t("settings.title")}
        data-testid="settings-modal"
      >
        <button
          className="settings-close"
          aria-label={t("settings.close")}
          data-testid="settings-close"
          onClick={close}
        >
          <Icon name="x" size={16} />
        </button>

        <nav className="settings-nav" aria-label={t("settings.navAria")}>
          <div className="settings-nav-title">{t("settings.title")}</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`settings-nav-item${section === s.id ? " is-active" : ""}`}
              data-testid={`settings-nav-${s.id}`}
              onClick={() => setSection(s.id)}
            >
              <Icon name={s.icon} size={15} />
              <span>{t(s.labelKey)}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content" data-testid={`settings-section-${section}`}>
          {section === "appearance" && <AppearanceSection />}
          {section === "plugins" && <PluginsSection />}
          {section === "hotkeys" && <HotkeysSection />}
          {section === "about" && <AboutSection />}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Appearance ---------------- */

function AppearanceSection() {
  const app = useApp();
  const t = useI18n();
  const ws = useStore(app.workspace.state);
  const currentLocale = useStore(locale);

  return (
    <section>
      <h2 className="settings-heading">{t("settings.section.appearance")}</h2>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.theme")}</div>
          <div className="setting-desc">{t("settings.themeDesc")}</div>
        </div>
        <div className="settings-segmented" role="group" aria-label={t("settings.theme")}>
          <button
            className={ws.theme === "dark" ? "is-active" : ""}
            aria-pressed={ws.theme === "dark"}
            data-testid="settings-theme-dark"
            onClick={() => app.workspace.setTheme("dark")}
          >
            <Icon name="moon" size={13} />
            {t("settings.themeDark")}
          </button>
          <button
            className={ws.theme === "light" ? "is-active" : ""}
            aria-pressed={ws.theme === "light"}
            data-testid="settings-theme-light"
            onClick={() => app.workspace.setTheme("light")}
          >
            <Icon name="sun" size={13} />
            {t("settings.themeLight")}
          </button>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.fontSize")}</div>
          <div className="setting-desc">{t("settings.fontSizeDesc")}</div>
        </div>
        <div className="settings-slider">
          <input
            type="range"
            min={11}
            max={28}
            step={1}
            value={ws.fontSize}
            aria-label={t("settings.fontSize")}
            data-testid="settings-font-size"
            onChange={(e) => app.workspace.setFontSize(Number(e.target.value))}
          />
          <span className="settings-slider-value" data-testid="settings-font-size-value">
            {ws.fontSize}px
          </span>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.language")}</div>
          <div className="setting-desc">{t("settings.languageDesc")}</div>
        </div>
        <select
          className="settings-select"
          data-testid="settings-language"
          value={currentLocale}
          aria-label={t("settings.language")}
          onChange={(e) => setLocale(e.target.value === "zh" ? "zh" : "en")}
        >
          {/* option labels are self-named — never translated */}
          <option value="en">English</option>
          <option value="zh">中文</option>
        </select>
      </div>
    </section>
  );
}

/* ---------------- Plugins ---------------- */

/** Badge label key per plugin source ("builtin" reads as "core" in the UI). */
const SOURCE_LABEL_KEY: Record<PluginSource, I18nKey> = {
  builtin: "settings.sourceBadgeBuiltin",
  external: "settings.sourceBadgeExternal",
  obsidian: "settings.sourceBadgeObsidian",
};

function PluginsSection() {
  const app = useApp();
  const t = useI18n();
  useStore(app.plugins.revision); // re-render on enable/disable/register
  const settingsSections = useStore(app.plugins.settingsSections);
  const obsidianReport = useStore(app.obsidianLoadReport);
  const entries = app.plugins.list();
  const builtin = entries.filter((e) => e.source === "builtin");
  const external = entries.filter((e) => e.source === "external");
  const obsidian = entries.filter((e) => e.source === "obsidian");

  /* compat loader report: failed/skipped plugins never reach the registry,
     so the load report is the only place their failure reason exists */
  const obsidianIssues = obsidianReport.filter(
    (r) => r.status === "failed" || r.status === "skipped",
  );
  const obsidianWarnings = new Map(
    obsidianReport
      .filter((r) => r.minAppWarning !== undefined)
      .map((r) => [r.id, r.minAppWarning as string] as const),
  );

  /* settings sections contributed by ENABLED plugins, with the plugin name for the header */
  const enabledByid = new Map(entries.filter((e) => e.enabled).map((e) => [e.plugin.id, e.plugin]));
  const activeSections = settingsSections
    .map((section) => ({ section, plugin: enabledByid.get(section.pluginId) }))
    .filter((x): x is { section: PluginSettingsSection; plugin: (typeof entries)[number]["plugin"] } =>
      x.plugin !== undefined,
    );

  return (
    <section>
      <h2 className="settings-heading">{t("settings.section.plugins")}</h2>
      <p className="settings-note">
        {t("settings.pluginsNotePre")}
        <code>window.geode.registerPlugin</code>
        {t("settings.pluginsNotePost")}
      </p>

      <div className="plugin-group-header">
        <h3 className="plugin-group-title">{t("settings.pluginGroupBuiltin")}</h3>
      </div>
      <PluginList entries={builtin} group="builtin" />

      <div className="plugin-group-header">
        <h3 className="plugin-group-title">{t("settings.pluginGroupExternal")}</h3>
        <button
          className="plugin-reload-btn"
          data-testid="settings-reload-plugins"
          title={t("settings.reloadPluginsTitle")}
          onClick={() => void app.commands.execute("app:reload-plugins")}
        >
          {/* lucide refresh-cw (not in the shared icon set) */}
          <svg
            width={13}
            height={13}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
          {t("settings.reloadPlugins")}
        </button>
      </div>
      <p className="settings-note plugin-path-hint" data-testid="settings-plugin-path-hint">
        {t("settings.pluginPathHint1")}
        <code>.js</code>
        {t("settings.pluginPathHint2")}
        <code>&lt;vault&gt;/.geode/plugins/</code>
        {t("settings.pluginPathHint3")}
        <code>docs/PLUGINS.md</code>
        {t("settings.pluginPathHint4")}
      </p>
      <PluginList entries={external} group="external" />

      <div className="plugin-group-header">
        <h3 className="plugin-group-title">{t("settings.pluginGroupObsidian")}</h3>
      </div>
      <p className="settings-note plugin-path-hint" data-testid="settings-obsidian-path-hint">
        {t("settings.obsidianHintPre")}
        <code>&lt;vault&gt;/.obsidian/plugins/</code>
        {t("settings.obsidianHintPost")}
      </p>
      <PluginList entries={obsidian} group="obsidian" warnings={obsidianWarnings} />

      {obsidianIssues.length > 0 && (
        <div className="plugin-list plugin-error-list" data-testid="settings-obsidian-errors">
          {obsidianIssues.map((r) => (
            <div
              className="plugin-item plugin-item-error"
              key={r.id}
              data-testid={`obsidian-plugin-error-${r.id}`}
            >
              <div className="plugin-info">
                <div className="plugin-name">
                  {r.id}
                  <span className="plugin-source-badge plugin-source-obsidian">
                    {t("settings.sourceBadgeObsidian")}
                  </span>
                  <span className="plugin-error-status">
                    {r.status === "failed" ? t("settings.pluginFailed") : t("settings.pluginSkipped")}
                  </span>
                </div>
                <div className="plugin-error-reason">{r.detail ?? t("settings.pluginNoDetail")}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeSections.length > 0 && (
        <>
          <div className="plugin-group-header">
            <h3 className="plugin-group-title">{t("settings.pluginSettingsGroup")}</h3>
          </div>
          {activeSections.map(({ section, plugin }) => (
            <PluginSettingsBlock key={section.id} section={section} pluginName={plugin.name} />
          ))}
        </>
      )}
    </section>
  );
}

/** Collapsible host for one plugin-contributed settings section (compat PluginSettingTab). */
function PluginSettingsBlock({
  section,
  pluginName,
}: {
  section: PluginSettingsSection;
  pluginName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="plugin-settings-block"
      data-testid={`plugin-settings-section-${section.id}`}
    >
      <button
        className="plugin-settings-header"
        aria-expanded={open}
        data-testid={`plugin-settings-toggle-${section.id}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
        <span className="plugin-settings-title">{pluginName}</span>
        {section.name && section.name !== pluginName && (
          <span className="plugin-settings-subtitle">{section.name}</span>
        )}
      </button>
      {open && <PluginSettingsBody section={section} />}
    </div>
  );
}

/** Mounts section.mount(container) while visible; unmounts on collapse/unmount. */
function PluginSettingsBody({ section }: { section: PluginSettingsSection }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false); // guards double-mount under StrictMode
  useEffect(() => {
    const host = hostRef.current;
    if (!host || mountedRef.current) return;
    mountedRef.current = true;
    try {
      section.mount(host);
    } catch (err) {
      console.error(`[settings] plugin section ${section.id} mount threw`, err);
    }
    return () => {
      mountedRef.current = false;
      try {
        section.unmount();
      } catch (err) {
        console.error(`[settings] plugin section ${section.id} unmount threw`, err);
      }
      host.replaceChildren();
    };
  }, [section]);
  return <div ref={hostRef} className="plugin-settings-body" />;
}

const EMPTY_GROUP_KEY: Record<PluginSource, I18nKey> = {
  builtin: "settings.pluginEmptyBuiltin",
  external: "settings.pluginEmptyExternal",
  obsidian: "settings.pluginEmptyObsidian",
};

function PluginList({
  entries,
  group,
  warnings,
}: {
  entries: ReturnType<PluginManager["list"]>;
  group: PluginSource;
  /** plugin id -> manifest warning (e.g. minAppVersion exceeds apiVersion) */
  warnings?: ReadonlyMap<string, string>;
}) {
  const app = useApp();
  const t = useI18n();

  if (entries.length === 0) {
    return (
      <div className="settings-empty" data-testid={`settings-plugin-empty-${group}`}>
        {t(EMPTY_GROUP_KEY[group])}
      </div>
    );
  }

  return (
    <div className="plugin-list" data-testid={`settings-plugin-list-${group}`}>
      {entries.map(({ plugin, enabled, source }) => (
        <div className="plugin-item" key={plugin.id} data-testid={`plugin-item-${plugin.id}`}>
          <div className="plugin-info">
            <div className="plugin-name">
              {plugin.name}
              {plugin.version && <span className="plugin-version">v{plugin.version}</span>}
              <span
                className={`plugin-source-badge plugin-source-${source}`}
                data-testid="plugin-source-badge"
              >
                {t(SOURCE_LABEL_KEY[source])}
              </span>
            </div>
            {plugin.description && <div className="plugin-desc">{plugin.description}</div>}
            {warnings?.has(plugin.id) && (
              <div
                className="plugin-warning"
                data-testid={`plugin-minapp-warning-${plugin.id}`}
              >
                {warnings.get(plugin.id)}
              </div>
            )}
          </div>
          <button
            className={`settings-toggle${enabled ? " is-on" : ""}`}
            role="switch"
            aria-checked={enabled}
            aria-label={t(enabled ? "settings.disablePlugin" : "settings.enablePlugin", {
              name: plugin.name,
            })}
            data-testid={`plugin-toggle-${plugin.id}`}
            onClick={() => {
              if (enabled) app.plugins.disable(plugin.id);
              else void app.plugins.enable(plugin.id, { userAction: true });
            }}
          >
            <span className="settings-toggle-thumb" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Hotkeys ---------------- */

function HotkeysSection() {
  const app = useApp();
  const t = useI18n();
  useStore(app.commands.revision); // re-render on (un)register and override changes
  const [filter, setFilter] = useState("");
  const [capturingId, setCapturingId] = useState<string | null>(null);

  const q = filter.trim().toLowerCase();
  const rows = app.commands
    .list()
    .filter(
      (cmd) =>
        !q ||
        getCommandName(cmd).toLowerCase().includes(q) ||
        cmd.id.toLowerCase().includes(q),
    );

  /* CAPTURE mode: a window-level capture-phase listener grabs the next keydown
     before the global hotkey handler and the modal's Escape-to-close (both
     bubble-phase on window) can react to it. */
  useEffect(() => {
    if (capturingId === null) return;
    const id = capturingId;
    const onKeydown = (e: KeyboardEvent) => {
      // a captured chord must never trigger commands or close the settings modal
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        setCapturingId(null); // cancel — keep the current binding
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        app.commands.setHotkeyOverride(id, null); // explicitly unbound
        setCapturingId(null);
        return;
      }
      // hotkeyFromEvent (core) rejects chords that must not bind — modifier-only,
      // Meta combos, bare printable keys (they would swallow normal typing),
      // a literal "+" — by returning null: keep waiting for a real chord. It
      // also normalizes shifted punctuation to the physical base character so
      // the candidate compares equal to default bindings ("Ctrl+Shift+\").
      const candidate = hotkeyFromEvent(e);
      if (candidate === null) return;
      app.commands.setHotkeyOverride(id, candidate);
      setCapturingId(null);
    };
    window.addEventListener("keydown", onKeydown, true);
    return () => window.removeEventListener("keydown", onKeydown, true);
  }, [app, capturingId]);

  return (
    <section>
      <h2 className="settings-heading">{t("settings.section.hotkeys")}</h2>
      <p className="settings-note">
        {t("settings.hotkeysNote1")}
        <em>{t("settings.customize")}</em>
        {t("settings.hotkeysNote2")}
        <code>Ctrl</code>
        {t("settings.hotkeysNote3")}
        <code>Alt</code>
        {t("settings.hotkeysNote4")}
        <code>Backspace</code>
        {t("settings.hotkeysNote5")}
        <code>Escape</code>
        {t("settings.hotkeysNote6")}
      </p>

      <input
        className="hotkeys-filter"
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t("settings.hotkeysFilter")}
        spellCheck={false}
        aria-label={t("settings.hotkeysFilter")}
        data-testid="settings-hotkeys-filter"
      />

      {rows.length === 0 ? (
        <div className="settings-empty" data-testid="settings-hotkeys-empty">
          {t("settings.hotkeysEmpty")}
        </div>
      ) : (
        <div className="hotkey-list">
          {rows.map((cmd) => {
            const effective = app.commands.getEffectiveHotkey(cmd.id);
            const capturing = capturingId === cmd.id;
            /* re-derived every render: after a conflicting save BOTH rows show the badge */
            const conflicts =
              effective !== null ? app.commands.findHotkeyConflicts(effective, cmd.id) : [];
            return (
              <div className="hotkey-row" key={cmd.id} data-testid={`hotkey-row-${cmd.id}`}>
                <div className="hotkey-info">
                  <div className="hotkey-name">{getCommandName(cmd)}</div>
                  {conflicts.length > 0 && (
                    <div className="hotkey-conflict" data-testid={`hotkey-conflict-${cmd.id}`}>
                      {t("settings.hotkeyConflict", {
                        names: conflicts.map((c) => `"${getCommandName(c)}"`).join(", "),
                      })}
                    </div>
                  )}
                </div>
                <div className="hotkey-controls">
                  {capturing ? (
                    <span className="hotkey-chip is-capturing">{t("settings.hotkeyCapture")}</span>
                  ) : effective !== null ? (
                    <span className={`hotkey-chip${conflicts.length > 0 ? " has-conflict" : ""}`}>
                      {effective}
                    </span>
                  ) : (
                    <span className="hotkey-chip is-empty">{t("settings.hotkeyNotSet")}</span>
                  )}
                  {!capturing && app.commands.hasHotkeyOverride(cmd.id) && (
                    <button
                      className="hotkey-reset"
                      title={t("settings.hotkeyResetTitle")}
                      aria-label={t("settings.hotkeyResetAria", { name: getCommandName(cmd) })}
                      data-testid={`hotkey-reset-${cmd.id}`}
                      onClick={() => app.commands.clearHotkeyOverride(cmd.id)}
                    >
                      <Icon name="corner-up-left" size={12} />
                    </button>
                  )}
                  <button
                    className={`hotkey-edit${capturing ? " is-capturing" : ""}`}
                    data-testid={`hotkey-edit-${cmd.id}`}
                    onClick={() => setCapturingId(capturing ? null : cmd.id)}
                  >
                    {capturing ? t("settings.cancel") : t("settings.customize")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ---------------- About ---------------- */

function AboutSection() {
  const t = useI18n();
  return (
    <section>
      <h2 className="settings-heading">{t("settings.section.about")}</h2>
      <div className="about-card">
        <div className="about-logo">💎</div>
        <div className="about-title">
          Geode <span className="about-version">0.8.0</span>
        </div>
        <p className="about-desc">{t("settings.aboutDesc")}</p>
        <p className="about-stack">{t("settings.aboutStack")}</p>
      </div>
    </section>
  );
}
