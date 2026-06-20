/**
 * R126 desktop probe — verifies compat getFileCache(file).frontmatterLinks on the real Tauri /
 * WKWebView fs index: every `[[wikilink]]` inside a frontmatter property value → {key, link,
 * original, displayText?}, key = field name or `field.N` for list elements, link = target without
 * `#subpath`, displayText = the `|alias`. Body wikilinks must NOT appear (FM-only). Metadata-level
 * (no editor mount) → fully verifiable on desktop, like R119/R124/R125. Fixture written HOST-side.
 * Run: node .calibration/r126-probe.mjs   (needs the release binary)
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r126-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r126-results.md");

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
// fixture written HOST-side. frontmatter: bare / aliased / subpath / inline-array link + plain.
// body has a wikilink that must NOT leak into frontmatterLinks.
const FML = [
  "---",
  'related: "[[Note A]]"',
  'link: "[[T|D]]"',
  'ref: "[[Note#Heading]]"',
  'refs: ["[[R1]]", "[[R2]]"]',
  "plain: text",
  "---",
  "# Body",
  "",
  "[[BodyLink]] must not appear.",
  "",
].join("\n");
writeFileSync(join(VAULT, "fml.md"), FML);

const probe = `module.exports = {
  id: "r126-probe", name: "r126-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r126-results.md", b).catch(() => napp.vault.modify("r126-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && window.app.metadataCache && window.app.vault);
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("fml.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      await napp.vault.read("fml.md").catch(() => {});
      const cache = () => window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("fml.md"));
      for (let i = 0; i < 40 && !(cache() && cache().frontmatterLinks && cache().frontmatterLinks.length >= 5); i++) { try { await napp.vault.read("fml.md"); } catch { /* drain */ } }
      const c = cache();
      const fl = c && c.frontmatterLinks ? c.frontmatterLinks : null;
      rec("keys", fl ? fl.map((x) => x.key) : null);
      rec("links", fl ? fl.map((x) => x.link) : null);
      rec("originals", fl ? fl.map((x) => x.original) : null);
      rec("disp", fl ? fl.map((x) => x.displayText === undefined ? null : x.displayText) : null);
      rec("hasBody", fl ? fl.some((x) => x.link === "BodyLink") : null);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r126-probe.js"), probe);
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

console.log("— compat getFileCache().frontmatterLinks on the real-fs index —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat metadataCache present", data.present === true);
ok("5 frontmatter links, keys = [related, link, ref, refs.0, refs.1]", eq(data.keys, ["related", "link", "ref", "refs.0", "refs.1"]), JSON.stringify(data.keys));
ok("links = [Note A, T, Note, R1, R2] (subpath dropped)", eq(data.links, ["Note A", "T", "Note", "R1", "R2"]), JSON.stringify(data.links));
ok("originals are the raw [[..]]", eq(data.originals, ["[[Note A]]", "[[T|D]]", "[[Note#Heading]]", "[[R1]]", "[[R2]]"]), JSON.stringify(data.originals));
ok("displayText only on the aliased link ([null, 'D', null, null, null])", eq(data.disp, [null, "D", null, null, null]), JSON.stringify(data.disp));
ok("body [[BodyLink]] excluded (FM-only, real fs)", data.hasBody === false, JSON.stringify(data.hasBody));

console.log(`\nR126 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
