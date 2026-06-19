/**
 * R106 frontmatter aliases in suggesters E2E — browser mode :1420.
 * Run: node .calibration/r106-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 106 additions" (㉟ 续).
 *
 * Aliases already RESOLVE as link targets (rebuildNameMap → nameToPaths); R106 surfaces
 * them in the two SUGGESTERS: `[[` autocomplete (insert `[[canonical|alias]]`) + QuickSwitcher
 * (open a note by its alias). Source = metadata.getAliasMap (cached). Read-only, no .md write.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r106", name: "r106", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeAliasMap, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// a note whose frontmatter declares two aliases
await app(async () => {
  try { await window.__app.vault.create("ZZAliased.md", "---\naliases:\n  - GreenTea\n  - Matcha\n---\n# ZZAliased\n\nbody\n"); } catch { /* exists */ }
  try { await window.__app.vault.create("ZZPlain.md", "# ZZPlain\n\nno aliases\n"); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 200));
});

// ── getAliasMap (probe): aliases parsed + enumerated ────────────────────────
console.log("— getAliasMap (probe) —");
const amap = await app(() => window.__geodeAliasMap());
ok("ZZAliased.md → its two frontmatter aliases", JSON.stringify(amap["ZZAliased.md"]) === JSON.stringify(["GreenTea", "Matcha"]), JSON.stringify(amap["ZZAliased.md"]));
ok("a note without aliases is absent from the map", !("ZZPlain.md" in amap));

// ── QuickSwitcher: open a note by its alias ─────────────────────────────────
console.log("— QuickSwitcher alias match —");
await app(() => window.__app.workspace.openModal("switcher"));
await wait(150);
await page.fill("[data-testid=switcher-input]", "Matcha");
await wait(300);
const aliasRow = await app(() => {
  const items = [...document.querySelectorAll('[data-testid="switcher-item"]')];
  const hit = items.find((el) => el.textContent.includes("Matcha"));
  return hit ? hit.textContent : null;
});
ok("typing an alias surfaces the note in the switcher", aliasRow !== null, JSON.stringify(aliasRow));
ok("the alias row shows the canonical note (↪ ZZAliased hint)", typeof aliasRow === "string" && aliasRow.includes("ZZAliased"), JSON.stringify(aliasRow));
await page.locator("[data-testid=switcher-input]").press("Enter");
await wait(300);
ok("pressing Enter on an alias match opens the real note (ZZAliased.md)", (await app(() => window.__app.workspace.getActiveFile())) === "ZZAliased.md", await app(() => window.__app.workspace.getActiveFile()));

// non-alias query still works (zero regression)
await app(() => window.__app.workspace.openModal("switcher"));
await wait(120);
await page.fill("[data-testid=switcher-input]", "ZZPlain");
await wait(250);
ok("a plain basename query still matches (zero regression)", await app(() => [...document.querySelectorAll('[data-testid="switcher-item"]')].some((el) => el.textContent.includes("ZZPlain"))));
await page.keyboard.press("Escape");
await wait(120);

// ── [[ autocomplete: alias suggestion + inserts [[canonical|alias]] ─────────
console.log("— [[ autocomplete alias —");
await app(async () => {
  const tab = window.__app.workspace.getActiveTab();
  if (tab) window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 250));
});
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await page.keyboard.press("Control+End");
await page.keyboard.type("\n[[GreenT");
await wait(350);
ok("typing `[[GreenT` opens the autocomplete tooltip", await page.isVisible(".cm-tooltip-autocomplete"));
const opts = await page.$$eval(".cm-tooltip-autocomplete li", (els) => els.map((e) => e.textContent)).catch(() => []);
ok("the alias 'GreenTea' is offered as a completion", opts.some((o) => o && o.includes("GreenTea")), JSON.stringify(opts));
ok("the alias option hints its canonical note (↪ ZZAliased)", opts.some((o) => o && o.includes("GreenTea") && o.includes("ZZAliased")), JSON.stringify(opts));
await page.keyboard.press("Enter");
await wait(250);
const docText = await app(() => window.__app.documents.get(window.__app.workspace.getActiveFile())?.getText() ?? "");
ok("picking the alias inserts `[[ZZAliased|GreenTea]]` (canonical link, alias display)", docText.includes("[[ZZAliased|GreenTea]]"), JSON.stringify(docText.slice(-60)));

// ── review fix: an alias with [ or ] is NOT offered in [[ (would break the link) ──
console.log("— review fix: bracket-in-alias skipped in [[ —");
await app(async () => {
  try { await window.__app.vault.create("ZZBrk.md", '---\naliases:\n  - "Bad]Alias"\n---\n# ZZBrk\n'); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 200));
});
// confirm it parsed (still in the alias map) but won't be an inserter option
ok("the bracket alias is still parsed (resolves + switcher)", await app(() => (window.__geodeAliasMap()["ZZBrk.md"] ?? []).includes("Bad]Alias")));
await page.keyboard.press("Control+End");
await page.keyboard.type("\n[[Bad]");
await wait(300);
const brkOpts = await page.$$eval(".cm-tooltip-autocomplete li", (els) => els.map((e) => e.textContent)).catch(() => []);
ok("the `]`-containing alias is NOT offered in [[ completion (would break the link)", !brkOpts.some((o) => o && o.includes("Bad]Alias")), JSON.stringify(brkOpts));

console.log(`\nR106 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
