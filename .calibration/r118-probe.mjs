/**
 * R118 desktop probe — exercises the R118 app.commands members (findCommand / executeCommand /
 * editorCommands) on the real Tauri / WKWebView binary over the shared core CommandRegistry.
 * These are registry-level (no editor mount needed), so the desktop semantics are fully verifiable
 * here — unlike R116/R117 (which needed a focused editor). Run: node .calibration/r118-probe.mjs
 *
 * §D/R111: native onload is fire-and-forget (avoids loadObsidianPlugins deadlock) + IPC-polls for
 * the compat App; the registry ops are synchronous module state — no timing fragility.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r118-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r118-results.md");

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
  id: "r118-probe", name: "r118-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r118-results.md", b).catch(() => napp.vault.modify("r118-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && window.app.commands && typeof window.app.commands.findCommand === "function");
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("seed.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      const ran = [];
      const reg = window.app._geode.handle.commands;
      reg.register({ id: "r118p:plain", name: "R118p Plain", callback: () => ran.push("plain") });
      reg.register({ id: "r118p:off", name: () => "R118p Off", callback: () => ran.push("off"), available: () => false });
      const cmds = window.app.commands;
      const f = cmds.findCommand("r118p:plain");
      rec("findId", f && f.id);
      rec("findNameString", f && typeof f.name === "string" && f.name);
      rec("findThunkResolved", cmds.findCommand("r118p:off") ? cmds.findCommand("r118p:off").name : null);
      rec("findUnknown", cmds.findCommand("r118p:nope") === undefined);
      rec("execPlain", cmds.executeCommand({ id: "r118p:plain" }));
      rec("execOff", cmds.executeCommand({ id: "r118p:off" }));
      rec("execUnknown", cmds.executeCommand({ id: "r118p:nope" }));
      rec("ran", ran);
      const ec = cmds.editorCommands;
      rec("editorCommandsEmpty", ec && typeof ec === "object" && Object.keys(ec).length === 0);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r118-probe.js"), probe);
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

console.log("— app.commands R118 members on the real WKWebView binary —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("findCommand present on the workspace commands", data.present === true);
ok("findCommand(id) returns the command", data.findId === "r118p:plain", JSON.stringify(data.findId));
ok("findCommand name is a resolved string", data.findNameString === "R118p Plain", JSON.stringify(data.findNameString));
ok("findCommand resolves a thunk name → 'R118p Off'", data.findThunkResolved === "R118p Off", JSON.stringify(data.findThunkResolved));
ok("findCommand(unknown) → undefined", data.findUnknown === true);
ok("executeCommand({id}) runs + returns true", data.execPlain === true);
ok("executeCommand(available=false) → false, does not run", data.execOff === false && JSON.stringify(data.ran) === JSON.stringify(["plain"]), JSON.stringify(data.ran));
ok("executeCommand(unknown) → false", data.execUnknown === false);
ok("editorCommands is an empty object (no throw)", data.editorCommandsEmpty === true);

console.log(`\nR118 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
