/**
 * R102 desktop probe — verifies the attachment-routing predicate (isAttachmentPath /
 * isImagePath) AND the real open→viewType on the Tauri / WKWebView build + real fs:
 *  ① __geodeAttachmentRouting classifies image/binary/md/text paths correctly;
 *  ② opening a real non-md file sets the active tab's viewType to "attachment"
 *     (the data-safety route — read-only viewer, never the editable markdown buffer),
 *     while opening a .md stays "markdown".
 * The viewer DOM (<img>/placeholder) is browser-E2E only (§D). Run:
 * node .calibration/r102-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r102-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r102-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "note.md"), "# a note\n");
writeFileSync(join(VAULT, "photo.png"), "fake-png-bytes");
writeFileSync(join(VAULT, "song.mp3"), "fake-mp3-bytes");

const probe = `module.exports = {
  id: "r102-probe", name: "r102-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r102-results.md", b).catch(() => app.vault.modify("r102-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeAttachmentRouting;
      rec("present", typeof F === "function");
      rec("routing", F(["photo.png", "song.mp3", "note.md", "data.json", "doc.pdf", "icon.svg", "sheet.docx", "phone.heic", "tool.exe"]));
      // open a real non-md file → viewType must be the read-only "attachment" route
      app.workspace.openFile("photo.png");
      await new Promise((r) => setTimeout(r, 150));
      rec("pngViewType", app.workspace.getActiveTab() && app.workspace.getActiveTab().viewType);
      // open a real .md → must stay editable "markdown"
      app.workspace.openFile("note.md");
      await new Promise((r) => setTimeout(r, 150));
      rec("mdViewType", app.workspace.getActiveTab() && app.workspace.getActiveTab().viewType);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r102-probe.js"), probe);
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
const route = Object.fromEntries((data.routing ?? []).map((r) => [r.path, r]));

console.log("— attachment routing + open→viewType on real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("photo.png → isAttachment + isImage", route["photo.png"]?.isAttachment === true && route["photo.png"]?.isImage === true, JSON.stringify(route["photo.png"]));
ok("song.mp3 → isAttachment, NOT image", route["song.mp3"]?.isAttachment === true && route["song.mp3"]?.isImage === false, JSON.stringify(route["song.mp3"]));
ok("doc.pdf → isAttachment, NOT image", route["doc.pdf"]?.isAttachment === true && route["doc.pdf"]?.isImage === false, JSON.stringify(route["doc.pdf"]));
ok("icon.svg → isAttachment + isImage", route["icon.svg"]?.isAttachment === true && route["icon.svg"]?.isImage === true, JSON.stringify(route["icon.svg"]));
ok("note.md → NOT attachment (editable markdown)", route["note.md"]?.isAttachment === false, JSON.stringify(route["note.md"]));
ok("data.json → NOT attachment (text stays editable)", route["data.json"]?.isAttachment === false, JSON.stringify(route["data.json"]));
ok("review fix 2: common binaries (docx/heic/exe) → attachment, NOT editable", route["sheet.docx"]?.isAttachment === true && route["phone.heic"]?.isAttachment === true && route["tool.exe"]?.isAttachment === true, JSON.stringify([route["sheet.docx"], route["phone.heic"], route["tool.exe"]]));
ok("opening photo.png sets viewType 'attachment' (read-only route)", data.pngViewType === "attachment", JSON.stringify(data.pngViewType));
ok("opening note.md stays viewType 'markdown' (editable)", data.mdViewType === "markdown", JSON.stringify(data.mdViewType));

console.log(`\nR102 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
