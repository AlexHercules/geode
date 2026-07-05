import { useEffect, useRef, useState } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { confirmAction } from "@core/confirm";
import {
  readableLineLength,
  setReadableLineLength,
  spellcheckEnabled,
  setSpellcheckEnabled,
  strictLineBreaks,
  setStrictLineBreaks,
  showViewModeToggle,
  setShowViewModeToggle,
  focusNewTab,
  setFocusNewTab,
  switcherShowExistingOnly,
  setSwitcherShowExistingOnly,
  switcherShowAttachments,
  setSwitcherShowAttachments,
  switcherShowAllTypes,
  setSwitcherShowAllTypes,
  showLineNumbers,
  setShowLineNumbers,
  hideReferenceMarks,
  setHideReferenceMarks,
  rightToLeft,
  setRightToLeft,
  quickFontZoom,
  setQuickFontZoom,
  autoPairBrackets,
  setAutoPairBrackets,
  autoPairMarkdown,
  setAutoPairMarkdown,
  smartLists,
  setSmartLists,
  vimMode,
  setVimMode,
  showBacklinksInDocument,
  setShowBacklinksInDocument,
  detectAllExtensions,
  setDetectAllExtensions,
  foldHeading,
  setFoldHeading,
  defaultNewTabMode,
  setDefaultNewTabMode,
  defaultEditMode,
  setDefaultEditMode,
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
  extractReplaceMode,
  setExtractReplaceMode,
  type ExtractReplaceMode,
  mergeConfirm,
  setMergeConfirm,
  deleteConfirm,
  setDeleteConfirm,
  attachmentDeleteMode,
  setAttachmentDeleteMode,
  type AttachmentDeleteMode,
  extractTemplatePath,
  setExtractTemplatePath,
} from "@core/appearance";
import { excludedRaw, setExcludedFiles } from "@core/excludedFiles";
import {
  attachmentFolder,
  setAttachmentFolder,
  decodeAttachmentMode,
  encodeAttachmentMode,
  coerceAttachmentMode,
  type AttachmentMode,
} from "@core/attachments";
import {
  newNoteLocation,
  setNewNoteLocation,
  newNoteFolder,
  setNewNoteFolder,
} from "@core/newNote";
import { uriLinksEnabled, setUriLinksEnabled } from "@core/obsidianUri";
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
import { getCommandName, hotkeyFromEvent, formatHotkey } from "@core/commands";
import { loadPinnedCommands, setPinnedCommands } from "@core/commandMru";
import {
  pagePreviewEnabled,
  pagePreviewRequireModifier,
  setPagePreviewEnabled,
  setPagePreviewRequireModifier,
} from "@core/hover";
import { locale, setLocale, useI18n, type I18nKey } from "@core/i18n";
import type { ThemeKind, Command } from "@core/types";
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
// exported (R217) so app:show-debug-info reuses the same constant — no 4th version hardcode.
export const APP_VERSION = "0.276.0";

type SectionId =
  | "about"
  | "editor"
  | "files-and-links"
  | "appearance"
  | "hotkeys"
  | "keychain"
  | "core-plugins"
  | "plugins"
  | "command-palette"
  | "quick-switcher"
  | "note-composer"
  | "templates"
  | "daily-notes"
  | "unique-notes"
  | "page-preview";

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

/* G1: three-group left-nav IA (Obsidian "Options" / "Core plugins" + per-plugin tabs).
   labels are i18n keys, resolved at render time via useI18n(). */
const NAV_GROUPS: Array<{
  titleKey: I18nKey;
  testid: string;
  items: Array<{ id: SectionId; labelKey: I18nKey; icon: string }>;
}> = [
  {
    titleKey: "settings.navGroup.options",
    testid: "settings-navgroup-options",
    items: [
      { id: "about", labelKey: "settings.section.about", icon: "book-open" },
      { id: "editor", labelKey: "settings.editorHeading", icon: "file-text" },
      { id: "files-and-links", labelKey: "settings.filesAndLinks", icon: "file-text" },
      { id: "appearance", labelKey: "settings.section.appearance", icon: "sun" },
      { id: "hotkeys", labelKey: "settings.section.hotkeys", icon: "command" },
      { id: "keychain", labelKey: "settings.section.keychain", icon: "key" },
      { id: "core-plugins", labelKey: "settings.section.corePlugins", icon: "puzzle" },
      { id: "plugins", labelKey: "settings.section.plugins", icon: "puzzle" },
    ],
  },
  {
    titleKey: "settings.navGroup.corePlugins",
    testid: "settings-navgroup-core-plugins",
    items: [
      { id: "command-palette", labelKey: "settings.section.commandPalette", icon: "pin" },
      { id: "quick-switcher", labelKey: "settings.section.quickSwitcher", icon: "search" },
      { id: "note-composer", labelKey: "settings.section.noteComposer", icon: "files" },
      { id: "templates", labelKey: "settings.templates", icon: "file-text" },
      { id: "daily-notes", labelKey: "settings.dailyNotes", icon: "file-text" },
      { id: "unique-notes", labelKey: "settings.uniqueNotes", icon: "file-text" },
      { id: "page-preview", labelKey: "settings.pagePreviewHeading", icon: "file-text" },
    ],
  },
];

export function SettingsModal() {
  const app = useApp();
  const t = useI18n();
  /* peek (don't consume) the auto-check flag — UpdateSection consumes it on mount */
  // R163: section is a string — fixed ids (SectionId) OR `plugin:<sectionId>` for
  // a per-plugin settings tab (Obsidian "one plugin, one tab" left-nav IA).
  const [section, setSection] = useState<string>(pendingAutoCheck ? "about" : "appearance");
  const close = () => app.workspace.closeModal();
  const panelRef = useRef<HTMLDivElement>(null);

  /* R163: enabled plugins that contribute a settings section → one left-nav tab each */
  useStore(app.plugins.revision); // re-render on enable/disable/register
  const settingsSections = useStore(app.plugins.settingsSections);
  const enabledPluginIds = new Set(
    app.plugins.list().filter((e) => e.enabled).map((e) => e.plugin.id),
  );
  const pluginTabs = settingsSections.filter((s) => enabledPluginIds.has(s.pluginId));
  const pluginTab = pluginTabs.find((s) => `plugin:${s.id}` === section);

  /* take focus away from the editor so keystrokes don't keep editing the note behind */
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  /* if the open plugin tab's plugin gets disabled/uninstalled, fall back to Plugins */
  useEffect(() => {
    if (section.startsWith("plugin:") && pluginTab === undefined) setSection("plugins");
  }, [section, pluginTab]);

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
          {/* G1: each fixed nav group renders a sub-title then its items */}
          {NAV_GROUPS.map((group) => (
            <div key={group.testid}>
              <div className="settings-nav-title settings-nav-subtitle" data-testid={group.testid}>
                {t(group.titleKey)}
              </div>
              {group.items.map((s) => (
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
            </div>
          ))}
          {/* R163: one left-nav entry per enabled plugin's settings tab */}
          {pluginTabs.length > 0 && (
            <>
              <div className="settings-nav-title settings-nav-subtitle">
                {t("settings.pluginSettingsGroup")}
              </div>
              {pluginTabs.map((s) => (
                <button
                  key={s.id}
                  className={`settings-nav-item${section === `plugin:${s.id}` ? " is-active" : ""}`}
                  data-testid={`settings-nav-plugin-${s.id}`}
                  onClick={() => setSection(`plugin:${s.id}`)}
                >
                  <Icon name="puzzle" size={15} />
                  <span>{s.name}</span>
                </button>
              ))}
            </>
          )}
        </nav>

        <div className="settings-content" data-testid={`settings-section-${section}`}>
          {section === "about" && <AboutSection />}
          {section === "editor" && <EditorSection />}
          {section === "files-and-links" && <FilesAndLinksSection />}
          {section === "appearance" && <AppearanceSection />}
          {section === "hotkeys" && <HotkeysSection />}
          {section === "keychain" && <KeychainSection />}
          {section === "core-plugins" && <CorePluginsSection setSection={setSection} />}
          {section === "plugins" && <PluginsSection setSection={setSection} />}
          {section === "command-palette" && <CommandPaletteSection />}
          {section === "quick-switcher" && <QuickSwitcherSection />}
          {section === "note-composer" && <NoteComposerSection />}
          {section === "templates" && <TemplatesSection />}
          {section === "daily-notes" && <DailyNotesSection />}
          {section === "unique-notes" && <UniqueNotesSection />}
          {section === "page-preview" && <PagePreviewSection />}
          {/* R163: per-plugin settings tab (Obsidian "one plugin, one tab") */}
          {pluginTab && (
            <section>
              <h2 className="settings-heading">{pluginTab.name}</h2>
              <PluginSettingsBody key={pluginTab.id} section={pluginTab} />
            </section>
          )}
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
  const quickZoom = useStore(quickFontZoom);
  /* R94: interface — show inline title + show ribbon */
  const inlineTitle = useStore(showInlineTitle);
  const ribbon = useStore(showRibbon);
  /* R100: interface — show tab title bar + show status bar */
  const tabTitleBar = useStore(showTabTitleBar);
  const statusBar = useStore(showStatusBar);
  const accent = useStore(accentColor);
  // the <input type=color> needs a literal hex; with no override, reflect the
  // theme's actual --accent (read live) rather than hardcoding a color value.
  const accentSwatch = accent || readCssAccent();
  /* R85: font families (interface / text / monospace) — "" = theme default */
  const iFont = useStore(interfaceFont);
  const tFont = useStore(textFont);
  const mFont = useStore(monospaceFont);
  /* R20: Obsidian CSS compat — via the AppContext handle (features never import @compat) */
  const obsidianCss = useStore(app.obsidianCss.state);
  const obsidianEnabled = obsidianCss.enabled;
  const activeThemeListed =
    obsidianCss.activeTheme === "" ||
    obsidianCss.themes.some((th) => th.dir === obsidianCss.activeTheme);

  return (
    <section>
      <h2 className="settings-heading">{t("settings.section.appearance")}</h2>

      <div className="settings-card">
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.baseColor")}</div>
          <div className="setting-desc">{t("settings.baseColorDesc")}</div>
        </div>
        {/* G2: Obsidian「基础颜色方案」is a dropdown (跟随系统/浅色/深色), not segmented */}
        <select
          className="settings-select"
          value={ws.theme}
          aria-label={t("settings.theme")}
          data-testid="settings-theme-select"
          onChange={(e) => app.workspace.setTheme(e.target.value as ThemeKind)}
        >
          <option value="system">{t("settings.themeSystem")}</option>
          <option value="light">{t("settings.themeLight")}</option>
          <option value="dark">{t("settings.themeDark")}</option>
        </select>
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
          <div className="setting-name">{t("settings.theme")}</div>
          <div className="setting-desc">{t("settings.themeManageDesc")}</div>
        </div>
        <div className="settings-control-group">
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
            <option value="">{t("settings.obsidianThemeDefault")}</option>
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
          <button
            className="settings-action-btn is-primary"
            type="button"
            disabled
            aria-disabled
            title={t("settings.themeManageDesc")}
            data-testid="settings-theme-manage"
          >
            {t("settings.manage")}
          </button>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.installedThemes")}</div>
          <div className="setting-desc">{t("settings.installedThemesCount", { count: obsidianCss.themes.length })}</div>
        </div>
      </div>
      </div>

      <h3 className="settings-subheader" data-testid="settings-subheader-interface">{t("settings.subheaderInterface")}</h3>
      <div className="settings-card">

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
      </div>

      <h3 className="settings-subheader" data-testid="settings-subheader-fonts">{t("settings.subheaderFonts")}</h3>
      <div className="settings-card">

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

      {/* R227: quick font size adjustment — Ctrl/Cmd + scroll changes the font size (default OFF) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.quickFontZoom")}</div>
          <div className="setting-desc">{t("settings.quickFontZoomDesc")}</div>
        </div>
        <button
          className={`settings-toggle${quickZoom ? " is-on" : ""}`}
          role="switch"
          aria-checked={quickZoom}
          aria-label={t("settings.quickFontZoom")}
          data-testid="settings-quick-font-zoom-toggle"
          onClick={() => setQuickFontZoom(!quickZoom)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>
      </div>

      <h3 className="settings-subheader" data-testid="settings-subheader-appearance-advanced">{t("settings.subheaderAdvanced")}</h3>
      <div className="settings-card">
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
      </div>

    </section>
  );
}

/* ---------------- Editor ---------------- */

function EditorSection() {
  const app = useApp();
  const t = useI18n();
  /* R50: appearance toggles — readable line length + editor spellcheck */
  const readable = useStore(readableLineLength);
  const spell = useStore(spellcheckEnabled);
  const strict = useStore(strictLineBreaks);
  const viewModeToggle = useStore(showViewModeToggle);
  const focusNew = useStore(focusNewTab);
  const lineNo = useStore(showLineNumbers);
  const hideRefMarks = useStore(hideReferenceMarks);
  const rtl = useStore(rightToLeft);
  const autoPair = useStore(autoPairBrackets);
  const autoPairMd = useStore(autoPairMarkdown);
  const smartList = useStore(smartLists);
  const vim = useStore(vimMode);
  const backlinksInDoc = useStore(showBacklinksInDocument);
  const foldH = useStore(foldHeading);
  const newTabMode = useStore(defaultNewTabMode);
  const editMode = useStore(defaultEditMode);
  /* R92: editor indentation — indent using tabs + tab indent size */
  const useTabs = useStore(indentUsingTabs);
  const indentSize = useStore(tabIndentSize);
  /* R22: in-document properties display (visible | hidden | source) */
  const propsDisplay = useStore(app.workspace.propertiesInDocument);

  return (
    <section>
      <h2 className="settings-heading">{t("settings.editorHeading")}</h2>

      {/* R233: always focus new tabs — switch to a file opened in a new tab (Obsidian "Always focus new tabs", default ON) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.focusNewTab")}</div>
          <div className="setting-desc">{t("settings.focusNewTabDesc")}</div>
        </div>
        <button
          className={`settings-toggle${focusNew ? " is-on" : ""}`}
          role="switch"
          aria-checked={focusNew}
          aria-label={t("settings.focusNewTab")}
          data-testid="settings-focus-new-tab-toggle"
          onClick={() => setFocusNewTab(!focusNew)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      {/* R272: Obsidian splits this into two orthogonal dropdowns (reference 01-编辑器-01):
          「默认视图模式」editing/reading × 「默认编辑模式」live/source — not one 3-way control.
          The combined `defaultNewTabMode` stays the single source of truth consumed by
          workspace.openFile; these dropdowns read/write it + the remembered `defaultEditMode`,
          so the edit-mode choice survives switching the view to Reading (R272). */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.defaultNewTabMode")}</div>
          <div className="setting-desc">{t("settings.defaultNewTabModeDesc")}</div>
        </div>
        <select
          className="settings-select"
          data-testid="settings-newtab-view"
          value={newTabMode === "preview" ? "read" : "edit"}
          aria-label={t("settings.defaultNewTabMode")}
          onChange={(e) => setDefaultNewTabMode(e.target.value === "read" ? "preview" : editMode)}
        >
          <option value="edit">{t("settings.viewEditing")}</option>
          <option value="read">{t("settings.viewReading")}</option>
        </select>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.defaultEditMode")}</div>
          <div className="setting-desc">{t("settings.defaultEditModeDesc")}</div>
        </div>
        <select
          className="settings-select"
          data-testid="settings-newtab-editmode"
          value={editMode}
          aria-label={t("settings.defaultEditMode")}
          onChange={(e) => {
            const m = e.target.value === "source" ? "source" : "live";
            setDefaultEditMode(m);
            // when already in editing view, the combined value follows the edit-mode change
            if (newTabMode !== "preview") setDefaultNewTabMode(m);
          }}
        >
          <option value="live">{t("settings.modeLive")}</option>
          <option value="source">{t("settings.modeSource")}</option>
        </select>
      </div>

      {/* R229: show the edit/read view-mode toggle button on each tab (default ON) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.showViewModeToggle")}</div>
          <div className="setting-desc">{t("settings.showViewModeToggleDesc")}</div>
        </div>
        <button
          className={`settings-toggle${viewModeToggle ? " is-on" : ""}`}
          role="switch"
          aria-checked={viewModeToggle}
          aria-label={t("settings.showViewModeToggle")}
          data-testid="settings-view-mode-toggle"
          onClick={() => setShowViewModeToggle(!viewModeToggle)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      <h3 className="settings-subheader" data-testid="settings-subheader-display">{t("settings.subheaderDisplay")}</h3>

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

      {/* R156: allow folding heading sections (Obsidian "Fold heading", default ON) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.foldHeading")}</div>
          <div className="setting-desc">{t("settings.foldHeadingDesc")}</div>
        </div>
        <button
          className={`settings-toggle${foldH ? " is-on" : ""}`}
          role="switch"
          aria-checked={foldH}
          aria-label={t("settings.foldHeading")}
          data-testid="settings-fold-heading-toggle"
          onClick={() => setFoldHeading(!foldH)}
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

      {/* R224: hide reference marks — live preview reveals syntax only at cursor (default ON) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.hideReferenceMarks")}</div>
          <div className="setting-desc">{t("settings.hideReferenceMarksDesc")}</div>
        </div>
        <button
          className={`settings-toggle${hideRefMarks ? " is-on" : ""}`}
          role="switch"
          aria-checked={hideRefMarks}
          aria-label={t("settings.hideReferenceMarks")}
          data-testid="settings-hide-reference-marks-toggle"
          onClick={() => setHideReferenceMarks(!hideRefMarks)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      {/* R226: right-to-left — default editor + reading view text direction (default OFF) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.rightToLeft")}</div>
          <div className="setting-desc">{t("settings.rightToLeftDesc")}</div>
        </div>
        <button
          className={`settings-toggle${rtl ? " is-on" : ""}`}
          role="switch"
          aria-checked={rtl}
          aria-label={t("settings.rightToLeft")}
          data-testid="settings-rtl-toggle"
          onClick={() => setRightToLeft(!rtl)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      {/* R154: show linked mentions at the bottom of the note (Obsidian "Backlink in
          document", default OFF) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.backlinksInDocument")}</div>
          <div className="setting-desc">{t("settings.backlinksInDocumentDesc")}</div>
        </div>
        <button
          className={`settings-toggle${backlinksInDoc ? " is-on" : ""}`}
          role="switch"
          aria-checked={backlinksInDoc}
          aria-label={t("settings.backlinksInDocument")}
          data-testid="settings-backlinks-indoc-toggle"
          onClick={() => setShowBacklinksInDocument(!backlinksInDoc)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      <h3 className="settings-subheader" data-testid="settings-subheader-behavior">{t("settings.subheaderBehavior")}</h3>

      {/* R50: editor spellcheck (browser squiggles on the CM contentDOM, default ON) */}
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

      {/* R153: auto-pair brackets while typing (Obsidian "Auto pair brackets", default ON) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.autoPairBrackets")}</div>
          <div className="setting-desc">{t("settings.autoPairBracketsDesc")}</div>
        </div>
        <button
          className={`settings-toggle${autoPair ? " is-on" : ""}`}
          role="switch"
          aria-checked={autoPair}
          aria-label={t("settings.autoPairBrackets")}
          data-testid="settings-autopair-toggle"
          onClick={() => setAutoPairBrackets(!autoPair)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      {/* R225: auto-pair Markdown syntax while typing (Obsidian "Auto pair Markdown syntax", default ON) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.autoPairMarkdown")}</div>
          <div className="setting-desc">{t("settings.autoPairMarkdownDesc")}</div>
        </div>
        <button
          className={`settings-toggle${autoPairMd ? " is-on" : ""}`}
          role="switch"
          aria-checked={autoPairMd}
          aria-label={t("settings.autoPairMarkdown")}
          data-testid="settings-autopair-markdown-toggle"
          onClick={() => setAutoPairMarkdown(!autoPairMd)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      {/* R232: Smart lists — auto indentation and list item placement (Obsidian "Smart lists", default ON) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.smartLists")}</div>
          <div className="setting-desc">{t("settings.smartListsDesc")}</div>
        </div>
        <button
          className={`settings-toggle${smartList ? " is-on" : ""}`}
          role="switch"
          aria-checked={smartList}
          aria-label={t("settings.smartLists")}
          data-testid="settings-smart-lists-toggle"
          onClick={() => setSmartLists(!smartList)}
        >
          <span className="settings-toggle-thumb" />
        </button>
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
        {/* R271: Obsidian renders 制表符宽度 as a 1–8 slider (reference 01-编辑器-02), not a
            segmented control — match the form (setTabIndentSize already clamps to 1–8). */}
        <div className="settings-slider">
          <input
            type="range"
            min={1}
            max={8}
            step={1}
            value={indentSize}
            aria-label={t("settings.tabIndentSize")}
            data-testid="settings-tab-indent-size"
            onChange={(e) => setTabIndentSize(Number(e.target.value))}
          />
          <span className="settings-slider-value" data-testid="settings-tab-indent-size-value">
            {indentSize}
          </span>
        </div>
      </div>

      <h3 className="settings-subheader" data-testid="settings-subheader-editor-advanced">{t("settings.subheaderAdvanced")}</h3>

      {/* R253: Vim key bindings — @replit/codemirror-vim in the editor (Obsidian "Vim 模式", Editor › Advanced per reference/01-编辑器.md, default OFF) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.vimMode")}</div>
          <div className="setting-desc">{t("settings.vimModeDesc")}</div>
        </div>
        <button
          className={`settings-toggle${vim ? " is-on" : ""}`}
          role="switch"
          aria-checked={vim}
          aria-label={t("settings.vimMode")}
          data-testid="settings-vim-mode-toggle"
          onClick={() => setVimMode(!vim)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>
    </section>
  );
}

/* ---------------- Files & links ---------------- */

function FilesAndLinksSection() {
  const app = useApp();
  const t = useI18n();
  const detectExt = useStore(detectAllExtensions);
  const autoUpdate = useStore(autoUpdateLinks);
  const askDelete = useStore(deleteConfirm);
  const attachMode = useStore(attachmentDeleteMode);
  const useMdLinks = useStore(linkUseMarkdown);
  const linkPath = useStore(linkPathFormat);
  /* R89: default location for new notes */
  const newNoteLoc = useStore(newNoteLocation);
  const newNoteFolderVal = useStore(newNoteFolder);
  /* R273: attachment folder location — Obsidian renders this as a dropdown
     (root / specified / current / subfolder) + a conditional path input, where
     the mode is encoded into the single attachmentFolder string. Hold the mode +
     path in local state (seeded fresh on mount — the section remounts per open)
     so clearing the path field doesn't visibly collapse the dropdown to another
     mode. */
  const [attachLoc, setAttachLoc] = useState(() => decodeAttachmentMode(attachmentFolder.get()));
  const applyAttachLoc = (mode: AttachmentMode, path: string): void => {
    setAttachLoc({ mode, path });
    setAttachmentFolder(encodeAttachmentMode(mode, path));
  };
  /* R96: excluded files (search/graph/explorer filter) */
  const excluded = useStore(excludedRaw);
  /* R275: enable obsidian:// URI in-app routing (Files & Links → Advanced). */
  const uriLinks = useStore(uriLinksEnabled);

  return (
    <section>
      <h2 className="settings-heading">{t("settings.filesAndLinks")}</h2>

      {/* R89: default location for new notes (root / current folder / specified) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.newNoteLocation")}</div>
          <div className="setting-desc">{t("settings.newNoteLocationDesc")}</div>
        </div>
        {/* R271: Obsidian renders 新建笔记的存放位置 as a dropdown (reference 02-文件与链接-01),
            not a segmented control — match the form (same root/current/folder values + setter). */}
        <select
          className="settings-select"
          data-testid="settings-newnote-location"
          value={newNoteLoc}
          aria-label={t("settings.newNoteLocation")}
          onChange={(e) =>
            setNewNoteLocation(e.target.value === "current" ? "current" : e.target.value === "folder" ? "folder" : "root")
          }
        >
          <option value="root">{t("settings.newNoteLocationRoot")}</option>
          <option value="current">{t("settings.newNoteLocationCurrent")}</option>
          <option value="folder">{t("settings.newNoteLocationFolder")}</option>
        </select>
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

      {/* R273: Obsidian renders 附件默认存放路径 as a dropdown (reference 02-文件与链接-01);
          Geode preserves the existing "assets" default and encodes the mode into the single attachmentFolder string. */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.attachmentFolder")}</div>
          <div className="setting-desc">{t("settings.attachmentFolderDesc")}</div>
        </div>
        <select
          className="settings-select"
          data-testid="settings-attachment-folder"
          value={attachLoc.mode}
          aria-label={t("settings.attachmentFolder")}
          onChange={(e) => applyAttachLoc(coerceAttachmentMode(e.target.value), attachLoc.path)}
        >
          <option value="root">{t("settings.attachmentLocationRoot")}</option>
          <option value="specified">{t("settings.attachmentLocationSpecified")}</option>
          <option value="current">{t("settings.attachmentLocationCurrent")}</option>
          <option value="subfolder">{t("settings.attachmentLocationSubfolder")}</option>
        </select>
      </div>
      {(attachLoc.mode === "specified" || attachLoc.mode === "subfolder") && (
        <div className="setting-item">
          <div className="setting-info">
            <div className="setting-name">{t("settings.attachmentFolderPath")}</div>
          </div>
          <input
            className="settings-text-input"
            type="text"
            value={attachLoc.path}
            placeholder="assets"
            spellCheck={false}
            aria-label={t("settings.attachmentFolderPath")}
            data-testid="settings-attachment-folder-path"
            onChange={(e) => applyAttachLoc(attachLoc.mode, e.target.value)}
          />
        </div>
      )}

      <h3 className="settings-subheader" data-testid="settings-subheader-links">{t("settings.subheaderLinks")}</h3>

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

      {/* R155: show every file's extension in the explorer, incl .md (Obsidian "Detect all
          file extensions", default OFF) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.detectAllExtensions")}</div>
          <div className="setting-desc">{t("settings.detectAllExtensionsDesc")}</div>
        </div>
        <button
          className={`settings-toggle${detectExt ? " is-on" : ""}`}
          role="switch"
          aria-checked={detectExt}
          aria-label={t("settings.detectAllExtensions")}
          data-testid="settings-detect-extensions-toggle"
          onClick={() => setDetectAllExtensions(!detectExt)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      <h3 className="settings-subheader" data-testid="settings-subheader-trash">{t("settings.subheaderTrash")}</h3>

      {/* R242: confirm before deleting a file (Obsidian "Confirm file deletion", Trash group).
          Default ON for safety; OFF = Obsidian-faithful no-confirm (delete still → recoverable .trash). */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.deleteConfirm")}</div>
          <div className="setting-desc">{t("settings.deleteConfirmDesc")}</div>
        </div>
        <button
          className={`settings-toggle${askDelete ? " is-on" : ""}`}
          role="switch"
          aria-checked={askDelete}
          aria-label={t("settings.deleteConfirm")}
          data-testid="settings-delete-confirm-toggle"
          onClick={() => setDeleteConfirm(!askDelete)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      {/* R244: how to handle attachments used only by a note being deleted
          (Obsidian "Deleted attachments", Files & links). Default "ask" = faithful. */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.attachmentDelete")}</div>
          <div className="setting-desc">{t("settings.attachmentDeleteDesc")}</div>
        </div>
        <select
          className="settings-select"
          data-testid="settings-attachment-delete-mode"
          value={attachMode}
          aria-label={t("settings.attachmentDelete")}
          onChange={(e) => setAttachmentDeleteMode(e.target.value as AttachmentDeleteMode)}
        >
          <option value="ask">{t("settings.attachmentDeleteAsk")}</option>
          <option value="delete">{t("settings.attachmentDeleteDelete")}</option>
          <option value="keep">{t("settings.attachmentDeleteKeep")}</option>
        </select>
      </div>

      <h3 className="settings-subheader" data-testid="settings-subheader-advanced">{t("settings.subheaderAdvanced")}</h3>

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

      {/* R275: enable obsidian:// URI in-app routing (Obsidian "Enable URI links", Advanced). */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.uriLinksEnabled")}</div>
          <div className="setting-desc">{t("settings.uriLinksEnabledDesc")}</div>
        </div>
        <button
          className={`settings-toggle${uriLinks ? " is-on" : ""}`}
          role="switch"
          aria-checked={uriLinks}
          aria-label={t("settings.uriLinksEnabled")}
          data-testid="settings-uri-links-enabled"
          onClick={() => setUriLinksEnabled(!uriLinks)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      {/* R228: rebuild the in-memory metadata cache (Obsidian "Rebuild vault cache", Advanced) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.rebuildCache")}</div>
          <div className="setting-desc">{t("settings.rebuildCacheDesc")}</div>
        </div>
        <button
          className="settings-action-btn"
          data-testid="settings-rebuild-cache"
          onClick={() => void app.commands.execute("app:rebuild-cache")}
        >
          {t("settings.rebuildCacheButton")}
        </button>
      </div>
    </section>
  );
}

/* ---------------- Templates ---------------- */

function TemplatesSection() {
  const t = useI18n();
  /* R23: templates — stored verbatim (no trim), consumers trim (R17 precedent) */
  const tplFolder = useStore(templateFolder);
  const tplDateFormat = useStore(templateDateFormat);
  const tplTimeFormat = useStore(templateTimeFormat);

  return (
    <section>
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
    </section>
  );
}

/* ---------------- Daily notes ---------------- */

function DailyNotesSection() {
  const t = useI18n();
  /* R48: daily notes — folder / date format / template, stored verbatim (R17/R23 precedent) */
  const dailyFolder = useStore(dailyNoteFolder);
  const dailyFormat = useStore(dailyNoteFormat);
  const dailyTemplate = useStore(dailyNoteTemplate);

  return (
    <section>
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
    </section>
  );
}

/* ---------------- Unique notes ---------------- */

function UniqueNotesSection() {
  const t = useI18n();
  /* R53: unique note creator — folder / prefix format / template, stored verbatim */
  const uniqueFolder = useStore(uniqueNoteFolder);
  const uniqueFormat = useStore(uniqueNoteFormat);
  const uniqueTemplate = useStore(uniqueNoteTemplate);

  return (
    <section>
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

/* ---------------- Page preview ---------------- */

/* ---------------- Quick switcher (R231) ---------------- */

function QuickSwitcherSection() {
  const t = useI18n();
  const existingOnly = useStore(switcherShowExistingOnly);
  const showAttachments = useStore(switcherShowAttachments);
  const showAllTypes = useStore(switcherShowAllTypes);
  return (
    <section>
      <h2 className="settings-heading">{t("settings.section.quickSwitcher")}</h2>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.switcherExistingOnly")}</div>
          <div className="setting-desc">{t("settings.switcherExistingOnlyDesc")}</div>
        </div>
        <button
          className={`settings-toggle${existingOnly ? " is-on" : ""}`}
          role="switch"
          aria-checked={existingOnly}
          aria-label={t("settings.switcherExistingOnly")}
          data-testid="settings-switcher-existing-only"
          onClick={() => setSwitcherShowExistingOnly(!existingOnly)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.switcherShowAttachments")}</div>
          <div className="setting-desc">{t("settings.switcherShowAttachmentsDesc")}</div>
        </div>
        <button
          className={`settings-toggle${showAttachments ? " is-on" : ""}`}
          role="switch"
          aria-checked={showAttachments}
          aria-label={t("settings.switcherShowAttachments")}
          data-testid="settings-switcher-attachments"
          onClick={() => setSwitcherShowAttachments(!showAttachments)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.switcherShowAllTypes")}</div>
          <div className="setting-desc">{t("settings.switcherShowAllTypesDesc")}</div>
        </div>
        <button
          className={`settings-toggle${showAllTypes ? " is-on" : ""}`}
          role="switch"
          aria-checked={showAllTypes}
          aria-label={t("settings.switcherShowAllTypes")}
          data-testid="settings-switcher-all-types"
          onClick={() => setSwitcherShowAllTypes(!showAllTypes)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>
    </section>
  );
}

/* R234: Note composer core-plugin settings tab (Obsidian "Note composer"). Slice 1 = the
 * "Replace selection with" dropdown; merge-confirmation + template location land in R235. */
function NoteComposerSection() {
  const t = useI18n();
  const replaceMode = useStore(extractReplaceMode);
  const askMerge = useStore(mergeConfirm);
  const templatePath = useStore(extractTemplatePath);
  return (
    <section>
      <h2 className="settings-heading">{t("settings.section.noteComposer")}</h2>

      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.extractReplacement")}</div>
          <div className="setting-desc">{t("settings.extractReplacementDesc")}</div>
        </div>
        <select
          className="settings-select"
          data-testid="settings-extract-replacement"
          value={replaceMode}
          aria-label={t("settings.extractReplacement")}
          onChange={(e) => setExtractReplaceMode(e.target.value as ExtractReplaceMode)}
        >
          <option value="link">{t("settings.extractReplaceLink")}</option>
          <option value="embed">{t("settings.extractReplaceEmbed")}</option>
          <option value="none">{t("settings.extractReplaceNone")}</option>
        </select>
      </div>

      {/* R235: ask to confirm before merging notes (Obsidian "Note composer", default ON) */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.mergeConfirm")}</div>
          <div className="setting-desc">{t("settings.mergeConfirmDesc")}</div>
        </div>
        <button
          className={`settings-toggle${askMerge ? " is-on" : ""}`}
          role="switch"
          aria-checked={askMerge}
          aria-label={t("settings.mergeConfirm")}
          data-testid="settings-merge-confirm-toggle"
          onClick={() => setMergeConfirm(!askMerge)}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      {/* R236: template file location — structures notes created by "extract selection" */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t("settings.extractTemplate")}</div>
          <div className="setting-desc">{t("settings.extractTemplateDesc")}</div>
        </div>
        <input
          className="settings-text-input"
          type="text"
          value={templatePath}
          placeholder="templates/extract.md"
          spellCheck={false}
          aria-label={t("settings.extractTemplate")}
          data-testid="settings-extract-template"
          onChange={(e) => setExtractTemplatePath(e.target.value)}
        />
      </div>
    </section>
  );
}

function PagePreviewSection() {
  const t = useI18n();
  /* R25: page preview (hover) — settings Stores from core/hover */
  const pagePreview = useStore(pagePreviewEnabled);
  const pagePreviewModifier = useStore(pagePreviewRequireModifier);

  return (
    <section>
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
    </section>
  );
}

/* ---------------- Keychain ---------------- */

function KeychainSection() {
  const t = useI18n();
  return (
    <section>
      <h2 className="settings-heading">{t("settings.section.keychain")}</h2>
      <div className="setting-item" data-testid="settings-keychain-empty">
        <div className="setting-info">
          <div className="setting-desc">{t("settings.keychainEmpty")}</div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Core plugins ---------------- */

type CorePluginRowDef = {
  id: string;
  nameKey: I18nKey;
  descKey: I18nKey;
  defaultEnabled: boolean;
  pluginId?: string;
  settingsSection?: SectionId;
};

const CORE_PLUGIN_ROWS: CorePluginRowDef[] = [
  {
    id: "canvas",
    nameKey: "settings.corePlugin.canvas",
    descKey: "settings.corePlugin.canvasDesc",
    defaultEnabled: false,
  },
  {
    id: "note-composer",
    nameKey: "settings.section.noteComposer",
    descKey: "settings.corePlugin.noteComposerDesc",
    defaultEnabled: true,
    settingsSection: "note-composer",
  },
  {
    id: "tags",
    nameKey: "settings.corePlugin.tags",
    descKey: "settings.corePlugin.tagsDesc",
    defaultEnabled: true,
  },
  {
    id: "outgoing-links",
    nameKey: "cmdSource.outgoingLinks",
    descKey: "settings.corePlugin.outgoingLinksDesc",
    defaultEnabled: true,
  },
  {
    id: "outline",
    nameKey: "cmdSource.outline",
    descKey: "settings.corePlugin.outlineDesc",
    defaultEnabled: true,
  },
  {
    id: "publish",
    nameKey: "settings.corePlugin.publish",
    descKey: "settings.corePlugin.publishDesc",
    defaultEnabled: false,
  },
  {
    id: "backlinks",
    nameKey: "cmdSource.backlinks",
    descKey: "settings.corePlugin.backlinksDesc",
    defaultEnabled: true,
  },
  {
    id: "workspaces",
    nameKey: "settings.corePlugin.workspaces",
    descKey: "settings.corePlugin.workspacesDesc",
    defaultEnabled: false,
  },
  {
    id: "graph",
    nameKey: "cmdSource.graph",
    descKey: "settings.corePlugin.graphDesc",
    defaultEnabled: true,
  },
  {
    id: "slides",
    nameKey: "cmdSource.slides",
    descKey: "settings.corePlugin.slidesDesc",
    defaultEnabled: false,
  },
  {
    id: "quick-switcher",
    nameKey: "settings.section.quickSwitcher",
    descKey: "settings.corePlugin.quickSwitcherDesc",
    defaultEnabled: true,
    settingsSection: "quick-switcher",
  },
  {
    id: "audio-recorder",
    nameKey: "settings.corePlugin.audioRecorder",
    descKey: "settings.corePlugin.audioRecorderDesc",
    defaultEnabled: false,
  },
  {
    id: "random-note",
    nameKey: "plugin.randomNote.name",
    descKey: "plugin.randomNote.desc",
    defaultEnabled: true,
    pluginId: "random-note",
  },
  {
    id: "command-palette",
    nameKey: "settings.section.commandPalette",
    descKey: "settings.corePlugin.commandPaletteDesc",
    defaultEnabled: true,
    settingsSection: "command-palette",
  },
  {
    id: "templates",
    nameKey: "settings.templates",
    descKey: "settings.corePlugin.templatesDesc",
    defaultEnabled: true,
    settingsSection: "templates",
  },
  {
    id: "daily-notes",
    nameKey: "settings.dailyNotes",
    descKey: "plugin.dailyNote.desc",
    defaultEnabled: true,
    pluginId: "daily-note",
    settingsSection: "daily-notes",
  },
  {
    id: "unique-notes",
    nameKey: "settings.uniqueNotes",
    descKey: "plugin.uniqueNote.desc",
    defaultEnabled: false,
    pluginId: "unique-note",
    settingsSection: "unique-notes",
  },
  {
    id: "word-count",
    nameKey: "plugin.wordCount.name",
    descKey: "plugin.wordCount.desc",
    defaultEnabled: false,
    pluginId: "word-count",
  },
  {
    id: "file-recovery",
    nameKey: "settings.corePlugin.fileRecovery",
    descKey: "settings.corePlugin.fileRecoveryDesc",
    defaultEnabled: true,
  },
  {
    id: "file-explorer",
    nameKey: "settings.corePlugin.fileExplorer",
    descKey: "settings.corePlugin.fileExplorerDesc",
    defaultEnabled: true,
  },
  {
    id: "page-preview",
    nameKey: "settings.pagePreviewHeading",
    descKey: "settings.pagePreviewDesc",
    defaultEnabled: true,
    settingsSection: "page-preview",
  },
];

function CorePluginsSection({ setSection }: { setSection: (section: string) => void }) {
  const app = useApp();
  const t = useI18n();
  useStore(app.plugins.revision);
  const [query, setQuery] = useState("");
  const entries = app.plugins.list();
  const entryById = new Map(entries.map((e) => [e.plugin.id, e]));
  const q = query.trim().toLowerCase();
  const rows = CORE_PLUGIN_ROWS.filter((row) => {
    if (!q) return true;
    return (
      t(row.nameKey).toLowerCase().includes(q) ||
      t(row.descKey).toLowerCase().includes(q)
    );
  });

  return (
    <section>
      <h2 className="settings-heading">{t("settings.section.corePlugins")}</h2>
      <div className="core-plugins-search">
        <Icon name="search" size={15} />
        <input
          type="text"
          value={query}
          placeholder={t("settings.corePluginsSearch")}
          spellCheck={false}
          aria-label={t("settings.corePluginsSearch")}
          data-testid="settings-core-plugins-search"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="settings-card core-plugin-list" data-testid="settings-core-plugin-list">
        {rows.map((row) => {
          const entry = row.pluginId ? entryById.get(row.pluginId) : undefined;
          const enabled = entry ? entry.enabled : row.defaultEnabled;
          // 真插件化 step 1: only rows backed by a registered plugin have a working
          // toggle. The rest are always-on / not-yet-pluginified features whose toggle
          // is shown (Obsidian parity) but disabled — honest non-operable state rather
          // than a phantom switch. Future rounds wire each feature as a real plugin.
          const wired = !!entry;
          return (
            <div className="core-plugin-row" key={row.id} data-testid={`core-plugin-${row.id}`}>
              <div className="plugin-info">
                <div className="plugin-name">{t(row.nameKey)}</div>
                <div className="plugin-desc">{t(row.descKey)}</div>
              </div>
              <div className="core-plugin-actions">
                <button
                  className="core-plugin-icon-btn"
                  type="button"
                  disabled={!row.settingsSection}
                  aria-label={t("settings.corePluginSettings")}
                  title={t("settings.corePluginSettings")}
                  data-testid={`core-plugin-settings-${row.id}`}
                  onClick={() => {
                    if (row.settingsSection) setSection(row.settingsSection);
                  }}
                >
                  <Icon name="settings" size={15} />
                </button>
                <button
                  className="core-plugin-icon-btn"
                  type="button"
                  disabled
                  aria-label={t("settings.corePluginAdd")}
                  title={t("settings.corePluginAdd")}
                >
                  <Icon name="plus" size={15} />
                </button>
                <button
                  className={`settings-toggle${enabled ? " is-on" : ""}`}
                  role="switch"
                  aria-checked={enabled}
                  aria-label={t(enabled ? "settings.disablePlugin" : "settings.enablePlugin", {
                    name: t(row.nameKey),
                  })}
                  data-testid={`core-plugin-toggle-${row.id}`}
                  disabled={!wired}
                  aria-disabled={!wired}
                  onClick={() => {
                    if (!entry || !row.pluginId) return;
                    if (entry.enabled) app.plugins.disable(row.pluginId);
                    else void app.plugins.enable(row.pluginId, { userAction: true });
                  }}
                >
                  <span className="settings-toggle-thumb" />
                </button>
              </div>
            </div>
          );
        })}
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

function PluginsSection({ setSection }: { setSection: (section: string) => void }) {
  const app = useApp();
  const t = useI18n();
  useStore(app.plugins.revision); // re-render on enable/disable/register
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
      <PluginList entries={builtin} group="builtin" setSection={setSection} />

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
      <PluginList entries={external} group="external" setSection={setSection} />

      <div className="plugin-group-header">
        <h3 className="plugin-group-title">{t("settings.pluginGroupObsidian")}</h3>
      </div>
      <p className="settings-note plugin-path-hint" data-testid="settings-obsidian-path-hint">
        {t("settings.obsidianHintPre")}
        <code>&lt;vault&gt;/.obsidian/plugins/</code>
        {t("settings.obsidianHintPost")}
      </p>
      <PluginList entries={obsidian} group="obsidian" warnings={obsidianWarnings} setSection={setSection} />
      {/* R163: per-plugin settings moved OUT of this group into left-nav tabs */}

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

    </section>
  );
}

/** Mounts section.mount(container) while the plugin's tab is selected; unmounts on switch. */
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
  setSection,
}: {
  entries: ReturnType<PluginManager["list"]>;
  group: PluginSource;
  /** plugin id -> manifest warning (e.g. minAppVersion exceeds apiVersion) */
  warnings?: ReadonlyMap<string, string>;
  setSection: (section: string) => void;
}) {
  const app = useApp();
  const t = useI18n();
  const settingsSections = useStore(app.plugins.settingsSections);

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
          <div className="plugin-actions">
            {(() => {
              const settingsSection = settingsSections.find((s) => s.pluginId === plugin.id);
              return settingsSection ? (
                <button
                  className="plugin-settings-btn"
                  type="button"
                  aria-label={t("settings.pluginSettings", { name: getPluginName(plugin) })}
                  title={t("settings.pluginSettings", { name: getPluginName(plugin) })}
                  data-testid={`plugin-settings-${plugin.id}`}
                  onClick={() => setSection(`plugin:${settingsSection.id}`)}
                >
                  <Icon name="settings" size={15} />
                </button>
              ) : null;
            })()}
            {/* R166 (B1): uninstall — community (obsidian) plugins only; builtin is
                packaged, external (.geode dev scripts) has no id→file map (deferred) */}
            {source === "obsidian" && (
              <button
                className="plugin-uninstall-btn"
                aria-label={t("settings.uninstallPlugin", { name: getPluginName(plugin) })}
                title={t("settings.uninstallPlugin", { name: getPluginName(plugin) })}
                data-testid={`plugin-uninstall-${plugin.id}`}
                onClick={() => {
                  void (async () => {
                    const confirmed = await confirmAction(
                      t("settings.uninstallConfirm", { name: getPluginName(plugin) }),
                      t("settings.uninstallConfirmTitle"),
                    );
                    if (confirmed) await app.plugins.uninstall(plugin.id);
                  })();
                }}
              >
                {/* lucide trash-2 (not in the shared icon set) */}
                <svg
                  width={15}
                  height={15}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
            )}
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
        </div>
        );
      })}
    </div>
  );
}

/* ---------------- Hotkeys ---------------- */

/* R251: Obsidian's hotkeys page prefixes each plugin command's name with its SOURCE
   ("书签: 收藏当前搜索"); core app/editor/workspace/file-explorer commands have no prefix.
   Geode has no Command.source, so derive it from the id prefix. The list stays FLAT — this is a
   name prefix, NOT a collapsible group section (verify-first: Obsidian's hotkeys page is flat).
   Note: a few core-plugin commands Geode registers under editor:/app: (e.g. note composer) stay
   unprefixed — prefixing only the cleanly-sourced ids avoids mislabelling. */
const CMD_SOURCE_KEYS: Record<string, I18nKey> = {
  bookmarks: "cmdSource.bookmarks",
  "daily-note": "cmdSource.dailyNotes",
  backlink: "cmdSource.backlinks",
  "unique-note": "cmdSource.uniqueNotes",
  slides: "cmdSource.slides",
  "random-note": "cmdSource.randomNote",
  outline: "cmdSource.outline",
  "outgoing-links": "cmdSource.outgoingLinks",
  graph: "cmdSource.graph",
};

function HotkeysSection() {
  const app = useApp();
  const t = useI18n();
  useStore(app.commands.revision); // re-render on (un)register and override changes
  const [filter, setFilter] = useState("");
  // R145: Obsidian's "filter icon" — show only commands with an assigned hotkey.
  // Per-mount session state (resets on reopen), like the text filter above it.
  const [assignedOnly, setAssignedOnly] = useState(false);
  const [capturingId, setCapturingId] = useState<string | null>(null);

  // R251: source-prefixed display name ("书签: 收藏当前搜索"), also used for the filter so a user
  // can search by source label, and for the conflict list / reset aria-label. Core app/editor/
  // workspace/file-explorer commands (not in CMD_SOURCE_KEYS) get no prefix.
  const cmdLabel = (cmd: Command) => {
    const name = getCommandName(cmd);
    const colon = cmd.id.indexOf(":");
    const key = colon > 0 ? CMD_SOURCE_KEYS[cmd.id.slice(0, colon)] : undefined;
    if (!key) return name;
    const label = t(key);
    // Idempotent: a few commands already bake the source into their own registered name (e.g.
    // "Backlinks: …", ZH "反向链接：…" with a fullwidth colon, from R211/R212/R219 for the command
    // palette) — don't prepend a second copy (the e2e covers backlink:/outline:/outgoing-links:).
    return name.startsWith(`${label}:`) || name.startsWith(`${label}：`) ? name : `${label}: ${name}`;
  };

  const q = filter.trim().toLowerCase();
  const commands = app.commands.list();
  const rows = commands.filter(
    (cmd) =>
      (!q ||
        cmdLabel(cmd).toLowerCase().includes(q) ||
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
      <div className="settings-card hotkeys-search-card">
        <div className="hotkeys-search-meta">
          <div className="setting-name">{t("settings.hotkeysSearchTitle")}</div>
          <div className="setting-desc">{t("settings.hotkeysCount", { count: commands.length })}</div>
        </div>
        <div className="hotkeys-search-controls">
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
          <label className="hotkeys-search-box">
            <Icon name="search" size={15} />
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
          </label>
        </div>
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
                  <div className="hotkey-name">{cmdLabel(cmd)}</div>
                  {conflicts.length > 0 && (
                    <div className="hotkey-conflict" data-testid={`hotkey-conflict-${cmd.id}`}>
                      {t("settings.hotkeyConflict", {
                        names: conflicts.map((c) => `"${cmdLabel(c)}"`).join(", "),
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
                      <button
                        className="hotkey-chip-delete"
                        title={t("settings.hotkeyRemoveTitle")}
                        aria-label={t("settings.hotkeyRemoveAria", { name: cmdLabel(cmd) })}
                        data-testid={`hotkey-delete-${cmd.id}`}
                        onClick={() => app.commands.setHotkeyOverride(cmd.id, null)}
                      >
                        <Icon name="x" size={10} />
                      </button>
                    </span>
                  ) : (
                    <span className="hotkey-unset">{t("settings.hotkeyNotSet")}</span>
                  )}
                  {!capturing && (
                    <button
                      className="hotkey-add"
                      title={t("settings.hotkeyAddTitle")}
                      aria-label={t("settings.hotkeyAddAria", { name: cmdLabel(cmd) })}
                      data-testid={`hotkey-add-${cmd.id}`}
                      onClick={() => setCapturingId(cmd.id)}
                    >
                      <Icon name="plus" size={12} />
                    </button>
                  )}
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
  const currentLocale = useStore(locale);
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
