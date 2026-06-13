/**
 * R31 desktop probe — drives window.__geodeSlash against the REAL Tauri build
 * (WKWebView has no CDP, so a .geode/plugins probe writes results back to a
 * vault file we read externally). Validates the slash trigger gate + candidate
 * ranking on the real desktop runtime. The full apply flow (type `/` → run
 * command → delete query) is covered by the browser E2E in a real CM editor.
 *
 * Run: node .calibration/r31-probe.mjs   (release binary must be built)
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r31-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r31-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) {
  console.error(`release binary not found: ${BIN}`);
  process.exit(2);
}

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "note.md"), "# Note\n");

// probe plugin: registers a known command, then exercises __geodeSlash
const probe = `module.exports = {
  id: "r31-probe", name: "r31-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r31-results.md", body).catch(() =>
        app.vault.modify("r31-results.md", body).catch(() => {}));
    };
    try {
      app.commands.register({ id: "r31:zzprobe", name: "ZZ Probe Command", callback: () => {} });
      app.commands.register({ id: "r31:zzhidden", name: "ZZ Hidden Probe", available: () => false, callback: () => {} });
      rec("trig_slash", window.__geodeSlash.trigger("/"));
      rec("trig_ws", window.__geodeSlash.trigger("hello /zz"));
      rec("trig_midword", window.__geodeSlash.trigger("and/or"));
      rec("trig_url", window.__geodeSlash.trigger("http://"));
      rec("trig_wikilink", window.__geodeSlash.trigger("[[foo /zz"));
      const all = window.__geodeSlash.candidates("");
      rec("has_available", all.indexOf("r31:zzprobe") !== -1);
      rec("excludes_unavailable", all.indexOf("r31:zzhidden") === -1);
      rec("rank_top", window.__geodeSlash.candidates("zzprobe")[0]);
      rec("no_match_empty", window.__geodeSlash.candidates("zzzqqqnomatch").length);
    } catch (e) { rec("error", String(e)); }
    flush();
  }
};
`;
writeFileSync(join(PLUGINS, "r31-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 16000;
let raw = null;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) {
    raw = readFileSync(RESULTS, "utf8");
    if (raw.includes("no_match_empty=")) break;
  }
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

console.log("— desktop probe assertions (real runtime) —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("trigger: `/` fires", JSON.stringify(data.trig_slash) === JSON.stringify({ query: "" }));
ok("trigger: `/zz` after space fires with query", JSON.stringify(data.trig_ws) === JSON.stringify({ query: "zz" }));
ok("trigger: mid-word `and/or` suppressed", data.trig_midword === null);
ok("trigger: `http://` suppressed", data.trig_url === null);
ok("trigger: inside `[[foo /zz` wikilink suppressed", data.trig_wikilink === null);
ok("candidates include available command", data.has_available === true);
ok("candidates exclude unavailable command", data.excludes_unavailable === true);
ok("candidates rank exact-ish query first", data.rank_top === "r31:zzprobe", JSON.stringify(data.rank_top));
ok("non-matching query → empty candidates", data.no_match_empty === 0, JSON.stringify(data.no_match_empty));

console.log(`\nR31 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
