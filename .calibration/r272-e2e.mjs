/**
 * R272 — 表面复刻：defaultNewTabMode 3-way segmented → Obsidian 的 2 个正交下拉（reference 01-编辑器-01）：
 *  「默认视图模式」editing/reading × 「默认编辑模式」live/source。完成 R271 控件原生化弧。
 * 设计：combined `defaultNewTabMode`("live"|"source"|"preview") 仍是 workspace.openFile 消费的单一真源
 * （消费者零改）；新增持久化 `defaultEditMode`("live"|"source") 记住编辑模式，使 edit-mode 下拉在 read
 * 视图下也保留选择（combined 此时塌成 "preview" 会丢 live/source）。
 *
 * 关键忠实行为：edit-mode 偏好跨 read↔edit 持久。
 * Run: node .calibration/r272-e2e.mjs   (dev server :1420 up)
 * Contract: docs/ARCHITECTURE.md "Round 272 additions".
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
const app = (fn, arg) => page.evaluate(fn, arg);
const ls = (k) => app((key) => localStorage.getItem(key), k);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// grab the app handle (mirror r88/r107) for the consumer test
await app(() => window.geode.registerPlugin({ id: "r272", name: "r272", onload(a) { window.__app = a; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 8000 });
await page.waitForTimeout(300);
await app(() => document.querySelector('[aria-label*="设置"], [title*="设置"], [aria-label*="Settings" i]')?.click());
await page.waitForSelector(".settings-nav-item", { timeout: 8000 });
await app(() => [...document.querySelectorAll(".settings-nav-item")].find((n) => /编辑器|Editor/.test(n.textContent || ""))?.click());
await wait(250);

// ---------- forms: two dropdowns, old segmented gone ----------
console.log("— forms: view + edit-mode dropdowns replace the 3-way segmented —");
{
  const f = await app(() => {
    const v = document.querySelector('[data-testid="settings-newtab-view"]');
    const e = document.querySelector('[data-testid="settings-newtab-editmode"]');
    return {
      viewIsSelect: v?.tagName === "SELECT", viewOpts: v ? [...v.querySelectorAll("option")].map((o) => o.value) : [],
      editIsSelect: e?.tagName === "SELECT", editOpts: e ? [...e.querySelectorAll("option")].map((o) => o.value) : [],
      oldSeg: !!document.querySelector('[data-testid="settings-newtab-reading"]') || !!document.querySelector('[data-testid="settings-newtab-source"]'),
    };
  });
  ok("view dropdown is a <select> with [edit, read]", f.viewIsSelect && JSON.stringify(f.viewOpts) === JSON.stringify(["edit", "read"]), JSON.stringify(f.viewOpts));
  ok("edit-mode dropdown is a <select> with [live, source]", f.editIsSelect && JSON.stringify(f.editOpts) === JSON.stringify(["live", "source"]), JSON.stringify(f.editOpts));
  ok("old settings-newtab-{reading,live,source} segmented buttons are GONE", f.oldSeg === false);
}

// ---------- behavior: orthogonal settings, edit-mode persists across read ----------
console.log("— behavior: edit-mode preference survives switching the view to Reading —");
const setView = (v) => page.selectOption('[data-testid="settings-newtab-view"]', v).then(() => wait(80));
const setEdit = (v) => page.selectOption('[data-testid="settings-newtab-editmode"]', v).then(() => wait(80));

await setView("edit"); await setEdit("live");
ok("view=edit + editMode=live → combined = live", (await ls("geode.defaultNewTabMode")) === "live");

await setEdit("source");
ok("editMode=source (while editing) → combined = source", (await ls("geode.defaultNewTabMode")) === "source");
ok("editMode=source persisted to defaultEditMode", (await ls("geode.defaultEditMode")) === "source");

await setView("read");
ok("view=read → combined = preview", (await ls("geode.defaultNewTabMode")) === "preview");
ok("defaultEditMode STAYS source while reading (not lost)", (await ls("geode.defaultEditMode")) === "source");
ok("edit-mode dropdown still shows source while in read view", (await app(() => document.querySelector('[data-testid="settings-newtab-editmode"]')?.value)) === "source");

await setView("edit");
ok("view back to edit → combined RESTORES source (remembered edit mode)", (await ls("geode.defaultNewTabMode")) === "source");

// changing edit-mode WHILE reading updates the preference but not the (read) combined
await setView("read");
await setEdit("live");
ok("editMode=live while reading → defaultEditMode = live", (await ls("geode.defaultEditMode")) === "live");
ok("editMode change while reading does NOT leave read view (combined still preview)", (await ls("geode.defaultNewTabMode")) === "preview");

// ---------- consumer unchanged: a new tab opens in the combined mode ----------
console.log("— consumer (workspace.openFile) still uses the combined value —");
await app(() => window.__app?.workspace.closeModal());
{
  // set combined to source via the dropdowns, then open a new tab and read its mode
  await app(() => document.querySelector('[aria-label*="设置"], [title*="设置"], [aria-label*="Settings" i]')?.click());
  await wait(200);
  await app(() => [...document.querySelectorAll(".settings-nav-item")].find((n) => /编辑器|Editor/.test(n.textContent || ""))?.click());
  await wait(150);
  await setView("edit"); await setEdit("source");
  await app(() => window.__app?.workspace.closeModal());
  await wait(100);
  const mode = await app(async () => {
    if (!window.__app) return "no-app";
    try { await window.__app.vault.create("zzr272.md", "# r272\n"); } catch { /* exists */ }
    window.__app.workspace.openFile("zzr272.md", { newTab: true });
    await new Promise((r) => setTimeout(r, 180));
    return window.__app.workspace.getActiveTab()?.mode;
  });
  ok("new tab opens in source (combined consumed by openFile, unchanged)", mode === "source", String(mode));
}

ok("no page errors throughout", pageErrors.length === 0, pageErrors.join(" | "));

await browser.close();
console.log(`\nR272 e2e: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); process.exit(1); }
