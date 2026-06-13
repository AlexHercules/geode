/**
 * R26 media/PDF embed E2E — browser mode (Memory vault) against dev :1420.
 * Run: node .calibration/r26-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 26 additions".
 *
 * Covers: reading-view audio/video/pdf embeds render as native <audio>/<video>/
 * <iframe class=geode-embed-pdf>; PDF page anchor (#page=N) rides on the iframe
 * src; non-media attachment (.zip) still degrades to a link (no embed element);
 * live-preview (.cm-content) renders the same three via CM widgets.
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
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r26", name: "r26", onload(app) { window.__app = app; } }));

const create = (p, c) => page.evaluate(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 50));
}, [p, c]);
const openMode = (p, mode) => page.evaluate(async ([path, m]) => {
  window.__app.workspace.openFile(path);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, m);
  await new Promise((r) => setTimeout(r, 150));
}, [p, mode]);

// fixtures — content is arbitrary (hydration reads bytes into a blob; the native
// player can't decode fake data, but the ELEMENT + src are what we assert).
await create("audio.mp3", "fake-audio-bytes");
await create("video.mp4", "fake-video-bytes");
await create("doc.pdf", "%PDF-1.4 fake");
await create("archive.zip", "PK fake");
await create("Media.md", `# Media

audio: ![[audio.mp3]]

video: ![[video.mp4]]

pdf: ![[doc.pdf]]

pdf page: ![[doc.pdf#page=3]]

zip: ![[archive.zip]]
`);

console.log("— reading view: audio/video/pdf render as native elements —");
await openMode("Media.md", "preview");
await page.waitForSelector(".preview-content audio.geode-embed-media", { timeout: 4000 }).catch(() => {});
ok("audio embed → <audio class=geode-embed-media>", (await page.$(".preview-content audio.geode-embed-media")) !== null);
ok("video embed → <video class=geode-embed-media>", (await page.$(".preview-content video.geode-embed-media")) !== null);
ok("pdf embed → <iframe class=geode-embed-pdf>", (await page.$(".preview-content iframe.geode-embed-pdf")) !== null);

const audioSrc = await page.$eval(".preview-content audio.geode-embed-media", (el) => el.getAttribute("src") || "").catch(() => "");
ok("audio src is a blob URL", audioSrc.startsWith("blob:"), audioSrc.slice(0, 40));

const pdfSrcs = await page.$$eval(".preview-content iframe.geode-embed-pdf", (els) => els.map((e) => e.getAttribute("src") || ""));
ok("at least one pdf iframe carries #page=3 anchor", pdfSrcs.some((s) => s.includes("#page=3")), JSON.stringify(pdfSrcs.map((s) => s.slice(-12))));
ok("plain pdf iframe has a blob src (no page anchor)", pdfSrcs.some((s) => s.startsWith("blob:") && !s.includes("#")), JSON.stringify(pdfSrcs.map((s) => s.slice(0, 10))));

console.log("— non-media attachment (.zip) still degrades to a link —");
ok("no embed element for .zip", (await page.$(".preview-content [data-embed-path='archive.zip']")) === null);
const zipLink = await page.$(".preview-content a.internal-link[data-target='archive.zip']");
ok(".zip renders as an internal-link anchor", zipLink !== null);

console.log("— live preview: same three render as CM widgets —");
await openMode("Media.md", "live");
await page.waitForSelector(".cm-content .cm-live-embed", { timeout: 4000 }).catch(() => {});
ok("live audio widget", (await page.$(".cm-content audio.cm-live-embed")) !== null);
ok("live video widget", (await page.$(".cm-content video.cm-live-embed")) !== null);
ok("live pdf widget", (await page.$(".cm-content iframe.cm-live-embed.geode-embed-pdf")) !== null);
const livePdfSrcs = await page.$$eval(".cm-content iframe.cm-live-embed.geode-embed-pdf", (els) => els.map((e) => e.getAttribute("src") || "")).catch(() => []);
ok("live pdf widget carries #page=3", livePdfSrcs.some((s) => s.includes("#page=3")), JSON.stringify(livePdfSrcs.map((s) => s.slice(-12))));

console.log(`\nR26 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
