/**
 * R30 desktop probe — drives window.__geodeProperties against the REAL Tauri
 * Rust filesystem backend (WKWebView has no CDP, so a .geode/plugins probe
 * writes results back to a vault file we read externally). Mirrors the data-
 * safety §D timing discipline: assertions land in the first seconds, the result
 * file is written fire-and-forget, fixtures are reset before each run.
 *
 * Run: node .calibration/r30-probe.mjs   (release binary must be built)
 * Validates on real fs: vault-wide aggregation (keyCounts/values), global
 * property rename (byte-safe, value-intact), and case-only rename (C1).
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r30-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r30-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) {
  console.error(`release binary not found: ${BIN}\nbuild: PATH="$HOME/.cargo/bin:$PATH" cargo build --release --manifest-path src-tauri/Cargo.toml`);
  process.exit(2);
}

/* ---- reset fixtures (fresh every run; rename mutates them) ---- */
rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "a.md"), "---\nauthor: Ada\nStatus: draft\n---\n# A\n");
writeFileSync(join(VAULT, "b.md"), "---\nauthor: Bob\nStatus: done\n---\n# B\n");
writeFileSync(join(VAULT, "c.md"), "# C no frontmatter\n");

/* ---- probe plugin (runs in the webview; window.__geodeProperties is live) ---- */
const probe = `module.exports = {
  id: "r30-probe", name: "r30-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r30-results.md", body).catch(() =>
        app.vault.modify("r30-results.md", body).catch(() => {}));
    };
    try {
      rec("counts", Object.fromEntries(window.__geodeProperties.keyCounts()));
      rec("values_author", window.__geodeProperties.values("author"));
      flush();
      rec("rename", await window.__geodeProperties.rename("author", "writer"));
      flush();
      rec("a_after", await app.vault.read("a.md"));
      rec("caseRename", await window.__geodeProperties.rename("Status", "status"));
      rec("b_after", await app.vault.read("b.md"));
    } catch (e) { rec("error", String(e)); }
    flush();
  }
};
`;
writeFileSync(join(PLUGINS, "r30-probe.js"), probe);
rmSync(RESULTS, { force: true });

/* ---- launch the release binary against the fixture vault ---- */
console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

/* ---- poll for the result file (App Nap: keep the window early) ---- */
const deadline = Date.now() + 16000;
let raw = null;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) {
    raw = readFileSync(RESULTS, "utf8");
    // wait until the final caseRename line landed (fire-and-forget grows the file)
    if (raw.includes("b_after=")) break;
  }
  await new Promise((r) => setTimeout(r, 300));
}
try { process.kill(-child.pid); } catch { /* already gone */ }

if (raw === null) {
  console.error("no result file produced — probe did not run");
  process.exit(1);
}

/* ---- parse k=json lines ---- */
const data = {};
for (const line of raw.split("\n")) {
  const i = line.indexOf("=");
  if (i === -1) continue;
  try { data[line.slice(0, i)] = JSON.parse(line.slice(i + 1)); } catch { /* partial */ }
}

console.log("— desktop probe assertions (real fs) —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("keyCounts author = 2 (real fs aggregation)", data.counts?.author === 2, JSON.stringify(data.counts));
ok("keyCounts Status = 2", data.counts?.Status === 2, JSON.stringify(data.counts));
ok("values(author) = [Ada, Bob]", JSON.stringify(data.values_author) === JSON.stringify(["Ada", "Bob"]), JSON.stringify(data.values_author));
ok("global rename author→writer changed 2 files", data.rename?.filesChanged === 2, JSON.stringify(data.rename));
ok("rename 0 skipped", Array.isArray(data.rename?.skipped) && data.rename.skipped.length === 0, JSON.stringify(data.rename));
ok("a.md real-fs write: writer key, value byte-intact", typeof data.a_after === "string" && data.a_after.includes("writer: Ada") && !data.a_after.includes("author:"), data.a_after);
ok("a.md other prop (Status) untouched by rename", typeof data.a_after === "string" && data.a_after.includes("Status: draft"), data.a_after);
ok("case-only rename Status→status changed 2 files (C1, real fs)", data.caseRename?.filesChanged === 2, JSON.stringify(data.caseRename));
ok("b.md case-only rewrite: status lowercased, value intact", typeof data.b_after === "string" && data.b_after.includes("status: done") && !/Status:/.test(data.b_after), data.b_after);

console.log(`\nR30 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
