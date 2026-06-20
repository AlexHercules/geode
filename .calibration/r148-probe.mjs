/**
 * R148 desktop probe — verifies compat Keymap.isModifier on the REAL Tauri/WKWebView build via the
 * __geodeKeymapIsModifier hook (synchronous, App-Nap-safe). The real WKWebView UA includes
 * "Macintosh" → Platform.isMacOS=true → "Mod" resolves to metaKey (Cmd), which a headless-chromium
 * browser run can't pin down — so this probe asserts the macOS-specific Mod branch on the binary.
 *
 * Run: node .calibration/r148-probe.mjs   (release binary must be built WITH R148)
 * Contract: docs/ARCHITECTURE.md "Round 148 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r148-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r148-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "seed.md"), "# Seed\n");

const probe = `module.exports = {
  id: "r148-probe", name: "r148-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r148-results.md", b).catch(() => app.vault.modify("r148-results.md", b).catch(() => {})); };
    try {
      const M = (globalThis).__geodeKeymapIsModifier;
      rec("present", typeof M === "function");
      rec("ctrl", M("Ctrl", { ctrl: true }));
      rec("ctrlNo", M("Ctrl", { meta: true }));
      rec("meta", M("Meta", { meta: true }));
      rec("shift", M("Shift", { shift: true }));
      rec("alt", M("Alt", { alt: true }));
      // macOS binary: Mod = Cmd (metaKey)
      rec("modIsMeta", M("Mod", { meta: true }));
      rec("modNotCtrl", M("Mod", { ctrl: true }));
      rec("isMac", (navigator.userAgent || "").includes("Macintosh"));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r148-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 16000;
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
const J = (v) => JSON.stringify(v);

console.log("— Keymap.isModifier on real WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeKeymapIsModifier present", data.present === true);
ok("Ctrl + {ctrl} → true", data.ctrl === true, J(data.ctrl));
ok("Ctrl + {meta} → false", data.ctrlNo === false, J(data.ctrlNo));
ok("Meta + {meta} → true", data.meta === true, J(data.meta));
ok("Shift + {shift} → true", data.shift === true, J(data.shift));
ok("Alt + {alt} → true", data.alt === true, J(data.alt));
ok("real binary UA is macOS (Macintosh)", data.isMac === true, J(data.isMac));
ok("Mod + {meta} → true on macOS (Mod=Cmd)", data.modIsMeta === true, J(data.modIsMeta));
ok("Mod + {ctrl} → false on macOS (Ctrl is not Mod here)", data.modNotCtrl === false, J(data.modNotCtrl));

console.log(`\nR148 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
