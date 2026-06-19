/**
 * R95 code-block copy button E2E — browser mode :1420.
 * Run: node .calibration/r95-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 95 additions" (㊶ 续续).
 *
 * A post-render hydration pass adds a hover "Copy" button to every reading-view code
 * fence (pre>code). markdown.ts is UNTOUCHED (byte-neutral). Verifies the button
 * presence, the actual clipboard write, mermaid/no-code exclusion, and multi-block.
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
const context = await browser.newContext();
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
const page = await context.newPage();
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r95", name: "r95", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeCodeCopy, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 50));
}, [p, c]);
const openReading = (p) => app(async ([path]) => {
  window.__app.workspace.openFile(path);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "preview");
  await new Promise((r) => setTimeout(r, 350));
}, [p]);
const copyButtons = () => app(() => document.querySelectorAll(".preview-content .code-copy-button").length);

// ── probe: pre>code matching logic ──────────────────────────────────────────
console.log("— hydrate matching (probe) —");
ok("a code fence gets a copy button", (await app(() => window.__geodeCodeCopy("<pre><code>x</code></pre>"))) === 1);
ok("two code fences → two buttons", (await app(() => window.__geodeCodeCopy("<pre><code>a</code></pre><pre><code>b</code></pre>"))) === 2);
ok("a <pre> without <code> gets no button", (await app(() => window.__geodeCodeCopy("<pre>raw</pre>"))) === 0);
// REAL markdown output: mermaid/query render a placeholder div whose source fallback IS
// a <pre class="geode-*-source"><code> (present until async render swaps it) — excluded
ok("a mermaid source-fallback pre gets no button", (await app(() =>
  window.__geodeCodeCopy('<div class="geode-mermaid"><pre class="geode-mermaid-source"><code>graph TD</code></pre></div>'))) === 0);
ok("a query source-fallback pre gets no button", (await app(() =>
  window.__geodeCodeCopy('<div class="geode-query"><pre class="geode-query-source"><code>tag:#x</code></pre></div>'))) === 0);
// idempotency: a pre that ALREADY carries a button is skipped → total stays 1 (no 2nd)
ok("a pre already carrying a button is skipped (idempotent)",
  (await app(() => window.__geodeCodeCopy('<pre><code>x</code><button class="code-copy-button">Copy</button></pre>'))) === 1);

// ── reading view: button presence + real clipboard ─────────────────────────
console.log("— reading view copy button —");
await create("code.md", "# code\n\n```js\nconst x = 1;\nconsole.log(x);\n```\n\ntext\n");
await openReading("code.md");
ok("reading view renders a copy button on the code block", (await copyButtons()) === 1);
// hover-reveal is CSS-only; the button exists + is clickable regardless
await page.click(".preview-content .code-copy-button");
await wait(150);
const clip = await app(() => navigator.clipboard.readText());
ok("clicking copies the code text (trailing newline trimmed)", clip === "const x = 1;\nconsole.log(x);", JSON.stringify(clip));
ok("button shows 'Copied' feedback after click", await app(() => {
  const b = document.querySelector(".preview-content .code-copy-button");
  return b?.classList.contains("is-copied") && b?.textContent === "Copied";
}));

// ── exclusions in the real pipeline ─────────────────────────────────────────
console.log("— exclusions —");
await create("nocode.md", "# no code\n\njust prose, an `inline span`, and a list:\n\n- a\n- b\n");
await openReading("nocode.md");
ok("a note without a fenced block gets no copy button (inline code excluded)", (await copyButtons()) === 0);

await create("multi.md", "```js\nA\n```\n\n```py\nB\n```\n");
await openReading("multi.md");
ok("two fenced blocks → two copy buttons in the rendered view", (await copyButtons()) === 2);

// REAL pipeline: a mermaid fence + a js fence — only the js block gets a button (the
// mermaid source-fallback pre is excluded), even though both are pre>code at render time
await create("mix.md", "```mermaid\ngraph TD;A-->B;\n```\n\n```js\nconst y = 2;\n```\n");
await openReading("mix.md");
await wait(250); // let mermaid hydration attempt run
ok("a note with a mermaid + a js fence → exactly 1 copy button (js only)", (await copyButtons()) === 1, `count=${await copyButtons()}`);

console.log(`\nR95 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
