/**
 * R32 desktop probe — drives window.__geodeHotkey against the REAL Tauri build
 * (WKWebView has no CDP, so a .geode/plugins probe writes results back to a
 * vault file we read externally). Validates the hotkey grammar on the real
 * desktop runtime: platform detection, normalize (Mod≠Ctrl), match (both
 * platform branches, deterministic via explicit isMac), and format glyphs.
 *
 * Run: node .calibration/r32-probe.mjs   (release binary must be built)
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r32-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r32-results.md");

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
writeFileSync(join(VAULT, "note.md"), "# Note\n");

// probe plugin: exercises window.__geodeHotkey on the real WKWebView runtime.
// Event-like objects are plain literals (KeyEventLike structural type).
const probe = `module.exports = {
  id: "r32-probe", name: "r32-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r32-results.md", body).catch(() =>
        app.vault.modify("r32-results.md", body).catch(() => {}));
    };
    const H = window.__geodeHotkey;
    const ev = (o) => Object.assign({ metaKey:false, ctrlKey:false, shiftKey:false, altKey:false, key:"p", code:"KeyP" }, o);
    try {
      rec("present", !!H);
      rec("isMac", H.isMac);
      // normalize: Mod preserved distinct from Ctrl
      rec("norm_mod", H.normalize("mod+p"));
      rec("norm_ctrl", H.normalize("ctrl+p"));
      rec("norm_order", H.normalize("shift+mod+e"));
      // match — mac branch
      rec("mac_mod_meta", H.match("Mod+P", ev({ metaKey:true }), true));
      rec("mac_mod_ctrl", H.match("Mod+P", ev({ ctrlKey:true }), true));
      rec("mac_ctrl_phys", H.match("Ctrl+P", ev({ ctrlKey:true }), true));
      rec("mac_exact_shift", H.match("Mod+P", ev({ metaKey:true, shiftKey:true }), true));
      rec("mac_punct", H.match("Mod+,", ev({ metaKey:true, key:",", code:"Comma" }), true));
      // match — non-mac branch
      rec("win_mod_ctrl", H.match("Mod+P", ev({ ctrlKey:true }), false));
      rec("win_mod_meta", H.match("Mod+P", ev({ metaKey:true }), false));
      // format both branches
      rec("fmt_mac", H.format("Mod+Shift+E", true));
      rec("fmt_win", H.format("Mod+Shift+E", false));
      rec("fmt_mac_arrow", H.format("Mod+Alt+ArrowRight", true));
    } catch (e) { rec("error", String(e)); }
    flush();
  }
};
`;
writeFileSync(join(PLUGINS, "r32-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 16000;
let raw = null;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) {
    raw = readFileSync(RESULTS, "utf8");
    if (raw.includes("fmt_mac_arrow=")) break;
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

console.log("— desktop probe assertions (real runtime) —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("__geodeHotkey present", data.present === true);
ok("real mac runtime detected (isMac=true)", data.isMac === true, JSON.stringify(data.isMac));
ok("normalize mod+p → Mod+P", data.norm_mod === "Mod+P", JSON.stringify(data.norm_mod));
ok("normalize ctrl+p → Ctrl+P (distinct)", data.norm_ctrl === "Ctrl+P", JSON.stringify(data.norm_ctrl));
ok("normalize shift+mod+e → Mod+Shift+E", data.norm_order === "Mod+Shift+E", JSON.stringify(data.norm_order));
ok("mac: Mod+P matches Cmd (metaKey)", data.mac_mod_meta === true);
ok("mac: Mod+P does NOT match Ctrl", data.mac_mod_ctrl === false);
ok("mac: Ctrl+P matches physical Ctrl", data.mac_ctrl_phys === true);
ok("mac: exact equality rejects extra Shift", data.mac_exact_shift === false);
ok("mac: Mod+, matches via physical code", data.mac_punct === true);
ok("win: Mod+P matches Ctrl (ctrlKey)", data.win_mod_ctrl === true);
ok("win: Mod+P does NOT match Meta", data.win_mod_meta === false);
ok("format(mac) Mod+Shift+E → ⇧⌘E", data.fmt_mac === "⇧⌘E", JSON.stringify(data.fmt_mac));
ok("format(win) Mod+Shift+E → Ctrl+Shift+E", data.fmt_win === "Ctrl+Shift+E", JSON.stringify(data.fmt_win));
ok("format(mac) Mod+Alt+ArrowRight → ⌥⌘→", data.fmt_mac_arrow === "⌥⌘→", JSON.stringify(data.fmt_mac_arrow));

console.log(`\nR32 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
