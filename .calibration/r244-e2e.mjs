/**
 * R244 "Delete attachments when deleting a note" E2E — browser mode :1420.
 * Run: node .calibration/r244-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 244 additions".
 *
 * Obsidian Files&Links 「删除文件时删除附件」(default 每次都询问). Deleting a note can also trash the
 * attachments referenced ONLY by it (orphaned by the delete), per attachmentDeleteMode ask/delete/keep.
 * DATA-SAFETY CRUX (底线①): orphan detection must cover BOTH body refs AND frontmatter `[[att]]` refs —
 * an attachment still referenced by ANOTHER note's frontmatter must NEVER be deleted. Deletions go to
 * the recoverable .trash (R42-vetted), never a permanent delete.
 *
 * Covers: getOrphanedAttachments core (incl. the frontmatter-protection that getAttachmentMap alone
 * would get wrong + bare-string-is-not-a-ref), the resolveAttachmentDeletion orchestration via the
 * __geodeResolveAttachmentDeletion probe (folder deletedRoots double-trash filter + keep/delete), and
 * integration through app:delete-file (real trash + ask dialog accept/dismiss).
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
let dialogMode = "accept";
let dialogsSeen = 0;
page.on("dialog", (d) => { dialogsSeen++; void (dialogMode === "accept" ? d.accept() : d.dismiss()); });

await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
// deleteConfirm OFF so the only dialog in integration is the R244 attachment "ask" prompt.
await page.evaluate(() => { try { localStorage.setItem("geode.deleteConfirm", "false"); localStorage.removeItem("geode.attachmentDeleteMode"); localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.__geodeResolveAttachmentDeletion, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r244", name: "r244", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => app((x) => window.__app.vault.fileExists(x), p);
const create = (p, c) => app(async ([path, content]) => { try { await window.__app.vault.create(path, content); } catch {} }, [p, c]);
const orphans = (deletedNotes) => app((d) => window.__app.metadata.getOrphanedAttachments(new Set(d)), deletedNotes);
const resolve = (notes, roots, mode) => app(([n, r, m]) => window.__geodeResolveAttachmentDeletion(n, r, m), [notes, roots, mode]);

// ── seed: orphan-detection fixtures (unique r244- names, immune to the seed vault) ──
await create("r244/r244-solo.png", "img");
await create("r244/r244-shared.png", "img");
await create("r244/r244-fm.png", "img");
await create("r244/r244-bare.png", "img");
await create("r244/solo-note.md", "# solo\n![[r244-solo.png]]\n");
await create("r244/note-a.md", "# noteA\nembeds ![[r244-shared.png]] ![[r244-fm.png]] ![[r244-bare.png]]\n");
// noteB references shared.png in the BODY and fm.png ONLY in frontmatter (quoted — the parser reads
// an unquoted `k: [[X]]` as a list). This is the attachment getAttachmentMap-alone would mis-orphan.
await create("r244/note-b.md", '---\ncover: "[[r244-fm.png]]"\n---\n# noteB\nbody ref [[r244-shared.png]]\n');
// noteC has a BARE frontmatter string (no [[]]) → NOT a reference (faithful to Obsidian).
await create("r244/note-c.md", "---\nimage: r244-bare.png\n---\n# noteC\n");
await wait(400);

console.log("— getOrphanedAttachments: body-only orphan detected —");
ok("solo.png is an orphan when its only referrer (solo-note) is deleted",
  (await orphans(["r244/solo-note.md"])).includes("r244/r244-solo.png"));

console.log("— DATA-SAFETY: an attachment referenced by ANOTHER note's frontmatter is NOT an orphan —");
const oA = await orphans(["r244/note-a.md"]);
ok("fm.png is PROTECTED by note-b's frontmatter [[fm.png]] (getAttachmentMap alone would mis-delete it)",
  !oA.includes("r244/r244-fm.png"), JSON.stringify(oA));
ok("shared.png is PROTECTED by note-b's body ref", !oA.includes("r244/r244-shared.png"), JSON.stringify(oA));
ok("bare.png IS an orphan (note-c's bare `image: bare.png` is not a [[]] ref → faithful, not a referrer)",
  oA.includes("r244/r244-bare.png"), JSON.stringify(oA));
ok("deleting note-a orphans exactly {bare.png}", oA.length === 1 && oA[0] === "r244/r244-bare.png", JSON.stringify(oA));

console.log("— multi-note delete: shared refs become orphans when ALL referrers are deleted —");
const oAB = await orphans(["r244/note-a.md", "r244/note-b.md"]);
ok("deleting note-a + note-b orphans shared.png + fm.png + bare.png",
  oAB.includes("r244/r244-shared.png") && oAB.includes("r244/r244-fm.png") && oAB.includes("r244/r244-bare.png"), JSON.stringify(oAB));
ok("no .md note is ever returned as an attachment", oAB.every((p) => !p.endsWith(".md")), JSON.stringify(oAB));

// ── resolveAttachmentDeletion orchestration (folder dedup + modes) via probe ──
await create("r244-foldout.png", "img");                       // root-level, referenced only by the folder note
await create("r244fold/inner-att.png", "img");                 // INSIDE the folder
await create("r244fold/inner-note.md", "# inner\n![[inner-att.png]] and ![[r244-foldout.png]]\n");
await wait(300);

console.log("— resolveAttachmentDeletion: keep mode trashes nothing —");
ok("keep mode → [] (no attachments trashed)", (await resolve(["r244/solo-note.md"], ["r244/solo-note.md"], "keep")).length === 0);

console.log("— resolveAttachmentDeletion: delete mode returns the orphan —");
ok("delete mode → [solo.png]", JSON.stringify(await resolve(["r244/solo-note.md"], ["r244/solo-note.md"], "delete")) === JSON.stringify(["r244/r244-solo.png"]));

console.log("— folder delete: an orphan INSIDE the deleted folder is filtered out (no double-trash) —");
const oFold = await orphans(["r244fold/inner-note.md"]);
ok("orphan detection sees BOTH the inside + outside attachment",
  oFold.includes("r244fold/inner-att.png") && oFold.includes("r244-foldout.png"), JSON.stringify(oFold));
const rFold = await resolve(["r244fold/inner-note.md"], ["r244fold"], "delete");
ok("resolve with deletedRoots=[folder] drops the inside attachment, keeps the outside one",
  rFold.includes("r244-foldout.png") && !rFold.includes("r244fold/inner-att.png"), JSON.stringify(rFold));

// ── integration via app:delete-file (real trash + modes + ask dialog) ──
const setMode = async (mode) => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.click('[data-testid="settings-nav-files-and-links"]');
  await page.waitForSelector('[data-testid="settings-attachment-delete-mode"]', { timeout: 3000 });
  await page.selectOption('[data-testid="settings-attachment-delete-mode"]', mode);
  await wait(60);
  await app(() => window.__app.workspace.closeModal());
  await wait(50);
};
const deleteActive = async (path) => {
  await app((p) => window.__app.workspace.openFile(p), path);
  await wait(120);
  await app(() => window.geode.app.commands.execute("app:delete-file"));
  await wait(350);
};

console.log("— settings dropdown present, defaults to 'ask' (Obsidian 每次都询问) —");
await app(() => window.__app.workspace.openModal("settings"));
await page.click('[data-testid="settings-nav-files-and-links"]');
await page.waitForSelector('[data-testid="settings-attachment-delete-mode"]', { timeout: 3000 });
ok("attachment-delete-mode dropdown present", await app(() => !!document.querySelector('[data-testid="settings-attachment-delete-mode"]')));
ok("defaults to 'ask'", (await app(() => document.querySelector('[data-testid="settings-attachment-delete-mode"]')?.value)) === "ask");
await app(() => window.__app.workspace.closeModal());
await wait(50);

console.log("— delete mode → the orphan attachment is trashed (no dialog) —");
await create("r244/int-del.png", "img");
await create("r244/int-del.md", "# del\n![[int-del.png]]\n");
await wait(200);
await setMode("delete");
dialogMode = "accept"; dialogsSeen = 0;
await deleteActive("r244/int-del.md");
ok("delete mode shows NO attachment dialog", dialogsSeen === 0, `dialogs=${dialogsSeen}`);
ok("the note is trashed", !(await exists("r244/int-del.md")));
ok("the orphan attachment is trashed too", !(await exists("r244/int-del.png")));
ok("the trashed attachment is RECOVERABLE in .trash (not permanently deleted)",
  (await app(() => window.__app.vault.listTrash())).includes(".trash/int-del.png"));

console.log("— keep mode → the attachment is left alone —");
await create("r244/int-keep.png", "img");
await create("r244/int-keep.md", "# keep\n![[int-keep.png]]\n");
await wait(200);
await setMode("keep");
dialogsSeen = 0;
await deleteActive("r244/int-keep.md");
ok("keep mode shows no dialog", dialogsSeen === 0, `dialogs=${dialogsSeen}`);
ok("the note is trashed", !(await exists("r244/int-keep.md")));
ok("keep mode leaves the attachment in place", await exists("r244/int-keep.png"));

console.log("— ask mode + accept → the orphan is trashed (one dialog) —");
await create("r244/int-ask-a.png", "img");
await create("r244/int-ask-a.md", "# ask-a\n![[int-ask-a.png]]\n");
await wait(200);
await setMode("ask");
dialogMode = "accept"; dialogsSeen = 0;
await deleteActive("r244/int-ask-a.md");
ok("ask mode shows exactly one attachment dialog", dialogsSeen === 1, `dialogs=${dialogsSeen}`);
ok("accepted → the orphan is trashed", !(await exists("r244/int-ask-a.png")));

console.log("— ask mode + dismiss → the attachment is kept (no data lost) —");
await create("r244/int-ask-d.png", "img");
await create("r244/int-ask-d.md", "# ask-d\n![[int-ask-d.png]]\n");
await wait(200);
dialogMode = "dismiss"; dialogsSeen = 0;
await deleteActive("r244/int-ask-d.md");
ok("ask mode shows exactly one attachment dialog", dialogsSeen === 1, `dialogs=${dialogsSeen}`);
ok("dismissed → the note is still trashed", !(await exists("r244/int-ask-d.md")));
ok("dismissed → the attachment is KEPT", await exists("r244/int-ask-d.png"));

console.log("— DATA-SAFETY integration: an attachment referenced by another note's frontmatter survives delete mode —");
await create("r244/int-shared-fm.png", "img");
await create("r244/int-fa.md", "# fa\n![[int-shared-fm.png]]\n");
await create("r244/int-fb.md", '---\nbanner: "[[int-shared-fm.png]]"\n---\n# fb\n');
await wait(300);
await setMode("delete");
dialogsSeen = 0;
await deleteActive("r244/int-fa.md");
ok("delete mode shows no dialog", dialogsSeen === 0, `dialogs=${dialogsSeen}`);
ok("the note int-fa is trashed", !(await exists("r244/int-fa.md")));
ok("the attachment referenced by int-fb's frontmatter is NOT deleted (底线①)", await exists("r244/int-shared-fm.png"));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR244 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
