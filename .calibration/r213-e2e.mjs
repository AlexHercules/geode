/**
 * R213 — G3 §8 收尾: FootnotesPanel + FilePropertiesPanel 跟随 lastActiveFile.
 * Aligns the last 2 right-sidebar aux panels with the lastActiveFile fallback that
 * R211/R212 gave backlinks/outgoing/outline — so they stay populated when a non-markdown
 * main-area tab (e.g. graph) is active. FootnotesPanel is read-only; FilePropertiesPanel
 * is an EDITABLE second writer, so the data-safety assertion (C) is the crux: editing a
 * property while a graph tab is active must write to lastActiveFile byte-correctly.
 * Browser :1420.  Run: node .calibration/r213-e2e.mjs
 * Contract: ARCHITECTURE "Round 213 additions".
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
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r213", name: "r213", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const activeViewType = () => app(() => window.__app.workspace.getActiveTab()?.viewType ?? null);
const docText = (p) => app(([path]) => window.__app.documents.get(path)?.getText() ?? "(not open)", [p]);

const DOC_BODY = "Body with a footnote.[^1]\n\n[^1]: note one\n";
await app(async (body) => {
  try { await window.__app.vault.create("Doc.md", "---\ncount: 1\n---\n" + body); } catch { /* exists */ }
  try { await window.__app.vault.create("Doc2.md", "---\ncount: 99\n---\nplain\n"); } catch { /* exists */ }
  // for E: an unlinked mention of "Target" (plain text in another note)
  try { await window.__app.vault.create("Target.md", "# Target\n"); } catch { /* exists */ }
  try { await window.__app.vault.create("Mentioner.md", "I reference Target in prose here.\n"); } catch { /* exists */ }
}, DOC_BODY);
await wait(250);
await app(() => window.__app.workspace.openFile("Doc.md")); // lastActiveFile = Doc
await wait(200);
await app(() => window.__app.workspace.openGraph());          // active main tab = non-markdown
await wait(200);
ok("setup: active main tab is graph (non-markdown)", (await activeViewType()) === "graph");

console.log("A. FootnotesPanel (read-only) follows lastActiveFile on a non-markdown tab");
await page.click('[data-testid="right-tab-footnotes"]');
await page.waitForSelector('[data-testid="footnotes-panel"]', { timeout: 4000 }).catch(() => {});
ok("footnotes panel shown", (await page.$('[data-testid="footnotes-panel"]')) !== null);
ok("follows lastActiveFile → shows Doc's footnote (not fn-empty)",
  await app(() => { const el = document.querySelector('[data-testid="footnotes-panel"]'); return !!el && !!el.querySelector('[data-testid="fn-item"]') && el.innerText.includes("note one"); }));

console.log("B. FilePropertiesPanel (writer) follows lastActiveFile on a non-markdown tab");
await page.click('[data-testid="right-tab-fileproperties"]');
await page.waitForSelector('[data-testid="fileproperties-panel"]', { timeout: 4000 }).catch(() => {});
ok("file-properties panel shown", (await page.$('[data-testid="fileproperties-panel"]')) !== null);
ok("follows lastActiveFile → shows Doc's properties (not fp-empty)",
  await app(() => !!document.querySelector('[data-testid="fileproperties-panel"] [data-testid="property-row-count"]')
    && !document.querySelector('[data-testid="fileproperties-panel"] [data-testid="fp-empty"]')));

console.log("C. data-safety: editing a property on the graph tab writes to lastActiveFile byte-correctly");
await page.fill('[data-testid="fileproperties-panel"] [data-testid="property-value-count"]', "42");
await page.press('[data-testid="fileproperties-panel"] [data-testid="property-value-count"]', "Enter");
await wait(300);
const after = await docText("Doc.md");
ok("Doc.md frontmatter updated to count: 42", /(^|\n)count: 42(\n|$)/.test(after), JSON.stringify(after));
ok("footnote + body bytes preserved verbatim", after.endsWith("---\n" + DOC_BODY), JSON.stringify(after));
ok("no stray old value left", !/count: 1\b/.test(after));
ok("editing did NOT switch the active main tab (still graph)", (await activeViewType()) === "graph");

console.log("D. precedence: a real markdown active tab takes priority over lastActiveFile");
await app(() => window.__app.workspace.openFile("Doc2.md"));
await wait(250);
ok("active markdown tab → panel re-targets to Doc2 (count 99, not Doc)",
  (await page.inputValue('[data-testid="fileproperties-panel"] [data-testid="property-value-count"]')) === "99");

console.log("E. review-caught: backlinks unlinked-mentions scan COMPLETES on a non-markdown tab");
// R211 left BacklinksPanel's async unlinked-mentions stale-guard on `: null` while its render
// followed lastActive → on a graph tab the scan started but the guard bailed before
// setScanning(false) → permanent 'Searching…'. R213 mirrors the fallback in the guard.
await app(() => window.__app.workspace.openFile("Target.md"));
await wait(200);
await app(() => window.__app.workspace.openGraph());
await wait(150);
await page.click('[data-testid="right-tab-backlinks"]');
await page.waitForSelector('[data-testid="backlinks-panel"]', { timeout: 4000 }).catch(() => {});
await page.click('[data-testid="bl-section-unlinked"]'); // expand the unlinked section
await wait(600); // let the async scan finish
const unlinked = await app(() => {
  const btn = document.querySelector('[data-testid="bl-section-unlinked"]');
  const body = btn?.parentElement?.querySelector(".bl-section-body");
  return { bodyText: body ? body.innerText : "", hasSource: !!(body && body.querySelector('[data-testid="bl-source"]')) };
});
ok("active main tab is still graph (following lastActiveFile=Target)", (await activeViewType()) === "graph");
ok("unlinked scan completed — shows the mention, NOT stuck on 'Searching…'",
  unlinked.hasSource && !unlinked.bodyText.includes("Searching"), JSON.stringify(unlinked));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR213: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
