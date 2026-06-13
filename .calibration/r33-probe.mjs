/**
 * R33 desktop probe — drives window.__geodeFormat against the REAL Tauri build
 * (WKWebView has no CDP, so a .geode/plugins probe writes results back to a
 * vault file we read externally). Validates the pure formatting engine on the
 * real desktop runtime: WRAP (bold wrap / bold unwrap-inside / italic emphasis-
 * guard on "**x**"), LINK (empty), HEADING cycle ("foo"→"# foo"), BLOCKQUOTE,
 * CHECKLIST add, NUMBERED two-line, CODE-BLOCK wrap, CALLOUT wrap.
 *
 * Run: node .calibration/r33-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 33 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r33-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r33-results.md");

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
writeFileSync(join(VAULT, "note.md"), "# Note\n");

// probe plugin: exercises window.__geodeFormat.apply on the real WKWebView
// runtime. Each result is recorded as key=JSON.stringify(value); the FULL
// FormatEdit object is serialized so external assertions are byte-exact.
// "fmt_callout" is the sentinel last key for the completion check.
const probe = `module.exports = {
  id: "r33-probe", name: "r33-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r33-results.md", body).catch(() =>
        app.vault.modify("r33-results.md", body).catch(() => {}));
    };
    const F = window.__geodeFormat;
    const A = (op, text, from, to) => F.apply(op, text, from, to);
    try {
      rec("present", !!F);
      // WRAP — bold
      rec("fmt_bold_wrap", A("bold", "Hello", 0, 5));
      rec("fmt_bold_unwrap", A("bold", "**Hello**", 0, 9));
      // WRAP — italic emphasis-char guard (must WRAP "**x**", not strip)
      rec("fmt_italic_guard", A("italic", "**x**", 0, 5));
      // LINK — empty selection
      rec("fmt_link_empty", A("link", "", 0, 0));
      // HEADING cycle
      rec("fmt_heading", A("heading", "foo", 0, 3));
      // BLOCKQUOTE
      rec("fmt_blockquote", A("blockquote", "foo", 0, 3));
      // CHECKLIST add
      rec("fmt_checklist", A("checklist", "foo", 0, 3));
      // NUMBERED two-line
      rec("fmt_numbered", A("numbered-list", "a\\nb", 0, 3));
      // CODE-BLOCK wrap
      rec("fmt_codeblock", A("code-block", "foo", 0, 3));
      // CALLOUT wrap (sentinel last key)
      rec("fmt_callout", A("callout", "foo", 0, 3));
    } catch (e) { rec("error", String(e)); }
    flush();
  }
};
`;
writeFileSync(join(PLUGINS, "r33-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 16000;
let raw = null;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) {
    raw = readFileSync(RESULTS, "utf8");
    if (raw.includes("fmt_callout=")) break;
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
const eq = (name, actual, expected) => ok(name, J(actual) === J(expected), `got ${J(actual)} want ${J(expected)}`);

console.log("— desktop probe assertions (real runtime) —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeFormat present", data.present === true);
// WRAP — bold
eq("bold wrap 'Hello' → '**Hello**' sel[2,7]",
  data.fmt_bold_wrap, { from: 0, to: 5, insert: "**Hello**", selFrom: 2, selTo: 7 });
eq("bold unwrap '**Hello**' [0,9] → 'Hello' sel[0,5]",
  data.fmt_bold_unwrap, { from: 0, to: 9, insert: "Hello", selFrom: 0, selTo: 5 });
// WRAP — italic emphasis-char guard
ok("italic on '**x**' WRAPS not strips (insert '***x***')",
  data.fmt_italic_guard && data.fmt_italic_guard.insert === "***x***", J(data.fmt_italic_guard));
// LINK
eq("link empty → '[]()' cursor in []",
  data.fmt_link_empty, { from: 0, to: 0, insert: "[]()", selFrom: 1, selTo: 1 });
// HEADING
ok("heading 'foo' → '# foo'", data.fmt_heading && data.fmt_heading.insert === "# foo", J(data.fmt_heading));
// BLOCKQUOTE
ok("blockquote 'foo' → '> foo'", data.fmt_blockquote && data.fmt_blockquote.insert === "> foo", J(data.fmt_blockquote));
// CHECKLIST
ok("checklist 'foo' → '- [ ] foo'", data.fmt_checklist && data.fmt_checklist.insert === "- [ ] foo", J(data.fmt_checklist));
// NUMBERED
ok("numbered two-line 'a\\nb' → '1. a\\n2. b'",
  data.fmt_numbered && data.fmt_numbered.insert === "1. a\n2. b", J(data.fmt_numbered));
// CODE-BLOCK
ok("code-block 'foo' → fenced w/ selFrom=4",
  data.fmt_codeblock && data.fmt_codeblock.insert === "```\nfoo\n```" && data.fmt_codeblock.selFrom === 4,
  J(data.fmt_codeblock));
// CALLOUT
ok("callout 'foo' → '> [!note]\\n> foo'",
  data.fmt_callout && data.fmt_callout.insert === "> [!note]\n> foo", J(data.fmt_callout));

console.log(`\nR33 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
