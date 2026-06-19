/**
 * R105 Unsupported-file denylist flip E2E — browser mode :1420.
 * Run: node .calibration/r105-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 105 additions" (㊽ 续续续续续续续).
 *
 * isAttachmentPath flipped allowlist→DENYLIST: only markdown + known text/code + extensionless
 * files open in the editor; EVERYTHING else (binaries, media, AND unknown extensions) opens
 * read-only — closing the data-safety hole where an unrecognised binary could be edited-as-
 * markdown and corrupted. Verified by symmetric difference: no binary flips to editable.
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r105", name: "r105", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeAttachmentRouting, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const route = async (exts) => {
  const paths = exts.map((e) => (e === "" ? "README" : `f.${e}`));
  const res = await app(([ps]) => Object.fromEntries(window.__geodeAttachmentRouting(ps).map((r) => [r.path, r.isAttachment])), [paths]);
  return (e) => res[e === "" ? "README" : `f.${e}`];
};
const open = (p) => app(([path]) => { window.__app.workspace.openFile(path); }, [p]);
const activeViewType = () => app(() => window.__app.workspace.getActiveTab()?.viewType ?? null);

// ── SAFETY: every old binary/media extension is STILL read-only (no corruption regression) ──
console.log("— safety: no binary/media flips to editable —");
const OLD_ATTACH = ["png","jpg","jpeg","gif","webp","svg","bmp","ico","avif","mp3","m4a","aac","opus","aiff","wav","ogg","flac","3gp","mp4","m4v","mov","mkv","webm","ogv","avi","wmv","flv","pdf","doc","docx","xls","xlsx","ppt","pptx","odt","ods","odp","rtf","epub","heic","heif","tiff","tif","psd","ai","raw","zip","7z","rar","tar","gz","bz2","xz","tgz","exe","dll","so","dylib","bin","wasm","app","deb","rpm","msi","dmg","iso","db","sqlite","sqlite3","ttf","otf","woff","woff2"];
const rOld = await route(OLD_ATTACH);
const flippedToEditable = OLD_ATTACH.filter((e) => rOld(e) !== true);
ok("ALL old binary/media extensions stay read-only attachment (none flips to editable)", flippedToEditable.length === 0, `flipped: ${JSON.stringify(flippedToEditable)}`);

// ── known text/code stays editable (zero regression for text editing) ───────
console.log("— text/code stays editable —");
const TEXT = ["md","markdown","txt","json","jsonc","csv","tsv","yaml","yml","toml","xml","html","css","js","jsx","ts","tsx","py","rb","rs","go","java","c","cpp","sh","bash","sql","graphql","vue","svelte"];
const rText = await route(TEXT);
const textNowAttach = TEXT.filter((e) => rText(e) !== false);
ok("ALL known text/code extensions stay editable (not attachment)", textNowAttach.length === 0, `now read-only: ${JSON.stringify(textNowAttach)}`);

// ── the FLIP: unknown extensions are now read-only; extensionless stays editable ──
console.log("— the denylist flip —");
const rMisc = await route(["xyz", "foo", "dat", "unknownext", ""]);
ok("unknown extension .xyz → read-only attachment (the data-safety win)", rMisc("xyz") === true);
ok("unknown extensions .foo/.dat/.unknownext → read-only", rMisc("foo") === true && rMisc("dat") === true && rMisc("unknownext") === true);
ok("extensionless file (README/LICENSE) stays editable", rMisc("") === false);
// .plist is deliberately read-only (binary bplist variant); ipynb/srt are text → editable
const rEdge = await route(["plist", "ipynb", "srt"]);
ok(".plist → read-only (has a binary variant — review consistency fix)", rEdge("plist") === true);
ok(".ipynb/.srt (text) → editable", rEdge("ipynb") === false && rEdge("srt") === false);

// ── end-to-end routing honors the flip ──────────────────────────────────────
console.log("— end-to-end routing —");
await app(async () => {
  try { await window.__app.vault.create("notes.txt", "plain text"); } catch { /* exists */ }
  try { await window.__app.vault.create("mystery.xyz", "unknown bytes"); } catch { /* exists */ }
  try { await window.__app.vault.create("Dockerfile", "FROM scratch"); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 60));
});
await open("notes.txt");
await wait(150);
ok(".txt opens in the editable markdown editor (viewType markdown)", (await activeViewType()) === "markdown");
await open("mystery.xyz");
await wait(150);
ok("unknown .xyz opens in the read-only attachment viewer (viewType attachment)", (await activeViewType()) === "attachment");
ok("the unknown file shows the read-only placeholder (mediaKind other)", await app(() => !!document.querySelector('[data-testid="attachment-placeholder"]')));
ok("DATA SAFETY: no editable handle for the unknown-binary attachment", (await app(() => window.__app.documents.getActiveView())) === null);
await open("Dockerfile");
await wait(150);
ok("extensionless 'Dockerfile' opens editable (viewType markdown)", (await activeViewType()) === "markdown");

console.log(`\nR105 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
