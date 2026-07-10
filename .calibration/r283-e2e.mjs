/**
 * R283 — Markdown reading-view link styles + spellcheck default ON + status-bar density.
 * Browser :1420.   Run: node .calibration/r283-e2e.mjs
 * Contract: docs/ARCHITECTURE.md "Round 283 additions".
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r283", name: "r283", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("A. reading-view link styles");
await app(async () => {
  try { await window.__app.vault.remove("Links.md"); } catch {}
  try { await window.__app.vault.remove("Existing.md"); } catch {}
  await window.__app.vault.create("Existing.md", "# Existing\n");
  await window.__app.vault.create("Links.md", "# Links\n\n[[Existing]]\n\n[[Missing]]\n\n[external](https://example.com)\n");
});
await app(() => window.__app.workspace.openFile("Links.md"));
await wait(150);
await app(() => {
  const tab = window.__app.workspace.getActiveTab();
  if (tab) window.__app.workspace.setTabMode(tab.id, "preview");
});
await wait(250);

const linkStyles = await page.evaluate(() => {
  const internal = document.querySelector(".preview-content a.internal-link:not(.is-unresolved)");
  const unresolved = document.querySelector(".preview-content a.internal-link.is-unresolved");
  const external = document.querySelector(".preview-content a.external-link");
  const styleOf = (el) => el ? window.getComputedStyle(el) : null;
  const s = (st) => st ? { color: st.color, textDecoration: st.textDecoration, textDecorationStyle: st.textDecorationStyle } : null;
  return {
    internal: s(styleOf(internal)),
    unresolved: s(styleOf(unresolved)),
    external: s(styleOf(external)),
  };
});

ok("internal link has no underline", linkStyles.internal && linkStyles.internal.textDecoration.includes("none"), JSON.stringify(linkStyles.internal));
ok("unresolved link is dashed underlined", linkStyles.unresolved && linkStyles.unresolved.textDecoration.includes("underline") && linkStyles.unresolved.textDecorationStyle === "dashed", JSON.stringify(linkStyles.unresolved));
ok("external link is underlined", linkStyles.external && linkStyles.external.textDecoration.includes("underline"), JSON.stringify(linkStyles.external));

console.log("B. status-bar density");
const statusStyles = await page.evaluate(() => {
  const bar = document.querySelector(".status-bar");
  if (!bar) return null;
  const st = window.getComputedStyle(bar);
  return { gap: st.gap, padding: st.padding };
});
ok("status-bar gap is 6px", statusStyles?.gap === "6px", JSON.stringify(statusStyles));
ok("status-bar padding is 0px 7px", statusStyles?.padding === "0px 7px", JSON.stringify(statusStyles));

console.log("C. spellcheck default ON");
await app(() => {
  const tab = window.__app.workspace.getActiveTab();
  if (tab) window.__app.workspace.setTabMode(tab.id, "live");
});
await wait(200);
ok("editor contentDOM spellcheck is true by default", (await app(() => document.querySelector(".cm-content")?.getAttribute("spellcheck"))) === "true");

// clean up
await app(() => {
  if (window.__app.vault.fileExists("Links.md")) window.__app.vault.remove("Links.md");
  if (window.__app.vault.fileExists("Existing.md")) window.__app.vault.remove("Existing.md");
});

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR283: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
