/**
 * R122 desktop probe — verifies compat DataAdapter.writeBinary (create-or-overwrite) on the real
 * Tauri / WKWebView fs, INCLUDING the R122-review data-safety fix: vault_modify_binary now uses a
 * UNIQUE temp per writer, so N concurrent same-path writes leave ONE COMPLETE buffer on disk
 * (last-writer-wins), never a torn half-A-half-B mix (the shared-temp clobber R17 root cause). The
 * HOST reads the real on-disk files out-of-band. Run: node .calibration/r122-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r122-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r122-results.md");

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
writeFileSync(join(VAULT, "existing.bin"), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));

const N = 16; // concurrent writers
const LEN = 4096; // each writes a buffer filled with its own index → torn mix is detectable
const probe = `module.exports = {
  id: "r122-probe", name: "r122-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r122-results.md", b).catch(() => napp.vault.modify("r122-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && window.app.vault && window.app.vault.adapter);
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("existing.bin"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      const a = window.app.vault.adapter;
      // create a new file
      await a.writeBinary("new.bin", new Uint8Array([11, 22, 33]).buffer);
      rec("created", [...new Uint8Array(await a.readBinary("new.bin"))]);
      // overwrite an existing file
      await a.writeBinary("existing.bin", new Uint8Array([99, 88]).buffer);
      rec("overwritten", [...new Uint8Array(await a.readBinary("existing.bin"))]);
      // CONCURRENCY: ${N} writers to the SAME path, each a ${LEN}-byte buffer filled with its index
      await Promise.all(Array.from({ length: ${N} }, (_, i) =>
        a.writeBinary("conc.bin", new Uint8Array(${LEN}).fill(i).buffer)));
      const c = new Uint8Array(await a.readBinary("conc.bin"));
      rec("concLen", c.length);
      rec("concAllSame", c.every((b) => b === c[0]));
      rec("concVal", c[0]);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r122-probe.js"), probe);
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

console.log("— create-or-overwrite + concurrent-write atomicity on the real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat adapter present", data.present === true);
ok("writeBinary creates a new file", eq(data.created, [11, 22, 33]), JSON.stringify(data.created));
ok("writeBinary overwrites an existing file (10→2 = exactly [99,88])", eq(data.overwritten, [99, 88]), JSON.stringify(data.overwritten));
ok(`${N} concurrent same-path writes → final file is full length (${LEN}, complete, not partial)`, data.concLen === LEN, JSON.stringify(data.concLen));
ok("concurrent result is ONE writer's COMPLETE buffer (all bytes identical, NOT a torn mix)", data.concAllSame === true, JSON.stringify({ same: data.concAllSame, val: data.concVal }));

// out-of-band: HOST reads the real on-disk files + checks for temp residue
console.log("— host reads the real on-disk files (out-of-band) —");
const concDisk = existsSync(join(VAULT, "conc.bin")) ? readFileSync(join(VAULT, "conc.bin")) : null;
ok("on-disk conc.bin is full length + a single value (no torn write)", concDisk && concDisk.length === LEN && concDisk.every((b) => b === concDisk[0]), concDisk ? `len=${concDisk.length} same=${concDisk.every((b) => b === concDisk[0])}` : "null");
ok("on-disk existing.bin is exactly [99,88] (overwrite, no leftover)", eq(existsSync(join(VAULT, "existing.bin")) ? [...readFileSync(join(VAULT, "existing.bin"))] : null, [99, 88]));
const stray = readdirSync(VAULT).filter((f) => f.endsWith(".geode-tmp"));
ok("no .geode-tmp residue after concurrent writes (each writer's unique temp was renamed away)", stray.length === 0, JSON.stringify(stray));

console.log(`\nR122 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
