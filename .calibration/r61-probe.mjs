/**
 * R61 desktop probe — verifies image-embed sizing through the REAL reading-view
 * pipeline (__geodeRenderMarkdown → markdown.ts → parseEmbedSize) on the actual
 * Tauri/WKWebView build. Deterministic + synchronous (no live view, no async
 * binary read) → App-Nap-safe. A real pic.png seeded into the vault makes
 * metadata.resolveAttachment succeed so the image branch runs.
 *
 * Run: node .calibration/r61-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 61 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r61-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r61-results.md");

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
// a real (tiny) PNG so metadata.resolveAttachment("pic.png") succeeds
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
writeFileSync(join(VAULT, "pic.png"), PNG);

const probe = `module.exports = {
  id: "r61-probe", name: "r61-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r61-results.md", body).catch(() =>
        app.vault.modify("r61-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const R = (globalThis).__geodeRenderMarkdown;
      recFlush("present", typeof R === "function");
      recFlush("widthOnly", R("![[pic.png|200]]", ""));
      recFlush("widthHeight", R("![[pic.png|150x90]]", ""));
      recFlush("caption", R("![[pic.png|a caption]]", ""));
      recFlush("plain", R("![[pic.png]]", ""));
      recFlush("badX", R("![[pic.png|200x]]", ""));
      recFlush("huge", R("![[pic.png|999999]]", ""));
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r61-probe.js"), probe);
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
const has = (k, sub) => typeof data[k] === "string" && data[k].includes(sub);

console.log("— image-embed sizing through real markdown.ts on WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeRenderMarkdown present", data.present === true);
ok("`|200` → width=200, alt=filename", has("widthOnly", 'width="200"') && has("widthOnly", 'alt="pic.png"') && !has("widthOnly", "height="), J(data.widthOnly));
ok("`|150x90` → width=150 height=90", has("widthHeight", 'width="150"') && has("widthHeight", 'height="90"'), J(data.widthHeight));
ok("`|a caption` → alt=caption, no width", has("caption", 'alt="a caption"') && !has("caption", "width="), J(data.caption));
ok("plain embed → no width, alt=filename", has("plain", 'alt="pic.png"') && !has("plain", "width="), J(data.plain));
ok("`|200x` (malformed) → alt text, no width", has("badX", 'alt="200x"') && !has("badX", "width="), J(data.badX));
ok("`|999999` (over 5-digit cap) → alt text, no width", has("huge", 'alt="999999"') && !has("huge", "width="), J(data.huge));

console.log(`\nR61 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
