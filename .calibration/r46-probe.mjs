/**
 * R46 desktop probe — verifies the obsidian:// URI parser + executor against the
 * REAL Tauri build. The pure parser (__geodeUri.parse) runs synchronously; the
 * `new` action is driven via __geodeUri.handle (store + vault level → drivable in a
 * backgrounded WKWebView) and the Node runner reads the created note ON DISK. The
 * reading-view CLICK routing is React-effect bound (App-Nap §D) → browser E2E.
 *
 * Run: node .calibration/r46-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 46 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r46-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r46-results.md");
const NEW_NOTE = join(VAULT, "ProbeNew.md");

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
  id: "r46-probe", name: "r46-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r46-results.md", body).catch(() =>
        app.vault.modify("r46-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const U = (globalThis).__geodeUri;
      recFlush("present", !!U);
      const p = U.parse("obsidian://open?file=Note&heading=Sec");
      recFlush("parseKind", p && p.kind);       // open
      recFlush("parseFile", p && p.file);        // Note
      recFlush("parseHeading", p && p.heading);  // Sec
      recFlush("parseNull", U.parse("https://x.com")); // null
      const pn = U.parse("obsidian://new?file=N&content=Hi");
      recFlush("parseNewKind", pn && pn.kind);   // new
      U.handle("obsidian://new?file=ProbeNew&content=probe-content"); // fire-and-forget → writes ProbeNew.md
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r46-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 16000;
let raw = null;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) { raw = readFileSync(RESULTS, "utf8"); if (raw.includes("done=")) break; }
  await new Promise((r) => setTimeout(r, 300));
}
const fileDeadline = Date.now() + 4000;
while (Date.now() < fileDeadline && !existsSync(NEW_NOTE)) await new Promise((r) => setTimeout(r, 200));
try { process.kill(-child.pid); } catch { /* gone */ }
if (raw === null) { console.error("no result file produced — probe did not run"); process.exit(1); }

const data = {};
for (const line of raw.split("\n")) {
  const i = line.indexOf("=");
  if (i === -1) continue;
  try { data[line.slice(0, i)] = JSON.parse(line.slice(i + 1)); } catch { /* partial */ }
}
const J = (v) => JSON.stringify(v);

console.log("— __geodeUri pure parser on real WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeUri present", data.present === true);
ok("parse open → kind 'open'", data.parseKind === "open", J(data.parseKind));
ok("parse open → file 'Note'", data.parseFile === "Note", J(data.parseFile));
ok("parse open → heading 'Sec'", data.parseHeading === "Sec", J(data.parseHeading));
ok("parse non-obsidian → null", data.parseNull === null, J(data.parseNull));
ok("parse new → kind 'new'", data.parseNewKind === "new", J(data.parseNewKind));

console.log("— ON-DISK note created by obsidian://new (the executor core) —");
ok("obsidian://new wrote a note to disk", existsSync(NEW_NOTE));
ok("created note holds the URI content", existsSync(NEW_NOTE) && readFileSync(NEW_NOTE, "utf8") === "probe-content", existsSync(NEW_NOTE) ? J(readFileSync(NEW_NOTE, "utf8")) : "missing");

console.log(`\nR46 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
