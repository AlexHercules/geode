/**
 * R112 desktop probe — exercises compat fileManager.generateMarkdownLink on the REAL Tauri /
 * WKWebView build against the native filesystem index. The compat App (globalThis.app, built by
 * the plugin loader) delegates to core formatLink; link settings are flipped via the always-on
 * R72 __geodeFormatLink probe (set at bootstrap, before loadExternal). Run: node .calibration/r112-probe.mjs
 *
 * App-Nap / timing discipline (data-safety §D, R111): native .geode/plugins load during
 * loadExternal — BEFORE loadObsidianPlugins publishes window.app — so onload returns immediately
 * (fire-and-forget; awaiting would deadlock loadObsidianPlugins) and polls window.app + the index
 * via IPC vault reads (IPC drains under App-Nap; setTimeout does not).
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r112-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r112-results.md");

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
  id: "r112-probe", name: "r112-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r112-results.md", b).catch(() => napp.vault.modify("r112-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      await napp.vault.create("Note.md", "# Note\\n").catch(() => {});
      const fmt = () => globalThis.__geodeFormatLink && globalThis.__geodeFormatLink("Note.md", "", { useMarkdown: false, pathFormat: "shortest" });
      let app = window.app;
      // poll (via IPC reads) for window.app AND for the index to resolve the new note
      for (let i = 0; i < 60 && (!app || fmt() !== "[[Note]]"); i++) { try { await napp.vault.read("seed.md"); } catch { /* drain */ } app = window.app; }
      rec("present", !!app && !!app.fileManager && typeof app.fileManager.generateMarkdownLink === "function");
      if (!app) { rec("done", true); return; }
      const fm = app.fileManager;
      const file = app.vault.getFileByPath("Note.md") || { path: "Note.md" };
      rec("basic", fm.generateMarkdownLink(file, ""));
      rec("alias", fm.generateMarkdownLink(file, "", undefined, "Disp"));
      rec("sub", fm.generateMarkdownLink(file, "", "#Heading"));
      rec("emptyAlias", fm.generateMarkdownLink(file, "", undefined, ""));
      globalThis.__geodeFormatLink("Note.md", "", { useMarkdown: true, pathFormat: "shortest" });
      rec("md", fm.generateMarkdownLink(file, ""));
      rec("mdSubSpace", fm.generateMarkdownLink(file, "", "#Heading With Spaces"));
      globalThis.__geodeFormatLink("Note.md", "", { useMarkdown: false, pathFormat: "shortest" });
      rec("fallback", fm.generateMarkdownLink({ path: "Ghost.md" }, ""));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r112-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 25000;
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

console.log("— compat generateMarkdownLink on real fs index —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat App.fileManager.generateMarkdownLink present", data.present === true);
ok("basic note → [[Note]] (wikilink shortest)", data.basic === "[[Note]]", JSON.stringify(data.basic));
ok("alias → [[Note|Disp]]", data.alias === "[[Note|Disp]]", JSON.stringify(data.alias));
ok("subpath → [[Note#Heading]]", data.sub === "[[Note#Heading]]", JSON.stringify(data.sub));
ok("empty-string alias = file name → [[Note]]", data.emptyAlias === "[[Note]]", JSON.stringify(data.emptyAlias));
ok("markdown mode → [Note](Note.md)", data.md === "[Note](Note.md)", JSON.stringify(data.md));
ok("markdown spaced subpath %-encoded → [Note](Note.md#Heading%20With%20Spaces)", data.mdSubSpace === "[Note](Note.md#Heading%20With%20Spaces)", JSON.stringify(data.mdSubSpace));
ok("unindexed file still returns a string (fallback) → [[Ghost]]", data.fallback === "[[Ghost]]", JSON.stringify(data.fallback));

console.log(`\nR112 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
