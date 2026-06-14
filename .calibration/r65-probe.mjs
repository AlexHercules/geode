/**
 * R65 desktop probe — verifies the footnote metadata index on the REAL
 * Tauri/WKWebView build with a real .md file on the real filesystem. Mirrors
 * r62-probe: open a seeded note, read app.metadata.getFootnotes(path), confirm
 * the [^id]: defs are parsed (and a fenced def is excluded). The panel render is
 * a view behavior exercised by the browser E2E on the identical React component.
 *
 * Run: node .calibration/r65-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 65 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r65-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r65-results.md");

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
writeFileSync(
  join(VAULT, "Notes.md"),
  "# Doc\n\nbody[^1] and[^note].\n\n```\n[^fenced]: in a code fence, excluded\n```\n\n[^1]: First.\n[^note]: Named one.\n[^code]: `inline` then text.\n",
);

const probe = `module.exports = {
  id: "r65-probe", name: "r65-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r65-results.md", b).catch(() => app.vault.modify("r65-results.md", b).catch(() => {})); };
    try {
      let tries = 0;
      const tick = () => {
        tries++;
        const fns = app.metadata.getFootnotes("Notes.md") || [];
        rec("ids", fns.map((f) => f.id));
        rec("contents", fns.map((f) => f.content));
        if (fns.length >= 3 || tries >= 6) { rec("done", true); return; }
        setTimeout(tick, 400);
      };
      tick();
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r65-probe.js"), probe);
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
const ids = Array.isArray(data.ids) ? data.ids : [];
const contents = Array.isArray(data.contents) ? data.contents : [];

console.log("— footnote metadata index on real fs / WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("exactly 3 footnotes (fenced def excluded)", ids.length === 3, J(ids));
ok("ids = [1, code, note]", ids.slice().sort().join(",") === "1,code,note", J(ids));
ok("contents parsed from original", contents.includes("First.") && contents.includes("Named one."), J(contents));
ok("leading inline-code body preserved (review fix #1)", contents.includes("`inline` then text."), J(contents));
ok("fenced `[^fenced]` excluded", !ids.includes("fenced"), J(ids));

console.log(`\nR65 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
