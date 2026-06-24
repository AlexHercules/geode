/**
 * R203 — G C1: vault switcher first slice — recentVaults store + switcher modal + app:switch-vault.
 * Browser :1420.   Run: node .calibration/r203-e2e.mjs   Contract: docs/ARCHITECTURE.md "Round 203 additions".
 *
 * A = recentVaults store CRUD via __geodeRecentVaults (load/push/remove, dedupe, cap, defensive parse).
 * B = command + modal: app:switch-vault opens the modal; recents render (basename + path); empty state.
 * C = remove a recent → list + localStorage update, vault DATA untouched (硬边界#3). D = click → switch flow runs.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r203", name: "r203", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeRecentVaults, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clearRecents = () => app(() => localStorage.removeItem("geode.recentVaults"));
const setRaw = (val) => app((v) => localStorage.setItem("geode.recentVaults", v), val);
const load = () => app(() => window.__geodeRecentVaults.load());

console.log("A. recentVaults store CRUD (__geodeRecentVaults)");
await clearRecents();
ok("empty → load() === []", JSON.stringify(await load()) === "[]");
await app(() => window.__geodeRecentVaults.push("/Users/me/Alpha"));
await app(() => window.__geodeRecentVaults.push("/Users/me/Beta"));
let list = await load();
ok("push order: most-recent first ([Beta, Alpha])", JSON.stringify(list) === JSON.stringify(["/Users/me/Beta", "/Users/me/Alpha"]), JSON.stringify(list));
await app(() => window.__geodeRecentVaults.push("/Users/me/Alpha")); // re-push existing
list = await load();
ok("re-push dedupes + moves to front ([Alpha, Beta])", JSON.stringify(list) === JSON.stringify(["/Users/me/Alpha", "/Users/me/Beta"]), JSON.stringify(list));
await clearRecents();
await app(() => { for (let i = 0; i < 14; i++) window.__geodeRecentVaults.push("/v/" + i); });
ok("cap at 10 (push 14 → length 10)", (await load()).length === 10, String((await load()).length));
await app(() => window.__geodeRecentVaults.remove("/v/13")); // /v/13 is most-recent (pushed last)
ok("remove() drops the entry", !(await load()).includes("/v/13"));
// defensive parse
await setRaw("not json{");
ok("corrupt JSON → []", JSON.stringify(await load()) === "[]");
await setRaw(JSON.stringify(["x", "x", 1, null, "y"]));
ok("dedupe + filter non-strings (['x','x',1,null,'y'] → ['x','y'])", JSON.stringify(await load()) === JSON.stringify(["x", "y"]), JSON.stringify(await load()));
await setRaw(JSON.stringify({ not: "an array" }));
ok("non-array → []", JSON.stringify(await load()) === "[]");

console.log("B. command + modal render");
const reg = await app(() => {
  const c = window.__app.commands.list().find((x) => x.id === "app:switch-vault");
  return { present: !!c, name: c ? c.name() : null };
});
ok("app:switch-vault registered + name resolves (not isTauri-gated)", reg.present && !!reg.name && !reg.name.startsWith("cmd."), JSON.stringify(reg));

await clearRecents();
await app(() => { window.__geodeRecentVaults.push("/Users/me/Alpha"); window.__geodeRecentVaults.push("/Users/me/Beta"); });
await app(() => window.__app.commands.execute("app:switch-vault"));
await page.waitForSelector('[data-testid="vaultswitcher-modal"]', { timeout: 3000 });
let items = await page.$$eval('[data-testid="vaultswitcher-item"] .vaultswitcher-name', (els) => els.map((e) => e.textContent));
ok("modal lists recents by basename, most-recent first ([Beta, Alpha])", JSON.stringify(items) === JSON.stringify(["Beta", "Alpha"]), JSON.stringify(items));
const paths = await page.$$eval('[data-testid="vaultswitcher-item"] .vaultswitcher-path', (els) => els.map((e) => e.textContent));
ok("modal shows full paths too", paths.includes("/Users/me/Beta") && paths.includes("/Users/me/Alpha"), JSON.stringify(paths));
ok("'Open another vault' button present", (await page.$('[data-testid="vaultswitcher-open-other"]')) !== null);
await app(() => window.__app.workspace.closeModal());
await wait(80);

// empty state
await clearRecents();
await app(() => window.__app.commands.execute("app:switch-vault"));
await page.waitForSelector('[data-testid="vaultswitcher-modal"]', { timeout: 3000 });
ok("empty recents → empty-state message", (await page.$('[data-testid="vaultswitcher-empty"]')) !== null);
ok("empty recents → no items", (await page.$$('[data-testid="vaultswitcher-item"]')).length === 0);
await app(() => window.__app.workspace.closeModal());
await wait(80);

console.log("C. remove a recent → list + localStorage update; vault DATA untouched (硬边界#3)");
await app(async () => { try { await window.__app.vault.create("r203-keep.md", "keep me\n"); } catch { /* exists */ } });
await clearRecents();
await app(() => { window.__geodeRecentVaults.push("/Users/me/Alpha"); window.__geodeRecentVaults.push("/Users/me/Beta"); });
await app(() => window.__app.commands.execute("app:switch-vault"));
await page.waitForSelector('[data-testid="vaultswitcher-modal"]', { timeout: 3000 });
await page.click('[data-testid="vaultswitcher-item"] [data-testid="vaultswitcher-remove"]'); // removes the first (Beta)
await wait(120);
items = await page.$$eval('[data-testid="vaultswitcher-item"] .vaultswitcher-name', (els) => els.map((e) => e.textContent));
ok("remove button drops the row (only Alpha remains)", JSON.stringify(items) === JSON.stringify(["Alpha"]), JSON.stringify(items));
ok("localStorage updated (Beta gone)", !(await load()).includes("/Users/me/Beta"));
ok("硬边界#3: removing a recent does NOT delete vault data (r203-keep.md intact)", await app(() => window.__app.vault.fileExists("r203-keep.md")));
await app(() => window.__app.workspace.closeModal());
await wait(80);

console.log("D. click a recent → switch flow runs + reorders recents to front (click the OLDER row)");
await clearRecents();
await app(() => { window.__geodeRecentVaults.push("/Users/me/Gamma"); window.__geodeRecentVaults.push("/Users/me/Delta"); }); // recents [Delta, Gamma]
await app(() => window.__app.commands.execute("app:switch-vault"));
await page.waitForSelector('[data-testid="vaultswitcher-modal"]', { timeout: 3000 });
// click the OLDER row (Gamma, 2nd) → switchToVault must push it to the front and retain Delta
await page.$$eval('[data-testid="vaultswitcher-item"]', (items) => {
  const it = items.find((el) => el.querySelector(".vaultswitcher-name")?.textContent === "Gamma");
  it?.querySelector(".vaultswitcher-open")?.click();
});
await wait(250);
ok("click closes the modal", (await app(() => document.querySelector('[data-testid="vaultswitcher-modal"]') === null)));
ok("click ran switchToVault → clicked (Gamma) moved to recents front, Delta retained ([Gamma, Delta])", JSON.stringify(await load()) === JSON.stringify(["/Users/me/Gamma", "/Users/me/Delta"]), JSON.stringify(await load()));
ok("vault still functional after switch flow (r203-keep.md intact)", await app(() => window.__app.vault.fileExists("r203-keep.md")));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR203: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
