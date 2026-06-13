/**
 * R44 desktop probe — verifies the pure note-composer helpers (window.__geodeComposer)
 * against the REAL Tauri build / WKWebView, with adversarial inputs. Per the App-Nap
 * discipline (data-safety §D) + R36 lesson, the live command (editor:extract-selection)
 * is registered in a React effect that does NOT run in a backgrounded webview, so the
 * extract COMMAND is covered by the browser E2E; here we drive only the always-on pure
 * helpers (name derivation / sanitize / content / link), which run synchronously.
 *
 * Run: node .calibration/r44-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 44 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r44-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r44-results.md");

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

const probe = `module.exports = {
  id: "r44-probe", name: "r44-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r44-results.md", body).catch(() =>
        app.vault.modify("r44-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const C = (globalThis).__geodeComposer;
      recFlush("present", !!C);
      recFlush("heading", C.derive("# My Heading\\nbody"));   // My Heading
      recFlush("firstLine", C.derive("plain line\\nmore"));   // plain line
      recFlush("empty", C.derive(""));                        // Untitled
      recFlush("whitespace", C.derive("   \\n\\t "));         // Untitled
      recFlush("cjk", C.derive("## 中文 标题"));              // 中文 标题
      recFlush("illegal", C.derive("a/b:c*?"));               // a b c
      recFlush("wikimeta", C.derive("x[[y]]#z|w"));           // x y z w
      recFlush("hashNoSpace", C.derive("#nospace"));          // nospace
      recFlush("dotCollapse", C.derive(". ."));               // Untitled (no "..md"/"[[.]]")
      recFlush("trailingDot", C.derive("note."));             // note
      recFlush("control", C.derive("x" + String.fromCharCode(7) + "y")); // x y
      recFlush("longLen", C.derive("L".repeat(300)).length);  // <= 200
      recFlush("content", C.content("x\\n\\n\\n"));           // x\\n
      recFlush("link", C.replacement("N", "link"));           // [[N]]
      recFlush("embed", C.replacement("N", "embed"));         // ![[N]]
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r44-probe.js"), probe);
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

console.log("— __geodeComposer pure helpers on real WKWebView (adversarial inputs) —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeComposer present", data.present === true);
ok("derive heading → 'My Heading'", data.heading === "My Heading", J(data.heading));
ok("derive plain → first line", data.firstLine === "plain line", J(data.firstLine));
ok("derive empty → Untitled", data.empty === "Untitled", J(data.empty));
ok("derive all-whitespace → Untitled", data.whitespace === "Untitled", J(data.whitespace));
ok("derive CJK heading preserved", data.cjk === "中文 标题", J(data.cjk));
ok("derive sanitizes illegal chars 'a/b:c*?' → 'a b c'", data.illegal === "a b c", J(data.illegal));
ok("derive strips wikilink metachars", data.wikimeta === "x y z w", J(data.wikimeta));
ok("derive '#nospace' → 'nospace'", data.hashNoSpace === "nospace", J(data.hashNoSpace));
ok("derive '. .' → Untitled (no '..md'/'[[.]]')", data.dotCollapse === "Untitled", J(data.dotCollapse));
ok("derive trailing dot stripped 'note.' → 'note'", data.trailingDot === "note", J(data.trailingDot));
ok("derive strips control chars (BEL)", data.control === "x y", J(data.control));
ok("derive byte-truncates long names (≤200)", typeof data.longLen === "number" && data.longLen <= 200 && data.longLen > 0, J(data.longLen));
ok("content trims trailing newlines to one", data.content === "x\n", J(data.content));
ok("replacement link → [[N]]", data.link === "[[N]]", J(data.link));
ok("replacement embed → ![[N]]", data.embed === "![[N]]", J(data.embed));

console.log(`\nR44 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
