/**
 * R108 [[ completion lists non-md attachments E2E — browser mode :1420.
 * Run: node .calibration/r108-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 108 additions" (㊹ 续续).
 *
 * The `[[` autocomplete now offers non-md attachments (images/pdf/…) — picking inserts
 * `[[image.png]]` (link) or `![[image.png]]` (embed, when `![[` was typed). Link text = the
 * name (with extension) unless ambiguous → full path. Pure = wikilinkAttachmentCandidates.
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
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); localStorage.removeItem("geode.graphPrefs"); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r108", name: "r108", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeWikilinkAttachments, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await app(async () => {
  try { await window.__app.vault.create("ZZNote.md", "# ZZNote\n\nbody\n"); } catch { /* exists */ }
  try { await window.__app.vault.create("zzpic.png", "fake-png"); } catch { /* exists */ }
  try { await window.__app.vault.create("zzdoc.pdf", "%PDF fake"); } catch { /* exists */ }
  try { await window.__app.vault.createFolder("zzA"); } catch { /* exists */ }
  try { await window.__app.vault.createFolder("zzB"); } catch { /* exists */ }
  try { await window.__app.vault.create("zzA/dup.png", "fakeA"); } catch { /* exists */ }
  try { await window.__app.vault.create("zzB/dup.png", "fakeB"); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 250));
});

// ── wikilinkAttachmentCandidates (probe) ────────────────────────────────────
console.log("— wikilinkAttachmentCandidates (probe) —");
const cands = await app(() => window.__geodeWikilinkAttachments(false));
const by = (n) => cands.filter((c) => c.name === n);
ok("zzpic.png offered, link text is the bare name (unique)", by("zzpic.png").length === 1 && by("zzpic.png")[0].linkText === "zzpic.png", JSON.stringify(by("zzpic.png")));
ok("zzdoc.pdf offered (pdf attachment)", by("zzdoc.pdf").length === 1);
ok("ambiguous dup.png → link text is the FULL PATH (zzA/dup.png + zzB/dup.png)", by("dup.png").length === 2 && by("dup.png").every((c) => c.linkText.endsWith("/dup.png") && c.linkText.includes("/")), JSON.stringify(by("dup.png")));
ok("md notes are NOT in the attachment candidates (ZZNote excluded)", !cands.some((c) => c.name === "ZZNote.md" || c.name === "ZZNote"));
const candsAbs = await app(() => window.__geodeWikilinkAttachments(true));
ok("absolute path format → even a unique attachment uses the full path", candsAbs.find((c) => c.name === "zzpic.png")?.linkText === "zzpic.png" || candsAbs.find((c) => c.name === "zzpic.png")?.linkText.includes("zzpic.png"), JSON.stringify(candsAbs.find((c) => c.name === "zzpic.png")));

// ── [[ CM completion: attachment offered + inserts [[zzpic.png]] ────────────
console.log("— [[ CM completion (attachment) —");
await app(async () => {
  window.__app.workspace.openFile("ZZNote.md");
  await new Promise((r) => setTimeout(r, 200));
  const tab = window.__app.workspace.getActiveTab();
  if (tab) window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 250));
});
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await page.keyboard.press("Control+End");
await page.keyboard.type("\n[[zzpic");
await wait(350);
ok("typing `[[zzpic` opens the autocomplete tooltip", await page.isVisible(".cm-tooltip-autocomplete"));
const opts = await page.$$eval(".cm-tooltip-autocomplete li", (els) => els.map((e) => e.textContent)).catch(() => []);
ok("the attachment `zzpic.png` is offered", opts.some((o) => o && o.includes("zzpic.png")), JSON.stringify(opts));
await page.keyboard.press("Enter");
await wait(250);
let docText = await app(() => window.__app.documents.get(window.__app.workspace.getActiveFile())?.getText() ?? "");
ok("picking the attachment inserts `[[zzpic.png]]` (link, with extension)", docText.includes("[[zzpic.png]]"), JSON.stringify(docText.slice(-40)));

// ── ![[ embed: same completion, inserts ![[zzpic.png]] ──────────────────────
console.log("— ![[ embed completion —");
await page.keyboard.press("Control+End");
await page.keyboard.type("\n![[zzpic");
await wait(350);
const embOpts = await page.$$eval(".cm-tooltip-autocomplete li", (els) => els.map((e) => e.textContent)).catch(() => []);
ok("`![[zzpic` also offers the attachment", embOpts.some((o) => o && o.includes("zzpic.png")), JSON.stringify(embOpts));
await page.keyboard.press("Enter");
await wait(250);
docText = await app(() => window.__app.documents.get(window.__app.workspace.getActiveFile())?.getText() ?? "");
ok("picking under `![[` inserts `![[zzpic.png]]` (embed)", docText.includes("![[zzpic.png]]"), JSON.stringify(docText.slice(-40)));

// ── the inserted attachment link RESOLVES (data integrity) ──────────────────
ok("the inserted `[[zzpic.png]]` resolves to the attachment", (await app(() => window.__app.metadata.resolveAttachment("zzpic.png", "ZZNote.md"))) === "zzpic.png");

// ── zero regression: md note completion still works ─────────────────────────
console.log("— zero regression: md note completion —");
await page.keyboard.press("Control+End");
await page.keyboard.type("\n[[ZZNo");
await wait(300);
const noteOpts = await page.$$eval(".cm-tooltip-autocomplete li", (els) => els.map((e) => e.textContent)).catch(() => []);
ok("plain `[[ZZNo` still completes the md note basename (ZZNote)", noteOpts.some((o) => o && o.includes("ZZNote")), JSON.stringify(noteOpts));

console.log(`\nR108 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
