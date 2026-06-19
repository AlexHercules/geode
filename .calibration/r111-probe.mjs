/**
 * R111 desktop probe — exercises the Obsidian compat binary IO bridge on the REAL Tauri /
 * WKWebView build against the native filesystem (not the Memory adapter). The compat App
 * (`globalThis.app`, built by the plugin loader) bridges Vault.readBinary/createBinary +
 * DataAdapter.readBinary/writeBinary to Geode's native binary IO. Binary OVERWRITE via
 * Vault.modifyBinary is real since R120 (atomic tmp+rename); adapter.writeBinary stays create-only.
 * Run: node .calibration/r111-probe.mjs   (needs src-tauri/target/release/geode)
 *
 * App-Nap discipline (data-safety §D): the round-trip runs immediately in onload, results are
 * written via a fire-and-forget chain, and we poll the result file from the host.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r111-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r111-results.md");

let passed = 0, failed = 0;
const fails = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "seed.md"), "# seed\n");

// Native Geode probe plugin: reaches the COMPAT app at globalThis.app and rounds-trips binary IO
// against the real fs. Writes results progressively (fire-and-forget) to survive App Nap.
const probe = `module.exports = {
  id: "r111-probe", name: "r111-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r111-results.md", b).catch(() => napp.vault.modify("r111-results.md", b).catch(() => {})); };
    rec("boot", true); // immediate marker — proves onload ran + native vault.create works
    // Fire-and-forget: this native plugin loads during loadExternal, BEFORE loadObsidianPlugins
    // publishes window.app. Returning immediately lets loadObsidianPlugins run (awaiting here would
    // deadlock it). The compat App is then polled via IPC vault reads — setTimeout is suspended in
    // the App-Nap dead zone (data-safety §D), but Tauri IPC still drains (the boot write proves it).
    void (async () => {
    try {
      let app = window.app;
      for (let i = 0; i < 50 && !app; i++) { try { await napp.vault.read("seed.md"); } catch { /* drain */ } app = window.app; }
      rec("present", !!app && !!app.vault && typeof app.vault.readBinary === "function");
      if (!app) { rec("done", true); return; }
      const v = app.vault;

      // compat createBinary -> readBinary round-trip (real fs)
      const file = await v.createBinary("r111c.bin", new Uint8Array([10, 20, 30, 255]).buffer);
      rec("tfile", file && file.path);
      const back = await v.readBinary(v.getFileByPath("r111c.bin"));
      rec("rt", [...new Uint8Array(back)]);

      // returned buffer is a copy (mutation must not corrupt the store)
      new Uint8Array(back)[0] = 99;
      const back2 = await v.readBinary(v.getFileByPath("r111c.bin"));
      rec("copy", [...new Uint8Array(back2)]);

      // adapter.writeBinary creates + readBinary round-trips
      await v.adapter.writeBinary("r111a.bin", new Uint8Array([7, 8, 9]).buffer);
      const ab = await v.adapter.readBinary("r111a.bin");
      rec("adapter", [...new Uint8Array(ab)]);

      // modifyBinary now OVERWRITES (R120 — atomic tmp+rename; superseded the R111 gap)
      let modOk = false;
      try { await v.modifyBinary(v.getFileByPath("r111c.bin"), new Uint8Array([1]).buffer); modOk = true; } catch { modOk = false; }
      rec("modOk", modOk);

      // adapter.writeBinary on an EXISTING path throws (no silent truncation)
      let ow = false;
      try { await v.adapter.writeBinary("r111c.bin", new Uint8Array([1]).buffer); } catch { ow = true; }
      rec("overwriteThrew", ow);

      // R111 review MAJOR: untrusted plugin path is guarded (core assertSafeRelPath)
      let esc = false;
      try { await v.createBinary("../escape.bin", new Uint8Array([1]).buffer); } catch { esc = true; }
      rec("escapeThrew", esc);

      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r111-probe.js"), probe);
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

console.log("— compat binary IO bridge on real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat App present (globalThis.app.vault.readBinary)", data.present === true);
ok("compat vault.createBinary returns a TFile", data.tfile === "r111c.bin", JSON.stringify(data.tfile));
ok("compat vault.readBinary round-trips the exact bytes (native fs)", eq(data.rt, [10, 20, 30, 255]), JSON.stringify(data.rt));
ok("returned ArrayBuffer is a copy (store not corrupted by mutation)", eq(data.copy, [10, 20, 30, 255]), JSON.stringify(data.copy));
ok("compat adapter.writeBinary creates + readBinary round-trips", eq(data.adapter, [7, 8, 9]), JSON.stringify(data.adapter));
ok("vault.modifyBinary overwrites an existing binary (R120, no longer a gap)", data.modOk === true);
ok("adapter.writeBinary on existing path throws (no silent truncation)", data.overwriteThrew === true);
ok("untrusted plugin `..` path rejected by core assertSafeRelPath (R111 review fix)", data.escapeThrew === true);

console.log(`\nR111 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
