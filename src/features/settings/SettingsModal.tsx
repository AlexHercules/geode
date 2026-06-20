import { useEffect, useRef, useState } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import {
  readableLineLength,
  setReadableLineLength,
  spellcheckEnabled,
  setSpellcheckEnabled,
  strictLineBreaks,
  setStrictLineBreaks,
  showLineNumbers,
  setShowLineNumbers,
  defaultNewTabMode,
  setDefaultNewTabMode,
  tabIndentSize,
  setTabIndentSize,
  indentUsingTabs,
  setIndentUsingTabs,
  showInlineTitle,
  setShowInlineTitle,
  showRibbon,
  setShowRibbon,
  showTabTitleBar,
  setShowTabTitleBar,
  showStatusBar,
  setShowStatusBar,
  accentColor,
  setAccentColor,
  interfaceFont,
  setInterfaceFont,
  textFont,
  setTextFont,
  monospaceFont,
  setMonospaceFont,
} from "@core/appearance";
import { excludedRaw, setExcludedFiles } from "@core/excludedFiles";
import { attachmentFolder, setAttachmentFolder } from "@core/attachments";
import {
  newNoteLocation,
  setNewNoteLocation,
  newNoteFolder,
  setNewNoteFolder,
} from "@core/newNote";
import {
  dailyNoteFolder,
  dailyNoteFormat,
  dailyNoteTemplate,
  setDailyNoteFolder,
  setDailyNoteFormat,
  setDailyNoteTemplate,
} from "@core/dailyNote";
import {
  uniqueNoteFolder,
  uniqueNoteFormat,
  uniqueNoteTemplate,
  setUniqueNoteFolder,
  setUniqueNoteFormat,
  setUniqueNoteTemplate,
} from "@core/uniqueNote";
import { getCommandName, hotkeyFromEvent, formatHotkey, isMacPlatform } from "@core/commands";
import { loadPinnedCommands, setPinnedCommands } from "@core/commandMru";
import {
  pagePreviewEnabled,
  pagePreviewRequireModifier,
  setPagePreviewEnabled,
  setPagePreviewRequireModifier,
} from "@core/hover";
import { locale, setLocale, useI18n, type I18nKey } from "@core/i18n";
import { autoUpdateLinks, setAutoUpdateLinks } from "@core/linkRewrite";
import {
  linkPathFormat,
  linkUseMarkdown,
  setLinkPathFormat,
  setLinkUseMarkdown,
} from "@core/linkFormat";
import {
  getPluginDescription,
  getPluginName,
  type PluginManager,
  type PluginSettingsSection,
  type PluginSource,
} from "@core/plugins";
import { useStore } from "@core/store";
import {
  setTemplateDateFormat,
  setTemplateFolder,
  setTemplateTimeFormat,
  templateDateFormat,
  templateFolder,
  templateTimeFormat,
} from "@core/templates";
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  updateSupported,
  type UpdateInfo,
} from "@core/update";
import "./settings.css";

/** Current app version — single source for the About card and the update row. */
const APP_VERSION = "0.145.0";

type SectionId = "appearance" | "plugins" | "hotkeys" | "command-palette" | "about";

/**
 * Set by the `app:check-updates` command right before it opens the settings
 * modal: the modal then opens on the About section and the update area runs
 * one check automatically. Module-level on purpose — the command fires before
 * the modal component exists.
 */
let pendingAutoCheck = false;

export function requestUpdateAutoCheck(): void {
  pendingAutoCheck = true;
}

/* labels are i18n keys, resolved at render time via useI18n() */
const SECTIONS: Array<{ id: SectionId; labelKey: I18nKey; icon: string }> = [
  { id: "appearance", labelKey: "settings.section.appearance", icon: "sun" },
  { id: "plugins", labelKey: "settings.section.plugins", icon: "puzzle" },
  { id: "hotkeys", labelKey: "settings.section.hotkeys", icon: "command" },
  { id: "command-palette", labelKey: "settings.section.commandPalette", icon: "pin" },
  { id: "about", labelKey: "settings.section.about", icon: "book-open" },
];

export function SettingsModal() {
  const app = useApp();
  const t = useI18n();
  /* peek (don't consume) the auto-check flag — UpdateSection consumes it on mount */
  const [section, setSection] = useState<SectionId>(pendingAutoCheck ? "about" : "appearance");
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
          {section === "command-palette" && <CommandPaletteSection />}
          {section === "about" && <AboutSection />}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Appearance ---------------- */

/** The theme's current `--accent` (a 6-digit hex) for the color picker's
 *  no-override swatch. Falls back only if the var is unreadable/non-hex. */
function readCssAccent(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v : "#8b7cf6";
  } catch {
    return "#8b7cf6";
  }
}

function AppearanceSection() {
  const app = useApp();
  const t = useI18n();
  const ws = useStore(app.workspace.state);
  const currentLocale = useStore(locale);
  /* R50: appearance toggles — readable line length + editor spellcheck */
  const readable = useStore(readableLineLength);
  const spell = useStore(spellcheckEnabled);
  const strict = useStore(strictLineBreaks);
  const lineNo = useStore(showLineNumbers);
  const newTabMode = useStore(defaultNewTabMode);
  /* R92: editor indentation — indent using tabs + tab indent size */
  const useTabs = useStore(indentUsingTabs);
  const indentSize = useStore(tabIndentSize);
  /* R94: interface — show inline title + show ribbon */
  const inlineTitle = useStore(showInlineTitle);
  const ribbon = useStore(showRibbon);
  /* R100: interface — show tab title bar + show status bar */
  const tabTitleBar = useStore(showTabTitleBar);
  const statusBar = useStore(showStatusBar);
  /* R96: excluded files (search/graph/explorer filter) */
  const excluded = useStore(excludedRaw);
  const accent = useStore(accentColor);
  // the <input type=color> needs a literal hex; with no override, reflect the
  // theme's actual --accent (read live) rather than hardcoding a color value.
  const accentSwatch = accent || readCssAccent();
  /* R85: font families (interface / text / monospace) — "" = theme default */
  const iFont = useStore(interfaceFont);
  const tFont = useStore(textFont);
  const mFont = useStore(monospaceFont);
  const autoUpdate = useStore(autoUpdateLinks);
  const useMdLinks = useStore(linkUseMarkdown);
  const linkPath = useStore(linkPathFormat);
  const attachFolder = useStore(attachmentFolder);
  /* R89: default location for new notes */
  const newNoteLoc = useStore(newNoteLocation);
  const newNoteFolderVal = useStore(newNoteFolder);
  /* R23: templates — stored verbatim (no trim), consumers trim (R17 precedent) */
  const tplFolder = useStore(templateFolder);
  const tplDateFormat = useStore(templateDateFormat);
  const tplTimeFormat = useStore(templateTimeFormat);
  /* R48: daily notes — folder / date format / template, stored verbatim (R17/R23 precedent) */
  const dailyFolder = useStore(dailyNoteFolder);
  const dailyFormat = useStore(dailyNoteFormat);
  const dailyTemplate = useStore(dailyNoteTemplate);
  /* R53: unique note creator — folder / prefix format / template, stored verbatim */
  const uniqueFolder = useStore(uniqueNoteFolder);
  const uniqueFormat = useStore(uniqueNoteFormat);
  const uniqueTemplate = useStore(uniqueNoteTemplate);
  /* R22: in-document properties display (visible | hidden | source) */
  const propsDisplay = useStore(app.workspace.propertiesInDocument);
  /* R25: page preview (hover) — settings Stores from core/hover */
  const pagePreview = useStore(pagePreviewEnabled);
  const pagePreviewModifier = useStore(pagePreviewRequireModifier);
  /* R20: Obsidian CSS compat — via the AppContext handle (features never import @compat) */
  const obsidianCss = useStore(app.obsidianCss.state);
  const obsidianEnabled = obsidianCss.enabled;
  const activeThemeListed =
    obsidianCss.activeTheme === "" ||
    obsidianCss.themes.some((th) => th.dir === obsidianCss.activeTheme);

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
          <button
            className={ws.theme === "system" ? "is-active" : ""}
            aria-pressed={ws.theme === "system"}
            data-testid="settings-theme-system"
            onClick={() => app.workspace.setTheme("system")}
          >
            <Icon name="monitor" size={13} />
            {t("settings.themeSystem")}
          </button>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.accentColor")}</div>
          <div className="setting-desc">{t("settings.accentColorDesc")}</div>
        </div>
        <div className="settings-accent">
          <input
            type="color"
            className="settings-accent-input"
            value={accentSwatch}
            aria-label={t("settings.accentColor")}
            data-testid="settings-accent-color"
            onChange={(e) => setAccentColor(e.target.value)}
          />
          <button
            type="button"
            className="settings-accent-reset"
            data-testid="settings-accent-reset"
            onClick={() => setAccentColor("")}
          >
            {t("settings.accentReset")}
          </button>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.interfaceFont")}</div>
          <div className="setting-desc">{t("settings.interfaceFontDesc")}</div>
        </div>
        <input
          type="text"
          className="settings-text-input"
          value={iFont}
          placeholder={t("settings.fontDefault")}
          aria-label={t("settings.interfaceFont")}
          data-testid="settings-font-interface"
          onChange={(e) => setInterfaceFont(e.target.value)}
        />
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.textFont")}</div>
          <div className="setting-desc">{t("settings.textFontDesc")}</div>
        </div>
        <input
          type="text"
          className="settings-text-input"
          value={tFont}
          placeholder={t("settings.fontDefault")}
          aria-label={t("settings.textFont")}
          data-testid="settings-font-text"
          onChange={(e) => setTextFont(e.target.value)}
        />
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.monospaceFont")}</div>
          <div className="setting-desc">{t("settings.monospaceFontDesc")}</div>
        </div>
        <input
          type="text"
          className="settings-text-input"
          value={mFont}
          placeholder={t("settings.fontDefault")}
          aria-label={t("settings.monospaceFont")}
          data-testid="settings-font-monospace"
          onChange={(e) => setMonospaceFont(e.target.value)}
        />
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

      {/* R50: readable line length — caps the body column width (default ON) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.readableLineLength")}</div>
        </div>
        <button
          className={`settings-toggle${readable ? " is-on" : ""}`}
          role="switch"
          aria-checked={readable}
          aria-label={t("settings.readableLineLength")}
          data-testid="settings-readable-toggle"
          onClick={() => setReadableLineLength(!readable)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      {/* R50: editor spellcheck (browser squiggles on the CM contentDOM, default OFF) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.spellcheck")}</div>
        </div>
        <button
          className={`settings-toggle${spell ? " is-on" : ""}`}
          role="switch"
          aria-checked={spell}
          aria-label={t("settings.spellcheck")}
          data-testid="settings-spellcheck-toggle"
          onClick={() => setSpellcheckEnabled(!spell)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      {/* R87: strict line breaks (reading view); OFF = single newline → <br> (Obsidian default) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.strictLineBreaks")}</div>
          <div className="setting-desc">{t("settings.strictLineBreaksDesc")}</div>
        </div>
        <button
          className={`settings-toggle${strict ? " is-on" : ""}`}
          role="switch"
          aria-checked={strict}
          aria-label={t("settings.strictLineBreaks")}
          data-testid="settings-strict-linebreaks-toggle"
          onClick={() => setStrictLineBreaks(!strict)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      {/* R94: show inline title (filename as H1 atop the note, default ON) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.showInlineTitle")}</div>
          <div className="setting-desc">{t("settings.showInlineTitleDesc")}</div>
        </div>
        <button
          className={`settings-toggle${inlineTitle ? " is-on" : ""}`}
          role="switch"
          aria-checked={inlineTitle}
          aria-label={t("settings.showInlineTitle")}
          data-testid="settings-inline-title-toggle"
          onClick={() => setShowInlineTitle(!inlineTitle)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      {/* R94: show the left ribbon (default ON) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.showRibbon")}</div>
          <div className="setting-desc">{t("settings.showRibbonDesc")}</div>
        </div>
        <button
          className={`settings-toggle${ribbon ? " is-on" : ""}`}
          role="switch"
          aria-checked={ribbon}
          aria-label={t("settings.showRibbon")}
          data-testid="settings-ribbon-toggle"
          onClick={() => setShowRibbon(!ribbon)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      {/* R100: show tab title bar (default ON) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.showTabTitleBar")}</div>
          <div className="setting-desc">{t("settings.showTabTitleBarDesc")}</div>
        </div>
        <button
          className={`settings-toggle${tabTitleBar ? " is-on" : ""}`}
          role="switch"
          aria-checked={tabTitleBar}
          aria-label={t("settings.showTabTitleBar")}
          data-testid="settings-tab-title-bar-toggle"
          onClick={() => setShowTabTitleBar(!tabTitleBar)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      {/* R100: show the bottom status bar (default ON) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.showStatusBar")}</div>
          <div className="setting-desc">{t("settings.showStatusBarDesc")}</div>
        </div>
        <button
          className={`settings-toggle${statusBar ? " is-on" : ""}`}
          role="switch"
          aria-checked={statusBar}
          aria-label={t("settings.showStatusBar")}
          data-testid="settings-status-bar-toggle"
          onClick={() => setShowStatusBar(!statusBar)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      {/* R88: show line-number gutter in the editor (default OFF) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.showLineNumbers")}</div>
        </div>
        <button
          className={`settings-toggle${lineNo ? " is-on" : ""}`}
          role="switch"
          aria-checked={lineNo}
          aria-label={t("settings.showLineNumbers")}
          data-testid="settings-line-numbers-toggle"
          onClick={() => setShowLineNumbers(!lineNo)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      {/* R88: default mode a new markdown tab opens in (reading / live / source) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.defaultNewTabMode")}</div>
          <div className="setting-desc">{t("settings.defaultNewTabModeDesc")}</div>
        </div>
        <div className="settings-segmented" role="group" aria-label={t("settings.defaultNewTabMode")}>
          <button
            className={newTabMode === "preview" ? "is-active" : ""}
            aria-pressed={newTabMode === "preview"}
            data-testid="settings-newtab-reading"
            onClick={() => setDefaultNewTabMode("preview")}
          >
            {t("settings.modeReading")}
          </button>
          <button
            className={newTabMode === "live" ? "is-active" : ""}
            aria-pressed={newTabMode === "live"}
            data-testid="settings-newtab-live"
            onClick={() => setDefaultNewTabMode("live")}
          >
            {t("settings.modeLive")}
          </button>
          <button
            className={newTabMode === "source" ? "is-active" : ""}
            aria-pressed={newTabMode === "source"}
            data-testid="settings-newtab-source"
            onClick={() => setDefaultNewTabMode("source")}
          >
            {t("settings.modeSource")}
          </button>
        </div>
      </div>

      {/* R92: indent using tabs (default ON = Obsidian) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.indentUsingTabs")}</div>
          <div className="setting-desc">{t("settings.indentUsingTabsDesc")}</div>
        </div>
        <button
          className={`settings-toggle${useTabs ? " is-on" : ""}`}
          role="switch"
          aria-checked={useTabs}
          aria-label={t("settings.indentUsingTabs")}
          data-testid="settings-indent-tabs-toggle"
          onClick={() => setIndentUsingTabs(!useTabs)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      {/* R92: tab indent size (default 4 = Obsidian) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.tabIndentSize")}</div>
          <div className="setting-desc">{t("settings.tabIndentSizeDesc")}</div>
        </div>
        <div className="settings-segmented" role="group" aria-label={t("settings.tabIndentSize")}>
          {[2, 4, 8].map((n) => (
            <button
              key={n}
              className={indentSize === n ? "is-active" : ""}
              aria-pressed={indentSize === n}
              data-testid={`settings-tabsize-${n}`}
              onClick={() => setTabIndentSize(n)}
            >
              {n}
            </button>
          ))}
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

      {/* ---- Obsidian CSS compat (R20) ---- */}

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.obsidianCss")}</div>
          <div className="setting-desc">{t("settings.obsidianCssDesc")}</div>
        </div>
        <button
          className={`settings-toggle${obsidianEnabled ? " is-on" : ""}`}
          role="switch"
          aria-checked={obsidianEnabled}
          aria-label={t("settings.obsidianCss")}
          data-testid="obsidian-css-toggle"
          onClick={() =>
            void app.obsidianCss
              .setEnabled(!obsidianEnabled)
              .catch((err) => console.warn("[settings] obsidian css toggle failed", err))
          }
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.obsidianTheme")}</div>
          <div className="setting-desc">{t("settings.obsidianThemeDesc")}</div>
        </div>
        <select
          className="settings-select"
          data-testid="obsidian-theme-select"
          value={obsidianCss.activeTheme}
          aria-label={t("settings.obsidianTheme")}
          disabled={!obsidianEnabled}
          aria-disabled={!obsidianEnabled}
          onChange={(e) =>
            void app.obsidianCss
              .setTheme(e.target.value)
              .catch((err) => console.warn("[settings] obsidian theme change failed", err))
          }
        >
          <option value="">{t("settings.obsidianThemeNone")}</option>
          {obsidianCss.themes.map((th) => (
            <option key={th.dir} value={th.dir}>
              {th.name}
            </option>
          ))}
          {/* active theme missing from the discovery list (e.g. files deleted):
              still shown so the persisted value stays visible (Obsidian口径) */}
          {!activeThemeListed && (
            <option value={obsidianCss.activeTheme}>{obsidianCss.activeTheme}</option>
          )}
        </select>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.obsidianSnippets")}</div>
          <div className="setting-desc">{t("settings.obsidianSnippetsDesc")}</div>
        </div>
      </div>
      {obsidianCss.snippets.length === 0 ? (
        <div className="setting-item" data-testid="obsidian-snippets-empty">
          <div className="setting-info">
            <div className="setting-desc">{t("settings.obsidianSnippetsEmpty")}</div>
          </div>
        </div>
      ) : (
        obsidianCss.snippets.map((sn) => (
          <div className="setting-item" key={sn.name}>
            <div className="setting-info">
              <div className="setting-name">{sn.name}</div>
            </div>
            <button
              className={`settings-toggle${sn.enabled ? " is-on" : ""}`}
              role="switch"
              aria-checked={sn.enabled}
              aria-label={sn.name}
              disabled={!obsidianEnabled}
              aria-disabled={!obsidianEnabled}
              data-testid={`obsidian-snippet-toggle-${sn.name}`}
              onClick={() => {
                void app.obsidianCss
                  .setSnippet(sn.name, !sn.enabled)
                  .catch((err) => console.warn("[settings] obsidian snippet toggle failed", err));
              }}
            >
              <span className="settings-toggle-thumb" />
            </button>
          </div>
        ))
      )}

      <h2 className="settings-heading">{t("settings.editorHeading")}</h2>

      {/* ---- R22: in-document properties display ---- */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.propertiesDisplay")}</div>
          <div className="setting-desc">{t("settings.propertiesDisplayDesc")}</div>
        </div>
        <select
          className="settings-select"
          data-testid="settings-properties-display"
          value={propsDisplay}
          aria-label={t("settings.propertiesDisplay")}
          onChange={(e) =>
            app.workspace.setPropertiesInDocument(
              e.target.value === "hidden" ? "hidden" : e.target.value === "source" ? "source" : "visible",
            )
          }
        >
          <option value="visible">{t("settings.propertiesVisible")}</option>
          <option value="hidden">{t("settings.propertiesHidden")}</option>
          <option value="source">{t("settings.propertiesSource")}</option>
        </select>
      </div>

      {/* ---- R25: page preview (hover) ---- */}
      <h2 className="settings-heading">{t("settings.pagePreviewHeading")}</h2>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.pagePreview")}</div>
          <div className="setting-desc">{t("settings.pagePreviewDesc")}</div>
        </div>
        <button
          className={`settings-toggle${pagePreview ? " is-on" : ""}`}
          role="switch"
          aria-checked={pagePreview}
          aria-label={t("settings.pagePreview")}
          data-testid="settings-page-preview"
          onClick={() => setPagePreviewEnabled(!pagePreview)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.pagePreviewModifier")}</div>
          <div className="setting-desc">{t("settings.pagePreviewModifierDesc")}</div>
        </div>
        <button
          className={`settings-toggle${pagePreviewModifier ? " is-on" : ""}`}
          role="switch"
          aria-checked={pagePreviewModifier}
          aria-label={t("settings.pagePreviewModifier")}
          data-testid="settings-page-preview-modifier"
          onClick={() => setPagePreviewRequireModifier(!pagePreviewModifier)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      <h2 className="settings-heading">{t("settings.filesAndLinks")}</h2>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.autoUpdateLinks")}</div>
          <div className="setting-desc">{t("settings.autoUpdateLinksDesc")}</div>
        </div>
        <button
          className={`settings-toggle${autoUpdate ? " is-on" : ""}`}
          role="switch"
          aria-checked={autoUpdate}
          aria-label={t("settings.autoUpdateLinks")}
          data-testid="settings-auto-update-links"
          onClick={() => setAutoUpdateLinks(!autoUpdate)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      {/* ---- R72 (㉞-c): new-link format ---- */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.linkUseMarkdown")}</div>
          <div className="setting-desc">{t("settings.linkUseMarkdownDesc")}</div>
        </div>
        <button
          className={`settings-toggle${useMdLinks ? " is-on" : ""}`}
          role="switch"
          aria-checked={useMdLinks}
          aria-label={t("settings.linkUseMarkdown")}
          data-testid="settings-link-use-markdown"
          onClick={() => setLinkUseMarkdown(!useMdLinks)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.linkPathFormat")}</div>
          <div className="setting-desc">{t("settings.linkPathFormatDesc")}</div>
        </div>
        <select
          className="settings-select"
          data-testid="settings-link-path-format"
          value={linkPath}
          aria-label={t("settings.linkPathFormat")}
          onChange={(e) =>
            setLinkPathFormat(
              e.target.value === "relative" ? "relative" : e.target.value === "absolute" ? "absolute" : "shortest",
            )
          }
        >
          <option value="shortest">{t("settings.linkPathShortest")}</option>
          <option value="relative">{t("settings.linkPathRelative")}</option>
          <option value="absolute">{t("settings.linkPathAbsolute")}</option>
        </select>
      </div>

      {/* R89: default location for new notes (root / current folder / specified) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.newNoteLocation")}</div>
          <div className="setting-desc">{t("settings.newNoteLocationDesc")}</div>
        </div>
        <div className="settings-segmented" role="group" aria-label={t("settings.newNoteLocation")}>
          <button
            className={newNoteLoc === "root" ? "is-active" : ""}
            aria-pressed={newNoteLoc === "root"}
            data-testid="settings-newnote-root"
            onClick={() => setNewNoteLocation("root")}
          >
            {t("settings.newNoteLocationRoot")}
          </button>
          <button
            className={newNoteLoc === "current" ? "is-active" : ""}
            aria-pressed={newNoteLoc === "current"}
            data-testid="settings-newnote-current"
            onClick={() => setNewNoteLocation("current")}
          >
            {t("settings.newNoteLocationCurrent")}
          </button>
          <button
            className={newNoteLoc === "folder" ? "is-active" : ""}
            aria-pressed={newNoteLoc === "folder"}
            data-testid="settings-newnote-folder"
            onClick={() => setNewNoteLocation("folder")}
          >
            {t("settings.newNoteLocationFolder")}
          </button>
        </div>
      </div>
      {newNoteLoc === "folder" && (
        <div className="setting-item">
          <div className="setting-info">
            <div className="setting-name">{t("settings.newNoteFolder")}</div>
          </div>
          <input
            className="settings-text-input"
            type="text"
            value={newNoteFolderVal}
            placeholder="Notes"
            spellCheck={false}
            aria-label={t("settings.newNoteFolder")}
            data-testid="settings-newnote-folder-path"
            onChange={(e) => setNewNoteFolder(e.target.value)}
          />
        </div>
      )}

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.attachmentFolder")}</div>
          <div className="setting-desc">{t("settings.attachmentFolderDesc")}</div>
        </div>
        <input
          className="settings-text-input"
          type="text"
          value={attachFolder}
          placeholder="assets"
          spellCheck={false}
          aria-label={t("settings.attachmentFolder")}
          data-testid="settings-attachment-folder"
          onChange={(e) => setAttachmentFolder(e.target.value)}
        />
      </div>

      {/* R96: excluded files — patterns hidden from search/graph + dimmed in the tree */}
      <div className="setting-item setting-item-stacked">
        <div className="setting-info">
          <div className="setting-name">{t("settings.excludedFiles")}</div>
          <div className="setting-desc">{t("settings.excludedFilesDesc")}</div>
        </div>
        <textarea
          className="settings-textarea"
          value={excluded}
          rows={3}
          placeholder={"Archive/\n*.png\n{regex}^drafts/"}
          spellCheck={false}
          aria-label={t("settings.excludedFiles")}
          data-testid="settings-excluded-files"
          onChange={(e) => setExcludedFiles(e.target.value)}
        />
      </div>

      <h2 className="settings-heading">{t("settings.templates")}</h2>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.templateFolder")}</div>
        </div>
        <input
          className="settings-text-input"
          type="text"
          value={tplFolder}
          placeholder="templates"
          spellCheck={false}
          aria-label={t("settings.templateFolder")}
          data-testid="settings-template-folder"
          onChange={(e) => setTemplateFolder(e.target.value)}
        />
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.templateDateFormat")}</div>
        </div>
        <input
          className="settings-text-input"
          type="text"
          value={tplDateFormat}
          placeholder="YYYY-MM-DD"
          spellCheck={false}
          aria-label={t("settings.templateDateFormat")}
          data-testid="settings-template-date-format"
          onChange={(e) => setTemplateDateFormat(e.target.value)}
        />
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.templateTimeFormat")}</div>
        </div>
        <input
          className="settings-text-input"
          type="text"
          value={tplTimeFormat}
          placeholder="HH:mm"
          spellCheck={false}
          aria-label={t("settings.templateTimeFormat")}
          data-testid="settings-template-time-format"
          onChange={(e) => setTemplateTimeFormat(e.target.value)}
        />
      </div>

      <h2 className="settings-heading">{t("settings.dailyNotes")}</h2>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.dailyNoteFolder")}</div>
        </div>
        <input
          className="settings-text-input"
          type="text"
          value={dailyFolder}
          placeholder="Daily Notes"
          spellCheck={false}
          aria-label={t("settings.dailyNoteFolder")}
          data-testid="settings-daily-folder"
          onChange={(e) => setDailyNoteFolder(e.target.value)}
        />
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.dailyNoteFormat")}</div>
        </div>
        <input
          className="settings-text-input"
          type="text"
          value={dailyFormat}
          placeholder="YYYY-MM-DD"
          spellCheck={false}
          aria-label={t("settings.dailyNoteFormat")}
          data-testid="settings-daily-format"
          onChange={(e) => setDailyNoteFormat(e.target.value)}
        />
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.dailyNoteTemplate")}</div>
        </div>
        <input
          className="settings-text-input"
          type="text"
          value={dailyTemplate}
          placeholder=""
          spellCheck={false}
          aria-label={t("settings.dailyNoteTemplate")}
          data-testid="settings-daily-template"
          onChange={(e) => setDailyNoteTemplate(e.target.value)}
        />
      </div>

      <h2 className="settings-heading">{t("settings.uniqueNotes")}</h2>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.uniqueNoteFolder")}</div>
        </div>
        <input
          className="settings-text-input"
          type="text"
          value={uniqueFolder}
          placeholder="/"
          spellCheck={false}
          aria-label={t("settings.uniqueNoteFolder")}
          data-testid="settings-unique-folder"
          onChange={(e) => setUniqueNoteFolder(e.target.value)}
        />
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.uniqueNoteFormat")}</div>
        </div>
        <input
          className="settings-text-input"
          type="text"
          value={uniqueFormat}
          placeholder="YYYYMMDDHHmmss"
          spellCheck={false}
          aria-label={t("settings.uniqueNoteFormat")}
          data-testid="settings-unique-format"
          onChange={(e) => setUniqueNoteFormat(e.target.value)}
        />
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.uniqueNoteTemplate")}</div>
        </div>
        <input
          className="settings-text-input"
          type="text"
          value={uniqueTemplate}
          placeholder=""
          spellCheck={false}
          aria-label={t("settings.uniqueNoteTemplate")}
          data-testid="settings-unique-template"
          onChange={(e) => setUniqueNoteTemplate(e.target.value)}
        />
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
            <PluginSettingsBlock key={section.id} section={section} pluginName={getPluginName(plugin)} />
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
      {entries.map(({ plugin, enabled, source }) => {
        const description = getPluginDescription(plugin);
        return (
        <div className="plugin-item" key={plugin.id} data-testid={`plugin-item-${plugin.id}`}>
          <div className="plugin-info">
            <div className="plugin-name">
              {getPluginName(plugin)}
              {plugin.version && <span className="plugin-version">v{plugin.version}</span>}
              <span
                className={`plugin-source-badge plugin-source-${source}`}
                data-testid="plugin-source-badge"
              >
                {t(SOURCE_LABEL_KEY[source])}
              </span>
            </div>
            {description && <div className="plugin-desc">{description}</div>}
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
              name: getPluginName(plugin),
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
        );
      })}
    </div>
  );
}

/* ---------------- Hotkeys ---------------- */

function HotkeysSection() {
  const app = useApp();
  const t = useI18n();
  useStore(app.commands.revision); // re-render on (un)register and override changes
  const [filter, setFilter] = useState("");
  // R145: Obsidian's "filter icon" — show only commands with an assigned hotkey.
  // Per-mount session state (resets on reopen), like the text filter above it.
  const [assignedOnly, setAssignedOnly] = useState(false);
  const [capturingId, setCapturingId] = useState<string | null>(null);

  const q = filter.trim().toLowerCase();
  const rows = app.commands
    .list()
    .filter(
      (cmd) =>
        (!q ||
          getCommandName(cmd).toLowerCase().includes(q) ||
          cmd.id.toLowerCase().includes(q)) &&
        (!assignedOnly || app.commands.getEffectiveHotkey(cmd.id) !== null),
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
        <code>{isMacPlatform ? "⌘" : "Ctrl"}</code>
        {t("settings.hotkeysNote3")}
        <code>{isMacPlatform ? "⌥" : "Alt"}</code>
        {t("settings.hotkeysNote4")}
        <code>Backspace</code>
        {t("settings.hotkeysNote5")}
        <code>Escape</code>
        {t("settings.hotkeysNote6")}
      </p>

      <div className="hotkeys-filter-row">
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
        <button
          className={"hotkeys-filter-toggle" + (assignedOnly ? " is-active" : "")}
          onClick={() => setAssignedOnly((v) => !v)}
          aria-pressed={assignedOnly}
          aria-label={t("settings.hotkeysAssignedOnly")}
          title={t("settings.hotkeysAssignedOnly")}
          data-testid="settings-hotkeys-assigned-toggle"
        >
          <Icon name="filter" size={15} />
        </button>
      </div>

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
                      {formatHotkey(effective)}
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

/* ---------------- Command palette ---------------- */

/** Faithful to Obsidian's "Settings → Command palette": pin commands (shown at the top of the
 *  palette on an empty query) via a "Select a command" picker, and unpin them from a list. Pure
 *  per-vault localStorage UI (R142) — no vault writes. */
function CommandPaletteSection() {
  const app = useApp();
  const t = useI18n();
  useStore(app.commands.revision); // re-render on (un)register so the picker stays current
  const vault = app.vault.vaultName;
  const [pins, setPins] = useState<string[]>(() => loadPinnedCommands(vault));
  const [addQuery, setAddQuery] = useState("");

  const writePins = (next: string[]) => {
    setPins(next);
    setPinnedCommands(vault, next);
  };
  const pin = (id: string) => {
    if (!pins.includes(id)) writePins([...pins, id]);
    setAddQuery("");
  };
  const unpin = (id: string) => writePins(pins.filter((p) => p !== id));

  const pinnedSet = new Set(pins);
  /* pinned rows in pin order, resolving each id to its live command (skip unregistered ids) */
  const pinnedRows = pins
    .map((id) => app.commands.list().find((cmd) => cmd.id === id))
    .filter((cmd): cmd is NonNullable<typeof cmd> => cmd !== undefined);

  /* picker: unpinned commands matching the query (substring, capped) — only while typing */
  const q = addQuery.trim().toLowerCase();
  const candidates = q
    ? app.commands
        .list()
        .filter(
          (cmd) =>
            !pinnedSet.has(cmd.id) &&
            (getCommandName(cmd).toLowerCase().includes(q) || cmd.id.toLowerCase().includes(q)),
        )
        .slice(0, 50)
    : [];

  return (
    <section>
      <h2 className="settings-heading">{t("settings.section.commandPalette")}</h2>
      <p className="settings-note">{t("settings.cmdPalette.note")}</p>

      <div className="cmdpalette-add">
        <label className="cmdpalette-add-label">{t("settings.cmdPalette.newPinned")}</label>
        <input
          className="cmdpalette-add-input"
          type="text"
          value={addQuery}
          onChange={(e) => setAddQuery(e.target.value)}
          placeholder={t("settings.cmdPalette.selectCommand")}
          spellCheck={false}
          aria-label={t("settings.cmdPalette.selectCommand")}
          data-testid="cmdpalette-add-input"
        />
        {q && (
          <div className="cmdpalette-add-list" role="listbox">
            {candidates.length === 0 ? (
              <div className="cmdpalette-add-empty">{t("settings.cmdPalette.noMatch")}</div>
            ) : (
              candidates.map((cmd) => (
                <button
                  key={cmd.id}
                  className="cmdpalette-add-item"
                  role="option"
                  data-id={cmd.id}
                  data-testid="cmdpalette-add-item"
                  onClick={() => pin(cmd.id)}
                >
                  {getCommandName(cmd)}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <h3 className="cmdpalette-pinned-heading">{t("settings.cmdPalette.pinnedHeading")}</h3>
      {pinnedRows.length === 0 ? (
        <div className="settings-empty" data-testid="cmdpalette-pinned-empty">
          {t("settings.cmdPalette.empty")}
        </div>
      ) : (
        <div className="cmdpalette-pinned-list">
          {pinnedRows.map((cmd) => (
            <div
              className="cmdpalette-pinned-row"
              key={cmd.id}
              data-testid={`cmdpalette-pinned-row-${cmd.id}`}
            >
              <span className="cmdpalette-pinned-name">{getCommandName(cmd)}</span>
              <button
                className="cmdpalette-unpin"
                title={t("settings.cmdPalette.unpin")}
                aria-label={t("settings.cmdPalette.unpin")}
                data-testid={`cmdpalette-unpin-${cmd.id}`}
                onClick={() => unpin(cmd.id)}
              >
                <Icon name="x" size={14} />
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
  const t = useI18n();
  return (
    <section>
      <h2 className="settings-heading">{t("settings.section.about")}</h2>
      {updateSupported() && <UpdateSection />}
      <div className="about-card">
        <div className="about-logo">💎</div>
        <div className="about-title">
          Geode <span className="about-version">{APP_VERSION}</span>
        </div>
        <p className="about-desc">{t("settings.aboutDesc")}</p>
        <p className="about-stack">{t("settings.aboutStack")}</p>
      </div>
    </section>
  );
}

/* ---------------- Updates (desktop only) ---------------- */

type UpdatePhase = "idle" | "checking" | "none" | "available" | "downloading" | "installing";

interface UpdateProgressState {
  downloaded: number;
  contentLength: number | null;
}

interface UpdateErrorState {
  stage: "check" | "install";
  /** full error text — shown verbatim inside the localized wrapper */
  message: string;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(n / 1024))} KB`;
}

/**
 * Update area at the top of the About section. Rendered only when
 * updateSupported(). State machine: idle→checking→(none|available)→
 * downloading→installing. Unmounting does NOT cancel a download (the plugin
 * cannot cancel); reopening the modal degrades the button back to idle —
 * known limitation per the R9 contract.
 */
function UpdateSection() {
  const t = useI18n();
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateProgressState | null>(null);
  const [error, setError] = useState<UpdateErrorState | null>(null);
  /* drop state updates from promises that settle after unmount */
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const runCheck = async () => {
    setError(null);
    setInfo(null);
    setPhase("checking");
    try {
      const result = await checkForUpdate();
      if (!aliveRef.current) return;
      if (result !== null) {
        setInfo(result);
        setPhase("available");
      } else {
        setPhase("none");
      }
    } catch (err) {
      if (!aliveRef.current) return;
      setError({ stage: "check", message: errorText(err) });
      setPhase("idle");
    }
  };

  const runInstall = async () => {
    setError(null);
    setProgress(null);
    setPhase("downloading");
    try {
      await downloadAndInstallUpdate((p) => {
        if (!aliveRef.current) return;
        if (p.kind === "finished") setPhase("installing");
        else setProgress({ downloaded: p.kind === "progress" ? p.downloaded : 0, contentLength: p.contentLength });
      });
      // on success relaunch() exits the app — nothing to do here
    } catch (err) {
      if (!aliveRef.current) return;
      setError({ stage: "install", message: errorText(err) });
      setPhase("available"); // keep the install button so the user can retry
    }
  };

  /* the app:check-updates command requested an automatic check on open */
  useEffect(() => {
    if (pendingAutoCheck) {
      pendingAutoCheck = false;
      void runCheck();
    }
    // mount-only: consume the command flag exactly once per modal open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progressLabel =
    phase === "installing"
      ? t("settings.update.installing")
      : progress?.contentLength != null && progress.contentLength > 0
        ? t("settings.update.downloadingPct", {
            pct: Math.min(100, Math.round((progress.downloaded / progress.contentLength) * 100)),
          })
        : t("settings.update.downloadingBytes", {
            size: formatBytes(progress?.downloaded ?? 0),
          });

  return (
    <div className="update-section" data-testid="settings-update-section">
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.update.title")}</div>
          <div className="setting-desc">
            {t("settings.update.currentVersion", { version: APP_VERSION })}
          </div>
        </div>
        <button
          className="update-check-btn"
          data-testid="settings-check-updates"
          disabled={phase === "checking" || phase === "downloading" || phase === "installing"}
          onClick={() => void runCheck()}
        >
          {phase === "checking" ? t("settings.update.checking") : t("settings.update.check")}
        </button>
      </div>

      {phase === "none" && (
        <div className="update-status" data-testid="settings-update-status">
          {t("settings.update.upToDate")}
        </div>
      )}

      {info !== null && (phase === "available" || phase === "downloading" || phase === "installing") && (
        <div className="update-available">
          <div className="update-available-info">
            <div className="update-available-version">
              {t("settings.update.available", { version: info.version })}
            </div>
            {info.body && <p className="update-notes">{info.body}</p>}
          </div>
          {phase === "available" ? (
            <button
              className="update-install-btn"
              data-testid="settings-install-update"
              onClick={() => void runInstall()}
            >
              {t("settings.update.installRestart")}
            </button>
          ) : (
            <div className="update-progress" data-testid="settings-update-progress">
              <span className="update-progress-label">{progressLabel}</span>
              <div className="update-progress-track" aria-hidden="true">
                <div
                  className={`update-progress-fill${
                    phase === "installing" || progress?.contentLength == null
                      ? " is-indeterminate"
                      : ""
                  }`}
                  style={
                    phase !== "installing" && progress?.contentLength != null && progress.contentLength > 0
                      ? {
                          width: `${Math.min(
                            100,
                            (progress.downloaded / progress.contentLength) * 100,
                          )}%`,
                        }
                      : undefined
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}

      {error !== null && (
        <div className="update-error" data-testid="settings-update-error">
          {t(
            error.stage === "check"
              ? "settings.update.checkFailed"
              : "settings.update.installFailed",
            { error: error.message },
          )}
        </div>
      )}
    </div>
  );
}
