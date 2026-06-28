/**
 * R248 (G2-b) settings Files&Links page section-subheaders E2E — browser mode :1420.
 * Run: node .calibration/r248-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 248 additions".
 *
 * Extends R246's `.settings-subheader` grouping to the Files & Links page: reorders 11 flat settings
 * into 顶部(默认位置, headerless) → 链接(Links) → 回收站(Trash) → 高级(Advanced) + adds the 3 subheaders
 * (reference 02). Pure IA reorder — every original setting-item testid/binding preserved verbatim, and
 * the conditional newnote-folder-path block stays directly after its segmented control in the top group.
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
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r248", name: "r248", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await app(() => window.__app.workspace.openModal("settings"));
await page.click('[data-testid="settings-nav-files-and-links"]');
await page.waitForSelector('[data-testid="settings-attachment-folder"]', { timeout: 3000 });
await wait(80);

console.log("— every original Files&Links setting-item testid is preserved (pure reorder) —");
const ORIGINAL = [
  "settings-detect-extensions-toggle", "settings-auto-update-links", "settings-link-use-markdown",
  "settings-link-path-format", "settings-newnote-location",
  "settings-attachment-folder", "settings-excluded-files", "settings-delete-confirm-toggle",
  "settings-attachment-delete-mode", "settings-rebuild-cache",
];
const present = await app((ids) => ids.filter((id) => !!document.querySelector(`[data-testid="${id}"]`)), ORIGINAL);
ok(`all ${ORIGINAL.length} original testids present (${present.length})`, present.length === ORIGINAL.length, JSON.stringify(ORIGINAL.filter((id) => !present.includes(id))));

console.log("— the 链接 / 回收站 / 高级 subheaders exist with the right text —");
const subs = await app(() => ({
  links: document.querySelector('[data-testid="settings-subheader-links"]')?.textContent?.trim() ?? null,
  trash: document.querySelector('[data-testid="settings-subheader-trash"]')?.textContent?.trim() ?? null,
  adv: document.querySelector('[data-testid="settings-subheader-advanced"]')?.textContent?.trim() ?? null,
  cls: document.querySelector('[data-testid="settings-subheader-links"]')?.className ?? null,
}));
ok("链接 subheader present, text = 'Links'", subs.links === "Links", JSON.stringify(subs));
ok("回收站 subheader present, text = 'Trash'", subs.trash === "Trash", JSON.stringify(subs));
ok("高级 subheader present, text = 'Advanced'", subs.adv === "Advanced", JSON.stringify(subs));
ok("subheader uses .settings-subheader class", subs.cls === "settings-subheader", JSON.stringify(subs));

console.log("— faithful DOM order: 顶部 → 链接 → 回收站 → 高级 —");
const top = (sel) => app((s) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect().top : NaN; }, sel);
const o = await app(() => {
  const t = (s) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect().top : NaN; };
  return {
    newnote: t('[data-testid="settings-newnote-location"]'),
    attach: t('[data-testid="settings-attachment-folder"]'),
    linksSub: t('[data-testid="settings-subheader-links"]'),
    linkPath: t('[data-testid="settings-link-path-format"]'),
    detect: t('[data-testid="settings-detect-extensions-toggle"]'),
    trashSub: t('[data-testid="settings-subheader-trash"]'),
    delConfirm: t('[data-testid="settings-delete-confirm-toggle"]'),
    advSub: t('[data-testid="settings-subheader-advanced"]'),
    excluded: t('[data-testid="settings-excluded-files"]'),
  };
});
ok("顶部组 (newnote → attachment-folder) is above the 链接 subheader", o.newnote < o.attach && o.attach < o.linksSub, JSON.stringify(o));
ok("链接 subheader above 链接组 (link-path-format)", o.linksSub < o.linkPath, JSON.stringify(o));
ok("detect-extensions moved into 链接组 (now after link-path, above 回收站)", o.linkPath < o.detect && o.detect < o.trashSub, JSON.stringify(o));
ok("回收站 subheader above 回收站组 (delete-confirm)", o.trashSub < o.delConfirm, JSON.stringify(o));
ok("回收站组 above 高级 subheader", o.delConfirm < o.advSub, JSON.stringify(o));
ok("高级 subheader above 高级组 (excluded-files)", o.advSub < o.excluded, JSON.stringify(o));

console.log("— the conditional newnote-folder-path stays in 顶部 (above the 链接 subheader) when chosen —");
await page.selectOption('[data-testid="settings-newnote-location"]', "folder");
await wait(80);
const condTop = await top('[data-testid="settings-newnote-folder-path"]');
ok("newnote-folder-path appears and sits in 顶部 group (above 链接 subheader)", !Number.isNaN(condTop) && condTop < o.linksSub, `path=${condTop} linksSub=${o.linksSub}`);

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR248 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
