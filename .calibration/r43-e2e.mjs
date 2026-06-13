/**
 * R43 calendar pane + daily-note nav E2E — browser mode vs dev :1420.
 * Run: node .calibration/r43-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 43 additions".
 *
 *  A. pure date helpers (window.__geodeDaily): stamp/path/parse/gridDims.
 *  B. calendar pane: 6x7 grid, today highlight, has-note dot, click → open/create, month nav.
 *  C. daily-note nav commands: open-today / next-day / prev-day.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r43", name: "r43", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeDaily, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── A. pure date helpers ─────────────────────────────────────────────────────
console.log("A. pure date helpers (window.__geodeDaily)");
ok("stamp(2026,5,14) → 2026-06-14", (await app(() => window.__geodeDaily.stamp(2026, 5, 14))) === "2026-06-14");
ok("path(2026,5,14) → Daily Notes/2026-06-14.md", (await app(() => window.__geodeDaily.path(2026, 5, 14))) === "Daily Notes/2026-06-14.md");
ok("parse('Daily Notes/2026-06-14.md') → 2026-06-14", (await app(() => window.__geodeDaily.parse("Daily Notes/2026-06-14.md"))) === "2026-06-14");
ok("parse('note.md') → null", (await app(() => window.__geodeDaily.parse("note.md"))) === null);
ok("parse impossible date '2026-13-40' → null", (await app(() => window.__geodeDaily.parse("2026-13-40"))) === null);
// over-match guards (R43 review): basename-only + anchored, so date-named parent
// folders / 5-digit years / embedded dates never shadow the real filename.
ok("parse('2020-01-01-backup/2026-06-14.md') → 2026-06-14 (basename, not parent)", (await app(() => window.__geodeDaily.parse("2020-01-01-backup/2026-06-14.md"))) === "2026-06-14");
ok("parse('12025-06-14.md') → null (5-digit year not over-matched)", (await app(() => window.__geodeDaily.parse("12025-06-14.md"))) === null);
ok("parse('meeting-2026-06-14-notes.md') → null (embedded date not over-matched)", (await app(() => window.__geodeDaily.parse("meeting-2026-06-14-notes.md"))) === null);
const grid = await app(() => window.__geodeDaily.gridDims(2026, 5));
ok("gridDims(2026,5) → 6 weeks x 7 cols", grid.weeks === 6 && grid.cols === 7, JSON.stringify(grid));
ok("grid first cell is a Sunday on/before the 1st", new Date(grid.first + "T00:00").getDay() === 0 && grid.first <= "2026-06-01", JSON.stringify(grid.first));
ok("grid spans the whole month", grid.first <= "2026-06-01" && grid.last >= "2026-06-30", JSON.stringify([grid.first, grid.last]));

// ── B. calendar pane ─────────────────────────────────────────────────────────
console.log("B. calendar pane (grid / today / has-note / click / month nav)");
// create today's daily note so the calendar (inits to today's month) marks it
const todayPath = await app(() => { const n = new Date(); return window.__geodeDaily.path(n.getFullYear(), n.getMonth(), n.getDate()); });
await app(([p]) => window.__app.vault.create(p, "# today\n").catch(() => {}), [todayPath]);
await wait(40);
await app(() => window.__app.workspace.setRightPanel("calendar"));
await page.waitForSelector("[data-testid=calendar-panel]", { timeout: 4000 });
await wait(80);
ok("calendar renders 42 day cells", (await app(() => document.querySelectorAll(".calendar-grid .calendar-day").length)) === 42);
ok("calendar renders 7 weekday labels", (await app(() => document.querySelectorAll(".calendar-weekday").length)) === 7);
ok("calendar highlights today (exactly 1 .is-today)", (await app(() => document.querySelectorAll(".calendar-day.is-today").length)) === 1);
ok("calendar dots the day that has a note", (await app(() => document.querySelectorAll(".calendar-day.has-note").length)) >= 1);
// click today's cell → opens today's daily note
await app(() => document.querySelector(".calendar-day.is-today")?.click());
await wait(80);
ok("clicking today opens today's daily note", (await app(() => window.__app.workspace.getActiveFile())) === todayPath, JSON.stringify(await app(() => window.__app.workspace.getActiveFile())));
// month nav
const title1 = await app(() => document.querySelector("[data-testid=calendar-title]")?.textContent);
await app(() => document.querySelector("[data-testid=calendar-next]")?.click());
await wait(60);
const title2 = await app(() => document.querySelector("[data-testid=calendar-title]")?.textContent);
ok("next-month changes the calendar title", !!title2 && title1 !== title2, JSON.stringify([title1, title2]));
await app(() => document.querySelector("[data-testid=calendar-today]")?.click());
await wait(60);
ok("'today' button returns to current month", (await app(() => document.querySelector("[data-testid=calendar-title]")?.textContent)) === title1);

// ── C. daily-note nav commands ───────────────────────────────────────────────
console.log("C. daily-note nav commands (open-today / next-day / prev-day)");
const stampOf = (deltaDays) => app((delta) => { const n = new Date(); n.setDate(n.getDate() + delta); return window.__geodeDaily.stamp(n.getFullYear(), n.getMonth(), n.getDate()); }, deltaDays);
await app(() => window.__app.commands.execute("daily-note:open-today"));
await wait(60);
ok("open-today opens today's note", (await app(() => window.__app.workspace.getActiveFile()))?.includes(await stampOf(0)));
await app(() => window.__app.commands.execute("daily-note:next-day"));
await wait(60);
ok("next-day opens tomorrow's note", (await app(() => window.__app.workspace.getActiveFile()))?.includes(await stampOf(1)), JSON.stringify(await app(() => window.__app.workspace.getActiveFile())));
await app(() => window.__app.commands.execute("daily-note:prev-day"));
await app(() => window.__app.commands.execute("daily-note:prev-day"));
await wait(60);
ok("prev-day x2 from tomorrow opens yesterday's note", (await app(() => window.__app.workspace.getActiveFile()))?.includes(await stampOf(-1)), JSON.stringify(await app(() => window.__app.workspace.getActiveFile())));
// nav gating (R43 review): a stray date-named file OUTSIDE Daily Notes must not
// seed the base date — next-day falls back to today, never the decoy's date.
await app(() => window.__app.vault.create("Archive/2030-01-01.md", "# decoy\n").catch(() => {}));
await wait(40);
await app(() => window.__app.workspace.openFile("Archive/2030-01-01.md"));
await wait(60);
await app(() => window.__app.commands.execute("daily-note:next-day"));
await wait(80);
const navFromDecoy = await app(() => window.__app.workspace.getActiveFile());
ok("next-day from a date-named file outside Daily Notes uses TODAY+1, not the decoy date", navFromDecoy?.includes(await stampOf(1)) && !navFromDecoy.includes("2030-01"), JSON.stringify(navFromDecoy));

console.log(`\nR43 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
