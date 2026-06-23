/**
 * R48 configurable daily notes E2E — browser mode vs dev :1420.
 * Run: node .calibration/r48-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 48 additions".
 *
 *  A. configurable format/folder via __geodeDaily (stamp/path/parse follow).
 *  B. settings UI drives the format/folder/template Stores.
 *  C. open-today honors the configured folder + applies the configured template.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r48", name: "r48", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!(window.__geodeDaily && window.__geodeDaily.setFormat), null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pathFor = (y, m, d) => app(([a, b, c]) => window.__geodeDaily.path(a, b, c), [y, m, d]);

// ── A. configurable format/folder (__geodeDaily) ─────────────────────────────
console.log("A. configurable format/folder (__geodeDaily)");
ok("default stamp YYYY-MM-DD", (await app(() => window.__geodeDaily.stamp(2026, 5, 14))) === "2026-06-14");
await app(() => window.__geodeDaily.setFormat("DD-MM-YYYY"));
await wait(40);
ok("custom format: stamp follows", (await app(() => window.__geodeDaily.stamp(2026, 5, 14))) === "14-06-2026");
ok("custom format: path follows", (await pathFor(2026, 5, 14)) === "Daily Notes/14-06-2026.md");
ok("custom format: parse round-trips", (await app(() => window.__geodeDaily.parse("Daily Notes/14-06-2026.md"))) === "14-06-2026");
ok("custom format: old-format name no longer parses", (await app(() => window.__geodeDaily.parse("Daily Notes/2026-06-14.md"))) === null);
await app(() => window.__geodeDaily.setFormat("YYYY-MM-DD"));
await wait(40);
await app(() => window.__geodeDaily.setFolder("Journal"));
await wait(40);
ok("custom folder: path follows", (await pathFor(2026, 5, 14)) === "Journal/2026-06-14.md");
await app(() => window.__geodeDaily.setFolder("Daily Notes"));
await wait(40);
ok("reset restores default path", (await pathFor(2026, 5, 14)) === "Daily Notes/2026-06-14.md");
// F1 (review): a trailing-slash folder must not yield a double-slash path
await app(() => window.__geodeDaily.setFolder("Daily Notes/"));
await wait(40);
ok("trailing-slash folder → no double-slash path", (await pathFor(2026, 5, 14)) === "Daily Notes/2026-06-14.md", await pathFor(2026, 5, 14));
// F2 (review): a '..' / dot-prefixed folder falls back to default (no traversal)
await app(() => window.__geodeDaily.setFolder("../evil"));
await wait(40);
ok("'..' folder rejected → default", (await pathFor(2026, 5, 14)) === "Daily Notes/2026-06-14.md", await pathFor(2026, 5, 14));
await app(() => window.__geodeDaily.setFolder("Daily Notes"));
await wait(40);

// ── B. settings UI drives the Stores ─────────────────────────────────────────
console.log("B. settings UI drives the format Store");
await app(() => window.__app.workspace.openModal("settings"));
await page.click('[data-testid="settings-nav-daily-notes"]');
await new Promise((r) => setTimeout(r, 80));
await page.waitForSelector("[data-testid=settings-daily-format]", { timeout: 4000 });
await page.fill("[data-testid=settings-daily-format]", "YYYY.MM.DD");
await wait(150);
ok("settings 'date format' input updates dailyNotePath", (await pathFor(2026, 5, 14)) === "Daily Notes/2026.06.14.md", await pathFor(2026, 5, 14));
await page.fill("[data-testid=settings-daily-folder]", "Logs");
await wait(120);
ok("settings 'new file location' input updates folder", (await pathFor(2026, 5, 14)) === "Logs/2026.06.14.md", await pathFor(2026, 5, 14));
// reset via inputs
await page.fill("[data-testid=settings-daily-format]", "YYYY-MM-DD");
await page.fill("[data-testid=settings-daily-folder]", "Daily Notes");
await wait(120);
await app(() => window.__app.workspace.closeModal());
await wait(60);

// ── C. open-today honors folder + template ───────────────────────────────────
console.log("C. open-today honors folder + applies template");
await app(() => window.__geodeDaily.setFolder("FolderJournal"));
await wait(40);
await app(() => window.__app.commands.execute("daily-note:open-today"));
await wait(180);
ok("open-today creates the note in the configured folder", (await app(() => window.__app.workspace.getActiveFile()))?.startsWith("FolderJournal/"), JSON.stringify(await app(() => window.__app.workspace.getActiveFile())));
await app(() => window.__geodeDaily.setFolder("Daily Notes"));
await wait(40);

// template application
await app(() => window.__app.vault.create("DailyTpl.md", "Journal for {{title}}\n\n## Tasks\n").catch(() => {}));
await wait(80);
await app(() => window.__app.workspace.openModal("settings"));
await page.click('[data-testid="settings-nav-daily-notes"]');
await new Promise((r) => setTimeout(r, 80));
await page.waitForSelector("[data-testid=settings-daily-template]", { timeout: 4000 });
await page.fill("[data-testid=settings-daily-template]", "DailyTpl");
await wait(120);
await app(() => window.__app.workspace.closeModal());
await wait(60);
// open a fresh daily in a clean folder so it doesn't already exist
await app(() => window.__geodeDaily.setFolder("TplJournal"));
await wait(40);
await app(() => window.__app.commands.execute("daily-note:open-today"));
await wait(200);
const tplNote = await app(() => window.__app.workspace.getActiveFile());
const tplContent = await app((p) => window.__app.vault.read(p).catch(() => null), tplNote);
ok("open-today applies the configured template (expanded)", !!tplContent && tplContent.includes("Journal for") && tplContent.includes("## Tasks"), JSON.stringify(tplContent));
// reset
await app(() => window.__geodeDaily.setFolder("Daily Notes"));
await app(() => window.__app.workspace.openModal("settings"));
await page.click('[data-testid="settings-nav-daily-notes"]');
await new Promise((r) => setTimeout(r, 80));
await page.waitForSelector("[data-testid=settings-daily-template]", { timeout: 4000 });
await page.fill("[data-testid=settings-daily-template]", "");
await wait(120);
await app(() => window.__app.workspace.closeModal());

console.log(`\nR48 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
