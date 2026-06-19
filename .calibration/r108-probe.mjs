/**
 * R108 desktop probe — verifies wikilinkAttachmentCandidates (the non-md attachments the
 * `[[` completion offers) on the real Tauri / WKWebView build + real fs via
 * window.__geodeWikilinkAttachments(absolute): non-md files offered with the right insert
 * text (name vs full path by ambiguity), md/extensionless excluded. The CM autocomplete DOM
 * is browser-E2E only (§D). Run: node .calibration/r108-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r108-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r108-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(join(VAULT, "A"), { recursive: true });
mkdirSync(join(VAULT, "B"), { recursive: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "Note.md"), "# Note\n");
writeFileSync(join(VAULT, "pic.png"), "fake-png");
writeFileSync(join(VAULT, "doc.pdf"), "fake-pdf");
writeFileSync(join(VAULT, "README"), "extensionless"); // editable, NOT an attachment
writeFileSync(join(VAULT, "A/dup.png"), "a");
writeFileSync(join(VAULT, "B/dup.png"), "b");

const probe = `module.exports = {
  id: "r108-probe", name: "r108-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r108-results.md", b).catch(() => app.vault.modify("r108-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeWikilinkAttachments;
      rec("present", typeof F === "function");
      await new Promise((r) => setTimeout(r, 300));
      rec("cands", F(false));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r108-probe.js"), probe);
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
const cands = data.cands ?? [];
const by = (n) => cands.filter((c) => c.name === n);

console.log("— wikilinkAttachmentCandidates on real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("pic.png offered, link text = bare name (unique)", by("pic.png").length === 1 && by("pic.png")[0].linkText === "pic.png", JSON.stringify(by("pic.png")));
ok("doc.pdf offered", by("doc.pdf").length === 1, JSON.stringify(by("doc.pdf")));
ok("ambiguous dup.png → full path (A/dup.png + B/dup.png)", by("dup.png").length === 2 && by("dup.png").every((c) => c.linkText.includes("/dup.png")), JSON.stringify(by("dup.png")));
ok("md note Note.md NOT offered", !cands.some((c) => c.name === "Note.md" || c.name === "Note"), JSON.stringify(cands.map((c) => c.name)));
ok("extensionless README NOT offered (editable, not an attachment)", !cands.some((c) => c.name === "README"), JSON.stringify(cands.map((c) => c.name)));

console.log(`\nR108 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
