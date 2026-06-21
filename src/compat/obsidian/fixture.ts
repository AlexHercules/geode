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
 * R171: a SYNCHRONOUS IIFE exercising the Tier 8 D3 search surface —
 * prepareFuzzySearch(query) (substring fast-path → [[0,3]], in-order chars,
 * no-match → null, reusable scorer) and prepareSimpleSearch(query) (all
 * whitespace-split tokens must occur, matches sorted by start, missing token →
 * null); JSON results land in <div data-testid="fixture-d3search-results">.
 * R172: a one-line test stub exposing the static obsidian.MarkdownPreviewRenderer
 * class to window.__obsidianMPR, so the browser E2E can drive its static methods
 * (registerPostProcessor/unregisterPostProcessor/createCodeBlockPostProcessor)
 * from the page context (same shape as R132's window.__geodeRegisterMarkdownPostProcessor).
 * R173: a SECURITY IIFE exercising the Tier 8 D9 sanitizeHTMLToDom XSS vector
 * battery — each dangerous vector (script/img onerror/javascript:/control-char
 * javascript:/iframe/onclick/data:/svg+script) is sanitized then ADOPTED INTO THE
 * LIVE DOM, and the JSON results (incl. window-flag "did-not-execute" assertions
 * snapshotted after a 150ms tick) land in <div data-testid="fixture-d9san-results">.
 * R174: a one-shot async IIFE exercising the Tier 8 D12+D16 surface — getLanguage()
 * (current locale string), getIcon(id) (SVGSVGElement for a real builtin id, null for
 * unknown), getIconIds() (non-empty string[]), Platform.resourcePathPrefix ("" honest
 * placeholder), this.app.fileManager.getAvailablePathForAttachment(name) (deduped path
 * string) and getNewFileParent(sourcePath) (a TFolder with a .path string); JSON results
 * land in <div data-testid="fixture-d1216-results">.
 * R175: a one-line test stub exposing the compat App's (obsidian-shaped) workspace to
 * window.__compatWorkspace, so the browser E2E can drive Workspace navigation —
 * openLinkText(linktext, sourcePath) (+ #subpath reveal), getMostRecentLeaf() and
 * setActiveLeaf() — from the page context (same shape as R172's window.__obsidianMPR).
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

    // R171 — Tier 8 D3 search: prepareFuzzySearch(query) and
    // prepareSimpleSearch(query) each return a (text) => SearchResult | null
    // scorer. SearchResult = { score:number, matches:Array<[start,end)> }.
    // Fuzzy is in-order char matching (substring fast-path → [[0,3]] for
    // "foo"/"foobar"); simple splits the query on whitespace and every token
    // must occur as a substring, matches sorted by start. This probe is purely
    // SYNCHRONOUS (no awaits), so a plain IIFE writes the JSON immediately.
    var d3El = document.createElement("div");
    d3El.setAttribute("data-testid", "fixture-d3search-results");
    document.body.appendChild(d3El);
    this.register(function () { d3El.remove(); });
    (function () {
      var out = {};
      try {
        // fuzzy: substring fast-path
        var fSub = obsidian.prepareFuzzySearch("foo");
        var rSub = fSub("foobar");
        out.fuzzySubNonNull = (rSub !== null);
        out.fuzzySubMatches = rSub ? JSON.stringify(rSub.matches) : null;  // expect [[0,3]]
        out.fuzzySubScoreNum = rSub ? (typeof rSub.score === "number") : false;
        // fuzzy: in-order chars (non-contiguous)
        var fFz = obsidian.prepareFuzzySearch("fb");
        var rFz = fFz("foobar");
        out.fuzzyCharsNonNull = (rFz !== null);   // f@0, b@3 in order → match
        // fuzzy: no match
        var rNo = obsidian.prepareFuzzySearch("xyz")("foobar");
        out.fuzzyNoMatchIsNull = (rNo === null);
        // fuzzy: reusable (same prepared fn on 2 texts)
        out.fuzzyReuse = (fSub("afoo") !== null) && (fSub("zzz") === null);
        // simple: all tokens substrings
        var sFn = obsidian.prepareSimpleSearch("foo bar");
        var rS = sFn("xx foo yy bar");
        out.simpleNonNull = (rS !== null);
        out.simpleMatchCount = rS ? rS.matches.length : 0;     // expect 2
        out.simpleSorted = rS ? (rS.matches[0][0] <= rS.matches[1][0]) : false;  // sorted by start
        // simple: a token missing → null
        out.simpleMissingIsNull = (obsidian.prepareSimpleSearch("foo zzz")("foo bar") === null);
        // types exist (functions)
        out.fnTypes = (typeof obsidian.prepareFuzzySearch === "function") && (typeof obsidian.prepareSimpleSearch === "function");
        out.ok = true;
      } catch (e) {
        out.ok = false;
        out.error = String(e);
      }
      d3El.textContent = JSON.stringify(out);
    })();

    // R172 — expose the static MarkdownPreviewRenderer class so the browser E2E
    // can drive its static methods from the page context (no DOM/cleanup needed).
    window.__obsidianMPR = obsidian.MarkdownPreviewRenderer;

    // R175 — expose the compat App's (obsidian-shaped) workspace so the browser E2E
    // can drive Workspace navigation (openLinkText / getMostRecentLeaf / setActiveLeaf)
    // from the page context. this.app IS the compat App, so this.app.workspace is the
    // obsidian-shaped workspace facade actually under test (NOT the geode-native one).
    window.__compatWorkspace = this.app.workspace;

    // R173 — Tier 8 D9 sanitizeHTMLToDom: a conservative allowlist cleaner that
    // returns a DocumentFragment. SECURITY probe (XSS vector battery): every
    // dangerous vector is sanitized → ADOPTED INTO THE LIVE DOM (appended under a
    // body-mounted host) → then we assert the script/onerror did NOT execute
    // (window flags stay undefined after a tick) AND legitimate content survived.
    // The setTimeout(150) gives any (stripped) onerror a chance to fire before we
    // snapshot the flags — proving the stripping, not just absence of the attr.
    var d9sEl = document.createElement("div");
    d9sEl.setAttribute("data-testid", "fixture-d9san-results");
    document.body.appendChild(d9sEl);
    var sanHost = document.createElement("div");
    document.body.appendChild(sanHost);
    this.register(function () { d9sEl.remove(); sanHost.remove(); });
    (function () {
      var out = {};
      try {
        window.__xssScript = undefined; window.__xssImg = undefined; window.__xssSvg = undefined;
        var S = obsidian.sanitizeHTMLToDom;
        // helper: sanitize → adopt into live DOM → return the host element to inspect
        function bake(html) { var h = document.createElement("div"); h.appendChild(S(html)); sanHost.appendChild(h); return h; }

        out.returnsFragment = (S("<b>x</b>") instanceof DocumentFragment);

        // 1) script element dropped + not executed
        var h1 = bake('<script>window.__xssScript=1<\\/script><b>keep</b>');
        out.noScriptEl = !h1.querySelector("script");
        out.scriptText = h1.textContent;                  // "keep" (script text removed with the element)
        // 2) img onerror stripped + not fired
        var h2 = bake('<img src="x-nonexistent-zzz.png" onerror="window.__xssImg=1">');
        out.imgPresent = !!h2.querySelector("img");
        out.imgNoOnerror = h2.querySelector("img") ? !h2.querySelector("img").hasAttribute("onerror") : false;
        // 3) href javascript: stripped
        var h3 = bake('<a href="javascript:window.__xssA=1">link</a>');
        out.aPresent = !!h3.querySelector("a");
        out.aNoJsHref = h3.querySelector("a") ? !h3.querySelector("a").hasAttribute("href") : false;
        out.aText = h3.textContent;                        // "link"
        // 4) java\\tscript: (control-char bypass) stripped — runtime sees a real TAB
        var h4 = bake('<a href="java\\tscript:window.__xssT=1">t</a>');
        out.tabJsStripped = h4.querySelector("a") ? !h4.querySelector("a").hasAttribute("href") : false;
        // 5) iframe dropped
        out.noIframe = !bake('<iframe src="https://evil.example"></iframe>').querySelector("iframe");
        // 6) onclick on allowed div stripped, text kept
        var h6 = bake('<div onclick="window.__xssC=1">ok</div>');
        out.divNoOnclick = h6.querySelector("div") ? !h6.querySelector("div").hasAttribute("onclick") : false;
        out.divText = h6.textContent;                      // "ok"
        // 7) safe href kept
        var h7 = bake('<a href="https://example.com">e</a>');
        out.safeHrefKept = h7.querySelector("a") ? h7.querySelector("a").getAttribute("href") === "https://example.com" : false;
        // 8) relative href kept
        var h8 = bake('<a href="/rel/path">r</a>');
        out.relHrefKept = h8.querySelector("a") ? h8.querySelector("a").getAttribute("href") === "/rel/path" : false;
        // 9) data: href stripped
        out.dataHrefStripped = (function () { var a = bake('<a href="data:text/html,<x>">d</a>').querySelector("a"); return a ? !a.hasAttribute("href") : false; })();
        // 10) svg+script dropped (no script element, no exec)
        var h10 = bake('<svg><script>window.__xssSvg=1<\\/script></svg><i>ok</i>');
        out.svgScriptGone = !h10.querySelector("script");
        out.svgGone = !h10.querySelector("svg");
        // 11) unknown tag unwrapped, inner kept
        var h11 = bake('<unknownx>keep<b>bold</b></unknownx>');
        out.unknownUnwrapped = !h11.querySelector("unknownx");
        out.unknownInnerKept = !!h11.querySelector("b") && h11.textContent.indexOf("keep") !== -1;
        // 12) style attr stripped
        var h12 = bake('<div style="color:red">s</div>');
        out.styleStripped = h12.querySelector("div") ? !h12.querySelector("div").hasAttribute("style") : false;
        // 13) data-/aria- kept; class kept; arbitrary attr stripped
        var h13 = bake('<div class="c" data-x="1" aria-label="a" foo="bar">k</div>');
        var d13 = h13.querySelector("div");
        out.classKept = d13 ? d13.getAttribute("class") === "c" : false;
        out.dataKept = d13 ? d13.getAttribute("data-x") === "1" : false;
        out.ariaKept = d13 ? d13.getAttribute("aria-label") === "a" : false;
        out.fooStripped = d13 ? !d13.hasAttribute("foo") : false;
        // 14) comment node removed
        out.commentRemoved = (function () { var h = document.createElement("div"); h.appendChild(S("<!-- c -->text")); return h.childNodes.length === 1 && h.childNodes[0].nodeType === 3; })();

        out.ok = true;
      } catch (e) {
        out.ok = false;
        out.error = String(e);
      }
      // snapshot the window flags AFTER a tick — any (stripped) onerror/script would
      // have had a chance to run by now; their staying undefined proves no execution.
      setTimeout(function () {
        out.scriptDidNotRun = (window.__xssScript === undefined);
        out.imgOnerrorDidNotFire = (window.__xssImg === undefined);
        out.svgScriptDidNotRun = (window.__xssSvg === undefined);
        d9sEl.textContent = JSON.stringify(out);
      }, 150);
    })();

    // R174 — Tier 8 D12+D16: getLanguage()/getIcon()/getIconIds()/
    // Platform.resourcePathPrefix (D16) + fileManager.getAvailablePathForAttachment()/
    // getNewFileParent() (D12). getAvailablePathForAttachment is async, so a single
    // async IIFE computes every result and stashes the JSON in a live <div> for the E2E.
    var d1216El = document.createElement("div");
    d1216El.setAttribute("data-testid", "fixture-d1216-results");
    document.body.appendChild(d1216El);
    this.register(function () { d1216El.remove(); });
    (async function () {
      var out = {};
      try {
        // D16-1 getLanguage — current locale string ("en" with the e2e-preset locale)
        out.lang = obsidian.getLanguage();
        out.langIsString = (typeof out.lang === "string");
        // D16-3 getIconIds — all registered icon ids (builtin + addIcon)
        var ids = obsidian.getIconIds();
        out.iconIdsIsArray = Array.isArray(ids);
        out.iconIdsNonEmpty = ids.length > 0;
        // D16-2 getIcon — use a REAL id from getIconIds()[0] (avoids guessing a
        // builtin name that may not exist) → expect an SVGSVGElement
        var builtinId = ids[0];
        var icon = obsidian.getIcon(builtinId);
        out.iconIsSvg = (icon instanceof SVGSVGElement);
        out.iconNullForUnknown = (obsidian.getIcon("no-such-icon-zzz") === null);
        // D16 Platform.resourcePathPrefix — honest "" placeholder
        out.resourcePathPrefix = obsidian.Platform.resourcePathPrefix;
        out.resourcePrefixIsString = (typeof obsidian.Platform.resourcePathPrefix === "string");
        // D12-5 getAvailablePathForAttachment — deduped attachment path string (async)
        var attPath = await self.app.fileManager.getAvailablePathForAttachment("r174-img.png");
        out.attPathIsString = (typeof attPath === "string" && attPath.length > 0);
        out.attPathHasExt = /\\.png$/.test(attPath);
        // D12-6 getNewFileParent — a TFolder with a .path string
        var parent = self.app.fileManager.getNewFileParent("r174-note.md");
        out.parentHasPath = (parent != null && typeof parent.path === "string");
        out.ok = true;
      } catch (e) {
        out.ok = false;
        out.error = String(e);
      }
      d1216El.textContent = JSON.stringify(out);
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
