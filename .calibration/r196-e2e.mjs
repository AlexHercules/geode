/**
 * R196 — G3 missing→done: editor:add-alias / editor:add-tag (Obsidian add-alias /
 * add-tag) — browser :1420. Run: node .calibration/r196-e2e.mjs   (dev server up)
 * Contract: docs/ARCHITECTURE.md "Round 196 additions".
 *
 * Extends the R22 add-property one-shot Store with an optional key; PropertiesPanel
 * consumes it via the vetted submitAdd path (creates frontmatter if needed, adds the
 * named property, focuses its value, dedups an existing key). Verifies the property lands
 * in the doc's frontmatter.
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
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r196", name: "r196", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const exec = (id) => app(([cid]) => window.__app.commands.execute(cid), [id]);
const docOf = () => app(() => window.__app.documents.getActiveView()?.view.state.doc.toString() ?? null);

const IDS = ["editor:add-alias", "editor:add-tag"];
console.log("— both commands registered + names resolve + no default hotkey —");
const reg = await app(([ids]) => ids.map((id) => {
  const c = window.__app.commands.list().find((x) => x.id === id);
  return { id, present: !!c, name: c ? c.name() : null, hk: window.__app.commands.getEffectiveHotkey(id) || null };
}), [IDS]);
for (const r of reg) {
  ok(`${r.id} registered`, r.present);
  ok(`${r.id} name resolves (not raw key)`, !!r.name && !r.name.startsWith("cmd."), r.name);
  ok(`${r.id} has no default hotkey`, r.hk === null, r.hk);
}

// open a note with NO frontmatter, in live mode
await app(async () => { try { await window.__app.vault.create("r196props.md", "# Note\nbody\n"); } catch { /* exists */ } });
await app(() => {
  window.__app.workspace.openFile("r196props.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(150);

console.log("— add-alias creates frontmatter + an aliases property —");
ok("starts with no frontmatter", !(await docOf()).startsWith("---"));
await exec("editor:add-alias");
await wait(400); // panel mounts (properties-in-document → visible) + consumes + applyEdit
let doc = await docOf();
ok("doc now has a frontmatter block", doc.startsWith("---\n"), JSON.stringify(doc));
ok("frontmatter contains an aliases property", /\baliases\s*:/.test(doc), JSON.stringify(doc));
ok("note body preserved", doc.includes("# Note\nbody\n"), JSON.stringify(doc));

console.log("— add-tag adds a tags property (alongside aliases) —");
await exec("editor:add-tag");
await wait(400);
doc = await docOf();
ok("frontmatter contains a tags property", /\btags\s*:/.test(doc), JSON.stringify(doc));
ok("aliases still present (add-tag did not clobber it)", /\baliases\s*:/.test(doc), JSON.stringify(doc));

console.log("— add-alias on an existing aliases key does NOT duplicate it —");
await exec("editor:add-alias");
await wait(400);
doc = await docOf();
const aliasCount = (doc.match(/\baliases\s*:/g) || []).length;
ok("exactly one aliases property (dedup via submitAdd)", aliasCount === 1, `count=${aliasCount}`);

console.log("— no active file: command is a safe no-op —");
await app(() => window.__app.workspace.openGraph());
await wait(150);
await exec("editor:add-alias"); // graph tab → getActiveTab().filePath null → guarded
await wait(120);
ok("add-alias on graph tab does not throw", true);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR196: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
