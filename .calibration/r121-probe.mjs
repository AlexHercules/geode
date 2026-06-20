/**
 * R121 desktop probe — verifies app.commands.removeCommand on the real Tauri / WKWebView binary
 * over the shared core CommandRegistry (registry-level, no editor mount — fully verifiable here,
 * like R118/R120). register → removeCommand(id) → assert the id is gone from findCommand/listCommands/
 * commands; unknown id is a no-op; the kept command survives. Run: node .calibration/r121-probe.mjs
 *
 * §D/R111: native onload is fire-and-forget (avoids loadObsidianPlugins deadlock) + IPC-polls; the
 * registry ops are synchronous module state — no timing fragility.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r121-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r121-results.md");

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
  id: "r121-probe", name: "r121-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r121-results.md", b).catch(() => napp.vault.modify("r121-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && window.app.commands && typeof window.app.commands.removeCommand === "function");
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("seed.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      const reg = window.app._geode.handle.commands;
      reg.register({ id: "r121p:doomed", name: "R121p Doomed", callback: () => {} });
      reg.register({ id: "r121p:keep", name: "R121p Keep", callback: () => {} });
      const cmds = window.app.commands;
      rec("before", !!cmds.findCommand("r121p:doomed"));
      const ret = cmds.removeCommand("r121p:doomed");
      rec("retVoid", ret === undefined);
      rec("findGone", cmds.findCommand("r121p:doomed") === undefined);
      rec("execGone", cmds.executeCommandById("r121p:doomed") === false);
      rec("listGone", !cmds.listCommands().some((c) => c.id === "r121p:doomed"));
      rec("keepAlive", cmds.findCommand("r121p:keep") ? cmds.findCommand("r121p:keep").name : null);
      let threw = false;
      try { cmds.removeCommand("r121p:never"); } catch { threw = true; }
      rec("unknownNoThrow", !threw);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r121-probe.js"), probe);
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

console.log("— app.commands.removeCommand on the real WKWebView binary —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("removeCommand present", data.present === true);
ok("command present before removal", data.before === true);
ok("removeCommand returns undefined (void)", data.retVoid === true);
ok("findCommand(removed) → undefined", data.findGone === true);
ok("executeCommandById(removed) → false", data.execGone === true);
ok("listCommands no longer includes the removed id", data.listGone === true);
ok("the kept command survives removal", data.keepAlive === "R121p Keep", JSON.stringify(data.keepAlive));
ok("removeCommand(unknown) is a no-op (no throw)", data.unknownNoThrow === true);

console.log(`\nR121 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
