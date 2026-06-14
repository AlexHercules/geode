/**
 * R61 image-embed sizing E2E — browser mode (Memory vault) against dev :1420.
 * Run: node .calibration/r61-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 61 additions".
 *
 * Covers ㉒ image embed sizing `![[img.png|200]]` / `|200x100`:
 *  - reading view: <img class=geode-embed> carries width/height attrs AFTER
 *    hydration (proves hydrateEmbeds preserves them → export inherits the same);
 *  - non-numeric alias stays alt text (no width), byte-identical to pre-R61;
 *  - live preview: EmbedWidget <img class=cm-live-embed> carries width/height;
 *  - data safety: live render is pure view — the document text is unchanged.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r61", name: "r61", onload(app) { window.__app = app; } }));

const create = (p, c) => page.evaluate(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 50));
}, [p, c]);
const openMode = (p, mode) => page.evaluate(async ([path, m]) => {
  window.__app.workspace.openFile(path);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, m);
  await new Promise((r) => setTimeout(r, 200));
}, [p, mode]);
const attr = (sel, a) => page.$eval(sel, (el, n) => el.getAttribute(n), a).catch(() => null);

await create("pic.png", "fake-png-bytes");
const SRC = `# Sizing

width only: ![[pic.png|200]]

width x height: ![[pic.png|150x90]]

caption (no size): ![[pic.png|a caption]]

plain (no alias): ![[pic.png]]
`;
await create("Sizing.md", SRC);

console.log("— reading view (post-hydration): width/height attrs survive —");
await openMode("Sizing.md", "preview");
await page.waitForSelector(".preview-content img.geode-embed", { timeout: 4000 }).catch(() => {});
const rImgs = await page.$$eval(".preview-content img.geode-embed", (els) =>
  els.map((e) => ({ w: e.getAttribute("width"), h: e.getAttribute("height"), alt: e.getAttribute("alt") })),
);
ok("4 image embeds rendered", rImgs.length === 4, JSON.stringify(rImgs));
ok("width-only → width=200, no height, alt=filename",
  rImgs.some((i) => i.w === "200" && i.h === null && i.alt === "pic.png"), JSON.stringify(rImgs));
ok("width x height → width=150 height=90, alt=filename",
  rImgs.some((i) => i.w === "150" && i.h === "90" && i.alt === "pic.png"), JSON.stringify(rImgs));
ok("caption alias → no width, alt=caption (byte-identical to pre-R61)",
  rImgs.some((i) => i.w === null && i.h === null && i.alt === "a caption"), JSON.stringify(rImgs));
ok("plain embed → no width, alt=filename",
  rImgs.some((i) => i.w === null && i.h === null && i.alt === "pic.png"), JSON.stringify(rImgs));

console.log("— live preview: EmbedWidget carries width/height —");
await openMode("Sizing.md", "live");
await page.waitForSelector(".cm-content img.cm-live-embed", { timeout: 4000 }).catch(() => {});
const lImgs = await page.$$eval(".cm-content img.cm-live-embed", (els) =>
  els.map((e) => ({ w: e.getAttribute("width"), h: e.getAttribute("height") })),
);
ok("live width-only → width=200, no height",
  lImgs.some((i) => i.w === "200" && i.h === null), JSON.stringify(lImgs));
ok("live width x height → width=150 height=90",
  lImgs.some((i) => i.w === "150" && i.h === "90"), JSON.stringify(lImgs));
ok("live caption alias → no width attr (unsized widget)",
  lImgs.some((i) => i.w === null && i.h === null), JSON.stringify(lImgs));

console.log("— data safety: live render is pure view, document bytes unchanged —");
const liveText = await page.evaluate(() => {
  const p = window.__app.workspace.getActiveFile();
  return window.__app.documents.get(p)?.getText() ?? null;
});
ok("document text in live mode === source (no write)", liveText === SRC,
  JSON.stringify({ got: (liveText || "").slice(0, 30) }));

console.log("— renderer is the size oracle: bad/edge aliases stay alt text —");
const edges = await page.evaluate(() => {
  const r = (s) => window.__geodeRenderMarkdown(s, "");
  return {
    trailingX: r("![[pic.png|200x]]"),
    capitalX: r("![[pic.png|200X100]]"),
    zero: r("![[pic.png|0]]"),
    spaced: r("![[pic.png| 300 ]]"),
    huge: r("![[pic.png|999999]]"),
    bigOk: r("![[pic.png|99999]]"),
  };
});
ok("`|200x` (trailing x) → alt text, no width", edges.trailingX.includes('alt="200x"') && !edges.trailingX.includes("width="), edges.trailingX);
ok("`|200X100` (capital X) → alt text, no width", edges.capitalX.includes('alt="200X100"') && !edges.capitalX.includes("width="), edges.capitalX);
ok("`| 300 ` (whitespace) → width=300 trimmed", edges.spaced.includes('width="300"'), edges.spaced);
ok("`|0` → width=0 (faithful to Obsidian integer parse)", edges.zero.includes('width="0"'), edges.zero);
ok("`|99999` (5 digits) → width=99999 (within cap)", edges.bigOk.includes('width="99999"'), edges.bigOk);
ok("`|999999` (6 digits) → alt text, no width (cap prevents cross-path divergence)", edges.huge.includes('alt="999999"') && !edges.huge.includes("width="), edges.huge);

console.log(`\nR61 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
