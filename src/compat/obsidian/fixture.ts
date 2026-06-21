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
 * R167: an AbstractInputSuggest bound to a live <input> (data-testid
 * fixture-input-suggest) with a sibling result div (fixture-input-suggest-selected)
 * — type-ahead completion over [apple, apricot, banana] for the browser E2E.
 * R168: a one-shot async IIFE exercising the Tier 8 D-series util exports
 * (apiVersion/requireApiVersion, parseLinktext, arrayBufferToBase64 +
 * base64ToArrayBuffer + getBlobArrayBuffer, loadMermaid) and writing the JSON
 * results into a live <div data-testid="fixture-d-results"> for the E2E.
 * R169: a second one-shot async IIFE exercising the Tier 8 D7 surface — global
 * sleep(ms)/nextFrame() and the delegated Document.on/off listeners — plus a
 * zero-regression re-check of HTMLElement.prototype.on/off (refactored to a
 * shared impl this round); JSON results land in <div data-testid="fixture-d7-results">.
 * R170: a one-shot async IIFE exercising the Tier 8 D9 math surface —
 * renderMath(source, display) (sync HTMLElement fallback → KaTeX typeset),
 * finishRenderMath() (await the render queue), loadMathJax() (prewarm), and the
 * throwOnError:false invariant (invalid LaTeX must not throw); JSON results land
 * in <div data-testid="fixture-d9math-results">.
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

// R167: AbstractInputSuggest — type-ahead completion bound to a plain <input>.
// Unlike EditorSuggest, getSuggestions(query) receives the query STRING (the
// current input value), not a context. Empty query returns all candidates.
var FixtureInputSuggest = class extends obsidian.AbstractInputSuggest {
  getSuggestions(query) {
    var all = ["apple", "apricot", "banana"];
    var q = query.toLowerCase();
    return all.filter(function (s) { return s.indexOf(q) === 0; });
  }
  renderSuggestion(value, el) {
    el.setText(value);
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

    // R167: AbstractInputSuggest bound to a real <input> in the live DOM, so
    // the browser E2E can focus + type + navigate the completion popup.
    var inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.setAttribute("data-testid", "fixture-input-suggest");
    document.body.appendChild(inputEl);
    var selectedEl = document.createElement("div");
    selectedEl.setAttribute("data-testid", "fixture-input-suggest-selected");
    selectedEl.textContent = "";
    document.body.appendChild(selectedEl);
    // cleanup: remove the injected DOM when the plugin unloads (no residue)
    this.register(function () { inputEl.remove(); });
    this.register(function () { selectedEl.remove(); });
    var inputSug = new FixtureInputSuggest(this.app, inputEl);
    inputSug.onSelect(function (value) {
      inputSug.setValue(value);
      selectedEl.textContent = "selected: " + value;
    });

    // R168 — Tier 8 D-series util exports: apiVersion/requireApiVersion,
    // parseLinktext, arrayBufferToBase64/base64ToArrayBuffer/getBlobArrayBuffer,
    // loadMermaid. Compute every result in one async IIFE and stash the JSON in
    // a live <div> so the browser E2E can read it after the awaits settle.
    var dResultsEl = document.createElement("div");
    dResultsEl.setAttribute("data-testid", "fixture-d-results");
    document.body.appendChild(dResultsEl);
    this.register(function () { dResultsEl.remove(); });
    (async function () {
      var out = {};
      try {
        out.apiVersion = obsidian.apiVersion;
        out.req16 = obsidian.requireApiVersion("1.6.0");
        out.req180 = obsidian.requireApiVersion("1.8.0");
        out.req190 = obsidian.requireApiVersion("1.9.0");
        out.pl_heading = obsidian.parseLinktext("Note#heading");
        out.pl_plain = obsidian.parseLinktext("Note");
        out.pl_block = obsidian.parseLinktext("Note#^block");
        out.pl_subonly = obsidian.parseLinktext("#heading");
        // base64 round-trip over bytes [72,105,33] = "Hi!"
        var bytes = new Uint8Array([72, 105, 33]);
        var b64 = obsidian.arrayBufferToBase64(bytes.buffer);
        out.b64 = b64;
        var back = new Uint8Array(obsidian.base64ToArrayBuffer(b64));
        out.b64_roundtrip = Array.from(back).join(",");
        var blobBuf = await obsidian.getBlobArrayBuffer(new Blob([bytes]));
        out.blob_bytes = Array.from(new Uint8Array(blobBuf)).join(",");
        var m = await obsidian.loadMermaid();
        out.mermaidRender = typeof (m && m.render);
        out.ok = true;
      } catch (e) {
        out.ok = false;
        out.error = String(e);
      }
      dResultsEl.textContent = JSON.stringify(out);
    })();

    // R169 — Tier 8 D7: global sleep(ms)/nextFrame() + Document.on/off delegated
    // event listeners. The HTMLElement.prototype.on/off pair was refactored to a
    // shared implementation this round, so we also re-prove the element variant
    // (zero-regression). Same one-shot async IIFE + live <div> pattern as R168.
    var d7El = document.createElement("div");
    d7El.setAttribute("data-testid", "fixture-d7-results");
    document.body.appendChild(d7El);
    this.register(function () { d7El.remove(); });
    (async function () {
      var out = {};
      try {
        // sleep — resolves after roughly ms milliseconds
        var t0 = Date.now();
        await sleep(25);
        out.sleepElapsedOk = (Date.now() - t0) >= 15;   // tolerate timer jitter
        // nextFrame — resolves on the next animation frame
        await nextFrame();
        out.nextFrameOk = true;
        // Document.on/off — delegated listener fires only when a bubbled event's
        // target.closest(selector) matches; handler gets (ev, delegateTarget).
        var container = document.createElement("div");
        var btn = document.createElement("button");
        btn.className = "d7-target";
        btn.textContent = "t";
        container.appendChild(btn);
        document.body.appendChild(container);
        var fires = 0, lastDelegateMatch = false;
        var handler = function (ev, delegateTarget) { fires++; lastDelegateMatch = (delegateTarget === btn); };
        document.on("click", ".d7-target", handler);
        btn.click();                       // bubbles to document → matches
        out.firesAfterFirstClick = fires;  // expect 1
        out.delegateTargetOk = lastDelegateMatch;  // expect true
        // a click on a non-matching element does not fire the delegate
        var other = document.createElement("button");
        other.className = "d7-other";
        container.appendChild(other);
        other.click();
        out.firesAfterNonMatchClick = fires;  // still 1
        // off removes the delegate — no more fires
        document.off("click", ".d7-target", handler);
        btn.click();
        out.firesAfterOff = fires;            // still 1
        container.remove();
        // regression: HTMLElement.prototype.on/off still delegate (shared impl)
        var host = document.createElement("div");
        var child = document.createElement("span");
        child.className = "d7-el-child";
        host.appendChild(child);
        document.body.appendChild(host);
        var elFires = 0;
        var elHandler = function () { elFires++; };
        host.on("click", ".d7-el-child", elHandler);
        child.click();
        out.elOnFires = elFires;              // expect 1
        host.off("click", ".d7-el-child", elHandler);
        child.click();
        out.elOffFires = elFires;             // still 1
        host.remove();
        out.ok = true;
      } catch (e) {
        out.ok = false;
        out.error = String(e);
      }
      d7El.textContent = JSON.stringify(out);
    })();

    // R170 — Tier 8 D9 math: renderMath(source, display) returns a SYNC
    // HTMLElement (textContent=source fallback, then KaTeX typesets into it),
    // finishRenderMath() awaits the render queue, loadMathJax() prewarms KaTeX.
    // throwOnError:false → invalid LaTeX (\\frac{) must NOT throw on render and
    // finishRenderMath must still resolve. Same async-IIFE + live <div> pattern.
    var d9El = document.createElement("div");
    d9El.setAttribute("data-testid", "fixture-d9math-results");
    document.body.appendChild(d9El);
    this.register(function () { d9El.remove(); });
    (async function () {
      var out = {};
      try {
        // inline math
        var inlineEl = obsidian.renderMath("x^2", false);
        out.inlineIsElement = (inlineEl instanceof HTMLElement);
        out.inlineClass = inlineEl.className;          // expect "math math-inline"
        document.body.appendChild(inlineEl);
        // display (block) math — KaTeX receives \\frac{1}{2} at runtime
        var blockEl = obsidian.renderMath("\\\\frac{1}{2}", true);
        out.blockClass = blockEl.className;            // expect "math math-block"
        document.body.appendChild(blockEl);
        // invalid LaTeX must NOT throw on render (throwOnError:false)
        var badEl = obsidian.renderMath("\\\\frac{", false);
        document.body.appendChild(badEl);
        out.invalidNoThrowOnRender = true;             // reached = render didn't throw
        // finish — await the render queue
        await obsidian.finishRenderMath();
        out.finishResolved = true;
        out.inlineHasKatex = !!inlineEl.querySelector(".katex");
        out.inlineIsLoaded = inlineEl.classList.contains("is-loaded");
        out.blockHasKatex = !!blockEl.querySelector(".katex");
        // loadMathJax — prewarm
        await obsidian.loadMathJax();
        out.loadMathJaxResolved = true;
        // cleanup the appended math els
        inlineEl.remove(); blockEl.remove(); badEl.remove();
        out.ok = true;
      } catch (e) {
        out.ok = false;
        out.error = String(e);
      }
      d9El.textContent = JSON.stringify(out);
    })();

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
