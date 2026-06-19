/**
 * R102 read-only attachment viewer E2E — browser mode :1420.
 * Run: node .calibration/r102-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 102 additions" (㊽ 续续续续续).
 *
 * Non-md image/binary files open in a read-only viewer (viewType "attachment") instead
 * of the editable markdown editor — the data-safety boundary (no documents.acquire, no
 * autosave, so a binary can never be corrupted by being edited as markdown). Allowlist
 * routing (isAttachmentPath); md + text-ish files stay editable (zero regression).
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
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r102", name: "r102", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
}, [p, c]);
const open = (p) => app(([path]) => { window.__app.workspace.openFile(path); }, [p]);
const activeTab = () => app(() => { const t = window.__app.workspace.getActiveTab(); return t ? { viewType: t.viewType, filePath: t.filePath, title: t.title } : null; });
const tabCount = () => app(() => {
  const tabs = [];
  const walk = (n) => ("tabs" in n ? n.tabs.forEach((t) => tabs.push(t)) : n.children.forEach(walk));
  walk(window.__app.workspace.state.get().root);
  return tabs.length;
});

await create("note1.md", "# a note\n\nbody [[note2]]\n");
await create("note2.md", "# another\n");
// a REAL 1x1 PNG via createBinary — a fake-text "png" would fail to decode and fire the
// <img> onError handler (→ failed placeholder), so the image-render assertion needs valid bytes
await app(async () => {
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  try { await window.__app.vault.createBinary("pic.png", bin); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 60));
});
await create("doc.pdf", "%PDF-1.4 fake");
await create("data.json", '{"k":1}');
await wait(200);

// ── routing: non-md image → attachment viewType + read-only viewer DOM ──────
console.log("— routing: image → attachment view —");
await open("pic.png");
await wait(300); // let the real image decode (onError would otherwise swap to the placeholder)
ok("opening a .png sets viewType 'attachment'", (await activeTab())?.viewType === "attachment", JSON.stringify(await activeTab()));
ok("the attachment view is rendered", await app(() => !!document.querySelector('[data-testid="attachment-view"]')));
ok("an <img> (blob URL) is shown for the image", await app(() => {
  const img = document.querySelector('[data-testid="attachment-image"]');
  return !!img && (img.getAttribute("src") || "").startsWith("blob:");
}));
ok("NO markdown editor (.cm-editor) mounted for an attachment tab", await app(() => !document.querySelector('.main-content .cm-editor')));

// ── DATA SAFETY: an attachment tab never enters the editable/autosave path ──
console.log("— data safety: no editable document handle —");
ok("documents.getActiveView() is null while an attachment tab is active", (await app(() => window.__app.documents.getActiveView())) === null);

// ── non-previewable binary → read-only placeholder, not an <img> ────────────
// (R104 moved pdf/audio/video to inline preview; use a .zip which stays a placeholder)
console.log("— binary placeholder —");
await create("archive.zip", "PK fake-zip");
await wait(60);
await open("archive.zip");
await wait(200);
ok("opening a .zip sets viewType 'attachment'", (await activeTab())?.viewType === "attachment");
ok("a read-only placeholder (not an image) is shown", await app(() => !!document.querySelector('[data-testid="attachment-placeholder"]') && !document.querySelector('[data-testid="attachment-image"]')));

// ── md + text-ish files stay editable (zero regression) ─────────────────────
console.log("— md/text still editable —");
await open("note1.md");
await wait(200);
ok("opening a .md sets viewType 'markdown'", (await activeTab())?.viewType === "markdown");
ok("the markdown editor is mounted for a note", await app(() => !!document.querySelector('.main-content .cm-editor')));
await open("data.json");
await wait(200);
ok(".json (unknown/text) stays markdown editable (allowlist, not denylist)", (await activeTab())?.viewType === "markdown");

// ── attachment opens in a FRESH tab (never overwrites the active md tab) ─────
console.log("— attachment opens fresh, doesn't replace md —");
await create("fresh.png", "fake-fresh"); // a not-yet-open attachment
await wait(120);
await open("note1.md");
await wait(150);
const beforeCount = await tabCount();
await open("fresh.png");
await wait(150);
ok("opening a not-yet-open attachment from an active md tab adds a NEW tab (md tab preserved)", (await tabCount()) === beforeCount + 1, `before=${beforeCount} after=${await tabCount()}`);
ok("re-opening the same attachment reuses its tab (dedup)", await (async () => { const c = await tabCount(); await open("fresh.png"); await wait(120); return (await tabCount()) === c; })());

// ── rename retargets the open attachment tab ────────────────────────────────
console.log("— rename retargets attachment tab —");
await open("pic.png");
await wait(150);
await app(async () => { await window.__app.vault.rename("pic.png", "renamed.png"); await new Promise((r) => setTimeout(r, 80)); });
await wait(200);
ok("renaming the attachment file retargets its tab filePath", (await app(() => {
  const tabs = [];
  const walk = (n) => ("tabs" in n ? n.tabs.forEach((t) => tabs.push(t)) : n.children.forEach(walk));
  walk(window.__app.workspace.state.get().root);
  return tabs.some((t) => t.viewType === "attachment" && t.filePath === "renamed.png");
})), "expected an attachment tab at renamed.png");
ok("no stale attachment tab left at the old path", await app(() => {
  const tabs = [];
  const walk = (n) => ("tabs" in n ? n.tabs.forEach((t) => tabs.push(t)) : n.children.forEach(walk));
  walk(window.__app.workspace.state.get().root);
  return !tabs.some((t) => t.filePath === "pic.png");
}));

// ── delete closes the open attachment tab ───────────────────────────────────
console.log("— delete closes attachment tab —");
await app(async () => { await window.__app.vault.remove("renamed.png"); await new Promise((r) => setTimeout(r, 80)); });
await wait(200);
ok("deleting the attachment file closes its tab", await app(() => {
  const tabs = [];
  const walk = (n) => ("tabs" in n ? n.tabs.forEach((t) => tabs.push(t)) : n.children.forEach(walk));
  walk(window.__app.workspace.state.get().root);
  return !tabs.some((t) => t.filePath === "renamed.png");
}));

// ── persist: attachment tab written to localStorage + survives the sanitize round-trip ──
// (browser MemoryVault files don't survive a real reload, so test the SAVE blob directly +
//  capture→sanitize→apply with the file still present — exactly what restore() does at startup)
console.log("— persist (save side + sanitize round-trip) —");
await open("doc.pdf");
await wait(150);
const persisted = await app(() => { try { return localStorage.getItem("geode.workspace.v1"); } catch { return null; } });
ok("attachment tab is persisted to localStorage (would restore on desktop where files survive)", persisted !== null && persisted.includes('"viewType":"attachment"') && persisted.includes('"doc.pdf"'), (persisted ?? "").slice(0, 160));
await app(() => {
  const ws = window.__app.workspace;
  ws.applyLayout(ws.captureLayout(), (p) => window.__app.vault.fileExists(p));
});
await wait(150);
ok("attachment tab survives capture→sanitize→apply (sanitizeTab accepts 'attachment')", (await activeTab())?.viewType === "attachment", JSON.stringify(await activeTab()));

// ── review fix 1a: a persisted 'markdown' tab on a .png restores READ-ONLY (no edit→corrupt) ──
// (simulates a pre-R102 blob where clicking a .png made an editable markdown tab; sanitizeTab
//  must RE-derive viewType from the path so the binary never returns to the autosave path)
console.log("— review fix 1a: restore re-derives viewType from path —");
await create("restore.png", "fake-restore-png");
await wait(120);
await app(() => {
  const ws = window.__app.workspace;
  const l = JSON.parse(JSON.stringify(ws.captureLayout()));
  const walk = (n) => { if ("tabs" in n) n.tabs.forEach((tt) => { if (tt.filePath === "restore.png") tt.viewType = "markdown"; }); else n.children.forEach(walk); };
  // ensure a tab for restore.png exists, then force it to the old editable type
  ws.openFile("restore.png");
  const l2 = JSON.parse(JSON.stringify(ws.captureLayout()));
  walk(l2.root);
  ws.applyLayout(l2, (p) => window.__app.vault.fileExists(p));
  void l;
});
await wait(150);
ok("a persisted 'markdown' tab on a .png restores as read-only attachment (fix 1a)", await app(() => {
  const tabs = []; const walk = (n) => ("tabs" in n ? n.tabs.forEach((t) => tabs.push(t)) : n.children.forEach(walk));
  walk(window.__app.workspace.state.get().root);
  return tabs.find((t) => t.filePath === "restore.png")?.viewType === "attachment";
}), "expected restore.png tab re-derived to attachment");

// ── review fix 1b: cross-type rename (note.md → note.png) flips the tab to read-only ──
console.log("— review fix 1b: cross-type rename re-derives viewType —");
await create("typed.md", "# was a note\n");
await open("typed.md");
await wait(150);
ok("the .md opens editable (markdown) before rename", (await activeTab())?.viewType === "markdown");
await app(async () => { await window.__app.vault.rename("typed.md", "typed.png"); await new Promise((r) => setTimeout(r, 80)); });
await wait(200);
ok("renaming note.md → note.png flips the open tab to read-only attachment (fix 1b)", await app(() => {
  const tabs = []; const walk = (n) => ("tabs" in n ? n.tabs.forEach((t) => tabs.push(t)) : n.children.forEach(walk));
  walk(window.__app.workspace.state.get().root);
  return tabs.find((t) => t.filePath === "typed.png")?.viewType === "attachment";
}), "expected typed.png tab flipped to attachment");

console.log(`\nR102 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
