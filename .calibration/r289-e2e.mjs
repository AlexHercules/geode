/**
 * R289 — Obsidian-style full vault manager and rich recent-vault records.
 * Run: node .calibration/r289-e2e.mjs (dev server :1420 must be running).
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const failures = [];
function ok(name, condition, extra = "") {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.geode?.app && !!window.__geodeRecentVaults, null, { timeout: 15000 });
await page.evaluate(() => {
  localStorage.setItem("geode.locale", "en");
  localStorage.removeItem("geode.recentVaults");
  localStorage.removeItem("geode.recentVaultRecords.v1");
  window.__geodeRecentVaults.push("/Users/me/Desktop/workspace");
  window.__geodeRecentVaults.push("/Users/me/Documents/Code");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.geode?.app && !!window.__geodeRecentVaults, null, { timeout: 15000 });

console.log("— rich record migration and stable identity —");
let records = await page.evaluate(() => window.__geodeRecentVaults.records());
ok("legacy paths transparently expose rich records", records.length === 2 && records.every((record) => record.id.startsWith("geode-")), JSON.stringify(records));
const workspaceId = records.find((record) => record.path.endsWith("/workspace"))?.id;
await page.evaluate(() => window.__geodeRecentVaults.rename("/Users/me/Desktop/workspace", "Knowledge Base"));
records = await page.evaluate(() => window.__geodeRecentVaults.records());
ok("manager alias persists without changing the path", records.some((record) => record.name === "Knowledge Base" && record.path === "/Users/me/Desktop/workspace"), JSON.stringify(records));
await page.evaluate(() => window.__geodeRecentVaults.relocate("/Users/me/Desktop/workspace", "/Volumes/Notes/workspace"));
records = await page.evaluate(() => window.__geodeRecentVaults.records());
ok("location update preserves stable vault ID", records.some((record) => record.path === "/Volumes/Notes/workspace" && record.id === workspaceId && record.name === "Knowledge Base"), JSON.stringify(records));

console.log("— pixel-calibrated two-column manager —");
await page.evaluate(() => window.geode.app.workspace.openModal("vaultmanager"));
await page.waitForSelector('[data-testid="vaultmanager-modal"]');
const layout = await page.evaluate(() => {
  const box = (selector) => {
    const element = document.querySelector(selector);
    const rect = element.getBoundingClientRect();
    const css = getComputedStyle(element);
    return { width: Math.round(rect.width), height: Math.round(rect.height), background: css.backgroundColor, radius: css.borderRadius };
  };
  return {
    shell: box(".vaultmanager-shell"),
    sidebar: box(".vaultmanager-sidebar"),
    main: box(".vaultmanager-main"),
    logo: box(".vaultmanager-brand img"),
    rows: document.querySelectorAll('[data-testid="vaultmanager-item"]').length,
    directRemoveButtons: document.querySelectorAll('[data-testid="vaultmanager-item"] [data-testid="vaultmanager-remove"]').length,
  };
});
ok("manager is a 1000×720 Obsidian-style surface", layout.shell.width === 1000 && layout.shell.height === 720 && layout.shell.radius === "12px", JSON.stringify(layout));
ok("manager uses a 35/65 two-column split", layout.sidebar.width === 349 && layout.main.width === 649, JSON.stringify(layout));
ok("brand mark is 94px", layout.logo.width === 94 && layout.logo.height === 94, JSON.stringify(layout));
ok("records use ellipsis menus rather than permanent remove buttons", layout.rows === 2 && layout.directRemoveButtons === 0, JSON.stringify(layout));

console.log("— record menu and edit flows —");
const moreFor = async (text) => {
  await page.$$eval('[data-testid="vaultmanager-item"]', (items, label) => {
    const item = items.find((element) => element.querySelector(".vaultswitcher-name")?.textContent === label);
    item?.querySelector('[data-testid="vaultmanager-record-more"]')?.click();
  }, text);
  await page.waitForSelector('[data-testid="vaultmanager-record-menu"]');
};
await moreFor("Knowledge Base");
const menu = await page.evaluate(() => ({
  width: Math.round(document.querySelector('[data-testid="vaultmanager-record-menu"]').getBoundingClientRect().width),
  copy: !!document.querySelector('[data-testid="vaultmanager-copy-id"]'),
  rename: !!document.querySelector('[data-testid="vaultmanager-rename"]'),
  relocate: !!document.querySelector('[data-testid="vaultmanager-relocate"]'),
  reveal: !!document.querySelector('[data-testid="vaultmanager-reveal"]'),
  remove: !!document.querySelector('[data-testid="vaultmanager-remove"]'),
}));
ok("ellipsis opens the 260px five-action record menu", menu.width === 260 && Object.values(menu).slice(1).every(Boolean), JSON.stringify(menu));

await page.click('[data-testid="vaultmanager-rename"]');
await page.waitForSelector('[data-testid="vaultmanager-record-dialog"] input');
await page.fill('[data-testid="vaultmanager-record-dialog"] input', "Writing Vault");
await page.click('[data-testid="vaultmanager-record-dialog"] button[type="submit"]');
await page.waitForTimeout(80);
ok("rename dialog updates the manager label", await page.locator(".vaultswitcher-name").allTextContents().then((names) => names.includes("Writing Vault")));

await moreFor("Writing Vault");
await page.click('[data-testid="vaultmanager-relocate"]');
await page.fill('[data-testid="vaultmanager-record-dialog"] input', "/Volumes/Archive/writing");
await page.click('[data-testid="vaultmanager-record-dialog"] button[type="submit"]');
await page.waitForTimeout(80);
records = await page.evaluate(() => window.__geodeRecentVaults.records());
ok("move flow updates only the record path and preserves ID", records.some((record) => record.path === "/Volumes/Archive/writing" && record.id === workspaceId), JSON.stringify(records));

await moreFor("Writing Vault");
await page.click('[data-testid="vaultmanager-remove"]');
await page.waitForTimeout(80);
records = await page.evaluate(() => window.__geodeRecentVaults.records());
ok("remove forgets only the selected record", records.length === 1 && !records.some((record) => record.id === workspaceId), JSON.stringify(records));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
await browser.close();
console.log(`\nR289 e2e: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", failures.join(", "));
process.exit(failed ? 1 : 0);
