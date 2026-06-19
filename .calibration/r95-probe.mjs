/**
 * R95 desktop probe — verifies the code-copy hydration MATCHING logic on the REAL
 * Tauri / WKWebView build via window.__geodeCodeCopy(html): how many copy buttons the
 * pass adds for a given HTML fragment (code fences yes; mermaid/query/non-code pre no;
 * idempotent). The actual click→clipboard + hover-reveal is browser-E2E only (r95-e2e,
 * §D). Run: node .calibration/r95-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r95-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r95-results.md");

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
  id: "r95-probe", name: "r95-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r95-results.md", b).catch(() => app.vault.modify("r95-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeCodeCopy;
      rec("present", typeof F === "function");
      rec("oneFence", F("<pre><code>x</code></pre>"));
      rec("twoFences", F("<pre><code>a</code></pre><pre><code>b</code></pre>"));
      rec("preNoCode", F("<pre>raw</pre>"));
      rec("mermaid", F('<div class="geode-mermaid"><pre class="geode-mermaid-source"><code>graph TD</code></pre></div>'));
      rec("query", F('<div class="geode-query"><pre class="geode-query-source"><code>tag:#x</code></pre></div>'));
      rec("idempotent", F('<pre><code>x</code><button class="code-copy-button">Copy</button></pre>'));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r95-probe.js"), probe);
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

console.log("— code-copy hydration matching on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("one code fence → 1 button", data.oneFence === 1, JSON.stringify(data.oneFence));
ok("two code fences → 2 buttons", data.twoFences === 2, JSON.stringify(data.twoFences));
ok("<pre> without <code> → 0 buttons", data.preNoCode === 0, JSON.stringify(data.preNoCode));
ok("mermaid source-fallback pre → 0 buttons", data.mermaid === 0, JSON.stringify(data.mermaid));
ok("query source-fallback pre → 0 buttons", data.query === 0, JSON.stringify(data.query));
ok("pre with existing button → stays 1 (idempotent)", data.idempotent === 1, JSON.stringify(data.idempotent));

console.log(`\nR95 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
