/**
 * R183 — G3 (ui-only→done): "Copy path" / "Copy Obsidian URL" as active-file
 * COMMANDS — browser :1420.
 * Run: node .calibration/r183-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 183 additions" (G3 ui-only→done).
 *
 * R179 added these as Explorer right-click items; the G3 matrix marked them
 * ui-only. R183 promotes them to palette/hotkey-bindable commands operating on
 * the ACTIVE file (reuse core buildOpenUri; pure read + clipboard, no vault write).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r183", name: "r183", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await page.evaluate(() => {
  window.__clip = [];
  navigator.clipboard.writeText = (t) => { window.__clip.push(t); return Promise.resolve(); };
});

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (sel) => app(([s]) => !!document.querySelector(s), [sel]);

const FILE = "r183-dir/r183-note.md";
await app(async ([file]) => {
  try { await window.__app.vault.createFolder("r183-dir"); } catch { /* exists */ }
  try { await window.__app.vault.create(file, "# r183\n"); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 60));
}, [FILE]);
await wait(200);

console.log("— both commands registered with resolved (non-key) names —");
const reg = await app(() => {
  const ids = ["file-explorer:copy-path", "workspace:copy-url"];
  return ids.map((id) => {
    const c = window.__app.commands.list().find((x) => x.id === id);
    return { id, present: !!c, name: c ? c.name() : null };
  });
});
for (const r of reg) {
  ok(`${r.id} registered`, r.present);
  ok(`${r.id} name resolves (not raw key)`, !!r.name && !r.name.startsWith("explorer.") && !r.name.startsWith("cmd."), r.name);
}

console.log("— open the file (active) —");
await app(([f]) => window.__app.workspace.openFile(f), [FILE]);
await wait(150);
ok("file is active", (await app(() => window.__app.workspace.getActiveFile())) === FILE);

console.log("— copy-path command → vault-relative path on clipboard + toast —");
await app(() => window.__app.commands.execute("file-explorer:copy-path"));
await wait(120);
ok("clipboard got the vault-relative path", (await app(() => window.__clip[window.__clip.length - 1])) === FILE);
ok("command toast appeared", await has('[data-testid="command-notice"]'));

console.log("— copy-url command → obsidian://open?vault&file (.md stripped) —");
await app(() => window.__app.commands.execute("workspace:copy-url"));
await wait(120);
const urlCheck = await app(() => {
  const url = window.__clip[window.__clip.length - 1];
  let u; try { u = new URL(url); } catch { return { ok: false, url }; }
  return {
    ok: u.protocol === "obsidian:" && u.host === "open"
      && u.searchParams.get("vault") === window.__app.vault.vaultName
      && u.searchParams.get("file") === "r183-dir/r183-note",
    url, file: u.searchParams.get("file"), vault: u.searchParams.get("vault"),
  };
});
ok("obsidian://open URL: correct vault + .md-stripped file + %2F sep", urlCheck.ok, JSON.stringify(urlCheck));

console.log("— available() gating: false with no active file (graph tab) —");
await app(() => window.__app.workspace.openGraph());
await wait(120);
ok("graph tab → no active file", (await app(() => window.__app.workspace.getActiveFile())) === null);
ok("both commands available()===false with no active file", await app(() => {
  const ids = ["file-explorer:copy-path", "workspace:copy-url"];
  return ids.every((id) => {
    const c = window.__app.commands.list().find((x) => x.id === id);
    return c?.available?.() === false;
  });
}));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR183: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
