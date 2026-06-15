/**
 * R74 Slides presentation E2E — browser mode (Memory vault) against dev :1420.
 * Run: node .calibration/r74-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 74 additions" (㊱).
 *
 * Covers: splitSlides (via __geodeSplitSlides) — frontmatter stripped, code
 * fences respected, no-separator = single slide — AND the full-screen overlay:
 * open via the slides modal, page counter, ←/→ navigation, nav-button disabled
 * states, content render, and Esc closing the deck.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r74", name: "r74", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeSplitSlides, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 30));
}, [p, c]);
const split = (p) => app(([path]) => window.__geodeSplitSlides(path), [p]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (testid) => app(([id]) => {
  const el = document.querySelector(`[data-testid="${id}"]`);
  return el ? el.textContent : null;
}, [testid]);
const exists = (testid) => app(([id]) => !!document.querySelector(`[data-testid="${id}"]`), [testid]);

const FENCE = "```";
await create("deck.md", "# One\n\nfirst\n\n---\n\n# Two\n\nsecond\n\n---\n\n# Three\n\nthird\n");
await create("fmdeck.md", `---\ntitle: T\ntags: [a]\n---\n# A\n\naaa\n\n---\n\n# B\n\nbbb\n`);
await create("fencedeck.md", `# Code\n\n${FENCE}\nx\n---\ny\n${FENCE}\n\nstill one slide\n`);
await create("single.md", "# Solo\n\nno separators here\n");
await wait(400);

// ── splitSlides logic (via probe hook) ──────────────────────────────────────
console.log("— splitSlides —");
ok("3-slide note → 3 slides", (await split("deck.md")).length === 3);
ok("frontmatter + 2 slides → 2 (no ghost from fm fences)", (await split("fmdeck.md")).length === 2);
ok("--- inside code fence → NOT split (1 slide)", (await split("fencedeck.md")).length === 1);
ok("no separators → 1 slide", (await split("single.md")).length === 1);
const s0 = await split("deck.md");
ok("first slide carries its own content only", s0[0].includes("# One") && !s0[0].includes("# Two"), JSON.stringify(s0[0]));

// ── overlay: open, counter, render ──────────────────────────────────────────
console.log("— overlay mount + counter —");
await app(async () => {
  window.__app.workspace.openFile("deck.md");
  await new Promise((r) => setTimeout(r, 100));
  window.__app.workspace.openModal("slides");
  await new Promise((r) => setTimeout(r, 250));
});
ok("overlay mounts", await exists("slides-overlay"));
ok("counter shows 1 / 3", (await text("slides-counter"))?.replace(/\s+/g, " ").trim() === "1 / 3", await text("slides-counter"));
ok("first page renders heading One", (await app(() => document.querySelector('[data-testid="slides-page"]')?.innerHTML))?.includes("One"));
ok("prev button disabled on first page", await app(() => document.querySelector('[data-testid="slides-prev"]')?.disabled === true));

// ── keyboard navigation ─────────────────────────────────────────────────────
console.log("— keyboard nav —");
await page.keyboard.press("ArrowRight");
await wait(120);
ok("ArrowRight → counter 2 / 3", (await text("slides-counter"))?.replace(/\s+/g, " ").trim() === "2 / 3", await text("slides-counter"));
ok("page 2 renders heading Two", (await app(() => document.querySelector('[data-testid="slides-page"]')?.innerHTML))?.includes("Two"));
await page.keyboard.press("ArrowRight");
await wait(120);
ok("ArrowRight again → 3 / 3", (await text("slides-counter"))?.replace(/\s+/g, " ").trim() === "3 / 3", await text("slides-counter"));
ok("next button disabled on last page", await app(() => document.querySelector('[data-testid="slides-next"]')?.disabled === true));
await page.keyboard.press("ArrowRight");
await wait(120);
ok("ArrowRight on last page clamps (stays 3 / 3)", (await text("slides-counter"))?.replace(/\s+/g, " ").trim() === "3 / 3", await text("slides-counter"));
await page.keyboard.press("ArrowLeft");
await wait(120);
ok("ArrowLeft → back to 2 / 3", (await text("slides-counter"))?.replace(/\s+/g, " ").trim() === "2 / 3", await text("slides-counter"));

// ── next-button click also advances ─────────────────────────────────────────
console.log("— button nav —");
await app(() => document.querySelector('[data-testid="slides-next"]')?.click());
await wait(120);
ok("next button click → 3 / 3", (await text("slides-counter"))?.replace(/\s+/g, " ").trim() === "3 / 3", await text("slides-counter"));

// ── Esc closes the deck ─────────────────────────────────────────────────────
console.log("— Esc close —");
await page.keyboard.press("Escape");
await wait(150);
ok("Esc closes overlay (modal cleared)", (await exists("slides-overlay")) === false);
ok("workspace modal is null after Esc", await app(() => window.__app.workspace.state.get().modal === null));

// ── data-safety (review CONFIRMED-1): editor focused + slides open + typing ──
// must NOT mutate the note behind the opaque overlay (focus is stolen + trapped)
console.log("— data-safety: no silent mutation —");
await create("safe.md", "# Hello\n\nbody line\n");
await app(async () => {
  window.__app.workspace.openFile("safe.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 300));
});
// focus the editor, then open the deck
await page.locator('[data-testid="cm-editor"] .cm-content').click().catch(() => {});
await wait(100);
const before = await app(() => window.__app.documents.get("safe.md")?.getText());
await app(async () => { window.__app.workspace.openModal("slides"); await new Promise((r) => setTimeout(r, 250)); });
await page.keyboard.type("ZZZ ");
await page.keyboard.press("Tab");
await page.keyboard.type("QQQ");
await wait(150);
const after = await app(() => window.__app.documents.get("safe.md")?.getText());
ok("typing during presentation does NOT mutate the note", before === after, `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
ok("active element is not the editor during presentation", await app(() => !document.activeElement?.classList.contains("cm-content")));
await page.keyboard.press("Escape");
await wait(150);

// ── embed render (contract: embeds show in slides) ──────────────────────────
console.log("— embed render —");
await create("pic.png", "x");
await create("embeddeck.md", "# Pic slide\n\n![[pic.png]]\n");
await wait(200);
await app(async () => {
  window.__app.workspace.openFile("embeddeck.md");
  await new Promise((r) => setTimeout(r, 100));
  window.__app.workspace.openModal("slides");
  await new Promise((r) => setTimeout(r, 400));
});
ok("image embed hydrates to a blob src in the slide", await app(() => {
  const img = document.querySelector('[data-testid="slides-page"] img');
  return !!img && /^blob:/.test(img.getAttribute("src") || "");
}));
await page.keyboard.press("Escape");
await wait(120);

// ── close button also closes ────────────────────────────────────────────────
console.log("— close button —");
await app(async () => {
  window.__app.workspace.openModal("slides");
  await new Promise((r) => setTimeout(r, 200));
});
ok("overlay re-mounts", await exists("slides-overlay"));
await app(() => document.querySelector('[data-testid="slides-close"]')?.click());
await wait(120);
ok("close button closes overlay", (await exists("slides-overlay")) === false);

console.log(`\nR74 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
