/**
 * R57 desktop probe — verifies live-math `$$…$$` block detection (findMathBlockRanges,
 * renderer-confirmed) + the reused math placeholder (renderMarkdownToHtml →
 * .geode-math-block) against the REAL Tauri build via __geodeMath (deterministic,
 * App-Nap-safe — no live view / async KaTeX). The live block widget + async hydration
 * path is a view behavior exercised by the browser E2E.
 *
 * Run: node .calibration/r57-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 57 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r57-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r57-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "seed.md"), "# Seed\n");

// DOC = "intro\n\n$$\n\\frac{a}{b}\n$$\n\noutro\n"  (\\ → one backslash in the embedded JS)
const probe = `module.exports = {
  id: "r57-probe", name: "r57-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r57-results.md", body).catch(() =>
        app.vault.modify("r57-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const M = (globalThis).__geodeMath;
      const DOC = "intro\\n\\n$$\\n\\\\frac{a}{b}\\n$$\\n\\noutro\\n";
      recFlush("present", !!(M && M.ranges && M.placeholder));
      const rs = M.ranges(DOC);
      recFlush("count", rs.length);
      recFlush("slice", rs[0] ? DOC.slice(rs[0].from, rs[0].to) : "");
      recFlush("single", M.ranges("$$x^2$$\\n").length);
      recFlush("innerClose", M.ranges("$$x$$ foo\\n").length);
      recFlush("unterminated", M.ranges("$$\\nx\\nno close\\n").length);
      recFlush("inline", M.ranges("a $x$ b\\n").length);
      recFlush("placeholder", M.placeholder("$$\\nx\\n$$"));
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r57-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 16000;
let raw = null;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) { raw = readFileSync(RESULTS, "utf8"); if (raw.includes("done=")) break; }
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

console.log("— __geodeMath $$ block detection + placeholder on real WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeMath present", data.present === true);
ok("finds exactly one $$ block", data.count === 1, J(data.count));
ok("range slices to $$…$$", data.slice === "$$\n\\frac{a}{b}\n$$", J(data.slice));
ok("single-line $$x$$ is a block", data.single === 1, J(data.single));
ok("`$$x$$ foo` is NOT a block", data.innerClose === 0, J(data.innerClose));
ok("unterminated $$ is NOT a block", data.unterminated === 0, J(data.unterminated));
ok("inline $x$ is NOT a block", data.inline === 0, J(data.inline));
ok("renderMarkdownToHtml emits .geode-math-block", data.placeholder === true, J(data.placeholder));

console.log(`\nR57 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
