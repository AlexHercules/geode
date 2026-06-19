/**
 * R104 desktop probe — verifies the media-kind classification (mediaKind / mediaMime) on
 * the real Tauri / WKWebView build via window.__geodeMediaKind(paths): which inline preview
 * (image/audio/video/pdf/other) each attachment renders + its blob MIME. The actual
 * <audio>/<video>/<embed> DOM is browser-E2E only (§D). Run: node .calibration/r104-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r104-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r104-results.md");

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
  id: "r104-probe", name: "r104-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r104-results.md", b).catch(() => app.vault.modify("r104-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeMediaKind;
      rec("present", typeof F === "function");
      rec("kinds", F(["a.png","a.mp3","a.wav","a.mp4","a.mov","a.pdf","a.docx","a.zip","a.md","a.3gp","a.ogv","x.toString"]));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r104-probe.js"), probe);
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
const k = Object.fromEntries((data.kinds ?? []).map((r) => [r.path, r]));

console.log("— mediaKind/mediaMime on real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok(".png → image", k["a.png"]?.kind === "image");
ok(".mp3 → audio (audio/mpeg)", k["a.mp3"]?.kind === "audio" && k["a.mp3"]?.mime === "audio/mpeg");
ok(".wav → audio", k["a.wav"]?.kind === "audio");
ok(".mp4 → video (video/mp4)", k["a.mp4"]?.kind === "video" && k["a.mp4"]?.mime === "video/mp4");
ok(".mov → video", k["a.mov"]?.kind === "video");
ok(".pdf → pdf (application/pdf)", k["a.pdf"]?.kind === "pdf" && k["a.pdf"]?.mime === "application/pdf");
ok(".docx / .zip → other (placeholder)", k["a.docx"]?.kind === "other" && k["a.zip"]?.kind === "other");
ok(".md → other (not a media attachment)", k["a.md"]?.kind === "other");
ok("R104 added: .3gp → audio, .ogv → video", k["a.3gp"]?.kind === "audio" && k["a.ogv"]?.kind === "video");
ok("review fix: x.toString (Object.prototype name) → other, not image", k["x.toString"]?.kind === "other", JSON.stringify(k["x.toString"]));

console.log(`\nR104 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
