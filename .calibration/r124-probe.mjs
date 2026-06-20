/**
 * R124 desktop probe — verifies compat getFileCache(file).sections on the real Tauri / WKWebView
 * fs index: the top-level block segmentation (yaml/heading/paragraph/code/list/blockquote/
 * thematicBreak/table) + fence atomicity (an internal blank line must NOT split the code block).
 * Metadata-level (no editor mount) → fully verifiable on desktop, like R119. The sec.md fixture is
 * written HOST-side so the ``` fence never appears in the probe's backtick template (R119 gotcha).
 * Run: node .calibration/r124-probe.mjs   (needs the release binary)
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r124-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r124-results.md");

let passed = 0, failed = 0;
const fails = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
// fixture written HOST-side — the ``` fence stays OUT of the probe's backtick template (R119)
const SEC = [
  "---", "k: v", "---",
  "# Title", "",
  "a paragraph", "",
  "```", "code one", "", "code two", "```", "",
  "- one", "- two", "",
  "> quote", "",
  "***", "",
  "| h1 | h2 |", "| --- | --- |", "| a | b |", "",
].join("\n");
writeFileSync(join(VAULT, "sec.md"), SEC);

const probe = `module.exports = {
  id: "r124-probe", name: "r124-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r124-results.md", b).catch(() => napp.vault.modify("r124-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && window.app.metadataCache && window.app.vault);
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("sec.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      await napp.vault.read("sec.md").catch(() => {});
      const cache = () => window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("sec.md"));
      for (let i = 0; i < 40 && !(cache() && cache().sections && cache().sections.length >= 8); i++) { try { await napp.vault.read("sec.md"); } catch { /* drain */ } }
      const c = cache();
      rec("types", c && c.sections ? c.sections.map((s) => s.type) : null);
      const code = c && c.sections ? c.sections.find((s) => s.type === "code") : null;
      // a real-fs read of the code section's byte range must include both lines (fence atomic)
      const codeText = code ? (await napp.vault.read("sec.md")).slice(code.position.start.offset, code.position.end.offset) : "";
      rec("codeAtomic", codeText.includes("code one") && codeText.includes("code two"));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r124-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 25000;
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

console.log("— compat getFileCache().sections on the real-fs index —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat metadataCache present", data.present === true);
ok("section types match the top-level segmentation", eq(data.types, ["yaml", "heading", "paragraph", "code", "list", "blockquote", "thematicBreak", "table"]), JSON.stringify(data.types));
ok("fenced code is ONE atomic block (internal blank line not split, real fs)", data.codeAtomic === true, JSON.stringify(data.codeAtomic));

console.log(`\nR124 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
