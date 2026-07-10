/**
 * R270 — 表面复刻：设置页 settings-card 圆角卡 → 扁平行（Obsidian 设置是扁平整宽行 + 细分隔线·无卡）。
 * 偏差：Appearance(4) / Core plugins(1) / Hotkeys(1) 把行装进 `.settings-card`（`--bg-input` 背景 +
 * 12px 圆角 + 20px 内缩）·而 Obsidian 与 Geode 自己的 Editor/Files 页是裸 `.setting-item` 行 → 内部不一致。
 * 修（纯 CSS·机械档）：`.settings-card` 去背景/圆角/内缩（透明 passthrough）·`.core-plugin-list`/
 * `.hotkeys-search-card` 横向内缩归 0·`.settings-subheader` 横向 margin 20→0（行与 subheader 同 0 inset·
 * 顺带修 Editor/Files 页 subheader-vs-row 既有错位）。
 *
 * 验收 = computed-style（R245 锁视觉先例）：卡背景透明 + 0 圆角 + 0 内缩 + 行仍有分隔线 + subheader 与行左对齐。
 * 含反真空断言：`--bg-input` 解析为非透明色（证「卡背景透明」非因满屏透明而 vacuous）。
 * Run: node .calibration/r270-e2e.mjs   (dev server :1420 up)
 * Contract: docs/ARCHITECTURE.md "Round 270 additions".
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
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".ribbon-btn", { timeout: 15000 });

// open settings + a nav helper
await page.evaluate(() => {
  const btn = document.querySelector('[aria-label*="设置"], [title*="设置"], [aria-label*="Settings" i]');
  btn?.click();
});
await page.waitForSelector(".settings-nav-item", { timeout: 8000 });
const goNav = async (re) => {
  await page.evaluate((src) => {
    const r = new RegExp(src);
    const item = [...document.querySelectorAll(".settings-nav-item")].find((n) => r.test(n.textContent || ""));
    item?.click();
  }, re);
  await page.waitForTimeout(250);
};

const TRANSPARENT = "rgba(0, 0, 0, 0)";

// ---------- anti-vacuous: --bg-input is a real (non-transparent) color ----------
console.log("— anti-vacuous: the old card bg var is non-transparent —");
{
  const bgInput = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "var(--bg-input)";
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return c;
  });
  ok("--bg-input resolves to a non-transparent color (so 'card bg transparent' is meaningful)",
    bgInput !== TRANSPARENT && bgInput !== "", bgInput);
}

// ---------- Part A: Appearance — 4 pure cards flat + rows keep dividers + subheader aligned ----------
console.log("— Part A: Appearance page — cards flat, rows keep dividers, subheader aligned —");
await goNav("外观|Appearance");
{
  const res = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".settings-card")].map((c) => {
      const cs = getComputedStyle(c);
      return { bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, padL: cs.paddingLeft };
    });
    const firstRow = document.querySelector(".settings-content .setting-item");
    const rowBorder = firstRow ? getComputedStyle(firstRow).borderBottomWidth : null;
    const sub = document.querySelector(".settings-subheader");
    const rowName = document.querySelector(".settings-content .setting-item .setting-name");
    return {
      cardCount: cards.length,
      cards,
      rowBorder,
      subLeft: sub ? Math.round(sub.getBoundingClientRect().left) : null,
      rowNameLeft: rowName ? Math.round(rowName.getBoundingClientRect().left) : null,
    };
  });
  ok("Appearance has the 4 pure settings-card wrappers", res.cardCount === 4, `got ${res.cardCount}`);
  ok("every card background is transparent (no --bg-input box)", res.cards.every((c) => c.bg === "rgba(0, 0, 0, 0)"), JSON.stringify(res.cards.map((c) => c.bg)));
  ok("every card border-radius is 0 (no rounded box)", res.cards.every((c) => c.radius === "0px"), JSON.stringify(res.cards.map((c) => c.radius)));
  ok("every card padding-left is 0 (rows flush, not inset)", res.cards.every((c) => c.padL === "0px"), JSON.stringify(res.cards.map((c) => c.padL)));
  ok("setting rows STILL have a bottom divider (flat ≠ borderless)", res.rowBorder === "1px");
  ok("subheader left-aligns with row name (same inset)", res.subLeft !== null && Math.abs(res.subLeft - res.rowNameLeft) < 2, `sub ${res.subLeft} vs row ${res.rowNameLeft}`);
}

// ---------- Part B: Core plugins — .core-plugin-list flat ----------
console.log("— Part B: Core plugins — list flat —");
await goNav("核心插件|Core plugins");
{
  const cs = await page.evaluate(() => {
    const el = document.querySelector(".core-plugin-list");
    if (!el) return null;
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, radius: s.borderTopLeftRadius, padL: s.paddingLeft };
  });
  ok(".core-plugin-list found", cs !== null);
  ok(".core-plugin-list flat (transparent bg, 0 radius, 0 inset)", cs && cs.bg === "rgba(0, 0, 0, 0)" && cs.radius === "0px" && cs.padL === "0px", JSON.stringify(cs));
}

// ---------- Part C: Hotkeys — .hotkeys-search-card flat ----------
console.log("— Part C: Hotkeys — search header flat —");
await goNav("快捷键|Hotkeys");
{
  const res = await page.evaluate(() => {
    const flat = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, radius: s.borderTopLeftRadius, padL: s.paddingLeft };
    };
    // header title vs the first command row name — they must share a left edge (the R270 review bug:
    // header flattened to 0 inset but .hotkey-list left at 20px → 20px misalignment)
    const headerTitle = document.querySelector(".hotkeys-search-meta .setting-name");
    const rowName = document.querySelector(".hotkey-row .hotkey-info .setting-name, .hotkey-row .setting-name, .hotkey-row .hotkey-name");
    return {
      searchCard: flat(".hotkeys-search-card"),
      hotkeyList: flat(".hotkey-list"),
      headerLeft: headerTitle ? Math.round(headerTitle.getBoundingClientRect().left) : null,
      rowLeft: rowName ? Math.round(rowName.getBoundingClientRect().left) : null,
    };
  });
  ok(".hotkeys-search-card found + flat (transparent bg, 0 radius, 0 inset)", res.searchCard && res.searchCard.bg === "rgba(0, 0, 0, 0)" && res.searchCard.radius === "0px" && res.searchCard.padL === "0px", JSON.stringify(res.searchCard));
  ok(".hotkey-list (paired command list) ALSO flat (no --bg-modal box, 0 inset)", res.hotkeyList && res.hotkeyList.bg === "rgba(0, 0, 0, 0)" && res.hotkeyList.radius === "0px" && res.hotkeyList.padL === "0px", JSON.stringify(res.hotkeyList));
  ok("search header title left-aligns with command-row name (no 20px split)", res.headerLeft !== null && res.rowLeft !== null && Math.abs(res.headerLeft - res.rowLeft) < 2, `header ${res.headerLeft} vs row ${res.rowLeft}`);
}

// ---------- Part D: Editor (already flat) — subheader now aligns with rows ----------
console.log("— Part D: Editor page — subheader aligns with rows (pre-existing misalignment fixed) —");
await goNav("编辑器|Editor");
{
  const res = await page.evaluate(() => {
    const sub = document.querySelector(".settings-subheader");
    const rowName = document.querySelector(".settings-content .setting-item .setting-name");
    return {
      subLeft: sub ? Math.round(sub.getBoundingClientRect().left) : null,
      rowNameLeft: rowName ? Math.round(rowName.getBoundingClientRect().left) : null,
    };
  });
  ok("Editor subheader left-aligns with row name", res.subLeft !== null && Math.abs(res.subLeft - res.rowNameLeft) < 2, `sub ${res.subLeft} vs row ${res.rowNameLeft}`);
}

ok("no page errors throughout", pageErrors.length === 0, pageErrors.join(" | "));

await browser.close();
console.log(`\nR270 e2e: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); process.exit(1); }
