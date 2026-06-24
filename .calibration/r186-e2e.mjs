/**
 * R186 — G3 missing→done: "Set heading 1-6" / "Remove heading" editor commands —
 * browser :1420.
 * Run: node .calibration/r186-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 186 additions" (G3 missing pure-edit).
 *
 * Extends the R33 format engine with setHeadingLevel (fixed level 1-6, or 0=remove),
 * vs the existing cycling toggle-heading. DATA-SAFETY: byte-level transform tests via
 * the pure __geodeFormat.apply probe (exact FormatEdit.insert) — content preserved,
 * only the leading-# prefix changes; idempotent set → no-op (null).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r186", name: "r186", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeFormat && !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
// pure probe: returns FormatEdit {from,to,insert,selFrom,selTo} | null
const apply = (op, text, from, to) =>
  app(([o, t, f, u]) => window.__geodeFormat.apply(o, t, f, u), [op, text, from, to]);
const insertOf = async (op, text, from, to) => (await apply(op, text, from, to))?.insert ?? null;

console.log("A. byte-level transform (pure __geodeFormat.apply)");
// set level on plain prose (line "Hello", caret at 0)
ok("set-heading-1 on 'Hello' → '# Hello'", (await insertOf("heading-1", "Hello", 0, 0)) === "# Hello");
ok("set-heading-3 on 'Hello' → '### Hello'", (await insertOf("heading-3", "Hello", 0, 0)) === "### Hello");
ok("set-heading-6 on 'Hello' → '###### Hello'", (await insertOf("heading-6", "Hello", 0, 0)) === "###### Hello");
// re-level an existing heading (strip old marker, apply new)
ok("set-heading-3 on '# Hello' → '### Hello'", (await insertOf("heading-3", "# Hello", 0, 0)) === "### Hello");
ok("set-heading-1 on '#### Hello' → '# Hello'", (await insertOf("heading-1", "#### Hello", 0, 0)) === "# Hello");
// remove heading
ok("remove-heading on '## Hello' → 'Hello'", (await insertOf("remove-heading", "## Hello", 0, 0)) === "Hello");
ok("remove-heading on 'Hello' (no heading) → null (no-op)", (await apply("remove-heading", "Hello", 0, 0)) === null);
// idempotent set → null (no content-identical transaction)
ok("set-heading-2 on '## Hello' (already H2) → null (idempotent)", (await apply("heading-2", "## Hello", 0, 0)) === null);
// all-blank selection → null
ok("set-heading-1 on '' → null", (await apply("heading-1", "", 0, 0)) === null);
// content preserved — only prefix changes (inline formatting untouched)
ok("set-heading-2 preserves inline content '**b** x' → '## **b** x'",
  (await insertOf("heading-2", "**b** x", 0, 0)) === "## **b** x");
// multi-line selection: every non-blank line gets the prefix
ok("set-heading-2 multi-line 'a\\nb' → '## a\\n## b'", (await insertOf("heading-2", "a\nb", 0, 3)) === "## a\n## b");
// FormatEdit replaces exactly the line span (from/to = line bounds, not the caret)
const e = await apply("heading-2", "Hello", 0, 0);
ok("FormatEdit spans the whole line (from=0,to=5)", e && e.from === 0 && e.to === 5, JSON.stringify(e));

console.log("B. commands registered + names resolve");
const IDS = ["editor:set-heading-1", "editor:set-heading-2", "editor:set-heading-3",
  "editor:set-heading-4", "editor:set-heading-5", "editor:set-heading-6", "editor:remove-heading"];
const reg = await app(([ids]) => ids.map((id) => {
  const c = window.__app.commands.list().find((x) => x.id === id);
  return { id, present: !!c, name: c ? c.name() : null };
}), [IDS]);
for (const r of reg) {
  ok(`${r.id} registered`, r.present);
  ok(`${r.id} name resolves (not raw key)`, !!r.name && !r.name.startsWith("cmd."), r.name);
}

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR186: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
