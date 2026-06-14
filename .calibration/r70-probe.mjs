/**
 * R70 desktop probe — drives window.__geodeRename against the REAL Tauri Rust
 * filesystem backend (WKWebView has no CDP, so a .geode/plugins probe writes
 * results back to a vault file we read externally). Validates markdown-link
 * rename rewrite on real fs. Mirrors data-safety §D timing discipline.
 *
 * Run: node .calibration/r70-probe.mjs   (release binary must be built)
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r70-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r70-results.md");

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

/* ---- reset fixtures (rename mutates them) ---- */
rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "target.md"), "# Target\n");
writeFileSync(
  join(VAULT, "ref.md"),
  [
    "# Ref",
    "",
    "link [b](target.md) anchor [a](target.md#sec) wiki [[target]] too.",
    "external [e](https://example.com) stays.",
    "`[c](target.md)` in code stays.",
    "",
  ].join("\n"),
);

const probe = `module.exports = {
  id: "r70-probe", name: "r70-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r70-results.md", body).catch(() =>
        app.vault.modify("r70-results.md", body).catch(() => {}));
    };
    try {
      rec("present", typeof window.__geodeRename === "function");
      flush();
      rec("rename", await window.__geodeRename("target.md", "renamed.md"));
      flush();
      rec("ref_after", await app.vault.read("ref.md"));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    flush();
  }
};
`;
writeFileSync(join(PLUGINS, "r70-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 16000;
let raw = null;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) {
    raw = readFileSync(RESULTS, "utf8");
    if (raw.includes("done=true")) break;
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

console.log("— desktop probe assertions (real fs) —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("__geodeRename present", data.present === true);
ok("rename changed ≥1 file", data.rename?.filesChanged >= 1, JSON.stringify(data.rename));
ok("rename 0 skipped", Array.isArray(data.rename?.skipped) && data.rename.skipped.length === 0, JSON.stringify(data.rename));
const r = typeof data.ref_after === "string" ? data.ref_after : "";
ok("md link [b](target.md) → [b](renamed.md) (real fs)", r.includes("[b](renamed.md)"), r);
ok("md anchor [a](target.md#sec) → [a](renamed.md#sec)", r.includes("[a](renamed.md#sec)"), r);
ok("coexisting wikilink [[target]] → [[renamed]]", r.includes("[[renamed]]"), r);
ok("external [e](https://example.com) UNTOUCHED", r.includes("[e](https://example.com)"), r);
ok("code `[c](target.md)` UNTOUCHED", r.includes("`[c](target.md)`"), r);

console.log(`\nR70 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
