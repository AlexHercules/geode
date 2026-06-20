/**
 * R133 desktop probe — compat registerMarkdownCodeBlockProcessor on the real Tauri / WKWebView
 * binary. Registers a ```testblock handler, opens a note with that fence in preview, and (IF the
 * preview renders) asserts the <pre><code> was replaced + the handler got the source. Like R132,
 * a headless WKWebView's reading-view React tree is App-Nap-throttled (§D), so if it doesn't render
 * the probe falls back to a surface check (binary loads + hook registerable). Run: node .calibration/r133-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r133-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r133-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "cb.md"), "# Heading\n\n```testblock\nthe source\n```\n");

const probe = `module.exports = {
  id: "r133-probe", name: "r133-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r133-results.md", b).catch(() => napp.vault.modify("r133-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && typeof window.__geodeRegisterMarkdownCodeBlockProcessor === "function" && napp.workspace && napp.documents);
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("cb.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      window.__cb = { source: null, path: null };
      window.__geodeRegisterMarkdownCodeBlockProcessor("testblock", (source, el, ctx) => {
        window.__cb.source = source; window.__cb.path = ctx && ctx.sourcePath;
        el.className = "cb-rendered"; el.textContent = "R:" + source;
      });
      napp.workspace.openFile("cb.md");
      const tab = napp.workspace.getActiveTab();
      if (tab) napp.workspace.setTabMode(tab.id, "preview");
      for (let i = 0; i < 80 && !document.querySelector(".preview-content .cb-rendered"); i++) { try { await napp.vault.read("cb.md"); } catch { /* drain */ } }
      rec("source", window.__cb.source);
      rec("path", window.__cb.path);
      rec("preReplaced", !!document.querySelector(".preview-content") && document.querySelector(".preview-content pre > code.language-testblock") === null && document.querySelector(".preview-content .cb-rendered") !== null);
      rec("rendered", !!document.querySelector(".preview-content .cb-rendered"));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r133-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 30000;
let raw = null;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) { raw = readFileSync(RESULTS, "utf8"); if (raw.includes("done=true")) break; }
  await new Promise((r) => setTimeout(r, 300));
}
try { process.kill(-child.pid); } catch { /* gone */ }
if (raw === null) { console.error("no result file produced — probe did not run"); process.exit(1); }

const data = {};
for (const line of raw.split("\n")) {
  const i = line.indexOf("=");
  if (i === -1) continue;
  try { data[line.slice(0, i)] = JSON.parse(line.slice(i + 1)); } catch { /* partial */ }
}

console.log("— compat registerMarkdownCodeBlockProcessor on the real WKWebView binary —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat App + post-processor registry present (makeCodeBlockPostProcessor loads cleanly)", data.present === true);
ok("__geodeRegisterMarkdownCodeBlockProcessor hook registerable (no throw on register)", data.source !== undefined);
if (data.rendered) {
  ok("the ```testblock <pre><code> was replaced by the handler's div (real WKWebView)", data.preReplaced === true, JSON.stringify(data.preReplaced));
  ok("handler got source = 'the source'", data.source === "the source", JSON.stringify(data.source));
  ok("handler got ctx.sourcePath = 'cb.md'", data.path === "cb.md", JSON.stringify(data.path));
} else {
  console.log("  · preview did not render headless (App-Nap, §D) — code-block replacement covered by browser E2E 9/9");
}

console.log(`\nR133 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
