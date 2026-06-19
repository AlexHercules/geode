/**
 * R112 compat fileManager.generateMarkdownLink E2E — browser mode :1420.
 * Run: node .calibration/r112-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 112 additions" (compat 商业主轴).
 *
 * Obsidian `fileManager.generateMarkdownLink(file, sourcePath, subpath?, alias?) => string`
 * now real: delegates to core formatLink (honors wikilink/markdown + shortest/relative/absolute,
 * resolve-back verified). subpath carries Obsidian's leading `#`; empty-string alias = "use file
 * name"; formatLink null (unresolvable / unsafe name) → best-effort basename fallback (Obsidian
 * always returns a string). Link settings are flipped via the R72 __geodeFormatLink probe.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r112", name: "r112", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.fileManager, null, { timeout: 5000 });

// seed notes + normalize link settings to wikilink/shortest, then wait until the index resolves them
await page.evaluate(async () => {
  await window.__app.vault.create("Note.md", "# Note\n");
  await window.__app.vault.create("folder/Sub.md", "# Sub\n");
});
await page.waitForFunction(
  () => window.__geodeFormatLink && window.__geodeFormatLink("Note.md", "", { useMarkdown: false, pathFormat: "shortest" }) === "[[Note]]",
  null, { timeout: 5000 },
);

const gen = (target, source = "", subpath, alias) =>
  page.evaluate(
    ([t, s, sp, al]) => {
      const f = window.app.vault.getFileByPath(t) ?? { path: t };
      return window.app.fileManager.generateMarkdownLink(f, s, sp, al);
    },
    [target, source, subpath, alias],
  );
const setFmt = (opts) => page.evaluate((o) => window.__geodeFormatLink("Note.md", "", o), opts);

// ── wikilink + shortest (default) ───────────────────────────────────────────
console.log("— wikilink + shortest (default) —");
ok("basic note → [[Note]]", (await gen("Note.md")) === "[[Note]]");
ok("subpath heading → [[Note#Heading]] (leading # carried)", (await gen("Note.md", "", "#Heading")) === "[[Note#Heading]]");
ok("subpath block → [[Note#^abc]]", (await gen("Note.md", "", "#^abc")) === "[[Note#^abc]]");
ok("alias → [[Note|Display]]", (await gen("Note.md", "", undefined, "Display")) === "[[Note|Display]]");
ok("empty-string alias = use file name → [[Note]]", (await gen("Note.md", "", undefined, "")) === "[[Note]]");
ok("alias equal to linktext is omitted → [[Note]]", (await gen("Note.md", "", undefined, "Note")) === "[[Note]]");
ok("subpath + alias → [[Note#Heading|Display]]", (await gen("Note.md", "", "#Heading", "Display")) === "[[Note#Heading|Display]]");
ok("subfolder unique basename → shortest [[Sub]]", (await gen("folder/Sub.md")) === "[[Sub]]");

// ── always returns a string, even for an unindexed target (fallback) ────────
console.log("— always returns a string (fallback for unresolvable) —");
const ghost = await gen("Ghost.md");
ok("unindexed file still returns a non-empty link string", typeof ghost === "string" && ghost === "[[Ghost]]", JSON.stringify(ghost));
const unsafe = await gen("We#ird.md");
ok("wikilink-unsafe name (formatLink null) still returns a string", typeof unsafe === "string" && unsafe.length > 0 && unsafe.includes("We#ird"), JSON.stringify(unsafe));

// ── markdown mode (linkUseMarkdown ON via __geodeFormatLink) ────────────────
console.log("— markdown mode —");
await setFmt({ useMarkdown: true, pathFormat: "shortest" });
ok("markdown basic → [Note](Note.md)", (await gen("Note.md")) === "[Note](Note.md)");
ok("markdown alias → [Disp](Note.md)", (await gen("Note.md", "", undefined, "Disp")) === "[Disp](Note.md)");
ok("markdown subpath → [Note](Note.md#Heading)", (await gen("Note.md", "", "#Heading")) === "[Note](Note.md#Heading)");
// review MAJOR: a markdown subpath with spaces must be percent-encoded (href group is [^\s)]+)
ok("markdown subpath with spaces is %-encoded → no broken re-parse", (await gen("Note.md", "", "#Heading With Spaces")) === "[Note](Note.md#Heading%20With%20Spaces)", JSON.stringify(await gen("Note.md", "", "#Heading With Spaces")));
ok("markdown block subpath ^id stays intact", (await gen("Note.md", "", "#^blk")) === "[Note](Note.md#^blk)", JSON.stringify(await gen("Note.md", "", "#^blk")));

// ── absolute path format flows through (back to wikilink) ────────────────────
console.log("— absolute path format —");
await setFmt({ useMarkdown: false, pathFormat: "absolute" });
ok("absolute wikilink subfolder → [[folder/Sub]]", (await gen("folder/Sub.md")) === "[[folder/Sub]]");

// reset settings to defaults so the shared localStorage doesn't leak into other suites
await setFmt({ useMarkdown: false, pathFormat: "shortest" });

console.log(`\nR112 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
