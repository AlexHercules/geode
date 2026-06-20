/**
 * R135 desktop probe — MarkdownPostProcessorContext addChild lifecycle on the real Tauri / WKWebView
 * binary. Run: node .calibration/r135-probe.mjs
 *
 * The real ctx lifecycle fires through a render (reading-view React tree / live CM widget), which is
 * App-Nap-throttled in a headless WKWebView with no focus (§D) — that's covered by browser E2E
 * (r135-e2e 15/15). What IS §D-safe is the SYNCHRONOUS core lifecycle: __geodeProbeRenderChild builds
 * a RenderChildOwner + a real MarkdownRenderChild, runs addChild (loads) then unload, and reports the
 * order — proving the new lifecycle + the compat MarkdownRenderChild class work on the shipped binary.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r135-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r135-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "live.md"), "# Heading\n\n```lcblock\nhello\n```\n");

const probe = `module.exports = {
  id: "r135-probe", name: "r135-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r135-results.md", b).catch(() => napp.vault.modify("r135-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && typeof window.__geodeProbeRenderChild === "function" && napp.workspace);
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("live.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      const r = window.__geodeProbeRenderChild(); // synchronous RenderChildOwner + MarkdownRenderChild
      rec("afterAdd", r.afterAdd);       // expect ["load"]
      rec("afterUnload", r.afterUnload); // expect ["load","unload"]
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r135-probe.js"), probe);
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

const eq = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

console.log("— MarkdownPostProcessorContext addChild lifecycle on the real WKWebView binary —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat App + RenderChildOwner/MarkdownRenderChild present (loads cleanly)", data.present === true);
ok("addChild loaded the child immediately (onload fired)", eq(data.afterAdd, ["load"]), JSON.stringify(data.afterAdd));
ok("owner.unload unloaded the child after load (onunload fired, in order)", eq(data.afterUnload, ["load", "unload"]), JSON.stringify(data.afterUnload));

console.log(`\nR135 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
