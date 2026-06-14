/**
 * R56 desktop probe — verifies live-mermaid GFM fence detection (findMermaidRanges) +
 * the reused fence renderer (renderMarkdownToHtml → .geode-mermaid placeholder) against
 * the REAL Tauri build via __geodeMermaid (deterministic, App-Nap-safe — no live view /
 * async SVG). The live block widget + async hydration path is a view behavior exercised
 * by the browser E2E.
 *
 * Run: node .calibration/r56-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 56 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r56-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r56-results.md");

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

// DOC = "intro\n\n```mermaid\ngraph TD\nA-->B\n```\n\n```js\nconst x=1;\n```\n"
const probe = `module.exports = {
  id: "r56-probe", name: "r56-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r56-results.md", body).catch(() =>
        app.vault.modify("r56-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const M = (globalThis).__geodeMermaid;
      const DOC = "intro\\n\\n\\u0060\\u0060\\u0060mermaid\\ngraph TD\\nA-->B\\n\\u0060\\u0060\\u0060\\n\\n\\u0060\\u0060\\u0060js\\nconst x=1;\\n\\u0060\\u0060\\u0060\\n";
      recFlush("present", !!(M && M.ranges && M.placeholder));
      const rs = M.ranges(DOC);
      recFlush("count", rs.length);
      recFlush("slice", rs[0] ? DOC.slice(rs[0].from, rs[0].from + 10) : "");
      recFlush("placeholder", M.placeholder("\\u0060\\u0060\\u0060mermaid\\ngraph TD\\nA-->B\\n\\u0060\\u0060\\u0060"));
      recFlush("jsNoMatch", M.ranges("\\u0060\\u0060\\u0060js\\nx\\n\\u0060\\u0060\\u0060\\n").length);
      recFlush("caseNoMatch", M.ranges("\\u0060\\u0060\\u0060Mermaid\\nx\\n\\u0060\\u0060\\u0060\\n").length);
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r56-probe.js"), probe);
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

console.log("— __geodeMermaid fence detection + placeholder on real WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeMermaid present", data.present === true);
ok("finds exactly one mermaid fence", data.count === 1, J(data.count));
ok("range slices to ```mermaid", data.slice === "```mermaid", J(data.slice));
ok("renderMarkdownToHtml emits .geode-mermaid placeholder", data.placeholder === true, J(data.placeholder));
ok("```js fence → no mermaid range", data.jsNoMatch === 0, J(data.jsNoMatch));
ok("```Mermaid (case) → no match", data.caseNoMatch === 0, J(data.caseNoMatch));

console.log(`\nR56 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
