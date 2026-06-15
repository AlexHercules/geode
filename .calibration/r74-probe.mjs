/**
 * R74 desktop probe — verifies splitSlides on the REAL Tauri / WKWebView build +
 * real filesystem via window.__geodeSplitSlides (reads the note from disk, runs
 * splitSlides — synchronous logic, App-Nap-safe). The overlay DOM (mount / nav /
 * counter) is browser-E2E only (r74-e2e); WKWebView DOM reads are unreliable
 * under App-Nap (data-safety §D). This proves the real-fs split path on disk.
 *
 * Run: node .calibration/r74-probe.mjs   (release binary must be built)
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r74-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r74-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
const FENCE = "```";
writeFileSync(join(VAULT, "deck.md"), "# One\n\nfirst\n\n---\n\n# Two\n\nsecond\n\n---\n\n# Three\n\nthird\n");
writeFileSync(join(VAULT, "fmdeck.md"), `---\ntitle: T\ntags: [a]\n---\n# A\n\naaa\n\n---\n\n# B\n\nbbb\n`);
writeFileSync(join(VAULT, "fencedeck.md"), `# Code\n\n${FENCE}\nx\n---\ny\n${FENCE}\n\nstill one slide\n`);
writeFileSync(join(VAULT, "single.md"), "# Solo\n\nno separators here\n");

const probe = `module.exports = {
  id: "r74-probe", name: "r74-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r74-results.md", b).catch(() => app.vault.modify("r74-results.md", b).catch(() => {})); };
    try {
      const S = (globalThis).__geodeSplitSlides;
      rec("present", typeof S === "function");
      rec("deck", (await S("deck.md")).length);
      rec("fmdeck", (await S("fmdeck.md")).length);
      rec("fencedeck", (await S("fencedeck.md")).length);
      rec("single", (await S("single.md")).length);
      rec("first_has_one", (await S("deck.md"))[0].includes("# One"));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r74-probe.js"), probe);
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

console.log("— splitSlides on real WKWebView + real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("__geodeSplitSlides present", data.present === true);
ok("3-slide deck → 3", data.deck === 3, JSON.stringify(data.deck));
ok("frontmatter + 2 slides → 2 (no ghost)", data.fmdeck === 2, JSON.stringify(data.fmdeck));
ok("--- in code fence → 1 (not split)", data.fencedeck === 1, JSON.stringify(data.fencedeck));
ok("no separators → 1", data.single === 1, JSON.stringify(data.single));
ok("first slide carries '# One'", data.first_has_one === true, JSON.stringify(data.first_has_one));

console.log(`\nR74 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
