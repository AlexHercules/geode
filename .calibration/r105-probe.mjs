/**
 * R105 desktop probe — verifies the denylist-flipped isAttachmentPath on the real Tauri /
 * WKWebView build via window.__geodeAttachmentRouting(paths): every binary/media extension
 * stays read-only (no corruption regression), known text/code stays editable, unknown
 * extensions are now read-only, extensionless files stay editable. Run:
 * node .calibration/r105-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r105-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r105-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "seed.md"), "# seed\n");

const probe = `module.exports = {
  id: "r105-probe", name: "r105-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r105-results.md", b).catch(() => app.vault.modify("r105-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeAttachmentRouting;
      rec("present", typeof F === "function");
      const BIN = ["png","mp3","mp4","pdf","docx","zip","exe","heic","woff2"];
      const TEXT = ["md","txt","json","csv","js","ts","py","yaml","sh"];
      const e2k = (p) => p === "README" ? "" : p.slice(2);
      const r = (ps) => Object.fromEntries(F(ps.map((e) => e === "" ? "README" : "f." + e)).map((x) => [e2k(x.path), x.isAttachment]));
      rec("bin", r(BIN));
      rec("text", r(TEXT));
      rec("misc", r(["xyz","unknownext",""]));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r105-probe.js"), probe);
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
const bin = data.bin ?? {}, text = data.text ?? {}, misc = data.misc ?? {};
const allTrue = (o) => Object.values(o).every((v) => v === true);
const allFalse = (o) => Object.values(o).every((v) => v === false);

console.log("— denylist routing on real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("ALL binary/media (png/mp3/mp4/pdf/docx/zip/exe/heic/woff2) → read-only attachment", allTrue(bin), JSON.stringify(bin));
ok("ALL text/code (md/txt/json/csv/js/ts/py/yaml/sh) → editable (not attachment)", allFalse(text), JSON.stringify(text));
ok("unknown .xyz / .unknownext → read-only attachment (the flip)", misc.xyz === true && misc.unknownext === true, JSON.stringify(misc));
ok("extensionless (README) → editable", misc[""] === false, JSON.stringify(misc));

console.log(`\nR105 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
