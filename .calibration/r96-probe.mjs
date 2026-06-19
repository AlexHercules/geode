/**
 * R96 desktop probe — verifies the Excluded-files matching (glob + {regex}) on the REAL
 * Tauri / WKWebView build via window.__geodeExcluded(raw, path): sets the patterns then
 * returns whether the path is excluded. The search/graph/explorer DOM effects are
 * browser-E2E only (r96-e2e, §D). Run: node .calibration/r96-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r96-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r96-results.md");

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
  id: "r96-probe", name: "r96-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r96-results.md", b).catch(() => app.vault.modify("r96-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeExcluded;
      rec("present", typeof F === "function");
      rec("folder", F("Archive/", "Archive/old.md"));
      rec("folderMiss", F("Archive/", "keep.md"));
      rec("ext", F("*.png", "a/b.png"));
      rec("extMiss", F("*.png", "a/b.md"));
      rec("regex", F("{regex}^drafts/", "drafts/x.md"));
      rec("regexAnchor", F("{regex}^drafts/", "x/drafts/y.md"));
      rec("badRegex", F("{regex}[", "x.md"));
      rec("qLiteral", F("a?c", "x/a?c.md"));
      rec("qNotWild", F("a?c", "x/abc.md"));
      rec("empty", F("", "anything.md"));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r96-probe.js"), probe);
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

console.log("— excluded-files matching on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("folder glob matches under it", data.folder === true);
ok("folder glob misses a sibling", data.folderMiss === false);
ok("extension glob matches attachment", data.ext === true);
ok("extension glob misses a .md", data.extMiss === false);
ok("{regex} anchored matches", data.regex === true);
ok("{regex} anchor respected", data.regexAnchor === false);
ok("invalid {regex} ignored (no throw, no match)", data.badRegex === false);
ok("'?' is a literal glob char (matches a?c)", data.qLiteral === true);
ok("'?' is not a wildcard (misses abc)", data.qNotWild === false);
ok("empty list excludes nothing", data.empty === false);

console.log(`\nR96 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
