/**
 * R25 page-preview (hover) E2E — browser mode (Memory vault) against dev :1420.
 * Run: node .calibration/r25-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 25 additions — 悬停预览".
 *
 * Covers: explorer-row hover (no modifier) raises a card; leaving hides it;
 * reading-view link hover (no modifier); editor (.cm-content) requires Ctrl/Cmd
 * (no card without, card with); unresolved link raises no card; subpath link
 * scrolls the card to the heading (resolveSubpath ordinal); card-internal link
 * click navigates + closes; the __geodeHover probe renders the target; and the
 * settings toggle disables/re-enables previews.
 */
import { chromium } from "playwright";

const URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
// clean preview settings to defaults for a deterministic run
await page.evaluate(() => {
  localStorage.removeItem("geode.pagePreviewEnabled");
  localStorage.removeItem("geode.pagePreviewRequireModifier");
});
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => {
  window.geode.registerPlugin({ id: "r25probe", name: "r25probe", onload(app) { window.__app = app; } });
});
const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c) => app(async ([path, content]) => {
  await window.__app.vault.create(path, content);
  await new Promise((r) => setTimeout(r, 60));
}, [p, c]);
const openMode = (p, mode) => app(async ([path, m]) => {
  window.__app.workspace.openFile(path);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, m);
  await new Promise((r) => setTimeout(r, 120));
}, [p, mode]);
const activeFile = () => app(() => window.__app.workspace.getActiveFile());

const CARD = '[data-testid="hover-preview"]';
async function hover(selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
}
async function moveAway() {
  await page.mouse.move(3, 3, { steps: 2 });
  await page.waitForSelector(CARD, { state: "detached", timeout: 2000 }).catch(() => {});
}
const waitCard = () => page.waitForSelector(CARD, { timeout: 2500 });
async function noCard(ms = 500) {
  await page.waitForTimeout(ms);
  return (await page.$(CARD)) === null;
}
const cardText = () => page.$eval(`${CARD} .hover-preview-content`, (el) => el.textContent || "");

/* ---- fixtures ---- */
// separate paragraphs (blank line between) so the card content is genuinely
// tall enough to require scrolling — single newlines would soft-wrap into one
// short paragraph and the subpath-scroll assertion could not move scrollTop.
const filler = (tag) => Array.from({ length: 14 }, (_, i) => `${tag} filler paragraph ${i} lorem ipsum dolor sit amet consectetur.`).join("\n\n");
await create("HoverTarget.md", `# Hover Target

First paragraph of the target note body MARKER-BODY.

See also [[Other Note]] for the click-navigation test.

## Section One

${filler("s1")}

## Section Two

${filler("s2")}

## Section Three

THIRD-SECTION-MARKER body text lives down here.
`);
await create("Other Note.md", "# Other Note\n\nNavigated here from the hover card.\n");
await create("HoverSource.md", `# Hover Source

A plain link to [[HoverTarget]] in prose.

A deep link to [[HoverTarget#Section Three]] in prose.

A broken link to [[Ghost Note 9999]] in prose.
`);

console.log("— explorer row hover (no modifier) raises a card —");
await openMode("HoverSource.md", "preview");
await page.waitForSelector('[data-testid="explorer-item"][data-hover-path="HoverTarget.md"]');
await hover('[data-testid="explorer-item"][data-hover-path="HoverTarget.md"]');
await waitCard();
ok("card appears on explorer file-row hover", (await page.$(CARD)) !== null);
ok("card renders the target note body", (await cardText()).includes("MARKER-BODY"));

console.log("— leaving the anchor hides the card —");
await moveAway();
ok("card hidden after leaving", (await page.$(CARD)) === null);

console.log("— reading-view internal link hover (no modifier) —");
await hover('.preview-content a.internal-link[data-target="HoverTarget"]:not(.is-unresolved)');
await waitCard();
ok("card appears on reading-view link hover", (await cardText()).includes("MARKER-BODY"));
await moveAway();

console.log("— unresolved link raises no card —");
await hover('.preview-content a.internal-link.is-unresolved');
ok("no card for unresolved link", await noCard(500));
await moveAway();

console.log("— subpath link scrolls the card to the heading —");
await hover('.preview-content a.internal-link[data-subpath="Section Three"]');
await waitCard();
await page.waitForTimeout(150); // allow render + scroll
const scrollTop = await page.$eval(CARD, (el) => el.scrollTop);
ok("card scrolled down to Section Three (scrollTop > 0)", scrollTop > 0, `scrollTop=${scrollTop}`);
await moveAway();

console.log("— card-internal link click navigates + closes —");
await hover('.preview-content a.internal-link[data-target="HoverTarget"]:not(.is-unresolved)');
await waitCard();
await page.click(`${CARD} a.internal-link[data-target="Other Note"]`);
await page.waitForTimeout(150);
ok("clicking a card link navigates to its target", (await activeFile()) === "Other Note.md", `active=${await activeFile()}`);
ok("card closes after navigation", (await page.$(CARD)) === null);
await moveAway();

console.log("— editor (.cm-content live-preview) requires Ctrl/Cmd —");
await openMode("HoverSource.md", "live");
// live-preview collapsed wikilinks are span.cm-live-wikilink[data-link-target]
const LIVE_LINK = '.cm-content .cm-live-wikilink[data-link-target="HoverTarget"]';
await page.waitForSelector(LIVE_LINK);
await hover(LIVE_LINK);
ok("no card hovering an editor link WITHOUT modifier", await noCard(450));
await moveAway();
await page.keyboard.down("Meta");
await page.keyboard.down("Control"); // belt-and-suspenders across platforms
await hover(LIVE_LINK);
let modCard = false;
try { await waitCard(); modCard = true; } catch { /* none */ }
await page.keyboard.up("Control");
await page.keyboard.up("Meta");
ok("card appears hovering an editor link WITH modifier held", modCard);
await moveAway();

console.log("— __geodeHover probe renders the real-fs path —");
const probeHtml = await app(() => window.__geodeHover("HoverTarget", "HoverSource.md"));
ok("probe returns rendered HTML for a resolved target", typeof probeHtml === "string" && probeHtml.includes("Hover Target"));
const probeNull = await app(() => window.__geodeHover("Ghost Note 9999", "HoverSource.md"));
ok("probe returns null for an unresolved target", probeNull === null);

console.log("— settings toggle disables / re-enables previews —");
await openMode("HoverSource.md", "preview");
await app(() => window.__app.workspace.openModal("settings"));
await page.click('[data-testid="settings-nav-page-preview"]');
await new Promise((r) => setTimeout(r, 80));
await page.waitForSelector('[data-testid="settings-page-preview"]');
ok("page-preview toggle present in settings", true);
ok("require-modifier toggle present in settings", (await page.$('[data-testid="settings-page-preview-modifier"]')) !== null);
const wasOn = await page.$eval('[data-testid="settings-page-preview"]', (el) => el.getAttribute("aria-checked") === "true");
ok("page-preview defaults ON", wasOn);
await page.click('[data-testid="settings-page-preview"]'); // turn OFF
await app(() => window.__app.workspace.closeModal());
await page.waitForTimeout(100);
await hover('.preview-content a.internal-link[data-target="HoverTarget"]:not(.is-unresolved)');
ok("no card when page preview disabled", await noCard(500));
await moveAway();
// re-enable for a clean end state
await app(() => window.__app.workspace.openModal("settings"));
await page.click('[data-testid="settings-nav-page-preview"]');
await new Promise((r) => setTimeout(r, 80));
await page.waitForSelector('[data-testid="settings-page-preview"]');
await page.click('[data-testid="settings-page-preview"]'); // turn ON
await app(() => window.__app.workspace.closeModal());
await page.waitForTimeout(100);
await hover('.preview-content a.internal-link[data-target="HoverTarget"]:not(.is-unresolved)');
let reCard = false;
try { await waitCard(); reCard = true; } catch { /* none */ }
ok("card returns after re-enabling page preview", reCard);
await moveAway();

console.log(`\nR25 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
