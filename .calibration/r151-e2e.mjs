/**
 * R151 tags-pane sort menu E2E — browser mode :1420.
 * Run: node .calibration/r151-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 151 additions".
 *
 * Obsidian's tag pane has a "Change sort order" menu (Frequency / Tag name, each asc/desc). R151
 * parameterizes buildTagTree's per-level cmp by the chosen key + a persisted <select>. Default
 * freq-desc = R150 behavior. Sort applies at every tree level (top-level + subtree siblings).
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
await page.evaluate(() => { try { localStorage.removeItem("geode.tagsSort"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r151", name: "r151", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (p, tags) => app(([path, tg]) => window.__app.vault.create(path, `---\ntags: [${tg}]\n---\n# x\n`), [p, tags.join(", ")]);

// counts: rs_a=1, rs_b=3, rs_c=2 (top-level, distinct); subtree rs_p/xlo=2, rs_p/ahi=1 (name vs freq differ)
await mk("rs1.md", ["rs_b", "rs_c", "rs_p/xlo", "rs_p/ahi"]);
await mk("rs2.md", ["rs_b", "rs_c", "rs_p/xlo"]);
await mk("rs3.md", ["rs_b", "rs_a"]);
await page.waitForFunction(() => window.__app.metadata.getTagMap().has("rs_p/xlo"), null, { timeout: 4000 });

await app(() => window.__app.workspace.setRightPanel("tags"));
await page.waitForSelector("[data-testid=tags-panel]", { timeout: 4000 });
await wait(100);

// document order of my top-level rs_ tags (testids), excluding the rs_p subtree children
const topOrder = () => app(() =>
  [...document.querySelectorAll("[data-testid^='tag-row-rs_']")]
    .map((e) => e.getAttribute("data-testid"))
    .filter((id) => ["tag-row-rs_a", "tag-row-rs_b", "tag-row-rs_c", "tag-row-rs_p"].includes(id)));
const before = (order, a, b) => order.indexOf(a) >= 0 && order.indexOf(b) >= 0 && order.indexOf(a) < order.indexOf(b);
const subOrder = () => app(() =>
  [...document.querySelectorAll("[data-testid^='tag-row-rs_p/']")].map((e) => e.getAttribute("data-testid")));
const setSort = async (v) => { await page.selectOption("[data-testid=tags-sort]", v); await wait(80); };

console.log("— default sort is freq-desc (= R150 behavior) —");
ok("the sort <select> exists and defaults to freq-desc", (await app(() => document.querySelector("[data-testid=tags-sort]")?.value)) === "freq-desc");
let o = await topOrder();
ok("freq-desc: rs_b(3) → rs_c(2) → rs_a(1)", before(o, "tag-row-rs_b", "tag-row-rs_c") && before(o, "tag-row-rs_c", "tag-row-rs_a"), JSON.stringify(o));

console.log("— Tag name (A→Z) —");
await setSort("name-asc");
o = await topOrder();
ok("name-asc: rs_a → rs_b → rs_c → rs_p (alphabetical)", before(o, "tag-row-rs_a", "tag-row-rs_b") && before(o, "tag-row-rs_b", "tag-row-rs_c") && before(o, "tag-row-rs_c", "tag-row-rs_p"), JSON.stringify(o));

console.log("— Tag name (Z→A) —");
await setSort("name-desc");
o = await topOrder();
ok("name-desc: rs_p → rs_c → rs_b → rs_a (reverse alphabetical)", before(o, "tag-row-rs_p", "tag-row-rs_c") && before(o, "tag-row-rs_c", "tag-row-rs_b") && before(o, "tag-row-rs_b", "tag-row-rs_a"), JSON.stringify(o));

console.log("— Frequency (low→high) —");
await setSort("freq-asc");
o = await topOrder();
ok("freq-asc: rs_a(1) → rs_c(2) → rs_b(3)", before(o, "tag-row-rs_a", "tag-row-rs_c") && before(o, "tag-row-rs_c", "tag-row-rs_b"), JSON.stringify(o));

console.log("— sort applies WITHIN a subtree too (rs_p children) —");
await setSort("freq-desc");
let s = await subOrder();
ok("subtree freq-desc: rs_p/xlo(2) before rs_p/ahi(1)", before(s, "tag-row-rs_p/xlo", "tag-row-rs_p/ahi"), JSON.stringify(s));
await setSort("name-asc");
s = await subOrder();
ok("subtree name-asc: rs_p/ahi before rs_p/xlo (alpha flips the freq order)", before(s, "tag-row-rs_p/ahi", "tag-row-rs_p/xlo"), JSON.stringify(s));

console.log("— a collapse survives a sort change (R150 collapse state is independent of R151 sort) —");
await setSort("freq-desc");
await page.click("[data-testid='tag-chevron-rs_p']"); // collapse rs_p
await wait(60);
ok("after collapsing rs_p, its child rs_p/xlo is hidden", !(await page.isVisible("[data-testid='tag-row-rs_p/xlo']")));
await setSort("name-desc"); // change sort while collapsed
await wait(80);
ok("the child stays hidden across the sort change (collapse preserved by fullPath)", !(await page.isVisible("[data-testid='tag-row-rs_p/xlo']")));
ok("the collapsed parent rs_p is still visible after the sort change", await page.isVisible("[data-testid='tag-row-rs_p']"));
await page.click("[data-testid='tag-chevron-rs_p']"); // re-expand for the rest

console.log("— the sort pref persists across a reload —");
ok("pref written to localStorage (last sort = name-desc)", (await app(() => localStorage.getItem("geode.tagsSort"))) === "name-desc");
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r151b", name: "r151b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await app(() => window.__app.workspace.setRightPanel("tags"));
await page.waitForSelector("[data-testid=tags-sort]", { timeout: 4000 });
ok("after reload the sort <select> restores name-desc", (await app(() => document.querySelector("[data-testid=tags-sort]")?.value)) === "name-desc");

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR151 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
