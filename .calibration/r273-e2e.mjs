/**
 * R273 — 表面复刻收尾①：附件默认位置 text input → Obsidian-style 下拉 + 条件路径输入。
 * Obsidian renders 附件默认存放路径 as a dropdown (reference 02-文件与链接-01), default 仓库根目录,
 * with the MODE encoded into the single attachmentFolder string consumed by resolveAttachmentDir:
 *    root      -> "/"          specified -> "<path>"
 *    current   -> "./"         subfolder -> "./<path>"
 * The dropdown is a pure view transform over that one string (store/importer/resolveAttachmentDir
 * untouched). This suite locks: control FORM (select + conditional path input), the EXACT stored
 * grammar string per mode (round-trip losslessness — incl. the Explorer-right-click raw write
 * "myassets"), reload re-decode, and the empty-path collision held in local state (no mode jump).
 *
 * Run: node .calibration/r273-e2e.mjs   (dev server :1420 up)
 * Contract: docs/ARCHITECTURE.md "Round 273 additions".
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

const TID = '[data-testid="settings-attachment-folder"]';
const PATH = '[data-testid="settings-attachment-folder-path"]';

async function openFiles() {
  await page.waitForSelector(".ribbon-btn", { timeout: 15000 });
  await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelector('[aria-label*="设置"], [title*="设置"], [aria-label*="Settings" i]')?.click());
  await page.waitForSelector(".settings-nav-item", { timeout: 8000 });
  await page.evaluate(() => {
    const r = /文件与链接|Files/;
    [...document.querySelectorAll(".settings-nav-item")].find((n) => r.test(n.textContent || ""))?.click();
  });
  await page.waitForSelector(TID, { timeout: 8000 });
}
// seed localStorage to a raw stored string, reload, reopen Files page
async function seed(value) {
  await page.evaluate((v) => localStorage.setItem("geode.attachmentFolder", v), value);
  await page.reload({ waitUntil: "domcontentloaded" });
  await openFiles();
}
const stored = () => page.evaluate(() => localStorage.getItem("geode.attachmentFolder"));
const mode = () => page.evaluate((sel) => document.querySelector(sel)?.value, TID);
const pathVisible = () => page.evaluate((sel) => !!document.querySelector(sel), PATH);
const pathVal = () => page.evaluate((sel) => document.querySelector(sel)?.value, PATH);

// =========== Part A: form (select + 4 options, was a text input) ===========
console.log("— Part A: control FORM = native dropdown (was text input) —");
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
// fresh vault → no localStorage → Geode default "assets" = specified mode (NOT root — keeps existing data)
await page.evaluate(() => localStorage.removeItem("geode.attachmentFolder"));
await page.reload({ waitUntil: "domcontentloaded" });
await openFiles();
{
  const res = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return {
      tag: el?.tagName,
      cls: el?.className,
      opts: el ? [...el.querySelectorAll("option")].map((o) => o.value) : [],
    };
  }, TID);
  ok("attachment-folder control is a <select> (was <input type=text>)", res.tag === "SELECT", res.tag);
  ok("uses native .settings-select dropdown style", res.cls === "settings-select", res.cls);
  ok("has the 4 modes (root/specified/current/subfolder)",
    JSON.stringify(res.opts) === JSON.stringify(["root", "specified", "current", "subfolder"]), JSON.stringify(res.opts));
  ok("default (store 'assets') decodes to specified mode (NOT root — preserves existing behaviour)", (await mode()) === "specified");
  ok("default shows the path input with the existing value 'assets'", (await pathVisible()) && (await pathVal()) === "assets");
}

// =========== Part B: each mode encodes to the EXACT grammar string + path-input visibility ===========
console.log("— Part B: dropdown → exact stored grammar string + conditional path input —");
{
  await page.selectOption(TID, "root");
  await page.waitForTimeout(80);
  ok("root → stored '/' (vault root)", (await stored()) === "/", await stored());
  ok("root hides the path input", (await pathVisible()) === false);

  await page.selectOption(TID, "current");
  await page.waitForTimeout(80);
  ok("current → stored './' (same folder as note)", (await stored()) === "./", await stored());
  ok("current hides the path input", (await pathVisible()) === false);

  await page.selectOption(TID, "subfolder");
  await page.waitForTimeout(80);
  ok("subfolder shows the path input", (await pathVisible()) === true);
  await page.fill(PATH, "sub");
  await page.waitForTimeout(80);
  ok("subfolder + 'sub' → stored './sub'", (await stored()) === "./sub", await stored());

  await page.selectOption(TID, "specified");
  await page.waitForTimeout(80);
  await page.fill(PATH, "img");
  await page.waitForTimeout(80);
  ok("specified + 'img' → stored 'img' (fixed vault folder)", (await stored()) === "img", await stored());
}

// =========== Part C: empty-path collision held in local state (no visible mode jump) ===========
console.log("— Part C: clearing the path keeps the dropdown mode (collision held in UI state) —");
{
  await page.selectOption(TID, "subfolder");
  await page.fill(PATH, "x");
  await page.waitForTimeout(80);
  await page.fill(PATH, "");
  await page.waitForTimeout(80);
  ok("cleared subfolder path → stored collapses to './' (grammar)", (await stored()) === "./", await stored());
  ok("dropdown STILL shows 'subfolder' (mode not jumped to current)", (await mode()) === "subfolder");
  ok("path input still visible while cleared", (await pathVisible()) === true);
}

// =========== Part D: reload re-decode is lossless (incl. Explorer-right-click raw write) ===========
console.log("— Part D: reload re-decodes the stored string losslessly —");
{
  await seed("myassets"); // Explorer "Set as attachment folder" writes a raw fixed path
  ok("reload 'myassets' → specified mode", (await mode()) === "specified", await mode());
  ok("reload 'myassets' → path input shows 'myassets'", (await pathVisible()) && (await pathVal()) === "myassets");

  await seed("./photos");
  ok("reload './photos' → subfolder mode", (await mode()) === "subfolder", await mode());
  ok("reload './photos' → path input shows 'photos'", (await pathVisible()) && (await pathVal()) === "photos");

  await seed("/");
  ok("reload '/' → root mode", (await mode()) === "root", await mode());
  ok("reload '/' → path input hidden", (await pathVisible()) === false);

  await seed("./");
  ok("reload './' → current mode", (await mode()) === "current", await mode());
  ok("reload './' → path input hidden", (await pathVisible()) === false);
}

ok("no page errors throughout", pageErrors.length === 0, pageErrors.join(" | "));

await browser.close();
console.log(`\nR273 e2e: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); process.exit(1); }
