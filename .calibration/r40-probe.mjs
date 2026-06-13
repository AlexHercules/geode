/**
 * R40 desktop probe — verifies the `toggle-task` transform against the REAL Tauri
 * build via the existing window.__geodeFormat.apply probe (R33). The transform is
 * a PURE function (core/format.toggleTaskStatus) — no live view needed, so the
 * real binary exercises the actual decision. The live editor (real Mod+L in a CM
 * view) is a live-view path → covered by the browser r40-e2e.
 *
 * Run: node .calibration/r40-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 40 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r40-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r40-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "note.md"), "# Note\n");

const probe = `module.exports = {
  id: "r40-probe", name: "r40-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r40-results.md", body).catch(() =>
        app.vault.modify("r40-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const F = window.__geodeFormat;
      recFlush("present", !!F);
      const ins = (text) => { const e = F.apply("toggle-task", text, 0, text.length); return e && e.insert; };
      if (F) {
        recFlush("check", ins("- [ ] task"));        // - [x] task
        recFlush("uncheck", ins("- [x] task"));       // - [ ] task
        recFlush("bullet", ins("- bullet"));          // - [ ] bullet
        recFlush("plain", ins("plain"));              // - [ ] plain
        recFlush("star", ins("* foo"));               // - [ ] foo
        recFlush("empty", ins(""));                   // - [ ]␠
        recFlush("multi", ins("- [ ] a\\nplain\\n- [x] b")); // - [x] a / - [ ] plain / - [ ] b
        recFlush("customSlash", ins("- [/] doing"));  // - [x] doing (flip custom, not malformed)
        recFlush("customDash", ins("- [-] x"));       // - [x] x
      }
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r40-probe.js"), probe);
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

console.log("— desktop probe assertions (real WKWebView runtime, pure transform) —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeFormat wired in real binary", data.present === true, J(data.present));
ok("'- [ ] task' → '- [x] task'", data.check === "- [x] task", J(data.check));
ok("'- [x] task' → '- [ ] task'", data.uncheck === "- [ ] task", J(data.uncheck));
ok("'- bullet' → '- [ ] bullet'", data.bullet === "- [ ] bullet", J(data.bullet));
ok("'plain' → '- [ ] plain'", data.plain === "- [ ] plain", J(data.plain));
ok("'* foo' → '- [ ] foo'", data.star === "- [ ] foo", J(data.star));
ok("'' → '- [ ] '", data.empty === "- [ ] ", J(data.empty));
ok("multi-line mixed toggles per line", data.multi === "- [x] a\n- [ ] plain\n- [ ] b", J(data.multi));
ok("custom '- [/] doing' → '- [x] doing' (flip, not malformed)", data.customSlash === "- [x] doing", J(data.customSlash));
ok("custom '- [-] x' → '- [x] x'", data.customDash === "- [x] x", J(data.customDash));

console.log(`\nR40 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
