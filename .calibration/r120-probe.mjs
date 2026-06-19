/**
 * R120 desktop probe — verifies the REAL atomic binary overwrite path (Rust vault_modify_binary,
 * tmp + rename) on the Tauri / WKWebView build against the native filesystem. This is the ESSENTIAL
 * verification for R120: the browser e2e runs on the Memory adapter (plain set(), no tmp+rename),
 * so "no leftover bytes" is tautological there — only here is the actual atomic-write path exercised.
 * The HOST reads the real on-disk file out-of-band after the run + checks for `.{name}.geode-tmp`
 * residue. Run: node .calibration/r120-probe.mjs   (needs src-tauri/target/release/geode)
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r120-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r120-results.md");
const TARGET = join(VAULT, "r120.bin");
const TMP = join(VAULT, ".r120.bin.geode-tmp");

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
// seed a 10-byte binary on disk (the file to overwrite)
writeFileSync(TARGET, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));

const probe = `module.exports = {
  id: "r120-probe", name: "r120-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r120-results.md", b).catch(() => napp.vault.modify("r120-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && window.app.vault && typeof window.app.vault.modifyBinary === "function");
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("r120.bin"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      const v = window.app.vault;
      const file = () => v.getFileByPath("r120.bin");
      // SHRINK: 10 → 3 bytes (a non-atomic truncate-in-place would leave 7 leftover bytes)
      await v.modifyBinary(file(), new Uint8Array([99, 88, 77]).buffer);
      rec("afterShrink", [...new Uint8Array(await v.readBinary(file()))]);
      // GROW back: 3 → 8 bytes
      await v.modifyBinary(file(), new Uint8Array([10, 20, 30, 40, 50, 60, 255, 0]).buffer);
      rec("afterGrow", [...new Uint8Array(await v.readBinary(file()))]);
      // path guard
      let esc = false;
      try { await v.modifyBinary({ path: "../escape.bin" }, new Uint8Array([1]).buffer); } catch { esc = true; }
      rec("escapeThrew", esc);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r120-probe.js"), probe);
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

console.log("— atomic binary overwrite on the real filesystem —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat modifyBinary present", data.present === true);
ok("SHRINK 10→3: readBinary returns exactly [99,88,77] (no leftover)", eq(data.afterShrink, [99, 88, 77]), JSON.stringify(data.afterShrink));
ok("GROW 3→8: readBinary returns exactly the new bytes", eq(data.afterGrow, [10, 20, 30, 40, 50, 60, 255, 0]), JSON.stringify(data.afterGrow));
ok("modifyBinary rejects a `..` escape path (safe_join + assertSafeRelPath)", data.escapeThrew === true);

// out-of-band: the HOST reads the ACTUAL on-disk file + checks for tmp residue (the real atomic path)
console.log("— host reads the real on-disk file (out-of-band) —");
const onDisk = existsSync(TARGET) ? [...readFileSync(TARGET)] : null;
ok("the on-disk r120.bin is EXACTLY the last write (8 bytes, no truncation/leftover)", eq(onDisk, [10, 20, 30, 40, 50, 60, 255, 0]), JSON.stringify(onDisk));
ok("no `.r120.bin.geode-tmp` residue left behind (tmp cleaned by rename)", !existsSync(TMP));
ok("no escape file leaked outside the vault", !existsSync(join(here, "escape.bin")) && !existsSync(resolve(VAULT, "../escape.bin")));

console.log(`\nR120 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
