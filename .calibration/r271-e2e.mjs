/**
 * R271 — 表面复刻：控件原生化（segmented → Obsidian 的真实控件型）。Geode 自造的 3-way segmented
 * 与 Obsidian 形态不符——逐项 verify-first（reference 截图）后只转**已证实**的两个：
 *  · Tab 缩进宽度：segmented [2,4,8] → 1–8 SLIDER（reference 01-编辑器-02 = 制表符宽度滑块；
 *    setTabIndentSize 本就 clampTabSize 到 1–8）。
 *  · 新笔记默认位置：segmented(root/current/folder) → DROPDOWN（reference 02-文件与链接-01 = 下拉）。
 *  · defaultNewTabMode 仍 segmented（Obsidian 实为 2 个下拉 view-mode×edit-mode → 拆分=逻辑档·R272 backlog）。
 * 纯控件 form swap·Store/setter/editor 接线零改（机械档）。
 *
 * 功能流由 r92(slider)/r89(dropdown) 覆盖；本套件锁 FORM 保真（控件型对·旧 segmented testid 已消）。
 * Run: node .calibration/r271-e2e.mjs   (dev server :1420 up)
 * Contract: docs/ARCHITECTURE.md "Round 271 additions".
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
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('[aria-label*="设置"], [title*="设置"], [aria-label*="Settings" i]')?.click());
await page.waitForSelector(".settings-nav-item", { timeout: 8000 });
const goNav = async (re) => {
  await page.evaluate((src) => {
    const r = new RegExp(src);
    [...document.querySelectorAll(".settings-nav-item")].find((n) => r.test(n.textContent || ""))?.click();
  }, re);
  await page.waitForTimeout(250);
};

// ---------- Editor page: Tab indent size is a 1–8 slider, not segmented ----------
console.log("— Editor page: Tab indent size → 1–8 slider (was segmented [2,4,8]) —");
await goNav("编辑器|Editor");
{
  const res = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="settings-tab-indent-size"]');
    return {
      isRange: el?.tagName === "INPUT" && el?.type === "range",
      min: el?.min, max: el?.max,
      oldSegmented: !!document.querySelector('[data-testid="settings-tabsize-2"]') || !!document.querySelector('[data-testid="settings-tabsize-4"]'),
      // defaultNewTabMode segmented is intentionally still present (R272 backlog: needs 2-dropdown split)
      newtabSegmentedStillThere: !!document.querySelector('[data-testid="settings-newtab-reading"]'),
    };
  });
  ok("tab-indent control is an <input type=range>", res.isRange === true);
  ok("slider range is 1–8 (Obsidian-faithful)", res.min === "1" && res.max === "8", `${res.min}–${res.max}`);
  ok("old settings-tabsize-* segmented buttons are GONE", res.oldSegmented === false);
  ok("defaultNewTabMode segmented intentionally remains (R272 backlog: 2-dropdown split)", res.newtabSegmentedStillThere === true);
}

// ---------- Files & links page: new-note location is a dropdown, not segmented ----------
console.log("— Files&links page: new-note location → dropdown (was segmented) —");
await goNav("文件与链接|Files");
{
  const res = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="settings-newnote-location"]');
    return {
      isSelect: el?.tagName === "SELECT",
      cls: el?.className,
      optionVals: el ? [...el.querySelectorAll("option")].map((o) => o.value) : [],
      oldSegmented: !!document.querySelector('[data-testid="settings-newnote-root"]') || !!document.querySelector('[data-testid="settings-newnote-folder"]'),
    };
  });
  ok("new-note location control is a <select>", res.isSelect === true);
  ok("uses the native .settings-select dropdown style", res.cls === "settings-select");
  ok("has the 3 location options (root/current/folder)", JSON.stringify(res.optionVals) === JSON.stringify(["root", "current", "folder"]), JSON.stringify(res.optionVals));
  ok("old settings-newnote-{root,current,folder} segmented buttons are GONE", res.oldSegmented === false);

  // dropdown actually drives the setting (selecting folder reveals the folder-path input)
  await page.selectOption('[data-testid="settings-newnote-location"]', "folder");
  await page.waitForTimeout(120);
  const folderShown = await page.evaluate(() => !!document.querySelector('[data-testid="settings-newnote-folder-path"]'));
  ok("selecting 'folder' reveals the folder-path input (dropdown drives state)", folderShown === true);
}

ok("no page errors throughout", pageErrors.length === 0, pageErrors.join(" | "));

await browser.close();
console.log(`\nR271 e2e: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); process.exit(1); }
