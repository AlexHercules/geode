/**
 * R71 desktop probe — verifies md internal-link RENDERING on the REAL Tauri /
 * WKWebView build via window.__geodeRenderMarkdown (synchronous, deterministic,
 * App-Nap-safe). Click navigation is browser-E2E only (r71-e2e); this probe
 * proves the render path resolves md hrefs to internal-link anchors on real fs.
 *
 * Run: node .calibration/r71-probe.mjs   (release binary must be built)
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r71-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r71-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "Target.md"), "# Heading\n\nbody\n");
writeFileSync(join(VAULT, "pic.png"), "x");

const probe = `module.exports = {
  id: "r71-probe", name: "r71-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r71-results.md", b).catch(() => app.vault.modify("r71-results.md", b).catch(() => {})); };
    try {
      const R = (globalThis).__geodeRenderMarkdown;
      rec("present", typeof R === "function");
      rec("internal", R("[go](Target.md)", ""));
      rec("anchor", R("[go](Target.md#Heading)", ""));
      rec("external", R("[x](https://e.com)", ""));
      rec("attachment", R("[x](pic.png)", ""));
      rec("unresolved", R("[x](ghost9999.md)", ""));
      rec("wikilink", R("see [[Target]] here", ""));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r71-probe.js"), probe);
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

console.log("— md internal-link render on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("__geodeRenderMarkdown present", data.present === true);
ok("md link to note → internal-link + data-target", typeof data.internal === "string" && /class="internal-link"/.test(data.internal) && /data-target="Target\.md"/.test(data.internal), data.internal);
ok("md link #anchor → data-subpath", typeof data.anchor === "string" && /data-subpath="Heading"/.test(data.anchor), data.anchor);
ok("external md link → NOT internal-link", typeof data.external === "string" && !/internal-link/.test(data.external), data.external);
ok("attachment md link → NOT internal-link", typeof data.attachment === "string" && !/internal-link/.test(data.attachment), data.attachment);
ok("unresolved md link → NOT internal-link", typeof data.unresolved === "string" && !/internal-link/.test(data.unresolved), data.unresolved);
ok("wikilink still internal-link (regression)", typeof data.wikilink === "string" && /class="internal-link"/.test(data.wikilink), data.wikilink);

console.log(`\nR71 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
