/**
 * R187 — G3 partial→done: directional pane focus commands
 * (Obsidian focus-{left,right,top,bottom}-tab-group) — browser :1420.
 * Run: node .calibration/r187-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 187 additions".
 *
 * Builds a deterministic split layout  row[ column[A, C], B ]  →
 *   A = top-left (0,0,.5,.5) · C = bottom-left (0,.5,.5,.5) · B = right full-height (.5,0,.5,1)
 * then drives the 4 directional-focus commands and asserts the chosen neighbour.
 * Pure pane-state only — no vault/doc write, so no byte regression here.
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
// clean slate: english + no persisted split layout → deterministic single pane
await page.evaluate(() => {
  localStorage.setItem("geode.locale", "en");
  localStorage.removeItem("geode.workspace.v1");
});
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r187", name: "r187", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const exec = (id) => app(([cid]) => window.__app.commands.execute(cid), [id]);

const DIRS = [
  { id: "app:focus-left-pane", dir: "left" },
  { id: "app:focus-right-pane", dir: "right" },
  { id: "app:focus-top-pane", dir: "top" },
  { id: "app:focus-bottom-pane", dir: "bottom" },
];
const cmdFor = (dir) => DIRS.find((d) => d.dir === dir).id;

console.log("— all 4 directional commands registered + names resolve —");
const reg = await app(([ids]) => ids.map((id) => {
  const c = window.__app.commands.list().find((x) => x.id === id);
  return { id, present: !!c, name: c ? c.name() : null };
}), [DIRS.map((d) => d.id)]);
for (const r of reg) {
  ok(`${r.id} registered`, r.present);
  ok(`${r.id} name resolves (not raw key)`, !!r.name && !r.name.startsWith("cmd."), r.name);
}

console.log("— directional commands carry NO default hotkey (Obsidian parity) —");
for (const { id } of DIRS) {
  ok(`${id} has no default hotkey`, !(await app(([cid]) => window.__app.commands.getEffectiveHotkey(cid), [id])));
}

console.log("— single pane: directional focus is a safe no-op —");
await app(() => window.__app.workspace.openFile("Welcome.md"));
await wait(120);
const single = await app(() => window.__app.workspace.state.get().activePaneId);
await exec("app:focus-right-pane");
await wait(60);
ok("single-pane focus-right stays put", (await app(() => window.__app.workspace.state.get().activePaneId)) === single);

console.log("— build layout  row[ column[A, C], B ] —");
const layout = await app(() => {
  const ws = window.__app.workspace;
  const A = ws.state.get().activePaneId;          // the lone pane holding Welcome.md
  const B = ws.splitActivePane("row");            // A | B  (B to the right, now active)
  ws.setActivePane(A);
  const C = ws.splitActivePane("column");         // A stacked over C on the left, C active
  return { A, B, C };
});
const { A, B, C } = layout;
ok("split produced 3 distinct panes", A && B && C && A !== B && B !== C && A !== C, JSON.stringify(layout));

// sanity: geometry matches the intended grid (A top-left, C bottom-left, B right full-height)
const rects = await app(() => {
  // mirror leafRects in-page from the live tree (independent recompute = cross-check)
  const walk = (n, r) => {
    if (n.kind === "leaf") return [{ id: n.id, ...r }];
    let off = 0; const out = [];
    n.children.forEach((c, i) => {
      const f = n.sizes[i] ?? 1 / n.children.length;
      const cr = n.direction === "row"
        ? { x: r.x + off * r.w, y: r.y, w: f * r.w, h: r.h }
        : { x: r.x, y: r.y + off * r.h, w: r.w, h: f * r.h };
      out.push(...walk(c, cr)); off += f;
    });
    return out;
  };
  const map = {};
  for (const lr of walk(window.__app.workspace.state.get().root, { x: 0, y: 0, w: 1, h: 1 })) map[lr.id] = lr;
  return map;
});
const near = (a, b) => Math.abs(a - b) < 1e-6;
ok("A is top-left", near(rects[A]?.x, 0) && near(rects[A]?.y, 0) && near(rects[A]?.w, 0.5) && near(rects[A]?.h, 0.5), JSON.stringify(rects[A]));
ok("C is bottom-left", near(rects[C]?.x, 0) && near(rects[C]?.y, 0.5) && near(rects[C]?.h, 0.5), JSON.stringify(rects[C]));
ok("B is right full-height", near(rects[B]?.x, 0.5) && near(rects[B]?.h, 1), JSON.stringify(rects[B]));

// focusFrom: set active = start, run the directional command, return the resulting active pane
async function focusFrom(start, dir) {
  await app(([s]) => window.__app.workspace.setActivePane(s), [start]);
  await exec(cmdFor(dir));
  await wait(50);
  return app(() => window.__app.workspace.state.get().activePaneId);
}

console.log("— directional focus picks the correct neighbour —");
ok("A → right = B", (await focusFrom(A, "right")) === B);
ok("A → bottom = C", (await focusFrom(A, "bottom")) === C);
ok("A → left = no-op (A)", (await focusFrom(A, "left")) === A);
ok("A → top = no-op (A)", (await focusFrom(A, "top")) === A);

ok("C → top = A", (await focusFrom(C, "top")) === A);
ok("C → right = B", (await focusFrom(C, "right")) === B);
ok("C → bottom = no-op (C)", (await focusFrom(C, "bottom")) === C);
ok("C → left = no-op (C)", (await focusFrom(C, "left")) === C);

ok("B → left = A (topmost, layout-order tiebreak)", (await focusFrom(B, "left")) === A);
ok("B → top = no-op (B, full height)", (await focusFrom(B, "top")) === B);
ok("B → right = no-op (B)", (await focusFrom(B, "right")) === B);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR187: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
