/**
 * R262 — typed frontmatter for the Obsidian-compat metadataCache (js-yaml-backed).
 * Part A (compat projection, ALWAYS runs): app.metadataCache.getFileCache(file).frontmatter
 *   now carries TYPED YAML values (number/boolean/float/nested map/list), like real Obsidian —
 *   not the stringified core fields. Includes the malformed-YAML FALLBACK (no crash) and the
 *   getAllTags consumer regression guard.
 * Part B (marquee Dataview proof): real Dataview 0.5.70 — `TABLE rating WHERE rating > 3` now
 *   filters CORRECTLY (was the confirmed R262 bug: string "5">3 is type-ordered always-true →
 *   every row leaked), numeric SORT orders by value, boolean WHERE filters. Needs the bundle at
 *   .calibration/dataview/ (see r261-e2e header); skipped if absent.
 * Run: node .calibration/r262-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 262 additions".
 */
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const DV_DIR = join(__dir, "dataview");
const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
const browser = await chromium.launch();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Part A: compat metadataCache typed frontmatter (no Dataview needed) ----------
console.log("— Part A: metadataCache.getFileCache().frontmatter is TYPED (+ fallback + getAllTags) —");
{
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  // tiny probe plugin to exercise getAllTags() from the real obsidian module
  await page.addInitScript(() => {
    const mainJs = [
      "const obs = require('obsidian');",
      "module.exports = class extends obs.Plugin {",
      "  onload() { window.__r262getAllTags = (p) => {",
      "    const f = this.app.vault.getAbstractFileByPath(p); if (!f) return null;",
      "    return obs.getAllTags(this.app.metadataCache.getFileCache(f));",
      "  }; window.__r262ready = true; }",
      "  onunload() {}",
      "};",
    ].join("\n");
    window.__geodeObsidianPlugins = [{ dir: "r262-probe", manifestJson: JSON.stringify({ id: "r262-probe", name: "R262 Probe", version: "1.0.0", minAppVersion: "0.0.1" }), mainJs, stylesCss: null, dataJson: null }];
    window.__geodeObsidianConfig = { "community-plugins.json": '["r262-probe"]' };
    try { localStorage.setItem("geode.locale", "en"); } catch {}
  });
  await page.goto(BASE_URL);
  await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__r262ready === true, null, { timeout: 8000 });

  await page.evaluate(async () => {
    const v = window.geode.app.vault;
    const mk = async (p, c) => { try { await v.create(p, c); } catch {} };
    await mk("r262t-rich.md", "---\ntitle: Alpha\nrating: 5\nscore: 3.5\npublished: true\nmissing: null\ntags: [book, fiction]\nmeta:\n  a: 1\n  b: hello\n---\n\n#bodytag body\n");
    await mk("r262t-bad.md", "---\ntitle: Bad\nweird: [unclosed\n---\n\nbody\n");
  });

  // warm content into the LRU then read typed cache (heals the no-content transient)
  const rich = await page.evaluate(async () => {
    const app = window.app;
    const f = app.vault.getAbstractFileByPath("r262t-rich.md");
    try { await app.vault.read(f); } catch {}
    let c = null;
    for (let i = 0; i < 8; i++) {
      c = app.metadataCache.getFileCache(f);
      if (c && c.frontmatter && typeof c.frontmatter.rating === "number") break;
      await new Promise((r) => setTimeout(r, 120));
    }
    const fm = c?.frontmatter ?? {};
    return {
      title: fm.title, titleType: typeof fm.title,
      rating: fm.rating, ratingType: typeof fm.rating,
      score: fm.score, scoreType: typeof fm.score,
      published: fm.published, publishedType: typeof fm.published,
      missingType: fm.missing === null ? "null" : typeof fm.missing,
      tagsIsArray: Array.isArray(fm.tags), tags: fm.tags,
      nested: fm.meta && typeof fm.meta === "object" ? fm.meta.a : "no-nested",
      nestedType: fm.meta ? typeof fm.meta.a : "none",
    };
  });
  ok("string stays string (title='Alpha')", rich.title === "Alpha" && rich.titleType === "string", JSON.stringify(rich));
  ok("number is a NUMBER (rating === 5, not '5')", rich.rating === 5 && rich.ratingType === "number", JSON.stringify(rich));
  ok("float is a number (score === 3.5)", rich.score === 3.5 && rich.scoreType === "number");
  ok("boolean is a BOOLEAN (published === true)", rich.published === true && rich.publishedType === "boolean");
  ok("null stays null (missing)", rich.missingType === "null");
  ok("inline list → array of strings (tags)", rich.tagsIsArray && rich.tags?.includes("book") && rich.tags?.includes("fiction"), JSON.stringify(rich.tags));
  ok("nested map preserved (meta.a === 1, number)", rich.nested === 1 && rich.nestedType === "number", JSON.stringify(rich));

  // getAllTags consumer regression: merges body #bodytag + frontmatter tags
  const allTags = await page.evaluate(() => window.__r262getAllTags("r262t-rich.md"));
  ok("getAllTags() still merges body+frontmatter tags (consumer unbroken)",
    Array.isArray(allTags) && allTags.includes("#book") && allTags.includes("#fiction") && allTags.includes("#bodytag"),
    JSON.stringify(allTags));

  // malformed YAML → FALLBACK to stringified fields, never throws / never breaks the cache
  const bad = await page.evaluate(async () => {
    const app = window.app;
    const f = app.vault.getAbstractFileByPath("r262t-bad.md");
    try { await app.vault.read(f); } catch {}
    await new Promise((r) => setTimeout(r, 200));
    let threw = false, fm = null;
    try { fm = app.metadataCache.getFileCache(f)?.frontmatter ?? null; } catch (e) { threw = true; }
    return { threw, hasFm: !!fm, title: fm?.title, isObject: fm && typeof fm === "object" };
  });
  ok("malformed YAML does not throw (getFileCache safe)", bad.threw === false, JSON.stringify(bad));
  ok("malformed YAML falls back to stringified fields (title='Bad' present)", bad.isObject === true && bad.title === "Bad", JSON.stringify(bad));
  ok("Part A: no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  await page.close();
}

// ---------- Part B: real Dataview typed numeric/boolean queries ----------
if (!existsSync(join(DV_DIR, "main.js"))) {
  console.log("— Part B SKIPPED: Dataview bundle not at .calibration/dataview/ (see r261-e2e header) —");
} else {
  console.log("— Part B: real Dataview — typed WHERE/SORT now correct (was string-coercion bug) —");
  const mainJs = readFileSync(join(DV_DIR, "main.js"), "utf8");
  const manifestJson = readFileSync(join(DV_DIR, "manifest.json"), "utf8");
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.addInitScript(({ mainJs, manifestJson }) => {
    window.__geodeObsidianPlugins = [{ dir: "dataview", manifestJson, mainJs, stylesCss: null, dataJson: null }];
    window.__geodeObsidianConfig = { "community-plugins.json": '["dataview"]' };
    try { localStorage.setItem("geode.locale", "en"); } catch {}
  }, { mainJs, manifestJson });
  await page.goto(BASE_URL);
  await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
  await page.waitForFunction(() => (window.geode?.app?.obsidianLoadReport?.get?.() ?? []).some((r) => r.id === "dataview"), null, { timeout: 12000 });
  const report = await page.evaluate(() => (window.geode.app.obsidianLoadReport.get() ?? []).find((r) => r.id === "dataview"));
  ok("Dataview enabled", report?.status === "enabled", JSON.stringify(report));

  // ratings 2/10/1 in creation order: numeric DESC (10,2,1) differs from lexical DESC
  // ("2","10","1") so SORT genuinely proves NUMERIC ordering, not string.
  await page.evaluate(async () => {
    const v = window.geode.app.vault;
    const mk = async (p, c) => { try { await v.create(p, c); } catch {} };
    await mk("r262d-alpha.md", "---\nrating: 2\npublished: true\n---\nalpha\n");
    await mk("r262d-beta.md", "---\nrating: 10\npublished: false\n---\nbeta\n");
    await mk("r262d-gamma.md", "---\nrating: 1\npublished: true\n---\ngamma\n");
  });
  // warm the typed metadataCache for each data file, then let Dataview's async index
  // ingest them before the first query (else the first query sees rating=undefined → 0 rows).
  await page.evaluate(async () => {
    const app = window.app;
    for (const p of ["r262d-alpha.md", "r262d-beta.md", "r262d-gamma.md"]) {
      const f = app.vault.getAbstractFileByPath(p);
      try { await app.vault.read(f); } catch {}
      app.metadataCache.getFileCache(f);
    }
  });
  await wait(1500);

  async function tableRows(fname, query) {
    await page.evaluate(async ({ fname, query }) => {
      const v = window.geode.app.vault;
      try { await v.create(fname, "# Q\n\n```dataview\n" + query + "\n```\n"); } catch {}
      window.geode.app.workspace.openFile(fname);
      const t = window.geode.app.workspace.getActiveTab();
      if (t) window.geode.app.workspace.setTabMode(t.id, "preview");
    }, { fname, query });
    await page.waitForFunction(() => !!document.querySelector(".dataview.table-view-table, .dataview-error"), null, { timeout: 8000 }).catch(() => {});
    await wait(500);
    return page.evaluate(() => {
      const table = document.querySelector(".dataview.table-view-table");
      if (!table) return { err: !!document.querySelector(".dataview-error"), rows: null };
      const body = Array.from(table.querySelectorAll("tbody tr"));
      return { err: false, rows: body.map((tr) => Array.from(tr.querySelectorAll("td")).map((c) => c.textContent.trim())) };
    });
  }

  const where = await tableRows("r262d-where.md", 'TABLE rating FROM "r262d-alpha" OR "r262d-beta" OR "r262d-gamma" WHERE rating > 3');
  ok("WHERE rating > 3 → exactly 1 row (was 3 — the string-coercion bug)", where.rows?.length === 1, JSON.stringify(where.rows));
  ok("WHERE rating > 3 → that row is beta (rating 10)", where.rows?.[0]?.some((c) => c === "10"), JSON.stringify(where.rows));

  const sort = await tableRows("r262d-sort.md", 'TABLE rating FROM "r262d-alpha" OR "r262d-beta" OR "r262d-gamma" SORT rating DESC');
  ok("SORT rating DESC → 3 rows", sort.rows?.length === 3, JSON.stringify(sort.rows));
  ok("SORT rating DESC → NUMERIC order 10,2,1 (first=10 not lexical '2'; proves numeric)", sort.rows?.[0]?.some((c) => c === "10") && sort.rows?.[2]?.some((c) => c === "1"), JSON.stringify(sort.rows));

  const boolq = await tableRows("r262d-bool.md", 'TABLE published FROM "r262d-alpha" OR "r262d-beta" OR "r262d-gamma" WHERE published');
  ok("WHERE published (boolean true) → 2 rows (alpha+gamma, not beta)", boolq.rows?.length === 2, JSON.stringify(boolq.rows));

  ok("Part B: no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  await page.close();
}

console.log(`\nR262 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
