/**
 * R36 desktop probe — verifies tab keyboard shortcuts against the REAL Tauri build
 * (WKWebView has no CDP, so a .geode/plugins probe writes results back to a vault
 * file we read externally).
 *
 * UNLIKE R34 (find/replace) and R35 (closeBrackets), R36's CORE feature is a
 * workspace STORE operation — it does NOT need a live CM view (App Nap §D: a
 * backgrounded WKWebView paints nothing → React effects never run → no EditorPane).
 * So the desktop binary CAN drive the real store layer: the probe gets the full
 * AppHandle (app.workspace), opens tabs, switches/reopens them, reads store truth —
 * a stronger probe surface than R34/R35's pure-function-only.
 *
 * What is NOT drivable here is the COMMAND layer: App.tsx registers app:next-tab
 * etc. inside a useEffect, which never runs in a backgrounded WKWebView (same App
 * Nap §D reason editor:* commands are absent — R34). So command registration +
 * execution is covered by the browser r36-e2e (real foreground render); this probe
 * drives ws.* directly. Hotkey grammar reuses the R32 __geodeHotkey.match probe.
 *
 * Run: node .calibration/r36-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 36 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r36-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r36-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) {
  console.error(`release binary not found: ${BIN}`);
  process.exit(2);
}

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
for (const f of ["a.md", "b.md", "c.md", "d.md"]) writeFileSync(join(VAULT, f), `# ${f}\n`);

// probe plugin: drives the REAL workspace store ops + command layer on the actual
// WKWebView runtime (no live view needed — store ops don't paint). App Nap §D:
// flush after EACH record fire-and-forget, keep work in the first few seconds,
// "done" is the sentinel last key.
const probe = `module.exports = {
  id: "r36-probe", name: "r36-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r36-results.md", body).catch(() =>
        app.vault.modify("r36-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const ws = app.workspace;
      const files = ["a.md", "b.md", "c.md", "d.md"];
      // clean slate: close any existing/restored tabs
      for (const leaf of ws.getPanes()) for (const t of [...leaf.tabs]) ws.closeTab(t.id);
      ws.openFile(files[0]);
      for (let i = 1; i < files.length; i++) ws.openFile(files[i], { newTab: true });
      recFlush("setupTabs", ws.getActivePane().tabs.map((t) => t.filePath).join(","));      // a,b,c,d
      recFlush("setupActive", ws.getActiveFile());                                          // d.md

      ws.activateTabAt(0); recFlush("at0", ws.getActiveFile());                             // a.md
      ws.cycleActiveTab(1); recFlush("cycleNext", ws.getActiveFile());                      // b.md
      ws.cycleActiveTab(-1); ws.cycleActiveTab(-1); recFlush("cycleWrapPrev", ws.getActiveFile()); // a→d wrap
      ws.activateLastTab(); recFlush("last", ws.getActiveFile());                           // d.md
      ws.activateTabAt(99); recFlush("outOfRange", ws.getActiveFile());                     // d.md (no-op)

      // NOTE: the COMMAND layer (app:next-tab etc.) is registered in App.tsx's
      // useEffect, which NEVER runs in a backgrounded WKWebView (App Nap §D / R34:
      // no paint → no React effect → app-level commands stay unregistered). So we
      // do NOT drive app.commands here — command registration + execution is
      // covered by the browser r36-e2e (real foreground render). What IS drivable
      // is the store layer below: ws.* methods are plain calls, not effect-gated.

      // reopen (LIFO) + view-mode restore
      ws.activateTabAt(2);
      const cTab = ws.getActiveTab();
      ws.setTabMode(cTab.id, "source");
      ws.closeTab(cTab.id);
      recFlush("afterClose", ws.getActivePane().tabs.map((t) => t.filePath).join(","));     // a,b,d
      const reopened = ws.reopenClosedTab();
      recFlush("reopened", reopened);                                                       // true
      recFlush("reopenActive", ws.getActiveFile());                                         // c.md
      recFlush("reopenMode", ws.getActiveTab() && ws.getActiveTab().mode);                  // source

      // hotkey grammar (R32 __geodeHotkey) — literal Ctrl vs Mod across platforms
      const H = window.__geodeHotkey;
      recFlush("hkPresent", !!H);
      if (H) {
        const e = (o) => Object.assign({ metaKey:false, ctrlKey:false, shiftKey:false, altKey:false, key:"", code:"" }, o);
        recFlush("hkCtrlTabMac", H.match("Ctrl+Tab", e({ ctrlKey:true, key:"Tab" }), true));        // true
        recFlush("hkCmdTabNoFireMac", H.match("Ctrl+Tab", e({ metaKey:true, key:"Tab" }), true));   // false
        recFlush("hkMod1Mac", H.match("Mod+1", e({ metaKey:true, key:"1" }), true));                // true
        recFlush("hkMod1Win", H.match("Mod+1", e({ ctrlKey:true, key:"1" }), false));               // true
        recFlush("hkModShiftTMac", H.match("Mod+Shift+T", e({ metaKey:true, shiftKey:true, key:"t" }), true)); // true
      }
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r36-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 16000;
let raw = null;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) {
    raw = readFileSync(RESULTS, "utf8");
    if (raw.includes("done=")) break;
  }
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

const J = (v) => JSON.stringify(v);

console.log("— desktop probe assertions (real WKWebView runtime, store-driven) —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("setup: 4 tabs [a,b,c,d]", data.setupTabs === "a.md,b.md,c.md,d.md", J(data.setupTabs));
ok("setup: active = d.md", data.setupActive === "d.md", J(data.setupActive));
ok("activateTabAt(0) → a.md", data.at0 === "a.md", J(data.at0));
ok("cycle(+1) a → b.md", data.cycleNext === "b.md", J(data.cycleNext));
ok("cycle(-1)x2 b → a → d.md (wrap)", data.cycleWrapPrev === "d.md", J(data.cycleWrapPrev));
ok("activateLastTab() → d.md", data.last === "d.md", J(data.last));
ok("activateTabAt(99) out-of-range → no-op (d.md)", data.outOfRange === "d.md", J(data.outOfRange));
ok("after closing c → [a,b,d]", data.afterClose === "a.md,b.md,d.md", J(data.afterClose));
ok("reopenClosedTab() → true", data.reopened === true, J(data.reopened));
ok("reopen restores c.md as active", data.reopenActive === "c.md", J(data.reopenActive));
ok("reopen restores source mode", data.reopenMode === "source", J(data.reopenMode));
ok("__geodeHotkey wired in real binary", data.hkPresent === true, J(data.hkPresent));
ok("Ctrl+Tab fires on physical Ctrl+Tab (mac)", data.hkCtrlTabMac === true, J(data.hkCtrlTabMac));
ok("Ctrl+Tab does NOT fire on Cmd+Tab (mac)", data.hkCmdTabNoFireMac === false, J(data.hkCmdTabNoFireMac));
ok("Mod+1 → Cmd+1 (mac)", data.hkMod1Mac === true, J(data.hkMod1Mac));
ok("Mod+1 → Ctrl+1 (win)", data.hkMod1Win === true, J(data.hkMod1Win));
ok("Mod+Shift+T → Cmd+Shift+T (mac)", data.hkModShiftTMac === true, J(data.hkModShiftTMac));

console.log(`\nR36 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
