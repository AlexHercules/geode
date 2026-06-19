/**
 * R114 desktop probe — exercises compat metadataCache.getTags() on the REAL Tauri / WKWebView
 * build against the native-fs index. The compat App (globalThis.app) projects core getTagMap
 * (tag→note-path Set, cached) into a `#`-prefixed Record<string,number> (distinct-note counts).
 * Run: node .calibration/r114-probe.mjs   (needs src-tauri/target/release/geode)
 *
 * Timing (data-safety §D, R111/R112): native plugin onload returns immediately (fire-and-forget;
 * awaiting deadlocks loadObsidianPlugins) and polls window.app + the tag index via IPC reads.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r114-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r114-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
// real-fs tag fixtures: #alpha in two notes, #beta once, #Alpha (case), #parent/child (nested)
writeFileSync(join(VAULT, "a.md"), "#alpha #beta\nbody\n");
writeFileSync(join(VAULT, "b.md"), "more #alpha\n");
writeFileSync(join(VAULT, "c.md"), "#Alpha #parent/child\n");

const probe = `module.exports = {
  id: "r114-probe", name: "r114-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r114-results.md", b).catch(() => napp.vault.modify("r114-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      let app = window.app;
      const ready = () => app && app.metadataCache && typeof app.metadataCache.getTags === "function";
      const tagged = () => { try { return app.metadataCache.getTags()["#alpha"] === 2; } catch { return false; } };
      for (let i = 0; i < 80 && !(ready() && tagged()); i++) { try { await napp.vault.read("a.md"); } catch { /* drain */ } app = window.app; }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      const t = app.metadataCache.getTags();
      rec("alpha", t["#alpha"]);
      rec("beta", t["#beta"]);
      rec("Alpha", t["#Alpha"]);
      rec("nested", t["#parent/child"]);
      rec("hashPrefixed", Object.keys(t).every((k) => k.startsWith("#")));
      rec("protoSafe", Object.getPrototypeOf(t) === Object.prototype);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r114-probe.js"), probe);
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

console.log("— compat getTags on the real-fs index —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat metadataCache.getTags present", data.present === true);
ok("#alpha counts 2 distinct notes (a, b)", data.alpha === 2, JSON.stringify(data.alpha));
ok("#beta counts 1", data.beta === 1, JSON.stringify(data.beta));
ok("case-sensitive: #Alpha is a separate key (count 1)", data.Alpha === 1, JSON.stringify(data.Alpha));
ok("nested tag → '#parent/child' (count 1)", data.nested === 1, JSON.stringify(data.nested));
ok("all keys carry the leading '#'", data.hashPrefixed === true);
ok("returned record has a clean prototype (no pollution)", data.protoSafe === true);

console.log(`\nR114 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
