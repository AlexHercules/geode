/**
 * R62 desktop probe — verifies the Outgoing Links pane wiring + data path on the
 * REAL Tauri/WKWebView build. App-Nap-safe: asserts via Store/metadata truth
 * (workspace.state.rightPanel, metadata.getOutgoingLinks) rather than async DOM,
 * with a short index-ready poll and fire-and-forget flush. Real .md files seeded
 * on disk so the real-fs metadata index parses their wikilinks.
 *
 * Run: node .calibration/r62-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 62 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r62-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r62-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "Alpha.md"), "# Alpha\n");
writeFileSync(join(VAULT, "Beta.md"), "# Beta\n");
writeFileSync(join(VAULT, "Source.md"), "# Source\n\nsee [[Alpha]] and [[Beta]] plus [[Ghost Note]].\n");

const probe = `module.exports = {
  id: "r62-probe", name: "r62-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r62-results.md", b).catch(() => app.vault.modify("r62-results.md", b).catch(() => {})); };
    try {
      app.workspace.openFile("Source.md");
      app.workspace.setRightPanel("outgoinglinks");
      const ws = app.workspace.state.get();
      rec("rightPanel", ws.rightPanel);
      rec("rightOpen", ws.rightSidebarOpen);
      // poll the index a few times (fire-and-forget each attempt) — App-Nap-safe,
      // all within the first seconds after load.
      let tries = 0;
      const tick = () => {
        tries++;
        const links = app.metadata.getOutgoingLinks("Source.md") || [];
        const resolved = links.filter((l) => l.resolvedPath).map((l) => l.link.target);
        const unresolved = links.filter((l) => !l.resolvedPath).map((l) => l.link.target);
        rec("resolved", resolved);
        rec("unresolved", unresolved);
        if (links.length >= 3 || tries >= 6) { rec("done", true); return; }
        setTimeout(tick, 400);
      };
      tick();
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r62-probe.js"), probe);
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
const arr = (v) => (Array.isArray(v) ? v : []);

console.log("— Outgoing Links pane wiring + real-fs metadata on WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("setRightPanel persisted rightPanel=outgoinglinks", data.rightPanel === "outgoinglinks", J(data.rightPanel));
ok("setRightPanel opened the right sidebar", data.rightOpen === true, J(data.rightOpen));
ok("resolved outgoing links = [Alpha, Beta]", arr(data.resolved).sort().join(",") === "Alpha,Beta", J(data.resolved));
ok("unresolved outgoing link = [Ghost Note]", arr(data.unresolved).join(",") === "Ghost Note", J(data.unresolved));

console.log(`\nR62 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
