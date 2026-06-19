/**
 * R101 attachments-as-graph-nodes E2E — browser mode :1420.
 * Run: node .calibration/r101-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 101 additions" (㊵ 续续续续).
 *
 * An "Attachments" toggle merges attachment nodes (id `attachment:<path>`, yellow) +
 * note→attachment edges into the graph, client-side (buildAttachmentGraph over
 * metadata.getAttachmentMap), no getGraph shape change. Default OFF (zero regression).
 * Pure front-end, no .md writes. Mirrors R99 (tags). The getGraph fix: an attachment
 * reference no longer masquerades as an `unresolved:` ghost note.
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
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); localStorage.removeItem("geode.graphPrefs"); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r101", name: "r101", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeGraphAttachments && !!window.__geodeGraphPrefs, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
}, [p, c]);
const lsPrefs = () => app(() => { try { return JSON.parse(localStorage.getItem("geode.graphPrefs")); } catch { return null; } });
const gp = (raw) => app(([r]) => window.__geodeGraphPrefs(r), [raw]);
const legendNodes = () => app(() => {
  const el = document.querySelector('[data-testid="graph-legend"]');
  if (!el) return null;
  const m = el.textContent.match(/(\d[\d,]*)/);
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
});

// ── attachment-graph construction (probe) ───────────────────────────────────
console.log("— buildAttachmentGraph (probe) —");
// a real non-md attachment file + notes referencing it two different ways
await create("r101pic.png", "fake-png-bytes");
await create("n1.md", "embed: ![[r101pic.png]]\n");      // wikilink embed
await create("n2.md", "link: [[r101pic.png]]\n");          // bare wikilink to attachment
await create("n3.md", "no attachment here, [[n1]] only\n"); // references a NOTE, not an attachment
await wait(350);
const ag = await app(() => window.__geodeGraphAttachments());
const deg = (id) => ag.nodes.find((n) => n.id === id)?.degree;
ok("attachment node has degree 2 (n1 + n2 reference it)", deg("attachment:r101pic.png") === 2, JSON.stringify(ag.nodes));
ok("attachment node id is `attachment:<path>` prefixed", ag.nodes.some((n) => n.id === "attachment:r101pic.png"), JSON.stringify(ag.nodes));
ok("no attachment node for the note-only ref n3", !ag.nodes.some((n) => n.id.includes("n3")), JSON.stringify(ag.nodes));

// ── getGraph no longer ghosts attachment refs (the doubling fix) ─────────────
console.log("— getGraph: attachment ref is NOT a ghost note —");
const base = await app(() => window.__app.metadata.getGraph());
ok("no `unresolved:r101pic.png` ghost note in the base graph", !base.nodes.some((n) => n.id === "unresolved:r101pic.png"), JSON.stringify(base.nodes.filter((n) => !n.resolved).map((n) => n.id)));
ok("no `attachment:` node in the BASE graph (only added by the toggle)", !base.nodes.some((n) => n.id.startsWith("attachment:")));
ok("the genuine note n1 IS still a base node", base.nodes.some((n) => n.id === "n1.md"));

// ── prefs: showAttachments default OFF + backward compat ─────────────────────
console.log("— prefs parse —");
ok("display.attachments defaults false (zero regression)", (await gp(null)).display.attachments === false);
ok("old blob without 'attachments' → false (backward compat)", (await gp(JSON.stringify({ mode: "global" }))).display.attachments === false);
ok("explicit attachments:true parses", (await gp(JSON.stringify({ display: { attachments: true } }))).display.attachments === true);
ok("tags + attachments are independent flags", (await gp(JSON.stringify({ display: { tags: true } }))).display.attachments === false);

// ── toggle UI + persistence + legend node count ─────────────────────────────
console.log("— Attachments toggle (real graph) —");
await app(async () => { window.__app.workspace.openGraph(); await new Promise((r) => setTimeout(r, 600)); });
await page.locator('[data-testid="graph-settings-toggle"]').click();
await wait(200);
ok("Attachments toggle present in graph settings", await app(() => !!document.querySelector('[data-testid="graph-attachments"]')));
const before = await legendNodes();
ok("legend shows note nodes before attachments are on", before !== null && before >= 3, JSON.stringify(before));
await page.click('[data-testid="graph-attachments"]');
await wait(400); // rebuild + settle
ok("toggling Attachments on persists display.attachments:true", (await lsPrefs())?.display?.attachments === true);
const after = await legendNodes();
ok("legend node count grows by exactly the attachment-node count", after === before + ag.nodes.length, `before=${before} after=${after} att=${ag.nodes.length}`);

// ── clicking an attachment node OPENS the real file, never a broken "attachment:" tab ──
console.log("— attachment-node click routing (R99 lesson: audit click handler) —");
const noAttTab = () => app(() => {
  const tabs = [];
  const walk = (node) => ("tabs" in node ? node.tabs.forEach((t) => tabs.push(t)) : node.children.forEach(walk));
  walk(window.__app.workspace.state.get().root);
  return !tabs.some((t) => (t.filePath ?? "").startsWith("attachment:"));
});
const clicked = await app(() => window.__geodeGraphClickNode("attachment:r101pic.png"));
await wait(200);
ok("the click hook found the attachment node (attachments are on)", clicked === true);
ok("clicking an attachment node opens the REAL file (prefix stripped)", (await app(() => window.__app.workspace.getActiveTab()?.filePath)) === "r101pic.png");
ok("clicking an attachment node creates NO broken 'attachment:' file tab", await noAttTab());
// opening the attachment replaced the graph tab → re-open the graph for the note-click check
await app(async () => { window.__app.workspace.openGraph(); await new Promise((r) => setTimeout(r, 400)); });
await page.waitForFunction(() => !!window.__geodeGraphClickNode, null, { timeout: 3000 });
await app(() => window.__geodeGraphClickNode("n1.md"));
await wait(200);
ok("clicking a NOTE node still opens that note", (await app(() => window.__app.workspace.getActiveTab()?.filePath)) === "n1.md");

// ── toggle off returns to the note-only count ───────────────────────────────
await app(async () => { window.__app.workspace.openGraph(); await new Promise((r) => setTimeout(r, 400)); });
await page.locator('[data-testid="graph-settings-toggle"]').click();
await wait(150);
await page.click('[data-testid="graph-attachments"]');
await wait(400);
ok("toggling Attachments off persists display.attachments:false", (await lsPrefs())?.display?.attachments === false);
ok("legend node count returns to the note-only count", (await legendNodes()) === before, JSON.stringify(await legendNodes()));

// ── review fix #1: a markdown link [x](doc.pdf) indexes the attachment, same as a wikilink ──
console.log("— review fix #1: markdown attachment link (decoded resolution) —");
await create("r101doc.pdf", "fake-pdf-bytes");
await create("n4.md", "see [the doc](r101doc.pdf) for details\n");
await wait(300);
const agMd = await app(() => window.__geodeGraphAttachments());
ok("markdown link to an attachment yields an attachment node (not just wikilinks)", agMd.nodes.some((n) => n.id === "attachment:r101doc.pdf"), JSON.stringify(agMd.nodes));

// ── review fix #2: an attachment created AFTER its reference makes the node appear ──
// (non-md create must bump the index revision, else getAttachmentMap returns a stale cache)
console.log("— review fix #2: attachment added after the reference (revision bump) —");
await create("n5.md", "a [[r101late.png]] that does not exist yet\n");
await wait(250);
const beforeLate = await app(() => window.__geodeGraphAttachments()); // caches getAttachmentMap at rev R
ok("no node while the attachment is missing", !beforeLate.nodes.some((n) => n.id === "attachment:r101late.png"), JSON.stringify(beforeLate.nodes));
await create("r101late.png", "fake-late-png-bytes");
await wait(300);
const afterLate = await app(() => window.__geodeGraphAttachments());
ok("creating the attachment later makes its node appear (non-md create bumps revision)", afterLate.nodes.some((n) => n.id === "attachment:r101late.png"), JSON.stringify(afterLate.nodes));

console.log(`\nR101 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
