/**
 * R89 default new-note location E2E — browser mode :1420.
 * Run: node .calibration/r89-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 89 additions" (㊽).
 *
 * Covers resolveNewNoteFolder (root/current/folder, via __geodeNewNoteFolder),
 * createNewNote end-to-end (folder-ensure + slash-guard, via __geodeCreateNewNote),
 * and the settings segmented + folder input. Writes .md via the vetted create path.
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
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r89", name: "r89", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeNewNoteFolder && !!window.__geodeCreateNewNote, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const resolve = (loc, folder, active) => app(([l, f, a]) => window.__geodeNewNoteFolder(l, f, a), [loc, folder, active]);
const createNote = (name) => app(([n]) => window.__geodeCreateNewNote(n), [name]);
const exists = (p) => app(([path]) => window.__app.vault.fileExists(path), [p]);
const ls = (k) => app(([key]) => localStorage.getItem(key), [k]);

// ── resolveNewNoteFolder truth table ────────────────────────────────────────
console.log("— resolveNewNoteFolder —");
ok("root → vault root (\"\")", (await resolve("root", "", "sub/note.md")) === "");
ok("current + active in sub/ → sub", (await resolve("current", "", "sub/note.md")) === "sub");
ok("current + active at root → \"\"", (await resolve("current", "", "note.md")) === "");
ok("current + no active file → \"\"", (await resolve("current", "", null)) === "");
ok("folder → the specified folder", (await resolve("folder", "Inbox", "x.md")) === "Inbox");
ok("folder strips leading/trailing slashes", (await resolve("folder", "/Inbox/Sub/", "x.md")) === "Inbox/Sub");

// ── createNewNote end-to-end (folder-ensure + slash-guard) ──────────────────
console.log("— createNewNote end-to-end —");
// folder location → note created inside it (folder auto-created)
await resolve("folder", "Inbox", "x.md"); // sets the setting
const p1 = await createNote("Captured");
ok("note created in the specified folder", p1 === "Inbox/Captured.md", p1);
ok("the created file exists", await exists("Inbox/Captured.md"));
// a name carrying its own folder is vault-relative (NOT nested under Inbox)
const p2 = await createNote("Projects/Roadmap");
ok("a path-bearing name is NOT nested under the default folder", p2 === "Projects/Roadmap.md", p2);
// root location → vault root
await resolve("root", "", "x.md");
const p3 = await createNote("AtRoot");
ok("root location → created at vault root", p3 === "AtRoot.md", p3);
// collision → uniquePath suffix
const p4 = await createNote("AtRoot");
ok("collision gets a uniquePath suffix", p4 === "AtRoot 1.md", p4);

// ── settings segmented + folder input ───────────────────────────────────────
console.log("— settings UI —");
await app(async () => { window.__app.workspace.openModal("settings"); await new Promise((r) => setTimeout(r, 250)); });
await page.click('[data-testid="settings-nav-files-and-links"]');
await new Promise((r) => setTimeout(r, 80));
ok("location dropdown present with 3 options (R271: was segmented)", await app(() => {
  const sel = document.querySelector('[data-testid="settings-newnote-location"]');
  return !!sel && sel.tagName === "SELECT" && sel.querySelectorAll("option").length === 3;
}));
// folder input hidden until "In folder…" chosen
await page.selectOption('[data-testid="settings-newnote-location"]', "root");
await wait(80);
ok("folder input hidden when location ≠ folder", !(await app(() => !!document.querySelector('[data-testid="settings-newnote-folder-path"]'))));
await page.selectOption('[data-testid="settings-newnote-location"]', "folder");
await wait(80);
ok("folder input appears when 'In folder…' chosen", await app(() => !!document.querySelector('[data-testid="settings-newnote-folder-path"]')));
ok("location persists to localStorage (folder)", (await ls("geode.newNoteLocation")) === "folder");
await page.fill('[data-testid="settings-newnote-folder-path"]', "Notes");
await wait(100);
ok("folder path persists to localStorage", (await ls("geode.newNoteFolder")) === "Notes");

console.log(`\nR89 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
