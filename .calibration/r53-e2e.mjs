/**
 * R53 Unique note creator E2E — browser vs :1420.
 * Run: node .calibration/r53-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 53 additions".
 *
 *  A. pure transform (window.__geodeUnique): name / path-preview + config reactivity.
 *  B. live command: unique-note:create creates a timestamp-named note in the vault.
 *  C. settings UI wiring: the folder field drives the Store → path.
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
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r53", name: "r53", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeUnique, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// reset config to defaults first (setFolder/setFormat persist to localStorage)
await app(() => { window.__geodeUnique.setFolder(""); window.__geodeUnique.setFormat("YYYYMMDDHHmmss"); });

// ── A. pure transforms (window.__geodeUnique) ────────────────────────────────
console.log("A. pure transforms (window.__geodeUnique)");
// new Date(2026, 5, 14, 9, 8, 7) = 2026-06-14 09:08:07 local
ok("name = timestamp (YYYYMMDDHHmmss)", (await app(() => window.__geodeUnique.name(2026, 5, 14, 9, 8, 7))) === "20260614090807");
ok("path = name.md at vault root (default folder)", (await app(() => window.__geodeUnique.path(2026, 5, 14, 9, 8, 7))) === "20260614090807.md");
ok("setFolder('Zettel') → Zettel/name.md", (await app(() => { window.__geodeUnique.setFolder("Zettel"); return window.__geodeUnique.path(2026, 5, 14, 9, 8, 7); })) === "Zettel/20260614090807.md");
ok("traversal folder '../evil' → falls back to root", (await app(() => { window.__geodeUnique.setFolder("../evil"); return window.__geodeUnique.path(2026, 5, 14, 9, 8, 7); })) === "20260614090807.md");
ok("setFormat reactive (YYYY-MM-DD HHmm)", (await app(() => { window.__geodeUnique.setFormat("YYYY-MM-DD HHmm"); return window.__geodeUnique.name(2026, 5, 14, 9, 8, 7); })) === "2026-06-14 0908");
// reset for the live + UI sections
await app(() => { window.__geodeUnique.setFolder(""); window.__geodeUnique.setFormat("YYYYMMDDHHmmss"); });

// ── B. live command (unique-note:create) ─────────────────────────────────────
console.log("B. live command (unique-note:create)");
const before = await app(() => window.__app.vault.getMarkdownFiles().length);
await app(() => window.__app.commands.execute("unique-note:create"));
await wait(160);
const active1 = await app(() => window.__app.workspace.getActiveFile());
ok("create opens a timestamp-named note at root", typeof active1 === "string" && /^\d{14}\.md$/.test(active1), JSON.stringify(active1));
ok("created note exists in the vault", await app((p) => window.__app.vault.fileExists(p), active1));
await app(() => window.__app.commands.execute("unique-note:create"));
await wait(160);
const active2 = await app(() => window.__app.workspace.getActiveFile());
ok("second create makes a distinct unique note", typeof active2 === "string" && active2 !== active1 && /^\d{14}( 1)?\.md$/.test(active2), JSON.stringify(active2));
const after = await app(() => window.__app.vault.getMarkdownFiles().length);
ok("two new notes were created", after === before + 2, `${before}->${after}`);
// same-tick double-trigger (review fix): two concurrent creates must yield TWO distinct
// notes (X.md + "X 1.md"), not silently re-open the first. Pin the clock so both compute
// the same base name, forcing the collision-retry path.
const racePaths = await app(async () => {
  const n = window.__app.vault.getMarkdownFiles().length;
  const d = new Date(2030, 0, 2, 3, 4, 5);
  const { createUniqueNote } = await import("/src/core/uniqueNote.ts");
  const [a, b] = await Promise.all([
    createUniqueNote(window.__app.vault, window.__app.workspace, d),
    createUniqueNote(window.__app.vault, window.__app.workspace, d),
  ]);
  return { a, b, added: window.__app.vault.getMarkdownFiles().length - n };
});
ok("same-tick double create → two distinct notes", racePaths.a !== racePaths.b && racePaths.added === 2, JSON.stringify(racePaths));

// ── C. settings UI wiring (folder field → Store → path) ──────────────────────
console.log("C. settings UI wiring");
await app(() => window.__app.workspace.openModal("settings"));
await page.click('[data-testid="settings-nav-unique-notes"]');
await new Promise((r) => setTimeout(r, 80));
await page.waitForSelector('[data-testid="settings-unique-folder"]', { timeout: 4000 });
await page.fill('[data-testid="settings-unique-folder"]', "Inbox");
await wait(60);
ok("typing folder 'Inbox' updates the path", (await app(() => window.__geodeUnique.path(2026, 5, 14, 9, 8, 7))) === "Inbox/20260614090807.md");
// reset the field so it doesn't leak to later runs
await page.fill('[data-testid="settings-unique-folder"]', "");
await wait(40);
await app(() => { window.__geodeUnique.setFolder(""); window.__geodeUnique.setFormat("YYYYMMDDHHmmss"); });

console.log(`\nR53 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
