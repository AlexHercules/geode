/**
 * R101 desktop probe — verifies attachments-as-graph-nodes construction
 * (getAttachmentMap + buildAttachmentGraph) on the REAL Tauri / WKWebView build + real
 * fs via window.__geodeGraphAttachments(): attachment nodes (id `attachment:<path>`,
 * degree = # referencing notes) + note→attachment edges over the real attachment index.
 * The yellow draw colour, the toggle, and click→openFile are browser-E2E only
 * (r101-e2e, §D). Run: node .calibration/r101-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r101-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r101-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
// a real non-md attachment + notes referencing it two ways + one note with no attachment
writeFileSync(join(VAULT, "pic.png"), "fake-png-bytes");
writeFileSync(join(VAULT, "note.md"), "embed ![[pic.png]]\n");
writeFileSync(join(VAULT, "other.md"), "link [[pic.png]]\n");
writeFileSync(join(VAULT, "plain.md"), "no attachment, [[note]] only\n");

const probe = `module.exports = {
  id: "r101-probe", name: "r101-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r101-results.md", b).catch(() => app.vault.modify("r101-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeGraphAttachments;
      rec("present", typeof F === "function");
      // give the index a beat to parse links + build the attachment maps
      await new Promise((r) => setTimeout(r, 400));
      rec("result", F());
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r101-probe.js"), probe);
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
const r = data.result ?? { nodes: [], edges: 0 };
const deg = (id) => r.nodes.find((n) => n.id === id)?.degree;

console.log("— buildAttachmentGraph on real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("exactly 1 attachment node (pic.png)", r.nodes.length === 1, JSON.stringify(r.nodes));
ok("attachment:pic.png degree 2 (note + other)", deg("attachment:pic.png") === 2, JSON.stringify(r.nodes));
ok("node id is `attachment:`-prefixed (real vault path)", r.nodes[0]?.id === "attachment:pic.png", JSON.stringify(r.nodes));
ok("2 note→attachment edges total", r.edges === 2, JSON.stringify(r.edges));
ok("the note-only ref contributes no attachment node", !r.nodes.some((n) => n.id.includes("plain") || n.id.includes("note.md")), JSON.stringify(r.nodes));

console.log(`\nR101 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
