/**
 * R38 desktop probe — verifies Quick Switcher sub-mode search against the REAL
 * Tauri build (WKWebView has no CDP, so a .geode/plugins probe writes results
 * back to a vault file we read externally).
 *
 * R38's match logic is a PURE core fn (core/switcherSearch) exposed at
 * window.__geodeSwitcher — so the real binary CAN exercise the actual #/^ search
 * over the real metadata index (no live view needed; App Nap §D doesn't block
 * store/pure reads). The live QuickSwitcher MODAL (typing # in a real component)
 * is a React/live-view path → covered by the browser r38-e2e. This probe asserts:
 * the probe is wired into the real binary, mode parse + heading/block search are
 * correct on the real metadata, and openFile + requestReveal navigation is sound.
 *
 * Run: node .calibration/r38-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 38 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r38-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r38-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) {
  console.error(`release binary not found: ${BIN}`);
  process.exit(2);
}

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "a.md"), "# Alpha One\n\n## Section Two\n\npara ^blk1\n");
writeFileSync(join(VAULT, "b.md"), "# Beta Heading\n\n## Shared Section\n\nx ^blk2\n");

const probe = `module.exports = {
  id: "r38-probe", name: "r38-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r38-results.md", body).catch(() =>
        app.vault.modify("r38-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const sw = window.__geodeSwitcher;
      recFlush("present", !!sw);
      if (sw) {
        recFlush("modeFile", sw.mode("foo"));      // file
        recFlush("modeHeading", sw.mode("#x"));    // heading
        recFlush("modeBlock", sw.mode("^y"));      // block
        const hSection = sw.headings("#Section").map((h) => h.text).sort();
        recFlush("hSection", hSection.join("|"));  // Section Two | Shared Section
        const hBeta = sw.headings("#Beta Heading");
        recFlush("hBetaPath", hBeta[0] && hBeta[0].path);   // b.md
        recFlush("hBetaText", hBeta[0] && hBeta[0].text);   // Beta Heading
        recFlush("browseCount", sw.headings("#").length);   // >=4
        const blkAll = sw.blocks("^blk").map((b) => b.id).sort().join(",");
        recFlush("blkAll", blkAll);                          // blk1,blk2
        const b2 = sw.blocks("^blk2");
        recFlush("blk2Path", b2[0] && b2[0].path);          // b.md
        // navigation: openFile to a heading hit + requestReveal → store truth
        if (hBeta[0]) {
          const ws = app.workspace;
          ws.openFile(hBeta[0].path);
          ws.requestReveal(hBeta[0].path, hBeta[0].from, hBeta[0].from + 5);
          recFlush("navActive", ws.getActiveFile());          // b.md
          recFlush("revealSet", !!ws.revealTarget.get());     // true
        }
      }
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r38-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 16000;
let raw = null;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) {
    raw = readFileSync(RESULTS, "utf8");
    if (raw.includes("done=")) break;
  }
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
const J = (v) => JSON.stringify(v);

console.log("— desktop probe assertions (real WKWebView runtime, pure search) —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeSwitcher wired into the real binary", data.present === true, J(data.present));
ok("mode('foo') = file", data.modeFile === "file", J(data.modeFile));
ok("mode('#x') = heading", data.modeHeading === "heading", J(data.modeHeading));
ok("mode('^y') = block", data.modeBlock === "block", J(data.modeBlock));
ok("headings('#Section') = Section Two + Shared Section", data.hSection === "Section Two|Shared Section", J(data.hSection));
ok("headings('#Beta Heading') top path = b.md", data.hBetaPath === "b.md", J(data.hBetaPath));
ok("headings('#Beta Heading') top text = Beta Heading", data.hBetaText === "Beta Heading", J(data.hBetaText));
ok("headings('#') browse returns all (>=4)", data.browseCount >= 4, J(data.browseCount));
ok("blocks('^blk') = blk1,blk2", data.blkAll === "blk1,blk2", J(data.blkAll));
ok("blocks('^blk2') top path = b.md", data.blk2Path === "b.md", J(data.blk2Path));
ok("navigation: openFile heading hit → active = b.md", data.navActive === "b.md", J(data.navActive));
ok("navigation: requestReveal set the reveal target", data.revealSet === true, J(data.revealSet));

console.log(`\nR38 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
