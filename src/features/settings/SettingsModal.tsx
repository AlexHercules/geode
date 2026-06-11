import { useEffect, useRef, useState } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { hotkeyFromEvent } from "@core/commands";
import type { PluginManager, PluginSettingsSection, PluginSource } from "@core/plugins";
import { useStore } from "@core/store";
import "./settings.css";

type SectionId = "appearance" | "plugins" | "hotkeys" | "about";

const SECTIONS: Array<{ id: SectionId; label: string; icon: string }> = [
  { id: "appearance", label: "Appearance", icon: "sun" },
  { id: "plugins", label: "Plugins", icon: "puzzle" },
  { id: "hotkeys", label: "Hotkeys", icon: "command" },
  { id: "about", label: "About", icon: "book-open" },
];

export function SettingsModal() {
  const app = useApp();
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
        aria-label="Settings"
        data-testid="settings-modal"
      >
        <button
          className="settings-close"
          aria-label="Close settings"
          data-testid="settings-close"
          onClick={close}
        >
          <Icon name="x" size={16} />
        </button>

        <nav className="settings-nav" aria-label="Settings sections">
          <div className="settings-nav-title">Settings</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`settings-nav-item${section === s.id ? " is-active" : ""}`}
              data-testid={`settings-nav-${s.id}`}
              onClick={() => setSection(s.id)}
            >
              <Icon name={s.icon} size={15} />
              <span>{s.label}</span>
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
  const ws = useStore(app.workspace.state);

  return (
    <section>
      <h2 className="settings-heading">Appearance</h2>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">Theme</div>
          <div className="setting-desc">Choose the base color scheme for the app.</div>
        </div>
        <div className="settings-segmented" role="group" aria-label="Theme">
          <button
            className={ws.theme === "dark" ? "is-active" : ""}
            aria-pressed={ws.theme === "dark"}
            data-testid="settings-theme-dark"
            onClick={() => app.workspace.setTheme("dark")}
          >
            <Icon name="moon" size={13} />
            Dark
          </button>
          <button
            className={ws.theme === "light" ? "is-active" : ""}
            aria-pressed={ws.theme === "light"}
            data-testid="settings-theme-light"
            onClick={() => app.workspace.setTheme("light")}
          >
            <Icon name="sun" size={13} />
            Light
          </button>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">Editor font size</div>
          <div className="setting-desc">Font size used by the markdown editor and preview.</div>
        </div>
        <div className="settings-slider">
          <input
            type="range"
            min={11}
            max={28}
            step={1}
            value={ws.fontSize}
            aria-label="Editor font size"
            data-testid="settings-font-size"
            onChange={(e) => app.workspace.setFontSize(Number(e.target.value))}
          />
          <span className="settings-slider-value" data-testid="settings-font-size-value">
            {ws.fontSize}px
          </span>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Plugins ---------------- */

/** Badge label per plugin source ("builtin" reads as "core" in the UI). */
const SOURCE_LABEL: Record<PluginSource, string> = {
  builtin: "core",
  external: "external",
  obsidian: "obsidian",
};

function PluginsSection() {
  const app = useApp();
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
      <h2 className="settings-heading">Plugins</h2>
      <p className="settings-note">
        Built-in plugins extend Geode with commands, status bar items and more. Plugins can
        also be registered at runtime via <code>window.geode.registerPlugin</code>.
      </p>

      <div className="plugin-group-header">
        <h3 className="plugin-group-title">Built-in</h3>
      </div>
      <PluginList entries={builtin} group="builtin" />

      <div className="plugin-group-header">
        <h3 className="plugin-group-title">External</h3>
        <button
          className="plugin-reload-btn"
          data-testid="settings-reload-plugins"
          title="Re-scan .geode/plugins and reload all external plugins"
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
          Reload external plugins
        </button>
      </div>
      <p className="settings-note plugin-path-hint" data-testid="settings-plugin-path-hint">
        Drop <code>.js</code> files into <code>&lt;vault&gt;/.geode/plugins/</code> — see{" "}
        <code>docs/PLUGINS.md</code> for the authoring guide.
      </p>
      <PluginList entries={external} group="external" />

      <div className="plugin-group-header">
        <h3 className="plugin-group-title">Obsidian</h3>
      </div>
      <p className="settings-note plugin-path-hint" data-testid="settings-obsidian-path-hint">
        Obsidian community plugins from <code>&lt;vault&gt;/.obsidian/plugins/</code>, loaded
        through the compatibility layer.
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
                  <span className="plugin-source-badge plugin-source-obsidian">obsidian</span>
                  <span className="plugin-error-status">
                    {r.status === "failed" ? "failed to load" : "skipped"}
                  </span>
                </div>
                <div className="plugin-error-reason">{r.detail ?? "no detail recorded"}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeSections.length > 0 && (
        <>
          <div className="plugin-group-header">
            <h3 className="plugin-group-title">Plugin settings</h3>
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

const EMPTY_GROUP_TEXT: Record<PluginSource, string> = {
  builtin: "No built-in plugins registered.",
  external: "No external plugins found.",
  obsidian: "No Obsidian plugins found.",
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

  if (entries.length === 0) {
    return (
      <div className="settings-empty" data-testid={`settings-plugin-empty-${group}`}>
        {EMPTY_GROUP_TEXT[group]}
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
                {SOURCE_LABEL[source]}
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
            aria-label={`${enabled ? "Disable" : "Enable"} ${plugin.name}`}
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
  useStore(app.commands.revision); // re-render on (un)register and override changes
  const [filter, setFilter] = useState("");
  const [capturingId, setCapturingId] = useState<string | null>(null);

  const q = filter.trim().toLowerCase();
  const rows = app.commands
    .list()
    .filter((cmd) => !q || cmd.name.toLowerCase().includes(q) || cmd.id.toLowerCase().includes(q));

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
      <h2 className="settings-heading">Hotkeys</h2>
      <p className="settings-note">
        Click <em>Customize</em>, then press the new key combination (must include{" "}
        <code>Ctrl</code> or <code>Alt</code>, except function keys). Press{" "}
        <code>Backspace</code> to remove a binding, <code>Escape</code> to cancel.
      </p>

      <input
        className="hotkeys-filter"
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter commands…"
        spellCheck={false}
        aria-label="Filter commands"
        data-testid="settings-hotkeys-filter"
      />

      {rows.length === 0 ? (
        <div className="settings-empty" data-testid="settings-hotkeys-empty">
          No matching commands.
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
                  <div className="hotkey-name">{cmd.name}</div>
                  {conflicts.length > 0 && (
                    <div className="hotkey-conflict" data-testid={`hotkey-conflict-${cmd.id}`}>
                      Conflicts with {conflicts.map((c) => `"${c.name}"`).join(", ")}
                    </div>
                  )}
                </div>
                <div className="hotkey-controls">
                  {capturing ? (
                    <span className="hotkey-chip is-capturing">Press a key…</span>
                  ) : effective !== null ? (
                    <span className={`hotkey-chip${conflicts.length > 0 ? " has-conflict" : ""}`}>
                      {effective}
                    </span>
                  ) : (
                    <span className="hotkey-chip is-empty">Not set</span>
                  )}
                  {!capturing && app.commands.hasHotkeyOverride(cmd.id) && (
                    <button
                      className="hotkey-reset"
                      title="Restore default hotkey"
                      aria-label={`Restore default hotkey for ${cmd.name}`}
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
                    {capturing ? "Cancel" : "Customize"}
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
  return (
    <section>
      <h2 className="settings-heading">About</h2>
      <div className="about-card">
        <div className="about-logo">💎</div>
        <div className="about-title">
          Geode <span className="about-version">0.3.0</span>
        </div>
        <p className="about-desc">
          Geode is a local-first markdown knowledge base. Your notes are plain files on your
          own disk — link them with wikilinks, follow backlinks, and explore the connections
          between ideas in an interactive graph.
        </p>
        <p className="about-stack">
          Built with Tauri 2 · React 18 · TypeScript · Vite · CodeMirror 6
        </p>
      </div>
    </section>
  );
}
