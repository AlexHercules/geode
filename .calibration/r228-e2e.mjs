/**
 * R228 "Rebuild vault cache" (Obsidian Files & Links → Advanced) E2E — browser :1420.
 * Run: node .calibration/r228-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 228 additions".
 *
 * Surfaces the existing (vault-load-tested) metadata.rebuildAll() via a command (app:rebuild-cache)
 * + a Files&Links settings button. Read-only re-index: bumps metadata.revision, re-derives the cache
 * (tags/links/headings) from disk; no .md writes. Verifies the cache survives a rebuild byte-for-data.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r228", name: "r228", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rev = () => app(() => window.__app.metadata.revision.get());
const hasTag = () => app(() => window.__app.metadata.getTagMap().has("rbtag"));

await app(async () => {
  try { await window.__app.vault.create("rb.md", "---\ntags: [rbtag]\n---\n# Heading\n\nlink to [[rb2]]\n"); } catch {}
  try { await window.__app.vault.create("rb2.md", "# rb2\n"); } catch {}
});
await page.waitForFunction(() => window.__app.metadata.getTagMap().has("rbtag"), null, { timeout: 4000 });

console.log("— the command exists + rebuilding bumps revision and preserves the cache —");
ok("app:rebuild-cache is registered", await app(() => window.__app.commands.list().some((c) => c.id === "app:rebuild-cache")));
ok("before: tag 'rbtag' is indexed", await hasTag());
const rev0 = await rev();
await app(() => window.__app.commands.execute("app:rebuild-cache"));
await page.waitForFunction((r) => window.__app.metadata.revision.get() > r, rev0, { timeout: 4000 });
ok("executing the command bumped metadata.revision (rebuild ran)", (await rev()) > rev0, `${rev0} → ${await rev()}`);
ok("after rebuild: tag 'rbtag' is STILL indexed (cache re-derived, not lost)", await hasTag());
ok("after rebuild: the tag→note mapping is intact (rb.md still under 'rbtag')",
  await app(() => [...(window.__app.metadata.getTagMap().get("rbtag") ?? [])].includes("rb.md")));

console.log("— the Files & Links settings button triggers the rebuild —");
await app(() => window.__app.workspace.openModal("settings"));
await page.click('[data-testid="settings-nav-files-and-links"]');
await page.waitForSelector('[data-testid="settings-rebuild-cache"]', { timeout: 4000 });
ok("the Rebuild button is present in Files & Links", (await page.locator('[data-testid="settings-rebuild-cache"]').count()) === 1);
const rev1 = await rev();
await page.click('[data-testid="settings-rebuild-cache"]');
await page.waitForFunction((r) => window.__app.metadata.revision.get() > r, rev1, { timeout: 4000 }).catch(() => {});
ok("clicking the settings button rebuilt (revision bumped again)", (await rev()) > rev1, `${rev1} → ${await rev()}`);
await app(() => window.__app.workspace.closeModal());
await wait(80);

console.log("— a confirmation toast is shown (command feedback) —");
// re-run via command; the showCommandNotice toast reuses the shared .link-update-notice styling
await app(() => window.__app.commands.execute("app:rebuild-cache"));
await wait(120);
ok("a toast notice appears after rebuild", await app(() => {
  const txt = [...document.querySelectorAll(".link-update-notice, [class*='notice']")].map((e) => e.textContent).join(" ");
  return /rebuilt|重建/i.test(txt);
}), "no toast text matched");

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR228 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
