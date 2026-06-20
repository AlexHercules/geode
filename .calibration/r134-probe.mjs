/**
 * R134 desktop probe — live-preview plugin code blocks on the real Tauri / WKWebView binary.
 * Run: node .calibration/r134-probe.mjs
 *
 * The live-preview CM editor's React tree + decoration build are App-Nap-throttled in a headless
 * WKWebView with no focus (§D), so the widget DOM doesn't render here — that's covered by browser
 * E2E (r134-e2e 24/24). What IS §D-safe is the SYNCHRONOUS core lang→handler registry: this probe
 * registers a ```probeblock processor through the real Plugin path (__geodeRegisterMarkdownCodeBlock
 * Processor → registerCodeBlockProcessor) and asserts `hasCodeBlockProcessor` flips true on register
 * and false on dispose — i.e. the dual-registration + disposer actually wired the live map on the
 * shipped binary (not just in the bundler).
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r134-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r134-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "live.md"), "# Heading\n\n```probeblock\nhello\n```\n");

const probe = `module.exports = {
  id: "r134-probe", name: "r134-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r134-results.md", b).catch(() => napp.vault.modify("r134-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && typeof window.__geodeRegisterMarkdownCodeBlockProcessor === "function"
        && typeof window.__geodeHasCodeBlockProcessor === "function" && napp.workspace && napp.documents);
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("live.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      rec("beforeRegister", window.__geodeHasCodeBlockProcessor("probeblock")); // expect false
      const dispose = window.__geodeRegisterMarkdownCodeBlockProcessor("probeblock", (source, el) => {
        el.className = "pb-rendered"; el.textContent = "PB:" + source;
      });
      rec("registerable", typeof dispose === "function");
      rec("afterRegister", window.__geodeHasCodeBlockProcessor("probeblock")); // expect true
      dispose();
      rec("afterDispose", window.__geodeHasCodeBlockProcessor("probeblock")); // expect false
      // best-effort: open in live preview (won't render headless §D) — just confirm no crash
      napp.workspace.openFile("live.md");
      const tab = napp.workspace.getActiveTab();
      if (tab) napp.workspace.setTabMode(tab.id, "live");
      for (let i = 0; i < 20; i++) { try { await napp.vault.read("live.md"); } catch { /* drain */ } }
      rec("liveWidget", !!document.querySelector('[data-testid="cm-live-codeblock"]'));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r134-probe.js"), probe);
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

console.log("— live-preview plugin code-block registry on the real WKWebView binary —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat App + core code-block registry present (markdownPostProcessors loads cleanly)", data.present === true);
ok("__geodeRegisterMarkdownCodeBlockProcessor registerable (returns a disposer, no throw)", data.registerable === true);
ok("hasCodeBlockProcessor('probeblock') is false BEFORE registering", data.beforeRegister === false, JSON.stringify(data.beforeRegister));
ok("registering populated the live lang→handler map (hasCodeBlockProcessor → true)", data.afterRegister === true, JSON.stringify(data.afterRegister));
ok("disposing removed it from the live map (hasCodeBlockProcessor → false)", data.afterDispose === false, JSON.stringify(data.afterDispose));
if (data.liveWidget) {
  ok("the ```probeblock live widget rendered (real WKWebView)", data.liveWidget === true);
} else {
  console.log("  · live-preview widget did not render headless (App-Nap, §D) — rendering covered by browser E2E 24/24");
}

console.log(`\nR134 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
