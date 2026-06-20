/**
 * R125 desktop probe — verifies compat getFileCache(file).listItems on the real Tauri / WKWebView
 * fs index: every list item → {position, parent, task?, id?}, parent encoding (nested → parent
 * line, root → -firstItemLine), task char, and the two R125-review fixes: (a) a `- x` inside a
 * fenced code block is NOT a phantom list item, (b) a trailing `^id` attaches to its OWN line, not
 * the last sibling of core's contiguous block run. Metadata-level (no editor mount) → fully
 * verifiable on desktop, like R119/R124. The li.md fixture is written HOST-side so the ``` fence
 * never appears in the probe's backtick template (R119 gotcha).
 * Run: node .calibration/r125-probe.mjs   (needs the release binary)
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r125-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r125-results.md");

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
// fixtures written HOST-side — the ``` fence stays OUT of the probe's backtick template (R119).
// li.md lines: 0=#Notes 1=blank 2=root-one 3=child-a 4=[ ]todo 5=a^x 6=b 7=``` 8=fake 9=``` 10=after
const LI = [
  "# Notes", "",
  "- root one", "  - child a", "- [ ] todo", "- a ^x", "- b",
  "```", "- not a bullet", "```",
  "- after", "",
].join("\n");
writeFileSync(join(VAULT, "li.md"), LI);
// fm.md: a YAML list entry inside frontmatter must NOT become a document list item (no phantom id)
const FM = ["---", "tags:", "  - meta ^fmx", "---", "", "- body", ""].join("\n");
writeFileSync(join(VAULT, "fm.md"), FM);

const probe = `module.exports = {
  id: "r125-probe", name: "r125-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r125-results.md", b).catch(() => napp.vault.modify("r125-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && window.app.metadataCache && window.app.vault);
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("li.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      await napp.vault.read("li.md").catch(() => {});
      const cacheOf = (p) => window.app.metadataCache.getFileCache(window.app.vault.getFileByPath(p));
      for (let i = 0; i < 40 && !(cacheOf("li.md") && cacheOf("li.md").listItems && cacheOf("li.md").listItems.length >= 6); i++) { try { await napp.vault.read("li.md"); } catch { /* drain */ } }
      const li = cacheOf("li.md") && cacheOf("li.md").listItems ? cacheOf("li.md").listItems : null;
      rec("lines", li ? li.map((x) => x.position.start.line) : null);
      rec("parents", li ? li.map((x) => x.parent) : null);
      rec("tasks", li ? li.map((x) => x.task === undefined ? null : x.task) : null);
      rec("ids", li ? li.map((x) => x.id === undefined ? null : x.id) : null);
      await napp.vault.read("fm.md").catch(() => {});
      for (let i = 0; i < 40 && !(cacheOf("fm.md") && cacheOf("fm.md").listItems); i++) { try { await napp.vault.read("fm.md"); } catch { /* drain */ } }
      const fm = cacheOf("fm.md") && cacheOf("fm.md").listItems ? cacheOf("fm.md").listItems : null;
      rec("fmLines", fm ? fm.map((x) => x.position.start.line) : null);
      rec("fmIds", fm ? fm.map((x) => x.id === undefined ? null : x.id) : null);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r125-probe.js"), probe);
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

console.log("— compat getFileCache().listItems on the real-fs index —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat metadataCache present", data.present === true);
// fence bullet (line 8) excluded; the post-fence '- after' (line 10) is captured → 6 real items
ok("6 real items at [2,3,4,5,6,10] (fence bullet excluded, post-fence item kept)", eq(data.lines, [2, 3, 4, 5, 6, 10]), JSON.stringify(data.lines));
// '- after' (line 10) is its OWN list root (-10), proving the column-0 fence broke the first list
ok("column-0 fence splits the list — '- after' is root -10, NOT merged into the line-2 list", eq(data.parents, [-2, 2, -2, -2, -2, -10]), JSON.stringify(data.parents));
ok("task char on '- [ ] todo' only", eq(data.tasks, [null, null, " ", null, null, null]), JSON.stringify(data.tasks));
ok("'^x' attaches to item a (line 5) only, NOT sibling b (line 6)", eq(data.ids, [null, null, null, "x", null, null]), JSON.stringify(data.ids));

console.log("— frontmatter YAML list entry is NOT a document list item (real fs) —");
ok("fm.md: only the body '- body' (line 5) is captured, frontmatter '- meta ^fmx' excluded", eq(data.fmLines, [5]), JSON.stringify(data.fmLines));
ok("fm.md: no phantom id leaked from the frontmatter entry", eq(data.fmIds, [null]), JSON.stringify(data.fmIds));

console.log(`\nR125 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
