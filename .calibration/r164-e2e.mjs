/**
 * R164 — Tier 7 C2: editable inline title → rename — browser :1420.
 * Run: node .calibration/r164-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 164 additions" (Tier 7 C2). DATA-SAFETY round.
 *
 * Click the inline title → input → commit routes through renameWithLinkUpdate (R16
 * vetted: flush dirty body first, rewrite links, rename; file:renamed retargets tab).
 * Case-insensitive dup validation guards against rename-over-existing (vault.rename
 * does NOT protect the target). MemoryVaultAdapter (browser) — safe in-memory.
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
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.evaluate(() => {
  try { localStorage.setItem("geode.locale", "en"); localStorage.setItem("geode.showInlineTitle", "true"); } catch {}
});
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TEXT = ".inline-title-text";
const INPUT = "[data-testid=inline-title-input]";
const fileExists = (p) => ev((path) => window.geode.app.vault.getFiles().some((f) => f.path === path), p);
const readFile = (p) => ev((path) => window.geode.app.vault.read(path), p);
const titleText = () => page.textContent(TEXT);

// fixtures: target note (+ content), a note linking to it, a dup-name note
await ev(async () => {
  const v = window.geode.app.vault;
  await v.create("r164-orig.md", "# Body\n\nsome content");
  await v.create("r164-linker.md", "see [[r164-orig]] here");
  await v.create("r164-dup.md", "dup");
  window.geode.app.workspace.openFile("r164-orig.md");
});
await page.waitForSelector(TEXT, { timeout: 5000 });
await wait(80);

console.log("— inline title shows + enters edit on click —");
ok("inline title shows the basename (no ext)", (await titleText()) === "r164-orig");
await page.click(TEXT);
await wait(60);
ok("clicking shows the rename input", await page.isVisible(INPUT));
ok("input is pre-filled with the current name", (await page.inputValue(INPUT)) === "r164-orig");

console.log("— Escape cancels (no rename) —");
await page.fill(INPUT, "should-not-apply");
await page.keyboard.press("Escape");
await wait(80);
ok("file unchanged after Escape", await fileExists("r164-orig.md"));
ok("title still original after Escape", (await titleText()) === "r164-orig");

console.log("— validation: empty + duplicate name are rejected (is-invalid, no commit) —");
await page.click(TEXT);
await page.fill(INPUT, "");
await wait(40);
ok("empty name → is-invalid", await ev((s) => document.querySelector(s)?.className.includes("is-invalid"), INPUT));
await page.fill(INPUT, "r164-dup");
await wait(40);
ok("duplicate sibling name → is-invalid", await ev((s) => document.querySelector(s)?.className.includes("is-invalid"), INPUT));
await page.keyboard.press("Enter"); // invalid → must NOT commit
await wait(80);
ok("invalid Enter did not rename (orig still exists)", await fileExists("r164-orig.md"));
ok("invalid Enter did not clobber dup file", await fileExists("r164-dup.md"));
await page.keyboard.press("Escape");
await wait(60);

console.log("— commit renames file + follows tab + rewrites links + preserves content —");
const origContent = await readFile("r164-orig.md");
await page.click(TEXT);
await page.fill(INPUT, "r164-renamed");
await page.keyboard.press("Enter");
await wait(300); // renameWithLinkUpdate: flush + ensureFresh + rewrite + rename
ok("old path is gone", !(await fileExists("r164-orig.md")));
ok("new path exists", await fileExists("r164-renamed.md"));
ok("inline title follows to the new name (tab retargeted)", (await titleText()) === "r164-renamed");
ok("content preserved at new path (no data loss)", (await readFile("r164-renamed.md")) === origContent);
ok("link in other note rewritten [[r164-orig]] → [[r164-renamed]]",
  (await readFile("r164-linker.md")).includes("[[r164-renamed]]") &&
  !(await readFile("r164-linker.md")).includes("[[r164-orig]]"));

console.log("— no-op when name unchanged —");
await page.click(TEXT);
await page.keyboard.press("Enter"); // unchanged → commit no-ops (newPath === path)
await wait(100);
ok("unchanged-name commit keeps the file", await fileExists("r164-renamed.md"));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR164: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
