/**
 * R41 desktop probe — verifies the pure `#` tag-completion logic (window.__geodeTag)
 * + the searchRequest store injection against the REAL Tauri build. The completion
 * trigger/candidates are pure (no live view); requestSearch is a store op (drivable
 * in a backgrounded WKWebView — SearchPanel does NOT mount, so searchRequest stays
 * set, which is exactly what we assert). The live editor popup + the Tags pane
 * (React) are covered by the browser r41-e2e.
 *
 * Run: node .calibration/r41-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 41 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r41-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r41-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "a.md"), "# A\n\n#alpha #beta\n");
writeFileSync(join(VAULT, "b.md"), "# B\n\n#alpha #gamma\n");
// degenerate frontmatter tags (R41 review fix): '#'/'bad space' must be dropped
writeFileSync(join(VAULT, "fm.md"), '---\ntags: ["#", "bad space", "goodfm"]\n---\n');

const probe = `module.exports = {
  id: "r41-probe", name: "r41-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r41-results.md", body).catch(() =>
        app.vault.modify("r41-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const T = window.__geodeTag;
      recFlush("present", !!T);
      if (T) {
        recFlush("trigAl", T.trigger("#al"));               // {query:"al"}
        recFlush("trigParen", T.trigger("(#al"));           // {query:"al"} (after paren)
        recFlush("trigHeading", T.trigger("## "));          // null
        recFlush("trigPlain", T.trigger("plain text"));     // null
        recFlush("candAll", T.candidates(""));              // ["alpha","beta","gamma","goodfm"] sorted, no junk
        recFlush("candAl", T.candidates("al"));             // ["alpha"]
        recFlush("candGam", T.candidates("gam"));           // ["gamma"]
      }
      // searchRequest store injection (SearchPanel doesn't mount in background → stays set)
      const ws = app.workspace;
      ws.requestSearch("#alpha");
      recFlush("searchReq", ws.searchRequest.get());        // "#alpha"
      recFlush("leftPanel", ws.state.get().leftPanel);      // "search"
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r41-probe.js"), probe);
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

console.log("— desktop probe assertions (real WKWebView runtime) —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeTag wired in real binary", data.present === true, J(data.present));
ok("trigger '#al' → {query:'al'}", data.trigAl && data.trigAl.query === "al", J(data.trigAl));
ok("trigger '(#al' → {query:'al'} (after paren)", data.trigParen && data.trigParen.query === "al", J(data.trigParen));
ok("trigger '## ' (heading) → null", data.trigHeading === null, J(data.trigHeading));
ok("trigger 'plain text' → null", data.trigPlain === null, J(data.trigPlain));
ok("candidates('') sorted + valid fm tag, no junk", J(data.candAll) === J(["alpha", "beta", "gamma", "goodfm"]), J(data.candAll));
ok("candidates('al') → alpha", J(data.candAl) === J(["alpha"]), J(data.candAl));
ok("candidates('gam') → gamma", J(data.candGam) === J(["gamma"]), J(data.candGam));
ok("requestSearch sets searchRequest to '#alpha'", data.searchReq === "#alpha", J(data.searchReq));
ok("requestSearch opens left search panel", data.leftPanel === "search", J(data.leftPanel));

console.log(`\nR41 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
