/**
 * R91 desktop probe — verifies sortTreeNodes on the REAL Tauri / WKWebView build
 * via window.__geodeSortTree (synchronous, App-Nap-safe). The explorer toolbar DOM
 * is browser-E2E only (r91-e2e, §D). Run: node .calibration/r91-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r91-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r91-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "n.md"), "# n\n");

const probe = `module.exports = {
  id: "r91-probe", name: "r91-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r91-results.md", b).catch(() => app.vault.modify("r91-results.md", b).catch(() => {})); };
    try {
      const S = (globalThis).__geodeSortTree;
      rec("present", typeof S === "function");
      const mixed = [
        { kind: "file", name: "banana.md" },
        { kind: "folder", name: "Zebra" },
        { kind: "file", name: "apple.md" },
        { kind: "folder", name: "alpha" },
      ];
      rec("asc", S(mixed, "name-asc"));
      rec("desc", S(mixed, "name-desc"));
      rec("numeric", S([{kind:"file",name:"n10.md"},{kind:"file",name:"n2.md"},{kind:"file",name:"n1.md"}], "name-asc"));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r91-probe.js"), probe);
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
const eq = (v, exp) => JSON.stringify(v) === JSON.stringify(exp);

console.log("— sortTreeNodes on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("name-asc → folders first then files", eq(data.asc, ["alpha", "Zebra", "apple.md", "banana.md"]), JSON.stringify(data.asc));
ok("name-desc → folders first reversed, files reversed", eq(data.desc, ["Zebra", "alpha", "banana.md", "apple.md"]), JSON.stringify(data.desc));
ok("numeric natural order", eq(data.numeric, ["n1.md", "n2.md", "n10.md"]), JSON.stringify(data.numeric));

console.log(`\nR91 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
