/**
 * R245 (G2-b 设置页视觉打磨) settings nav active-item fidelity E2E — browser mode :1420.
 * Run: node .calibration/r245-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 245 additions".
 *
 * Obsidian selects the settings left-nav item with a NEUTRAL highlight
 * (--background-modifier-active-hover), not the accent — accent is reserved for toggles /
 * primary buttons / links (reference 03 §三/§四). Geode had it as accent-muted + accent text;
 * R245 switches it to --bg-active + --text-normal. Asserts via computed style (variables
 * resolved through a probe element so the comparison is exact rgb, theme-independent).
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
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r245", name: "r245", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await app(() => window.__app.workspace.openModal("settings"));
await page.waitForSelector('.settings-nav-item.is-active', { timeout: 3000 });
await wait(80);

console.log("— settings nav active item uses a NEUTRAL highlight, not the accent —");
const s = await app(() => {
  const active = document.querySelector('.settings-nav-item.is-active');
  const probe = document.createElement('span');
  document.body.appendChild(probe);
  const resolve = (v) => { probe.style.color = v; return getComputedStyle(probe).color; };
  const resolveBg = (v) => { probe.style.backgroundColor = v; return getComputedStyle(probe).backgroundColor; };
  const textNormal = resolve('var(--text-normal)');
  const accent = resolve('var(--accent)');
  const accentMuted = resolveBg('var(--accent-muted)');
  const bgActive = resolveBg('var(--bg-active)');
  const cs = getComputedStyle(active);
  const r = { activeColor: cs.color, activeBg: cs.backgroundColor, textNormal, accent, accentMuted, bgActive };
  probe.remove();
  return r;
});

ok("an active nav item exists", !!s);
ok("active nav TEXT is --text-normal (not accent)", s.activeColor === s.textNormal && s.activeColor !== s.accent, JSON.stringify(s));
ok("active nav BG is the neutral --bg-active (not accent-tinted)", s.activeBg === s.bgActive, JSON.stringify(s));
ok("active nav BG is NOT the old accent-muted purple", s.activeBg !== s.accentMuted, JSON.stringify(s));
// sanity: --bg-active and --accent-muted must actually differ (else the assertion is vacuous)
ok("--bg-active and --accent-muted are genuinely different colors", s.bgActive !== s.accentMuted, JSON.stringify({ bgActive: s.bgActive, accentMuted: s.accentMuted }));

console.log("— toggles still use the accent (the fix only neutralises the nav, not controls) —");
await page.click('[data-testid="settings-nav-editor"]').catch(() => {});
await wait(80);
const toggleOn = await app(() => {
  const t = document.querySelector('.settings-toggle.is-on');
  if (!t) return null;
  const probe = document.createElement('span');
  document.body.appendChild(probe);
  probe.style.backgroundColor = 'var(--accent)';
  const accent = getComputedStyle(probe).backgroundColor;
  const bg = getComputedStyle(t).backgroundColor;
  probe.remove();
  return { bg, accent };
});
ok("an ON toggle still fills with --accent (accent semantics preserved)", toggleOn === null || toggleOn.bg === toggleOn.accent, JSON.stringify(toggleOn));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR245 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
