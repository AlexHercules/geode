/**
 * R71 markdown internal-link render + click navigation E2E — browser mode
 * (Memory vault) against dev :1420. Run: node .calibration/r71-e2e.mjs
 * Contract: docs/ARCHITECTURE.md "Round 71 additions" (㉞-b).
 *
 * Covers: a standard markdown link [text](note.md) that resolves to a NOTE now
 * renders as an internal-link anchor (reading view via __geodeRenderMarkdown) and
 * a .cm-live-mdlink carrying data-link-target (live), and clicking it navigates
 * to the note — while external / attachment / unresolved md links stay plain.
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
await page.waitForFunction(() => !!window.geode && !!window.__geodeRenderMarkdown, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r71", name: "r71", onload(app) { window.__app = app; } }));

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 30));
}, [p, c]);
const render = (src, from = "") => app(([s, f]) => window.__geodeRenderMarkdown(s, f), [src, from]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await create("Target.md", "# Heading\n\nTarget body.\n");
await create("pics/diagram.png", "x");
await create("ml/Ref.md", "go [go](../Target.md) and [pic](../pics/diagram.png) and [ext](https://e.com) and [ghost](ghost999.md)\n");
await wait(400);

// ── 1. reading-view render (via __geodeRenderMarkdown) ──────────────────────
console.log("— reading-view render —");
const internal = await render("[go](Target.md)");
ok("md link to a note → internal-link anchor", /class="internal-link"/.test(internal) && /data-target="Target\.md"/.test(internal), internal);
const sub = await render("[go](Target.md#Heading)");
ok("md link #anchor → data-subpath", /data-target="Target\.md"/.test(sub) && /data-subpath="Heading"/.test(sub), sub);
const ext = await render("[x](https://e.com)");
ok("external md link → external-link, NOT internal", /external-link/.test(ext) && !/internal-link/.test(ext), ext);
const att = await render("[x](pics/diagram.png)");
ok("attachment md link → NOT internal-link (plain)", !/internal-link/.test(att), att);
const ghost = await render("[x](ghost999.md)");
ok("unresolved md link → NOT internal-link (plain)", !/internal-link/.test(ghost), ghost);
const wiki = await render("see [[Target]] here");
ok("wikilink still internal-link (regression)", /class="internal-link"/.test(wiki) && /data-target="Target"/.test(wiki), wiki);
const rel = await render("[go](../Target.md)", "ml/Ref.md");
ok("relative ../ md link resolves → internal-link data-target=Target.md", /data-target="Target\.md"/.test(rel), rel);

// ── 2. reading-view click navigation ────────────────────────────────────────
console.log("— reading-view click nav —");
await app(async () => {
  window.__app.workspace.openFile("ml/Ref.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "preview");
  await new Promise((r) => setTimeout(r, 350));
});
const previewAnchor = await page.$('.cm-editor ~ * a.internal-link[data-target="Target.md"], a.internal-link[data-target="Target.md"]');
ok("preview renders the md link as a clickable internal-link", previewAnchor !== null);
if (previewAnchor) {
  await previewAnchor.click();
  await wait(300);
  const active = await app(() => window.__app.workspace.getActiveTab()?.filePath);
  ok("clicking the internal md link opens Target.md", active === "Target.md", String(active));
}

// ── 3. live-mode click navigation ───────────────────────────────────────────
console.log("— live-mode click nav —");
await app(async () => {
  window.__app.workspace.openFile("ml/Ref.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 350));
});
const liveLink = await page.$('.cm-live-mdlink[data-link-target="Target.md"]');
ok("live mode marks the internal md link with data-link-target", liveLink !== null);
if (liveLink) {
  await liveLink.click();
  await wait(300);
  const active = await app(() => window.__app.workspace.getActiveTab()?.filePath);
  ok("plain left-click in live mode opens Target.md", active === "Target.md", String(active));
}

// ── 4. root-absolute / relative resolve EXACTLY, not basename-fuzz (review E) ─
console.log("— positional href exact resolution —");
await create("Z.md", "# Root Z\n");
await create("sub/Z.md", "# Sub Z\n");
await create("sub/note.md", "x\n");
await wait(300);
const rootAbs = await render("[a](/Z.md)", "sub/note.md");
ok("root-absolute /Z.md from sub/ → data-target=Z.md (root, not sub/Z.md)", /data-target="Z\.md"/.test(rootAbs) && !/data-target="sub\/Z\.md"/.test(rootAbs), rootAbs);
const relUp = await render("[a](../Z.md)", "sub/note.md");
ok("relative ../Z.md from sub/ → data-target=Z.md (root exact)", /data-target="Z\.md"/.test(relUp), relUp);

// ── 5. angle-bracket href <note.md> resolves in live mode (review D) ─────────
console.log("— angle-bracket href —");
const angle = await render("[a](<Target.md>)");
ok("reading view <Target.md> → internal-link data-target=Target.md", /data-target="Target\.md"/.test(angle), angle);
await create("ml/AngleRef.md", "ang [a](<../Target.md>)\n");
await wait(200);
await app(async () => {
  window.__app.workspace.openFile("ml/AngleRef.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 350));
});
const angleLive = await page.$('.cm-live-mdlink[data-link-target="Target.md"]');
ok("live mode strips <> → marks internal md link", angleLive !== null);

// ── 6. live Ctrl/Cmd-click navigates internally (NOT window.open) (review A) ──
console.log("— live Ctrl-click internal nav —");
await app(async () => {
  window.__app.workspace.openFile("ml/Ref.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 350));
});
let opened = false;
await page.exposeFunction("__r71windowOpenSpy", () => { opened = true; }).catch(() => {});
await page.evaluate(() => { window.open = (...a) => { window.__r71windowOpenSpy?.(); return null; }; });
const ctrlLink = await page.$('.cm-live-mdlink[data-link-target="Target.md"]');
ok("live internal md link present for Ctrl-click test", ctrlLink !== null);
if (ctrlLink) {
  await ctrlLink.click({ modifiers: ["Meta"] });
  await wait(300);
  const active = await app(() => window.__app.workspace.getActiveTab()?.filePath);
  ok("Ctrl/Cmd-click navigates to Target.md (not window.open)", active === "Target.md" && !opened, `active=${active} opened=${opened}`);
}

console.log(`\nR71 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
