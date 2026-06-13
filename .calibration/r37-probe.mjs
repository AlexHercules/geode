/**
 * R37 desktop probe — verifies back/forward navigation history against the REAL
 * Tauri build (WKWebView has no CDP, so a .geode/plugins probe writes results back
 * to a vault file we read externally).
 *
 * Like R36, R37's CORE feature is a workspace STORE op — drivable without a live
 * view (App Nap §D: backgrounded WKWebView paints nothing → no React effect → no
 * EditorPane). The probe gets the full AppHandle (app.workspace), navigates a tab
 * a→b→c, steps back/forward, reads getActiveFile + canTabNavigate* — store truth.
 * The COMMAND layer (app:navigate-back, registered in App.tsx useEffect) is NOT
 * drivable here (same App Nap reason as R34/R36) → covered by browser r37-e2e.
 * Hotkey grammar reuses the R32 __geodeHotkey.match probe.
 *
 * Run: node .calibration/r37-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 37 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r37-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r37-results.md");

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
for (const f of ["a.md", "b.md", "c.md"]) writeFileSync(join(VAULT, f), `# ${f}\n`);

const probe = `module.exports = {
  id: "r37-probe", name: "r37-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r37-results.md", body).catch(() =>
        app.vault.modify("r37-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const ws = app.workspace;
      // clean slate, then ONE tab navigating a→b→c (openFile replace records old)
      for (const leaf of ws.getPanes()) for (const t of [...leaf.tabs]) ws.closeTab(t.id);
      ws.openFile("a.md"); ws.openFile("b.md"); ws.openFile("c.md");
      const tid = ws.getActiveTab() && ws.getActiveTab().id;
      recFlush("setupActive", ws.getActiveFile());                       // c.md
      recFlush("canBack", ws.canTabNavigateBack(tid));                   // true
      recFlush("canFwd", ws.canTabNavigateForward(tid));                 // false
      ws.navigateBack(); recFlush("back1", ws.getActiveFile());          // b.md
      ws.navigateBack(); recFlush("back2", ws.getActiveFile());          // a.md
      recFlush("canBackAtOldest", ws.canTabNavigateBack(tid));           // false
      ws.navigateBack(); recFlush("backNoop", ws.getActiveFile());       // a.md (no-op)
      ws.navigateForward(); recFlush("fwd1", ws.getActiveFile());        // b.md
      ws.navigateForward(); recFlush("fwd2", ws.getActiveFile());        // c.md
      recFlush("canFwdAtNewest", ws.canTabNavigateForward(tid));         // false
      // new navigation clears forward
      ws.navigateBack();                                                 // b, fwd=[c]
      ws.openFile("a.md");                                               // replace b→a, clears fwd
      const tid2 = ws.getActiveTab() && ws.getActiveTab().id;
      recFlush("newNavActive", ws.getActiveFile());                      // a.md
      recFlush("newNavFwdCleared", ws.canTabNavigateForward(tid2));      // false
      // fresh tab has empty history
      ws.openFile("b.md", { newTab: true });
      const tid3 = ws.getActiveTab() && ws.getActiveTab().id;
      recFlush("freshTabNoBack", ws.canTabNavigateBack(tid3));           // false
      // hotkey grammar (R32 __geodeHotkey) — Mod+Alt+Arrow both platforms
      const H = window.__geodeHotkey;
      recFlush("hkPresent", !!H);
      if (H) {
        const e = (o) => Object.assign({ metaKey:false, ctrlKey:false, shiftKey:false, altKey:false, key:"", code:"" }, o);
        recFlush("hkBackMac", H.match("Mod+Alt+ArrowLeft", e({ metaKey:true, altKey:true, key:"ArrowLeft" }), true));   // true
        recFlush("hkBackWin", H.match("Mod+Alt+ArrowLeft", e({ ctrlKey:true, altKey:true, key:"ArrowLeft" }), false)); // true
        recFlush("hkFwdMac", H.match("Mod+Alt+ArrowRight", e({ metaKey:true, altKey:true, key:"ArrowRight" }), true)); // true
      }
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r37-probe.js"), probe);
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
ok("setup: active = c.md", data.setupActive === "c.md", J(data.setupActive));
ok("canTabNavigateBack=true after a→b→c", data.canBack === true, J(data.canBack));
ok("canTabNavigateForward=false after a→b→c", data.canFwd === false, J(data.canFwd));
ok("back: c → b.md", data.back1 === "b.md", J(data.back1));
ok("back: b → a.md", data.back2 === "a.md", J(data.back2));
ok("canTabNavigateBack=false at oldest", data.canBackAtOldest === false, J(data.canBackAtOldest));
ok("back at oldest → no-op (a.md)", data.backNoop === "a.md", J(data.backNoop));
ok("forward: a → b.md", data.fwd1 === "b.md", J(data.fwd1));
ok("forward: b → c.md", data.fwd2 === "c.md", J(data.fwd2));
ok("canTabNavigateForward=false at newest", data.canFwdAtNewest === false, J(data.canFwdAtNewest));
ok("new nav → a.md", data.newNavActive === "a.md", J(data.newNavActive));
ok("new nav clears forward stack", data.newNavFwdCleared === false, J(data.newNavFwdCleared));
ok("fresh tab has empty back history", data.freshTabNoBack === false, J(data.freshTabNoBack));
ok("__geodeHotkey wired in real binary", data.hkPresent === true, J(data.hkPresent));
ok("Mod+Alt+Left fires Cmd+Alt+Left (mac)", data.hkBackMac === true, J(data.hkBackMac));
ok("Mod+Alt+Left fires Ctrl+Alt+Left (win)", data.hkBackWin === true, J(data.hkBackWin));
ok("Mod+Alt+Right fires Cmd+Alt+Right (mac)", data.hkFwdMac === true, J(data.hkFwdMac));

console.log(`\nR37 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
