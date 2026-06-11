/**
 * Built-in browser E2E fixture (?obsfixture=1): a realistic esbuild-style
 * CommonJS bundle STRING exercising the T0+T1+T1.5 surface — commands
 * (plain + editorCallback), status bar, ribbon icon, settings tab (Setting
 * DSL), Notice, vault.on("modify"), metadataCache.getFileCache headings,
 * loadData/saveData and normalizePath. R5 adds the T2 surface: a registered
 * ItemView opened via the recent-files leaf sequence, and a window.moment
 * assertion written into a status bar item. R6 adds an EditorSuggest ("@@"
 * trigger), a requestUrl data:-URL probe and a MarkdownRenderer.render probe.
 * R9: the suggest calls setInstructions in its constructor so the browser E2E
 * can assert the instructions bar (editor-suggest-instructions) renders, and
 * cursor movement out of the trigger range (ArrowLeft) closes the popup.
 * R13: the MarkdownRenderer probe also renders ![[Welcome]] (note embed —
 * assert .geode-embed-note-content) and ![[Fixture Block#^fxblock]] against a
 * fixture-created note, probing getFileCache().blocks along the way.
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

var FIXTURE_VIEW_TYPE = "fixture-view";

var FixtureView = class extends obsidian.ItemView {
  getViewType() {
    return FIXTURE_VIEW_TYPE;
  }
  getDisplayText() {
    return "Fixture View";
  }
  getIcon() {
    return "clock";
  }
  async onOpen() {
    this.contentEl.empty();
    this.contentEl.createDiv({
      text: "fixture view is open",
      attr: { "data-testid": "obsfixture-view-body" }
    });
    // R5: regression probe for window.app injection (F5)
    var probe = "missing";
    try {
      if (window.app && window.app.plugins && typeof window.app.plugins.getPlugin === "function") {
        window.app.plugins.getPlugin("x");
        probe = "ok";
      }
    } catch (e) {
      probe = "missing";
    }
    this.contentEl.createDiv({
      text: probe,
      attr: { "data-testid": "obsfixture-app-probe" }
    });
  }
};

// R6: real EditorSuggest — typing "@@" pops static suggestions; selecting one
// replaces the whole trigger range (start..end from the stored context).
var FixtureSuggest = class extends obsidian.EditorSuggest {
  constructor(app) {
    super(app);
    // R9: instructions bar set from the constructor (nldates' calling shape)
    this.setInstructions([{ command: "\\u21B5", purpose: "insert" }]);
  }
  onTrigger(cursor, editor, file) {
    var before = editor.getLine(cursor.line).slice(0, cursor.ch);
    var m = before.match(/@@([A-Za-z]*)$/);
    if (!m) return null;
    return {
      start: { line: cursor.line, ch: cursor.ch - m[0].length },
      end: { line: cursor.line, ch: cursor.ch },
      query: m[1]
    };
  }
  getSuggestions(context) {
    var all = ["alpha", "beta", "gamma"];
    var q = context.query.toLowerCase();
    return all.filter(function (s) { return s.indexOf(q) === 0; });
  }
  renderSuggestion(value, el) {
    el.setText(value);
  }
  selectSuggestion(value, evt) {
    var ctx = this.context;
    if (!ctx) return;
    ctx.editor.replaceRange(value, ctx.start, ctx.end);
  }
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

    // R5: real registerView + the recent-files open sequence
    this.registerView(FIXTURE_VIEW_TYPE, (leaf) => new FixtureView(leaf));

    this.addCommand({
      id: "open-view",
      name: "Open view",
      callback: async () => {
        var workspace = self.app.workspace;
        var leaf;
        [leaf] = workspace.getLeavesOfType(FIXTURE_VIEW_TYPE);
        if (!leaf) {
          leaf = workspace.getRightLeaf(false);
          await leaf.setViewState({ type: FIXTURE_VIEW_TYPE });
        }
        await workspace.revealLeaf(leaf);
      }
    });

    // R5: window.moment assertion surfaced in the status bar
    var momentEl = this.addStatusBarItem();
    momentEl.setText("moment: pending");
    momentEl.setAttr("data-testid", "fixture-moment");
    this.addCommand({
      id: "moment-today",
      name: "Write moment date to status bar",
      callback: () => {
        momentEl.setText("moment: " + window.moment().format("YYYY-MM-DD"));
      }
    });

    // R6: EditorSuggest registration ("@@" trigger, see FixtureSuggest above)
    this.registerEditorSuggest(new FixtureSuggest(this.app));

    // R6: requestUrl probe — data: URL resolves in-layer (deterministic, no network)
    var requestEl = this.addStatusBarItem();
    requestEl.setText("requesturl: pending");
    requestEl.setAttr("data-testid", "obsfixture-requesturl");
    this.addCommand({
      id: "requesturl-probe",
      name: "requestUrl probe",
      callback: async () => {
        try {
          var res = await obsidian.requestUrl('data:application/json,{"ok":true}');
          requestEl.setText("requesturl: " + res.status + " ok=" + res.json.ok);
        } catch (e) {
          requestEl.setText("requesturl: error " + e.message);
        }
      }
    });

    // R6: MarkdownRenderer probe — renders into a child of a status bar item.
    // R13: the source also exercises a note embed (![[Welcome]] — the E2E can
    // assert .geode-embed-note-content) and a ^block embed positive case
    // against a note the fixture creates itself (content fully controlled).
    var mdHostEl = this.addStatusBarItem();
    mdHostEl.setAttr("data-testid", "obsfixture-md-host");
    this.addCommand({
      id: "render-markdown",
      name: "Render markdown",
      callback: async () => {
        var blockPath = "Fixture Block.md";
        if (!self.app.vault.getAbstractFileByPath(blockPath)) {
          await self.app.vault.create(blockPath, "Block embed target paragraph. ^fxblock\\n");
        }
        // bounded poll: wait for the metadata index to expose the block id
        // (also a live probe of getFileCache().blocks) before rendering
        for (var i = 0; i < 30; i++) {
          var cache = self.app.metadataCache.getCache(blockPath);
          if (cache && cache.blocks && cache.blocks.fxblock) break;
          await new Promise(function (resolve) { setTimeout(resolve, 100); });
        }
        mdHostEl.empty();
        var target = mdHostEl.createDiv({ attr: { "data-testid": "obsfixture-md-render" } });
        var active = self.app.workspace.getActiveFile();
        await obsidian.MarkdownRenderer.render(
          self.app,
          "**bold** [[Welcome]]\\n\\n- [ ] task\\n\\n![[Welcome]]\\n\\n![[Fixture Block#^fxblock]]",
          target,
          active ? active.path : "",
          self
        );
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
