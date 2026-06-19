/**
 * R104 attachment media preview (audio/video/pdf) E2E — browser mode :1420.
 * Run: node .calibration/r104-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 104 additions" (㊽ 续续续续续续).
 *
 * Extends R102's read-only attachment viewer: audio→<audio>, video→<video>, pdf→<embed>
 * inline previews (was placeholder). Still read-only (no documents.acquire). mediaKind
 * routing in core/attachments; isAttachmentPath's total set is unchanged (+3gp/ogv media).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r104", name: "r104", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeMediaKind, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = (p) => app(([path]) => { window.__app.workspace.openFile(path); }, [p]);
const activeTab = () => app(() => { const t = window.__app.workspace.getActiveTab(); return t ? { viewType: t.viewType } : null; });
const createBin = (p) => app(async ([path]) => {
  try { await window.__app.vault.createBinary(path, new Uint8Array([1, 2, 3, 4])); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
}, [p]);

// ── mediaKind / mediaMime classification (probe) ────────────────────────────
console.log("— mediaKind (probe) —");
const route = Object.fromEntries((await app(() => window.__geodeMediaKind(
  ["a.png", "a.mp3", "a.m4a", "a.wav", "a.mp4", "a.mov", "a.webm", "a.pdf", "a.docx", "a.zip", "a.md", "a.json", "a.3gp", "a.ogv", "x.toString", "y.constructor"],
))).map((r) => [r.path, r]));
ok(".png → image", route["a.png"].kind === "image" && route["a.png"].mime === "image/png");
ok(".mp3 → audio (audio/mpeg)", route["a.mp3"].kind === "audio" && route["a.mp3"].mime === "audio/mpeg");
ok(".wav → audio (audio/wav)", route["a.wav"].kind === "audio" && route["a.wav"].mime === "audio/wav");
ok(".mp4 → video (video/mp4)", route["a.mp4"].kind === "video" && route["a.mp4"].mime === "video/mp4");
ok(".mov → video (video/quicktime)", route["a.mov"].kind === "video" && route["a.mov"].mime === "video/quicktime");
ok(".webm → video", route["a.webm"].kind === "video");
ok(".pdf → pdf (application/pdf)", route["a.pdf"].kind === "pdf" && route["a.pdf"].mime === "application/pdf");
ok(".docx → other (placeholder)", route["a.docx"].kind === "other");
ok(".zip → other (placeholder)", route["a.zip"].kind === "other");
ok(".md / .json → other (not a media attachment)", route["a.md"].kind === "other" && route["a.json"].kind === "other");
ok("R104 added formats: .3gp → audio, .ogv → video", route["a.3gp"].kind === "audio" && route["a.ogv"].kind === "video");
ok("review fix: Object.prototype-named files (x.toString) → other, not image", route["x.toString"].kind === "other" && route["y.constructor"].kind === "other", JSON.stringify([route["x.toString"], route["y.constructor"]]));

// ── inline preview DOM for each kind ────────────────────────────────────────
console.log("— inline preview rendering —");
await createBin("song.mp3");
await createBin("clip.mp4");
await createBin("paper.pdf");
await createBin("data.zip");

await open("song.mp3");
await wait(250);
ok("audio file → viewType attachment", (await activeTab())?.viewType === "attachment");
ok("an <audio controls> (blob URL) is rendered", await app(() => {
  const el = document.querySelector('[data-testid="attachment-audio"]');
  return !!el && el.tagName === "AUDIO" && el.hasAttribute("controls") && (el.getAttribute("src") || "").startsWith("blob:");
}));
ok("audio attachment never mounts a markdown editor", await app(() => !document.querySelector('.main-content .cm-editor')));

await open("clip.mp4");
await wait(250);
ok("a <video controls> (blob URL) is rendered", await app(() => {
  const el = document.querySelector('[data-testid="attachment-video"]');
  return !!el && el.tagName === "VIDEO" && el.hasAttribute("controls") && (el.getAttribute("src") || "").startsWith("blob:");
}));

await open("paper.pdf");
await wait(250);
ok("an <embed application/pdf> (blob URL) is rendered", await app(() => {
  const el = document.querySelector('[data-testid="attachment-pdf"]');
  return !!el && el.getAttribute("type") === "application/pdf" && (el.getAttribute("src") || "").startsWith("blob:");
}));

await open("data.zip");
await wait(200);
ok("non-previewable .zip still shows the read-only placeholder (no media element)", await app(() => {
  return !!document.querySelector('[data-testid="attachment-placeholder"]')
    && !document.querySelector('[data-testid="attachment-audio"]')
    && !document.querySelector('[data-testid="attachment-video"]')
    && !document.querySelector('[data-testid="attachment-pdf"]');
}));

// ── data safety: media preview is still read-only (no editable handle) ──────
console.log("— data safety —");
await open("clip.mp4");
await wait(200);
ok("documents.getActiveView() is null while a media attachment is active", (await app(() => window.__app.documents.getActiveView())) === null);

console.log(`\nR104 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
