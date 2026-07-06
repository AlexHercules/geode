/**
 * R285 — 滚动条 + inline-title 字号对齐 Obsidian.
 * Browser :1420.   Run: node .calibration/r285-e2e.mjs
 * Contract: docs/ARCHITECTURE.md "Round 285 additions".
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r285", name: "r285", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("A. inline-title font-size = 1.8em / weight = 700");
await app(() => window.__app.vault.create("R285.md", "# R285 Title\nBody line.\n").catch(() => {}));
await wait(100);
await app(() => window.__app.workspace.openFile("R285.md"));
await wait(200);
const titleStyle = await app(() => {
  const el = document.querySelector(".inline-title");
  if (!el) return null;
  const st = getComputedStyle(el);
  return { fontSize: st.fontSize, fontWeight: st.fontWeight };
});
ok("inline-title rendered", !!titleStyle, JSON.stringify(titleStyle));
ok("inline-title font-size is 28.8px (1.8× editor font-size)", titleStyle?.fontSize === "28.8px", JSON.stringify(titleStyle));
ok("inline-title font-weight is 700", titleStyle?.fontWeight === "700", JSON.stringify(titleStyle));

console.log("B. Obsidian-style scrollbars");
const scrollbarStyles = await app(() => {
  // create a scrollable host so WebKit renders a scrollbar thumb
  const host = document.createElement("div");
  host.style.cssText = "width:100px;height:100px;overflow:auto;position:absolute;left:-9999px;";
  const inner = document.createElement("div");
  inner.style.cssText = "width:200px;height:400px;";
  host.appendChild(inner);
  document.body.appendChild(host);
  const thumb = getComputedStyle(host, "::-webkit-scrollbar-thumb");
  const track = getComputedStyle(host, "::-webkit-scrollbar-track");
  const scrollbar = getComputedStyle(host, "::-webkit-scrollbar");
  const result = {
    scrollbarWidth: scrollbar.width,
    scrollbarHeight: scrollbar.height,
    thumbBackground: thumb.backgroundColor,
    thumbMinHeight: thumb.minHeight,
    thumbBorderTop: thumb.borderTopWidth,
    thumbBorderRight: thumb.borderRightWidth,
    thumbBorderBottom: thumb.borderBottomWidth,
    thumbBorderLeft: thumb.borderLeftWidth,
    trackBackground: track.backgroundColor,
  };
  host.remove();
  return result;
});
ok("scrollbar width is 12px", scrollbarStyles?.scrollbarWidth === "12px", JSON.stringify(scrollbarStyles));
ok("scrollbar height is 12px", scrollbarStyles?.scrollbarHeight === "12px", JSON.stringify(scrollbarStyles));
ok("scrollbar thumb min-height is 45px", scrollbarStyles?.thumbMinHeight === "45px", JSON.stringify(scrollbarStyles));
ok("scrollbar thumb has transparent gaps (border widths 3/3/3/2)",
  scrollbarStyles?.thumbBorderTop === "3px" && scrollbarStyles?.thumbBorderRight === "3px"
  && scrollbarStyles?.thumbBorderBottom === "3px" && scrollbarStyles?.thumbBorderLeft === "2px",
  JSON.stringify(scrollbarStyles));
ok("scrollbar track is transparent", scrollbarStyles?.trackBackground === "rgba(0, 0, 0, 0)", JSON.stringify(scrollbarStyles));

console.log("C. scrollbar thumb hover/active rule uses --scrollbar-active-thumb-bg");
const hasHoverRule = await app(() => {
  const needle = "::-webkit-scrollbar-thumb:hover";
  for (const style of document.querySelectorAll("style")) {
    const text = style.textContent || "";
    if (text.includes(needle) && text.includes("--scrollbar-active-thumb-bg")) return true;
  }
  return false;
});
ok("scrollbar thumb hover/active rule uses active color variable", hasHoverRule);

console.log("D. scrollbar colors differ between dark and light themes");
const darkThumb = scrollbarStyles?.thumbBackground;
await app(() => window.__app.workspace.setTheme("light"));
await wait(150);
const lightThumb = await app(() => {
  const host = document.createElement("div");
  host.style.cssText = "width:100px;height:100px;overflow:auto;position:absolute;left:-9999px;";
  const inner = document.createElement("div");
  inner.style.cssText = "width:200px;height:400px;";
  host.appendChild(inner);
  document.body.appendChild(host);
  const c = getComputedStyle(host, "::-webkit-scrollbar-thumb").backgroundColor;
  host.remove();
  return c;
});
ok("light theme scrollbar thumb color differs from dark", lightThumb !== darkThumb, `dark=${darkThumb} light=${lightThumb}`);
await app(() => window.__app.workspace.setTheme("dark"));
await wait(100);

// cleanup
await app(() => {
  if (window.__app.vault.fileExists("R285.md")) window.__app.vault.remove("R285.md");
});

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR285: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
