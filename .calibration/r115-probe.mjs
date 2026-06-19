/**
 * R115 desktop probe — verifies the core editor-extension REGISTRY works on the real Tauri /
 * WKWebView binary: registering a CM6 extension grows the registry + bumps the revision, and the
 * disposer shrinks it back + bumps again. (The view-integration — extension actually reaching a
 * mounted .cm-editor — is proven by the browser E2E; per §D the desktop probe verifies SYNC logic
 * only, never a React/DOM mount, which App-Nap throttles.) Run: node .calibration/r115-probe.mjs
 *
 * Native onload is fire-and-forget (avoids the loadObsidianPlugins deadlock) and polls the always-on
 * __geode* hooks via IPC reads. The registry ops are synchronous module state — no timing fragility.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r115-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r115-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "note.md"), "# note\n");

const probe = `module.exports = {
  id: "r115-probe", name: "r115-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r115-results.md", b).catch(() => napp.vault.modify("r115-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => typeof globalThis.__geodeRegisterEditorExtension === "function" && typeof globalThis.__geodeEditorExtState === "function";
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("note.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      const s0 = globalThis.__geodeEditorExtState();
      const dispose = globalThis.__geodeRegisterEditorExtension("data-r115", "on");
      const s1 = globalThis.__geodeEditorExtState();
      dispose();
      const s2 = globalThis.__geodeEditorExtState();
      const disposeAgainOk = (() => { try { dispose(); return true; } catch { return false; } })();
      const s3 = globalThis.__geodeEditorExtState();
      rec("registerGrew", s1.count === s0.count + 1);
      rec("registerBumped", s1.rev > s0.rev);
      rec("disposeShrank", s2.count === s0.count);
      rec("disposeBumped", s2.rev > s1.rev);
      rec("idempotent", disposeAgainOk && s3.count === s2.count && s3.rev === s2.rev);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r115-probe.js"), probe);
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

console.log("— editorExtensions registry on the real WKWebView binary —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("registry + register hook present", data.present === true);
ok("register grows the registry by 1", data.registerGrew === true);
ok("register bumps the revision", data.registerBumped === true);
ok("dispose shrinks the registry back", data.disposeShrank === true);
ok("dispose bumps the revision again (drives view reconfigure)", data.disposeBumped === true);
ok("dispose is idempotent (second call no-op, no extra bump)", data.idempotent === true);

console.log(`\nR115 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
