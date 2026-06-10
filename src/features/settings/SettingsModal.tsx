import { useState } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useStore } from "@core/store";
import "./settings.css";

type SectionId = "appearance" | "plugins" | "about";

const SECTIONS: Array<{ id: SectionId; label: string; icon: string }> = [
  { id: "appearance", label: "Appearance", icon: "sun" },
  { id: "plugins", label: "Plugins", icon: "puzzle" },
  { id: "about", label: "About", icon: "book-open" },
];

export function SettingsModal() {
  const app = useApp();
  const [section, setSection] = useState<SectionId>("appearance");
  const close = () => app.workspace.closeModal();

  return (
    <div
      className="modal-overlay"
      data-testid="settings-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
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

function PluginsSection() {
  const app = useApp();
  useStore(app.plugins.revision); // re-render on enable/disable/register
  const entries = app.plugins.list();

  return (
    <section>
      <h2 className="settings-heading">Plugins</h2>
      <p className="settings-note">
        Built-in plugins extend Geode with commands, status bar items and more. Plugins can
        also be registered at runtime via <code>window.geode.registerPlugin</code>.
      </p>

      {entries.length === 0 ? (
        <div className="settings-empty">No plugins registered.</div>
      ) : (
        <div className="plugin-list" data-testid="settings-plugin-list">
          {entries.map(({ plugin, enabled }) => (
            <div className="plugin-item" key={plugin.id} data-testid={`plugin-item-${plugin.id}`}>
              <div className="plugin-info">
                <div className="plugin-name">
                  {plugin.name}
                  {plugin.version && <span className="plugin-version">v{plugin.version}</span>}
                </div>
                {plugin.description && <div className="plugin-desc">{plugin.description}</div>}
              </div>
              <button
                className={`settings-toggle${enabled ? " is-on" : ""}`}
                role="switch"
                aria-checked={enabled}
                aria-label={`${enabled ? "Disable" : "Enable"} ${plugin.name}`}
                data-testid={`plugin-toggle-${plugin.id}`}
                onClick={() => {
                  if (enabled) app.plugins.disable(plugin.id);
                  else void app.plugins.enable(plugin.id);
                }}
              >
                <span className="settings-toggle-thumb" />
              </button>
            </div>
          ))}
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
          Geode <span className="about-version">0.1.0</span>
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
