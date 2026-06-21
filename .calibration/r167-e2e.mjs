/**
 * R167 — Tier 7: AbstractInputSuggest<T> type-ahead completion — browser :1420.
 * Run: node .calibration/r167-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 167 additions" (Tier 7, AbstractInputSuggest).
 *
 * The fixture plugin (?obsfixture=1) binds a FixtureInputSuggest to a live <input>
 * (data-testid fixture-input-suggest) over candidates [apple, apricot, banana], and
 * mirrors the selection into a sibling div (fixture-input-suggest-selected). The popup
 * is data-testid input-suggest-popup; each row is input-suggest-item (.suggestion-item),
 * the active row carries .is-selected. This suite drives focus/type/keyboard/click/escape/
 * outside-click and asserts setValue write-back + onSelect callback.
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

await page.goto(BASE_URL + "?obsfixture=1");
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await new Promise((r) => setTimeout(r, 300)); // let the fixture plugin onload finish

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const INPUT = "[data-testid=fixture-input-suggest]";
const SELECTED = "[data-testid=fixture-input-suggest-selected]";
const POPUP = "[data-testid=input-suggest-popup]";
const ITEM = "[data-testid=input-suggest-item]";
const popupCount = () => page.locator(POPUP).count();
const itemTexts = () => page.locator(`${POPUP} ${ITEM}`).allTextContents();

console.log("— initial state: input present, no popup —");
ok("fixture input present", await page.$(INPUT).then((h) => !!h));
ok("selected div present", await page.$(SELECTED).then((h) => !!h));
ok("popup not shown initially", (await popupCount()) === 0);

console.log("— focus shows the popup with all candidates (empty query) —");
await page.focus(INPUT);
await wait(80);
ok("popup shown after focus", (await popupCount()) === 1);
let texts = await itemTexts();
ok("3 items on empty query", texts.length === 3, JSON.stringify(texts));
ok("items are apple/apricot/banana",
  texts.includes("apple") && texts.includes("apricot") && texts.includes("banana"),
  JSON.stringify(texts));

console.log("— typing 'ap' filters to 2 (apple, apricot) —");
await page.type(INPUT, "ap");
await wait(80);
texts = await itemTexts();
ok("2 items after typing 'ap'", texts.length === 2, JSON.stringify(texts));
ok("filtered set is apple+apricot (no banana)",
  texts.includes("apple") && texts.includes("apricot") && !texts.includes("banana"),
  JSON.stringify(texts));

console.log("— keyboard nav + Enter select writes back via setValue + onSelect —");
const selIndex = () => page.evaluate((sel) => {
  const items = Array.from(document.querySelectorAll(`${sel}`));
  return items.findIndex((el) => el.classList.contains("is-selected"));
}, `${POPUP} ${ITEM}`);
ok("first item is .is-selected by default", (await selIndex()) === 0, `idx=${await selIndex()}`);
await page.keyboard.press("ArrowDown");
await wait(50);
ok("ArrowDown moves selection to second item", (await selIndex()) === 1, `idx=${await selIndex()}`);
await page.keyboard.press("Enter");
await wait(80);
ok("popup closed after Enter", (await popupCount()) === 0);
ok("input value written back to 'apricot' (setValue)", (await page.inputValue(INPUT)) === "apricot",
  await page.inputValue(INPUT));
ok("selected div reflects onSelect callback",
  (await page.locator(SELECTED).textContent()) === "selected: apricot",
  await page.locator(SELECTED).textContent());

console.log("— click-to-select path —");
await page.fill(INPUT, "");
await page.focus(INPUT);
await page.type(INPUT, "ba");
await wait(80);
texts = await itemTexts();
ok("1 item after typing 'ba' (banana)", texts.length === 1 && texts[0] === "banana", JSON.stringify(texts));
await page.locator(`${POPUP} ${ITEM}`).first().click();
await wait(80);
ok("popup closed after click", (await popupCount()) === 0);
ok("input value written back to 'banana' (click select)", (await page.inputValue(INPUT)) === "banana",
  await page.inputValue(INPUT));
ok("selected div updated to 'selected: banana'",
  (await page.locator(SELECTED).textContent()) === "selected: banana",
  await page.locator(SELECTED).textContent());

console.log("— Escape closes the popup without changing the value —");
await page.fill(INPUT, "");
await page.focus(INPUT);
await wait(80);
ok("popup shown again after re-focus", (await popupCount()) === 1);
await page.keyboard.press("Escape");
await wait(80);
ok("popup closed after Escape", (await popupCount()) === 0);
ok("input value unchanged by Escape (stays empty)", (await page.inputValue(INPUT)) === "");

console.log("— outside click closes the popup —");
// Escape keeps the input focused (matches Obsidian — close popup, keep focus),
// so a bare re-focus would NOT re-dispatch the focus event. Blur first so the
// focus genuinely fires and re-opens the popup.
await page.evaluate((sel) => document.querySelector(sel)?.blur(), INPUT);
await wait(30);
await page.focus(INPUT);
await wait(80);
ok("popup shown before outside click", (await popupCount()) === 1);
await page.mouse.click(5, 5); // click empty top-left of body, away from input/popup
await wait(80);
ok("popup closed after outside click", (await popupCount()) === 0);

console.log("— regression: fixture plugin still enabled (new input suggest didn't break it) —");
const fixtureReport = await ev(() =>
  window.geode.app.obsidianLoadReport.get().find((r) => r.id === "geode-compat-fixture") ?? null);
ok("fixture plugin present in load report", fixtureReport !== null, JSON.stringify(fixtureReport));
ok("fixture plugin status 'enabled'", fixtureReport?.status === "enabled",
  `status=${fixtureReport?.status} detail=${fixtureReport?.detail ?? ""}`);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR167: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
