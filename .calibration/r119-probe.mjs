/**
 * R119 desktop probe — verifies compat getFileCache(file).embeds on the real Tauri / WKWebView
 * binary against the native-fs index: `![[..]]` wikilink embeds are filed in .embeds (original/
 * position include the `!`), split out of .links. Metadata-level (no editor mount), so fully
 * verifiable on desktop (unlike R116/R117). Run: node .calibration/r119-probe.mjs
 *
 * §D/R111: native onload is fire-and-forget (avoids loadObsidianPlugins deadlock) + IPC-polls;
 * the content is warmed via napp.vault.read so buildCache sees the text (embeds need content).
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r119-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r119-results.md");

let passed = 0, failed = 0;
const fails = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "mix.md"), "see [[target]] and ![[image.png]] and ![[doc.pdf|My Doc]]\n");

const probe = `module.exports = {
  id: "r119-probe", name: "r119-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r119-results.md", b).catch(() => napp.vault.modify("r119-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && window.app.metadataCache && window.app.vault);
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("mix.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      // warm content so buildCache can detect the bang prefix
      await napp.vault.read("mix.md").catch(() => {});
      const fileOf = () => window.app.vault.getFileByPath("mix.md");
      const cache = () => window.app.metadataCache.getFileCache(fileOf());
      for (let i = 0; i < 40 && !(cache() && Array.isArray(cache().embeds) && cache().embeds.length === 2); i++) { try { await napp.vault.read("mix.md"); } catch { /* drain */ } }
      const c = cache();
      rec("embedsLen", c && c.embeds && c.embeds.length);
      rec("embedLinks", c && c.embeds && c.embeds.map((e) => e.link).sort());
      rec("embedOriginals", c && c.embeds && c.embeds.map((e) => e.original).sort());
      rec("aliasDisplay", c && c.embeds && (c.embeds.find((e) => e.link === "doc.pdf") || {}).displayText);
      rec("linkTargets", c && c.links && c.links.map((l) => l.link));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r119-probe.js"), probe);
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

console.log("— compat getFileCache().embeds on the real-fs index —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat metadataCache present", data.present === true);
ok("embeds has the 2 ![[..]] references", data.embedsLen === 2, JSON.stringify(data.embedsLen));
ok("embed links = [doc.pdf, image.png]", eq(data.embedLinks, ["doc.pdf", "image.png"]), JSON.stringify(data.embedLinks));
ok("embed originals carry the '!' (![[image.png]] / ![[doc.pdf|My Doc]])", eq(data.embedOriginals, ["![[doc.pdf|My Doc]]", "![[image.png]]"]), JSON.stringify(data.embedOriginals));
ok("aliased embed displayText = 'My Doc'", data.aliasDisplay === "My Doc", JSON.stringify(data.aliasDisplay));
ok("links has [[target]] but NOT the embeds", eq(data.linkTargets, ["target"]), JSON.stringify(data.linkTargets));

console.log(`\nR119 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
