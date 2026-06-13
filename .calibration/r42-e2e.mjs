/**
 * R42 local `.trash/` recoverable delete E2E — browser mode (Memory vault) vs dev :1420.
 * Run: node .calibration/r42-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 42 additions".
 *
 * DATA-SAFETY round: delete must be RECOVERABLE (move to .trash), never permanent.
 *  A. trash a file → gone from vault, present in listTrash, .trash hidden from tree.
 *  B. restoreFromTrash → file back with content intact, removed from trash.
 *  C. trashing a file open in a tab closes that tab (file:deleted reaction).
 *  D. collision: two same-basename files trashed get distinct trash paths.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r42", name: "r42", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const create = (p, c = "") => app(async ([path, content]) => { try { await window.__app.vault.create(path, content); } catch { /* exists */ } await new Promise((r) => setTimeout(r, 30)); }, [p, c]);
const exists = (p) => app((path) => window.__app.vault.fileExists(path), p);

// ── A. trash a file → recoverable ────────────────────────────────────────────
console.log("A. trash a file → gone from vault, in .trash, hidden from tree");
await create("r42/del.md", "# delete me");
const trashPath = await app(() => window.__app.vault.trash("r42/del.md"));
ok("trash returns a .trash/ path", typeof trashPath === "string" && trashPath.startsWith(".trash/"), JSON.stringify(trashPath));
ok("original gone from vault", (await exists("r42/del.md")) === false);
const trashList = await app(() => window.__app.vault.listTrash());
ok("listTrash includes the trashed file", trashList.some((t) => t.includes("del")), JSON.stringify(trashList));
ok(".trash hidden from the visible tree", (await app(() => JSON.stringify(window.__app.vault.tree.get()).includes('".trash"'))) === false);

// ── B. restore ───────────────────────────────────────────────────────────────
console.log("B. restoreFromTrash → file back, content intact");
await app(([tp]) => window.__app.vault.restoreFromTrash(tp, "r42/del.md"), [trashPath]);
await wait(40);
ok("restore brings the file back", (await exists("r42/del.md")) === true);
ok("restored content intact", (await app(() => window.__app.vault.read("r42/del.md"))) === "# delete me");
ok("listTrash no longer lists it", (await app(() => window.__app.vault.listTrash())).every((t) => !t.includes("del")));

// ── C. trashing an open file closes its tab ──────────────────────────────────
console.log("C. trashing an open file closes its tab (file:deleted reaction)");
await create("r42/open.md", "x");
await app(() => window.__app.workspace.openFile("r42/open.md"));
await wait(40);
ok("setup: file open in a tab", (await app(() => window.__app.workspace.getActivePane().tabs.some((t) => t.filePath === "r42/open.md"))) === true);
await app(() => window.__app.vault.trash("r42/open.md"));
await wait(60);
ok("trashing closes the tab pointing at it", (await app(() => window.__app.workspace.getActivePane().tabs.some((t) => t.filePath === "r42/open.md"))) === false);

// ── D. collision-safe trash names ────────────────────────────────────────────
console.log("D. collision: two same-basename files get distinct trash paths");
await create("r42a/note.md", "A");
await create("r42b/note.md", "B");
const t1 = await app(() => window.__app.vault.trash("r42a/note.md"));
const t2 = await app(() => window.__app.vault.trash("r42b/note.md"));
ok("two same-basename trashed → distinct paths", t1 !== t2, JSON.stringify([t1, t2]));
const both = await app(() => window.__app.vault.listTrash());
ok("both collided files present in trash", both.filter((t) => t.includes("note")).length === 2, JSON.stringify(both.filter((t) => t.includes("note"))));

// ── E. review fixes: binary trash / folder+binary / folder restore reindex ───
console.log("E. binary attachment trash + folder-with-binary + folder restore reindex");
// E1: trash a binary attachment (browser binaryFiles path — used to throw)
await app(() => window.__app.vault.createBinary("r42/img.png", new Uint8Array([1, 2, 3])));
const binTrash = await app(async () => { try { return await window.__app.vault.trash("r42/img.png"); } catch (e) { return "ERR:" + String(e); } });
ok("trashing a binary attachment doesn't throw", typeof binTrash === "string" && !binTrash.startsWith("ERR:"), JSON.stringify(binTrash));
ok("binary attachment gone from vault", (await exists("r42/img.png")) === false);

// E2: trash a folder with a binary child → both gone from the tree (no orphan)
await app(async () => {
  await window.__app.vault.createFolder("r42dir");
  await window.__app.vault.create("r42dir/note.md", "# n");
  await window.__app.vault.createBinary("r42dir/pic.png", new Uint8Array([9]));
});
await app(() => window.__app.vault.trash("r42dir"));
const treeStr = await app(() => JSON.stringify(window.__app.vault.tree.get()));
ok("folder-with-binary fully removed from tree (no orphan revival)", !treeStr.includes("r42dir") && !treeStr.includes("pic.png"));

// E3: folder restore REINDEXES its .md children (file:renamed → reindexFolder)
await create("fr/inside.md", "# Inside\n#frtag\n");
await page.waitForFunction(() => window.__app.metadata.getMetadata("fr/inside.md") !== undefined, null, { timeout: 3000 });
const ftp = await app(() => window.__app.vault.trash("fr"));
await wait(40);
ok("folder trashed → child no longer indexed", (await app(() => window.__app.metadata.getMetadata("fr/inside.md") === undefined)) === true);
await app(([tp]) => window.__app.vault.restoreFromTrash(tp, "fr"), [ftp]);
await wait(80);
ok("folder restore REINDEXES its .md children (metadata defined)", (await app(() => window.__app.metadata.getMetadata("fr/inside.md") !== undefined)) === true);

// E4: trash('') rejected — never trashes the vault root (defensive guard)
const emptyTrash = await app(async () => { try { await window.__app.vault.trash(""); return "ok"; } catch { return "rejected"; } });
ok("trash('') is rejected (never trashes the vault root)", emptyTrash === "rejected");

console.log(`\nR42 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
