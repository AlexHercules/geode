/**
 * Built-in browser E2E fixture (?obsfixture=1): a realistic esbuild-style
 * CommonJS bundle STRING exercising the T0+T1+T1.5 surface — commands
 * (plain + editorCallback), status bar, ribbon icon, settings tab (Setting
 * DSL), Notice, vault.on("modify"), metadataCache.getFileCache headings,
 * loadData/saveData and normalizePath.
 */
import type { ObsidianPluginSource } from "@core/vault";

export const FIXTURE_PLUGIN_ID = "geode-compat-fixture";

const MANIFEST = {
  id: FIXTURE_PLUGIN_ID,
  name: "Geode Compat Fixture",
  version: "1.0.0",
  minAppVersion: "1.0.0",
  author: "Geode",
  description: "Built-in test plugin exercising the Obsidian compat surface (browser E2E).",
};

const MAIN_JS = `"use strict";
var __defProp = Object.defineProperty;
var obsidian = require("obsidian");

var DEFAULT_SETTINGS = {
  greeting: "hello",
  enabled: true
};

var FixtureSettingTab = class extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    var containerEl = this.containerEl;
    containerEl.empty();
    containerEl.createEl("div", { text: "Geode compat fixture settings", cls: "setting-item-heading", attr: { "data-testid": "fixture-settings-heading" } });
    new obsidian.Setting(containerEl)
      .setName("Greeting")
      .setDesc("Stored in data.json via saveData()")
      .addText((text) => text
        .setPlaceholder("hello")
        .setValue(this.plugin.settings.greeting)
        .onChange(async (value) => {
          this.plugin.settings.greeting = value;
          await this.plugin.saveData(this.plugin.settings);
        }));
    new obsidian.Setting(containerEl)
      .setName("Enabled flag")
      .setDesc("Toggle persisted with the same data.json")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.enabled)
        .onChange(async (value) => {
          this.plugin.settings.enabled = value;
          await this.plugin.saveData(this.plugin.settings);
        }));
  }
};

var GeodeCompatFixture = class extends obsidian.Plugin {
  async onload() {
    var self = this;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    var statusEl = this.addStatusBarItem();
    statusEl.setText("fixture: 0 mods");
    statusEl.setAttr("data-testid", "fixture-status");
    var mods = 0;
    this.registerEvent(this.app.vault.on("modify", (file) => {
      mods += 1;
      statusEl.setText("fixture: " + mods + " mods (" + file.path + ")");
    }));

    this.addRibbonIcon("dice", "Fixture: show notice", () => {
      new obsidian.Notice("fixture ribbon: " + self.settings.greeting);
    });

    this.addCommand({
      id: "hello",
      name: "Say hello",
      callback: () => {
        var normalized = obsidian.normalizePath("\\\\foo\\\\\\\\bar/baz/");
        new obsidian.Notice("fixture says " + self.settings.greeting + " (" + normalized + ")");
      }
    });

    this.addCommand({
      id: "insert-heading-count",
      name: "Insert heading count",
      editorCallback: (editor, view) => {
        var file = self.app.workspace.getActiveFile();
        var cache = file ? self.app.metadataCache.getFileCache(file) : null;
        var count = cache && cache.headings ? cache.headings.length : 0;
        editor.replaceSelection("[fixture: " + count + " headings]");
      }
    });

    this.addSettingTab(new FixtureSettingTab(this.app, this));
  }
  onunload() {
  }
};
__defProp(exports, "__esModule", { value: true });
exports.default = GeodeCompatFixture;
//# sourceMappingURL=data:application/json;base64,e30=
`;

const STYLES_CSS = `/* fixture styles — proves styles.css injection/removal */
.geode-compat-status[data-testid="fixture-status"] {
  color: var(--accent);
}
`;

export const FIXTURE_PLUGIN: ObsidianPluginSource = {
  dir: FIXTURE_PLUGIN_ID,
  manifestJson: JSON.stringify(MANIFEST, null, 2),
  mainJs: MAIN_JS,
  stylesCss: STYLES_CSS,
  dataJson: null,
};
