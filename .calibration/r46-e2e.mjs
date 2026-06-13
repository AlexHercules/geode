/**
 * R46 obsidian:// URI (in-app slice) E2E — browser mode vs dev :1420.
 * Run: node .calibration/r46-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 46 additions".
 *
 *  A. pure parser (window.__geodeUri.parse): open/new/search/unknown/null/decode.
 *  B. executor (window.__geodeUri.handle): open?file → opens target, new → creates+opens,
 *     search → opens search panel.
 *  C. in-app link routing: clicking an obsidian:// link in a rendered note opens the target.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r46", name: "r46", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeUri, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const parse = (u) => app((x) => window.__geodeUri.parse(x), u);

// ── A. pure parser ───────────────────────────────────────────────────────────
console.log("A. pure parser (window.__geodeUri.parse)");
const pOpen = await parse("obsidian://open?vault=V&file=Note&heading=Sec");
ok("parse open (file/heading/vault)", pOpen && pOpen.kind === "open" && pOpen.file === "Note" && pOpen.heading === "Sec" && pOpen.vault === "V", JSON.stringify(pOpen));
const pBlock = await parse("obsidian://open?file=N&block=abc123");
ok("parse open (block)", pBlock && pBlock.kind === "open" && pBlock.block === "abc123");
const pNew = await parse("obsidian://new?file=N&content=Hi");
ok("parse new (file/content)", pNew && pNew.kind === "new" && pNew.file === "N" && pNew.content === "Hi");
const pSearch = await parse("obsidian://search?query=foo");
ok("parse search (query)", pSearch && pSearch.kind === "search" && pSearch.query === "foo");
const pUnknown = await parse("obsidian://frobnicate?x=1");
ok("parse unknown action", pUnknown && pUnknown.kind === "unknown" && pUnknown.action === "frobnicate" && pUnknown.params.x === "1", JSON.stringify(pUnknown));
ok("parse non-obsidian scheme → null", (await parse("https://example.com")) === null);
ok("parse garbage → null", (await parse("not a uri at all")) === null);
ok("parse percent-decodes params", (await parse("obsidian://open?file=A%20B")).file === "A B");

// ── B. executor ──────────────────────────────────────────────────────────────
console.log("B. executor (window.__geodeUri.handle)");
await app(() => window.__app.vault.create("UriTarget.md", "# Target\n").catch(() => {}));
await wait(80);
await app(() => window.__app.workspace.openFile("seed-x.md")?.catch?.(() => {}) ?? window.__app.workspace.openFile("UriTarget.md")); // ensure some active file
await wait(60);
await app(() => window.__geodeUri.handle("obsidian://open?file=UriTarget"));
await wait(180);
ok("handle open?file opens the target", (await app(() => window.__app.workspace.getActiveFile())) === "UriTarget.md", JSON.stringify(await app(() => window.__app.workspace.getActiveFile())));

await app(() => window.__geodeUri.handle("obsidian://new?file=UriNew&content=hello%20world"));
await wait(200);
ok("handle new creates the note", await app(() => window.__app.vault.fileExists("UriNew.md")));
ok("handle new writes the content", (await app(() => window.__app.vault.read("UriNew.md"))) === "hello world", JSON.stringify(await app(() => window.__app.vault.read("UriNew.md").catch(() => null))));
ok("handle new opens the note", (await app(() => window.__app.workspace.getActiveFile())) === "UriNew.md");

await app(() => window.__geodeUri.handle("obsidian://search?query=foobar"));
await wait(150);
ok("handle search opens the search panel", (await app(() => window.__app.workspace.state.get().leftPanel)) === "search");

// F5 (review): obsidian://open on a missing note must NOT create it (unlike a wikilink click)
const filesBeforeOpen = await app(() => window.__app.vault.getFiles().length);
await app(() => window.__geodeUri.handle("obsidian://open?file=NoSuchFile12345"));
await wait(150);
ok("open?file on a missing note does NOT create it", (await app(() => window.__app.vault.getFiles().length)) === filesBeforeOpen && !(await app(() => window.__app.vault.fileExists("NoSuchFile12345.md"))));
// F2 (review): a present-but-empty file= falls through to name
await app(() => window.__geodeUri.handle("obsidian://new?file=&name=FromName"));
await wait(180);
ok("new with empty file= falls through to name", await app(() => window.__app.vault.fileExists("FromName.md")));
// F1+F3 (review): a traversal path is rejected by the core guard — nothing created, no ghost tab
const filesBeforeBad = await app(() => window.__app.vault.getFiles().length);
await app(() => window.__geodeUri.handle("obsidian://new?file=../../evil&content=x"));
await wait(150);
ok("new with a '..' path creates nothing (core path guard)", !(await app(() => window.__app.vault.fileExists("../../evil.md"))) && (await app(() => window.__app.vault.getFiles().length)) === filesBeforeBad);

// ── C. in-app link routing (reading view) ────────────────────────────────────
console.log("C. in-app link routing (click obsidian:// in a rendered note)");
await app(() => window.__app.vault.create("UriHost.md", "[go](obsidian://open?file=UriTarget)\n").catch(() => {}));
await wait(80);
await app(() => window.__app.workspace.openFile("UriHost.md"));
await wait(120);
await app(() => { const t = window.__app.workspace.getActiveTab(); if (t) window.__app.workspace.setTabMode(t.id, "preview"); });
await wait(250);
// move active away so the click's effect (opening UriTarget) is observable
const clicked = await app(() => {
  const a = document.querySelector('a[href^="obsidian://"]');
  if (!a) return false;
  a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  return true;
});
ok("reading view renders the obsidian:// link as a clickable anchor", clicked);
await wait(200);
ok("clicking an obsidian:// link routes in-app (opens the target)", (await app(() => window.__app.workspace.getActiveFile())) === "UriTarget.md", JSON.stringify(await app(() => window.__app.workspace.getActiveFile())));

console.log(`\nR46 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
