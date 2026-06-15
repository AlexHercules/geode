/**
 * R72 desktop probe — verifies the new-link-format engine on the REAL Tauri /
 * WKWebView build + real filesystem. Drives window.__geodeFormatLink (sync,
 * App-Nap-safe — recorded first) for every wikilink/markdown × path-format ×
 * embed combination, then exercises the real-fs WRITE path: flips the
 * "use markdown links" setting ON and runs __geodeUnlinked.linkAll so an
 * unlinked mention is rewritten to a markdown link, and re-reads the file
 * (both via app.vault.read AND from disk in the harness) to prove the bytes
 * landed. Browser parity: .calibration/r72-e2e.mjs.
 *
 * Run: node .calibration/r72-probe.mjs   (release binary must be built)
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r72-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r72-results.md");
const MREF = join(VAULT, "mref.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(join(VAULT, "folder"), { recursive: true });
mkdirSync(join(VAULT, "a"), { recursive: true });
mkdirSync(join(VAULT, "b"), { recursive: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "Note.md"), "# Note\n");
writeFileSync(join(VAULT, "folder/Sub.md"), "# Sub\n");
writeFileSync(join(VAULT, "my note.md"), "# Spaced\n");
writeFileSync(join(VAULT, "a/from.md"), "x\n");
writeFileSync(join(VAULT, "b/Target.md"), "# Target\n");
writeFileSync(join(VAULT, "img.png"), "x");
writeFileSync(join(VAULT, "Spaced Note.md"), "# Spaced Note\n");
writeFileSync(MREF, "I mention Note here\n");
const SMREF = join(VAULT, "smref.md");
writeFileSync(SMREF, "I mention Spaced Note here\n");

const probe = `module.exports = {
  id: "r72-probe", name: "r72-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r72-results.md", b).catch(() => app.vault.modify("r72-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeFormatLink;
      rec("present", typeof F === "function");
      // ---- synchronous formatLink combinations (recorded immediately) ----
      rec("wiki_short", F("Note.md", "x.md", { useMarkdown: false, pathFormat: "shortest" }));
      rec("md_short", F("Note.md", "x.md", { useMarkdown: true, pathFormat: "shortest" }));
      rec("md_abs", F("folder/Sub.md", "x.md", { useMarkdown: true, pathFormat: "absolute" }));
      rec("md_space", F("my note.md", "x.md", { useMarkdown: true, pathFormat: "shortest" }));
      rec("md_rel", F("b/Target.md", "a/from.md", { useMarkdown: true, pathFormat: "relative" }));
      rec("guard_b_embed", F("img.png", "x.md", { useMarkdown: true, pathFormat: "absolute", embed: true }));
      rec("guard_a_wikirel", F("b/Target.md", "a/from.md", { useMarkdown: false, pathFormat: "relative" }));
      rec("unresolved_null", F("nope/ghost.md", "x.md", { useMarkdown: false, pathFormat: "absolute" }));
      // ---- real-fs write path: unlinked mention → markdown link ----
      F("Note.md", "x.md", { useMarkdown: true }); // flip global setting ON
      const U = (globalThis).__geodeUnlinked;
      rec("unlinked_present", !!U);
      await U.linkAll("Note.md", "mref.md");
      rec("mref_after", await app.vault.read("mref.md"));
      // spaced active-note name → percent-encoded href; resolveByKind fix
      await U.linkAll("Spaced Note.md", "smref.md");
      rec("smref_after", await app.vault.read("smref.md"));
      F("Note.md", "x.md", { useMarkdown: false }); // reset for cleanliness
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r72-probe.js"), probe);
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

console.log("— new-link format on real WKWebView + real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("__geodeFormatLink present", data.present === true);
ok("wiki + shortest → [[Note]]", data.wiki_short === "[[Note]]", JSON.stringify(data.wiki_short));
ok("md + shortest → [Note](Note.md)", data.md_short === "[Note](Note.md)", JSON.stringify(data.md_short));
ok("md + absolute → [Sub](folder/Sub.md)", data.md_abs === "[Sub](folder/Sub.md)", JSON.stringify(data.md_abs));
ok("md href encodes spaces → [my note](my%20note.md)", data.md_space === "[my note](my%20note.md)", JSON.stringify(data.md_space));
ok("md + relative → [Target](../b/Target.md)", data.md_rel === "[Target](../b/Target.md)", JSON.stringify(data.md_rel));
ok("guard (b): embed + md setting → ![[img.png]]", data.guard_b_embed === "![[img.png]]", JSON.stringify(data.guard_b_embed));
ok("guard (a): wiki + relative → shortest [[Target]]", data.guard_a_wikirel === "[[Target]]", JSON.stringify(data.guard_a_wikirel));
ok("unresolvable → null", data.unresolved_null === null, JSON.stringify(data.unresolved_null));
ok("__geodeUnlinked present", data.unlinked_present === true);
ok("unlinked mention rewritten to [Note](Note.md) (app.vault.read)", typeof data.mref_after === "string" && data.mref_after.includes("[Note](Note.md)") && !data.mref_after.includes("[[Note]]"), JSON.stringify(data.mref_after));
ok("spaced-name mention rewritten to [Spaced Note](Spaced%20Note.md) (resolveByKind fix)", typeof data.smref_after === "string" && data.smref_after.includes("[Spaced Note](Spaced%20Note.md)"), JSON.stringify(data.smref_after));
// strongest real-fs assertion: read the actual files from disk in the harness
const onDisk = existsSync(MREF) ? readFileSync(MREF, "utf8") : "";
ok("mref.md on DISK contains [Note](Note.md) (real fs write)", onDisk.includes("[Note](Note.md)"), JSON.stringify(onDisk));
const smOnDisk = existsSync(SMREF) ? readFileSync(SMREF, "utf8") : "";
ok("smref.md on DISK contains [Spaced Note](Spaced%20Note.md) (real fs, encoded href)", smOnDisk.includes("[Spaced Note](Spaced%20Note.md)"), JSON.stringify(smOnDisk));

console.log(`\nR72 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
