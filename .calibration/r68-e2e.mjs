/**
 * R68 search-operator extension E2E — browser mode against dev :1420.
 * Run: node .calibration/r68-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 68 additions".
 *
 * Covers ㉜ task: family + [property] (Obsidian-core search operators), via the
 * pure __geodeSearchQuery(query, input) probe (parseSearchQuery → evaluateSearch).
 * Also regresses R21 operators (content:/file:/tag:/line:/case) to prove the
 * frozen grammar still holds. (section:/block: deferred — Obsidian treats them
 * like line:.)
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
await page.waitForFunction(() => !!window.geode && !!window.__geodeSearchQuery, null, { timeout: 15000 });

// m(query, input) → boolean match
const m = (query, input) => page.evaluate(([q, i]) => window.__geodeSearchQuery(q, i), [query, input]);

const TASKS = "intro\n- [ ] call mom\n- [x] buy milk\nplain line\n";

console.log("— task: family —");
ok("task: matches a note with any checkbox", await m("task:", { content: TASKS }));
ok("task: does NOT match a note with no checkbox", !(await m("task:", { content: "just\nplain\ntext" })));
ok("task-todo: matches an unchecked box", await m("task-todo:", { content: TASKS }));
ok("task-todo: does NOT match when only checked boxes exist", !(await m("task-todo:", { content: "- [x] done" })));
ok("task-done: matches a checked box", await m("task-done:", { content: TASKS }));
ok("task-done: does NOT match when only unchecked exist", !(await m("task-done:", { content: "- [ ] todo" })));
ok("task:call matches 'call' inside a task line", await m("task:call", { content: TASKS }));
ok("task:call does NOT match 'call' outside a task line", !(await m("task:call", { content: "call mom\n- [ ] other" })));
ok("task:(call OR email) nested sub-query", await m("task:(call OR email)", { content: TASKS }));
ok("task-todo:milk → false (milk is in the DONE task)", !(await m("task-todo:milk", { content: TASKS })));
ok("ordered-list checkbox '1. [ ]' counts as a task", await m("task:", { content: "1. [ ] numbered task" }));
// custom checkbox states ([/], [-], [>]) — any single non-`]` char is a box
// (converges with R40 TASK_BOX_RE + Obsidian: non-space state = done).
ok("task: matches a custom state '- [/]'", await m("task:", { content: "- [/] in progress" }));
ok("task-done: matches a custom state '- [-]'", await m("task-done:", { content: "- [-] cancelled" }));
ok("task-todo: does NOT match a custom state '- [>]'", !(await m("task-todo:", { content: "- [>] forwarded" })));
ok("empty box '- []' is NOT a task", !(await m("task:", { content: "- [] not a task" })));
ok("multi-char box '- [ab]' is NOT a task", !(await m("task:", { content: "- [ab] not a task" })));

console.log("— [property] / [property:value] —");
const FM = { status: "done", tags: ["work", "home"], title: "My Note" };
ok("[status] matches when the key exists", await m("[status]", { frontmatter: FM }));
ok("[missing] does NOT match an absent key", !(await m("[missing]", { frontmatter: FM })));
ok("[status] does NOT match a note with no frontmatter", !(await m("[status]", { content: "x" })));
ok("[status:done] matches the value", await m("[status:done]", { frontmatter: FM }));
ok("[status:todo] does NOT match a different value", !(await m("[status:todo]", { frontmatter: FM })));
ok("[status:do] substring-matches 'done'", await m("[status:do]", { frontmatter: FM }));
ok("[STATUS:DONE] is case-insensitive (key + value)", await m("[STATUS:DONE]", { frontmatter: FM }));
ok("[tags:work] matches a value inside an array property", await m("[tags:work]", { frontmatter: FM }));
ok("[tags:office] does NOT match an absent array value", !(await m("[tags:office]", { frontmatter: FM })));
// [key:] (empty value) degrades to the key-exists predicate (else an empty
// substring would match any value of the key).
ok("[status:] (empty value) == [status] key-exists", await m("[status:]", { frontmatter: FM }));
ok("[missing:] (empty value) still respects key absence", !(await m("[missing:]", { frontmatter: FM })));

console.log("— negation + combination —");
ok("-task-done: matches a note with NO done task", await m("-task-done:", { content: "- [ ] todo\nplain" }));
ok("-task-done: does NOT match when a done task exists", !(await m("-task-done:", { content: "- [x] done" })));
ok("task: AND [status] combine", await m("task: [status]", { content: TASKS, frontmatter: FM }));

console.log("— regression: R21 operators still work (frozen grammar) —");
ok("content:foo still matches", await m("content:foo", { content: "a foo b" }));
ok("tag:work still matches", await m("tag:work", { content: "x", tags: ["work"] }));
ok("line:(alpha beta) same-line constraint still works", await m("line:(alpha beta)", { content: "alpha beta\ngamma" }));
ok("line:(alpha gamma) cross-line → no match", !(await m("line:(alpha gamma)", { content: "alpha\ngamma" })));
ok("plain word match still works", await m("hello", { content: "say hello world" }));
ok("#tag sugar still works", await m("#work", { content: "x", tags: ["work"] }));
ok("a stray '[' (no closing ]) degrades to literal text", await m("[abc", { content: "see [abc here" }));
// R68 known deviation vs R21: a bracket token `[link]` now parses as a property
// predicate, NOT literal bracketed text. Escape hatches: content:[…] or "[…]".
ok("[link] parses as a property (NOT literal text) — false on content only", !(await m("[link]", { content: "see [link] here" })));
ok("content:[link] escape hatch matches literal brackets", await m("content:[link]", { content: "see [link] here" }));
ok('"[link]" quoted escape hatch matches literal brackets', await m('"[link]"', { content: "see [link] here" }));

console.log(`\nR68 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
