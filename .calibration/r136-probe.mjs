/**
 * R136 desktop probe — opt-in sourcePos data-line emission on the real Tauri / WKWebView binary.
 * Run: node .calibration/r136-probe.mjs
 *
 * The reading-view getSectionInfo DOM-walk needs a rendered React preview tree (App-Nap-throttled
 * headless, §D) → that's covered by browser E2E (r136-e2e 11/11). What IS §D-safe is the SYNCHRONOUS
 * markdown render: __geodeRenderMarkdown(src, "", false, sourcePos) returns the HTML string directly.
 * This probe verifies on the shipped binary that (a) sourcePos:true emits data-line/data-line-end on
 * top-level blocks and (b) the default (sourcePos:false) path emits NONE — the §C byte-isolation.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r136-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r136-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "n.md"), "# H\n\npara\n");

const probe = `module.exports = {
  id: "r136-probe", name: "r136-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r136-results.md", b).catch(() => napp.vault.modify("r136-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => typeof window.__geodeRenderMarkdown === "function";
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("n.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      const src = "# Heading\\n\\nbody text\\n";
      const withPos = window.__geodeRenderMarkdown(src, "", false, true);
      const withoutPos = window.__geodeRenderMarkdown(src, "", false, false);
      rec("withPosHasDataLine", /data-line="0"/.test(withPos) && /data-line-end=/.test(withPos));
      rec("defaultHasNoDataLine", !/data-line/.test(withoutPos));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r136-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 30000;
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

console.log("— opt-in sourcePos data-line on the real WKWebView binary —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("core/markdown.ts + geode-source-pos ruler present (render hook loads cleanly)", data.present === true);
ok("sourcePos:true emits data-line/data-line-end on top-level blocks", data.withPosHasDataLine === true, JSON.stringify(data.withPosHasDataLine));
ok("default (sourcePos:false) emits NO data-line (§C byte-isolation holds on the binary)", data.defaultHasNoDataLine === true, JSON.stringify(data.defaultHasNoDataLine));

console.log(`\nR136 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
