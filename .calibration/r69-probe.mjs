/**
 * R69 desktop probe — drives window.__geodeRenameTag against the REAL Tauri Rust
 * filesystem backend (WKWebView has no CDP, so a .geode/plugins probe writes
 * results back to a vault file we read externally). Mirrors data-safety §D
 * timing discipline: assertions land early, the result file is written
 * fire-and-forget, fixtures are reset before each run (rename mutates them).
 *
 * Run: node .calibration/r69-probe.mjs   (release binary must be built)
 * Validates on real fs: vault-wide tag rename (inline + nested + frontmatter
 * tags:, code regions skipped, prefix boundary preserved).
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r69-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r69-results.md");

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
writeFileSync(join(VAULT, "a.md"), "# A\n\n#zzproj and #zzproj/api here, #zzproj-old stays.\n");
writeFileSync(join(VAULT, "b.md"), "---\ntags: [zzproj, zzkeep]\n---\n# B\n\nbody #zzproj mention.\n");
writeFileSync(join(VAULT, "c.md"), "# C\n\n`#zzproj` code stays.\n\nreal #zzproj here.\n");

/* ---- probe plugin (runs in the webview; window.__geodeRenameTag is live) ---- */
const probe = `module.exports = {
  id: "r69-probe", name: "r69-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r69-results.md", body).catch(() =>
        app.vault.modify("r69-results.md", body).catch(() => {}));
    };
    try {
      rec("present", typeof window.__geodeRenameTag === "function");
      flush();
      rec("rename", await window.__geodeRenameTag("zzproj", "zzwork"));
      flush();
      rec("a_after", await app.vault.read("a.md"));
      rec("b_after", await app.vault.read("b.md"));
      rec("c_after", await app.vault.read("c.md"));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    flush();
  }
};
`;
writeFileSync(join(PLUGINS, "r69-probe.js"), probe);
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
    if (raw.includes("done=true")) break;
  }
  await new Promise((r) => setTimeout(r, 300));
}
try { process.kill(-child.pid); } catch { /* already gone */ }

if (raw === null) { console.error("no result file produced — probe did not run"); process.exit(1); }

const data = {};
for (const line of raw.split("\n")) {
  const i = line.indexOf("=");
  if (i === -1) continue;
  try { data[line.slice(0, i)] = JSON.parse(line.slice(i + 1)); } catch { /* partial */ }
}

console.log("— desktop probe assertions (real fs) —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("__geodeRenameTag present", data.present === true);
ok("rename zzproj→zzwork changed 3 files", data.rename?.filesChanged === 3, JSON.stringify(data.rename));
ok("rename 0 skipped", Array.isArray(data.rename?.skipped) && data.rename.skipped.length === 0, JSON.stringify(data.rename));
ok("tagsRewritten = 5 (a:2 + b:2 + c:1)", data.rename?.tagsRewritten === 5, JSON.stringify(data.rename));
ok("a.md inline #zzproj → #zzwork (real fs)", typeof data.a_after === "string" && data.a_after.includes("#zzwork ") && data.a_after.includes("#zzwork/api"), data.a_after);
ok("a.md boundary #zzproj-old UNTOUCHED", typeof data.a_after === "string" && data.a_after.includes("#zzproj-old"), data.a_after);
ok("b.md frontmatter tags zzproj → zzwork + zzkeep kept", typeof data.b_after === "string" && /zzwork/.test(data.b_after) && data.b_after.includes("zzkeep") && !/\bzzproj\b/.test(data.b_after), data.b_after);
ok("b.md body #zzproj → #zzwork", typeof data.b_after === "string" && data.b_after.includes("body #zzwork mention"), data.b_after);
ok("c.md inline-code `#zzproj` STAYS, real → #zzwork", typeof data.c_after === "string" && data.c_after.includes("`#zzproj`") && data.c_after.includes("real #zzwork here"), data.c_after);

console.log(`\nR69 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
