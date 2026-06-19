/**
 * R113 desktop probe — exercises compat app.commands on the REAL Tauri / WKWebView build.
 * The compat App (globalThis.app, built by the plugin loader) exposes executeCommandById /
 * listCommands / commands over the SAME core CommandRegistry the native palette uses. Run:
 * node .calibration/r113-probe.mjs   (needs src-tauri/target/release/geode)
 *
 * Timing (data-safety §D, R111/R112): native .geode/plugins load during loadExternal — BEFORE
 * loadObsidianPlugins publishes window.app — so onload returns immediately (fire-and-forget;
 * awaiting would deadlock loadObsidianPlugins) and polls window.app via IPC vault reads (IPC
 * drains under App-Nap; setTimeout does not). Commands are seeded into the shared registry via
 * the compat App's internal bridge, then driven through app.commands.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r113-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r113-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "seed.md"), "# seed\n");

const probe = `module.exports = {
  id: "r113-probe", name: "r113-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r113-results.md", b).catch(() => napp.vault.modify("r113-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      let app = window.app;
      for (let i = 0; i < 60 && !(app && app.commands); i++) { try { await napp.vault.read("seed.md"); } catch { /* drain */ } app = window.app; }
      rec("present", !!app && !!app.commands && typeof app.commands.executeCommandById === "function");
      if (!app || !app.commands) { rec("done", true); return; }
      const ran = [];
      const reg = app._geode.handle.commands;
      reg.register({ id: "r113p:plain", name: "R113p Plain", callback: () => ran.push("plain") });
      reg.register({ id: "r113p:off", name: () => "R113p Off", callback: () => ran.push("off"), available: () => false });
      const cmds = app.commands;
      const ePlain = cmds.executeCommandById("r113p:plain");
      const eOff = cmds.executeCommandById("r113p:off");
      const eNope = cmds.executeCommandById("r113p:nope");
      rec("ePlain", ePlain);
      rec("eOff", eOff);
      rec("eNope", eNope);
      rec("ran", ran);
      const list = cmds.listCommands();
      rec("hasPlain", list.some((c) => c.id === "r113p:plain"));
      rec("namesAllString", list.every((c) => typeof c.name === "string"));
      const offCmd = list.find((c) => c.id === "r113p:off");
      rec("thunkResolved", offCmd ? offCmd.name : null);
      rec("recordPlain", cmds.commands["r113p:plain"] ? cmds.commands["r113p:plain"].name : null);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r113-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 25000;
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

console.log("— compat app.commands on the real registry —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat App.commands present (executeCommandById)", data.present === true);
ok("executeCommandById(plain) → true", data.ePlain === true, JSON.stringify(data.ePlain));
ok("executeCommandById(available=false) → false", data.eOff === false, JSON.stringify(data.eOff));
ok("executeCommandById(unknown) → false", data.eNope === false, JSON.stringify(data.eNope));
ok("only the plain command actually ran (gated one did NOT)", JSON.stringify(data.ran) === JSON.stringify(["plain"]), JSON.stringify(data.ran));
ok("listCommands includes the seeded command", data.hasPlain === true);
ok("listCommands names are all resolved strings (thunks resolved)", data.namesAllString === true);
ok("thunk name resolves → 'R113p Off'", data.thunkResolved === "R113p Off", JSON.stringify(data.thunkResolved));
ok("commands[id] maps with resolved string name", data.recordPlain === "R113p Plain", JSON.stringify(data.recordPlain));

console.log(`\nR113 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
