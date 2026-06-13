/**
 * R39 desktop probe — verifies pinned tabs against the REAL Tauri build (WKWebView
 * has no CDP, so a .geode/plugins probe writes results back to a vault file).
 *
 * Pinned tabs are a workspace STORE op (toggleTabPin + openFile's create-vs-replace
 * decision) — drivable without a live view (App Nap §D). The probe gets the full
 * AppHandle (app.workspace), pins a tab, opens another file, and reads getPanes()
 * truth. The COMMAND (app:toggle-pin, App.tsx useEffect) + UI (double-click, pin
 * icon) are React paths → covered by the browser r39-e2e. Persistence round-trip
 * (sanitizeTab) is covered by the r39-e2e reload test.
 *
 * Run: node .calibration/r39-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 39 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r39-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r39-results.md");

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
  id: "r39-probe", name: "r39-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r39-results.md", body).catch(() =>
        app.vault.modify("r39-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const ws = app.workspace;
      for (const leaf of ws.getPanes()) for (const t of [...leaf.tabs]) ws.closeTab(t.id);
      ws.openFile("a.md");
      const aId = ws.getActiveTab() && ws.getActiveTab().id;
      ws.toggleTabPin(aId);
      const pinned = (ws.getActivePane().tabs.find((t) => t.id === aId) || {}).pinned;
      recFlush("pinnedAfterToggle", pinned === true);                              // true
      ws.openFile("b.md");                                                         // pinned active → new tab
      const tabs1 = ws.getActivePane().tabs;
      recFlush("countAfterPinnedOpen", tabs1.length);                              // 2
      recFlush("aStillA", (tabs1.find((t) => t.id === aId) || {}).filePath);       // a.md
      recFlush("activeAfterPinnedOpen", ws.getActiveFile());                       // b.md
      recFlush("pinnedNoHistory", ws.canTabNavigateBack(aId));                     // false (no phantom record)
      // unpin A, activate, openFile → replace
      ws.toggleTabPin(aId);
      ws.setActiveTab(aId);
      ws.openFile("c.md");
      const tabs2 = ws.getActivePane().tabs;
      recFlush("countAfterUnpinnedOpen", tabs2.length);                            // 2 (replaced, no new tab)
      recFlush("activeAfterUnpinnedOpen", ws.getActiveFile());                     // c.md
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r39-probe.js"), probe);
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
ok("toggleTabPin marks tab pinned", data.pinnedAfterToggle === true, J(data.pinnedAfterToggle));
ok("openFile with pinned active tab → new tab (count 2)", data.countAfterPinnedOpen === 2, J(data.countAfterPinnedOpen));
ok("pinned tab keeps a.md", data.aStillA === "a.md", J(data.aStillA));
ok("active is the new tab b.md", data.activeAfterPinnedOpen === "b.md", J(data.activeAfterPinnedOpen));
ok("pinned tab has no phantom nav history", data.pinnedNoHistory === false, J(data.pinnedNoHistory));
ok("unpinned active tab replaced (count stays 2)", data.countAfterUnpinnedOpen === 2, J(data.countAfterUnpinnedOpen));
ok("unpinned active tab now shows c.md", data.activeAfterUnpinnedOpen === "c.md", J(data.activeAfterUnpinnedOpen));

console.log(`\nR39 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
