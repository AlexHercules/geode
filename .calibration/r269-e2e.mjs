/**
 * R269 — 表面复刻最后一公里：编辑器右键菜单补图标（reference 08）。Obsidian 的菜单每项左侧带
 * lucide 图标；Geode 的 compat Menu 一直留 16px 空图标槽（editorMenu.ts 从不调 setIcon）→ 看着像
 * 半成品。修：① icons.ts BUILTIN 补 8 个 lucide-ish 描边图标（scissors/copy/clipboard/bookmark/
 * file-output/link/folder/external-link，本地手绘非拷库）；② editorMenu.ts 给每个剪贴板项 +
 * 文件动作项（ICON_BY_COMMAND map）调 .setIcon。纯展示层、机械档、未碰 clipboard/edit 逻辑。
 *
 * Part A — 浏览器右键菜单：每项都有非空 .menu-item-icon svg（无 geode-icon-missing）。
 * Part B — 8 个新图标路径都解析为合法 SVGSVGElement（含桌面专属的 folder/external-link，浏览器里
 *          被 isTauri 门控隐藏，但路径串本身要校验）。
 * Run: node .calibration/r269-e2e.mjs   (dev server :1420 up)
 * Contract: docs/ARCHITECTURE.md "Round 269 additions".
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Part A: editor context menu items all carry a real icon ----------
console.log("— Part A: editor right-click menu — every item has a non-empty icon —");
{
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.geode.registerPlugin({ id: "r269", name: "r269", onload(app) { window.__app = app; } }));
  await page.waitForFunction(() => !!window.__app, null, { timeout: 8000 });
  // open a markdown file in live mode so workspace.activeEditor is set (editorMenu gate)
  await page.evaluate(async () => {
    try { await window.__app.vault.create("ZZr269.md", "# R269 menu icons\n\nbody text\n"); } catch { /* exists */ }
    await new Promise((r) => setTimeout(r, 150));
    window.__app.workspace.openFile("ZZr269.md");
    await new Promise((r) => setTimeout(r, 200));
    const tab = window.__app.workspace.getActiveTab();
    if (tab) window.__app.workspace.setTabMode(tab.id, "live");
    await new Promise((r) => setTimeout(r, 250));
  });
  await page.waitForSelector(".cm-content", { timeout: 8000 });
  await wait(300);

  const res = await page.evaluate(() => {
    const cm = document.querySelector(".cm-content") || document.querySelector(".cm-editor");
    if (!cm) return { error: "no editor" };
    const r = cm.getBoundingClientRect();
    cm.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + 40), clientY: Math.round(r.top + 30),
    }));
    const menu = document.querySelector(".geode-compat-menu");
    if (!menu) return { error: "no menu" };
    const items = [...menu.querySelectorAll(".menu-item")].map((it) => {
      const iconEl = it.querySelector(".menu-item-icon");
      return {
        title: it.querySelector(".menu-item-title")?.textContent || "",
        hasSvg: !!iconEl?.querySelector("svg"),
        missing: !!iconEl?.querySelector(".geode-icon-missing"),
        warning: it.classList.contains("is-warning"),
        // a scissors icon (cut) is the only menu icon with <circle> elements
        iconHasCircle: !!iconEl?.querySelector("svg circle"),
      };
    });
    return {
      noIconClass: menu.classList.contains("no-icon"),
      count: items.length,
      separators: menu.querySelectorAll(".menu-separator").length,
      items,
    };
  });

  ok("context menu opened", !res.error, JSON.stringify(res));
  ok("menu NOT collapsed (.no-icon absent → gutter shows)", res.noIconClass === false);
  ok("≥10 items shown (clipboard 3 + file-actions 5 + rename/delete 2; desktop group hidden in browser)", res.count >= 10, `got ${res.count}`);
  ok("2 separators between groups", res.separators === 2, `got ${res.separators}`);
  ok("EVERY item has an svg icon", res.items?.every((i) => i.hasSvg) === true);
  ok("NO item shows the missing-icon placeholder", res.items?.every((i) => !i.missing) === true);
  // positional (locale-independent): cut is always first, delete always last
  const cut = res.items?.[0];
  ok("first item (cut) → scissors (only iconed item with a <circle>)", cut?.iconHasCircle === true);
  const del = res.items?.[res.items.length - 1];
  ok("last item (delete) → warning style + has icon", del?.warning === true && del?.hasSvg === true);
  ok("ONLY the cut icon has a <circle> (scissors is unique)", res.items?.filter((i) => i.iconHasCircle).length === 1);
  ok("no page errors during menu build", pageErrors.length === 0, pageErrors.join(" | "));
  await page.close();
}

// ---------- Part B: all 8 new icon paths parse as valid SVG (incl desktop-only) ----------
console.log("— Part B: the 8 new BUILTIN icon paths are well-formed SVG —");
{
  const page = await browser.newPage();
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  // exact inner-SVG strings added to icons.ts BUILTIN (R269) — keep in sync
  const INNER = {
    scissors: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M20 4 8.5 15.5"/><path d="M14.5 14.5 20 20"/><path d="M8.5 8.5 12 12"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
    clipboard: '<rect x="8" y="2.5" width="8" height="4" rx="1"/><path d="M16 4.5h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h2"/>',
    bookmark: '<path d="M19 21.5 12 17l-7 4.5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    "file-output": '<path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5"/><path d="M12 11.5v5.5"/><path d="m9.5 14.5 2.5 2.5 2.5-2.5"/>',
    link: '<path d="M9.5 13.5a4 4 0 0 0 6 .5l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7"/><path d="M14.5 10.5a4 4 0 0 0-6-.5l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7"/>',
    folder: '<path d="M4 5h5l2 2.5h9a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5V6.5A1.5 1.5 0 0 1 4 5z"/>',
    "external-link": '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  };
  const res = await page.evaluate((inner) => {
    const out = {};
    for (const [name, body] of Object.entries(inner)) {
      const tpl = document.createElement("template");
      tpl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`.trim();
      const el = tpl.content.firstElementChild;
      out[name] = el instanceof SVGSVGElement && el.childElementCount > 0;
    }
    return out;
  }, INNER);
  for (const name of Object.keys(INNER)) ok(`icon "${name}" parses as SVG`, res[name] === true);
  await page.close();
}

await browser.close();
console.log(`\nR269 e2e: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); process.exit(1); }
