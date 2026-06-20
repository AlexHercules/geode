/**
 * R127 desktop probe — verifies compat getFileCache(file).footnotes + footnoteRefs on the real
 * Tauri / WKWebView fs index: `[^id]: content` DEFINITIONS (footnotes) + inline `[^id]` REFERENCES
 * (footnoteRefs), both {id (no caret), position}, and the masking (a `[^id]` inside fenced code or
 * frontmatter is excluded). Metadata-level (no editor mount) → fully verifiable on desktop, like
 * R119/R124/R125/R126. Fixture written HOST-side so the ``` fence stays out of the probe template.
 * Run: node .calibration/r127-probe.mjs   (needs the release binary)
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r127-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r127-results.md");

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
// fixture written HOST-side. refs ^1/^note in body; ^z (frontmatter) + ^x (fenced code) excluded;
// defs ^1/^note. line map (0-based): 5=refs, 8=^x fenced, 11=def^1, 12=def^note.
const FN = [
  "---",
  'fmref: "see [^z] here"',
  "---",
  "# Notes",
  "",
  "Ref [^1] and [^note].",
  "",
  "```",
  "code [^x]",
  "```",
  "",
  "[^1]: def one",
  "[^note]: def two",
  "",
].join("\n");
writeFileSync(join(VAULT, "fn.md"), FN);

const probe = `module.exports = {
  id: "r127-probe", name: "r127-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r127-results.md", b).catch(() => napp.vault.modify("r127-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && window.app.metadataCache && window.app.vault);
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("fn.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      await napp.vault.read("fn.md").catch(() => {});
      const cache = () => window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("fn.md"));
      for (let i = 0; i < 40 && !(cache() && cache().footnotes && cache().footnoteRefs && cache().footnotes.length >= 2 && cache().footnoteRefs.length >= 2); i++) { try { await napp.vault.read("fn.md"); } catch { /* drain */ } }
      const c = cache();
      const defs = c && c.footnotes ? c.footnotes : null;
      const refs = c && c.footnoteRefs ? c.footnoteRefs : null;
      rec("defIds", defs ? defs.map((d) => d.id) : null);
      rec("defLines", defs ? defs.map((d) => d.position.start.line) : null);
      rec("refIds", refs ? refs.map((r) => r.id) : null);
      rec("refLines", refs ? refs.map((r) => r.position.start.line) : null);
      rec("maskedLeak", (defs && refs) ? [...defs.map((d) => d.id), ...refs.map((r) => r.id)].some((id) => id === "x" || id === "z") : null);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r127-probe.js"), probe);
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

console.log("— compat getFileCache().footnotes + footnoteRefs on the real-fs index —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat metadataCache present", data.present === true);
ok("definition ids = [1, note] (no caret)", eq(data.defIds, ["1", "note"]), JSON.stringify(data.defIds));
ok("definition lines = [11, 12]", eq(data.defLines, [11, 12]), JSON.stringify(data.defLines));
ok("reference ids = [1, note]", eq(data.refIds, ["1", "note"]), JSON.stringify(data.refIds));
ok("reference lines = [5, 5]", eq(data.refLines, [5, 5]), JSON.stringify(data.refLines));
ok("masking holds (no ^x fenced / ^z frontmatter id leaked, real fs)", data.maskedLeak === false, JSON.stringify(data.maskedLeak));

console.log(`\nR127 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
