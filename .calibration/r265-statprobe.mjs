import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const DV = ".calibration/dataview";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(({ mainJs, manifestJson }) => {
  window.__geodeObsidianPlugins = [{ dir: "dataview", manifestJson, mainJs, stylesCss: null, dataJson: null }];
  window.__geodeObsidianConfig = { "community-plugins.json": '["dataview"]' };
  try { localStorage.setItem("geode.locale", "en"); } catch {}
}, { mainJs: readFileSync(DV+"/main.js","utf8"), manifestJson: readFileSync(DV+"/manifest.json","utf8") });
await page.goto("http://localhost:1420");
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.waitForFunction(() => (window.geode?.app?.obsidianLoadReport?.get?.() ?? []).some(r => r.id === "dataview"), null, { timeout: 12000 });
await page.evaluate(async () => {
  const v = window.geode.app.vault;
  await v.create("stat-a.md", "x".repeat(500) + "\n").catch(()=>{});
  await v.create("stat-b.md", "y".repeat(50) + "\n").catch(()=>{});
});
// also inspect TFile.stat directly
const direct = await page.evaluate(() => {
  const f = window.app.vault.getAbstractFileByPath("stat-a.md");
  return { stat: f ? f.stat : null };
});
console.log("TFile.stat (stat-a.md, content 501 bytes):", JSON.stringify(direct.stat));
await page.evaluate(async () => {
  const v = window.geode.app.vault;
  await v.create("stat-q.md", "# Q\n\n```dataview\nTABLE file.size, file.ctime, file.mtime FROM \"stat-a\" OR \"stat-b\"\n```\n").catch(()=>{});
  window.geode.app.workspace.openFile("stat-q.md");
  const t = window.geode.app.workspace.getActiveTab(); if (t) window.geode.app.workspace.setTabMode(t.id, "preview");
});
await new Promise(r=>setTimeout(r,1200));
const rows = await page.evaluate(() => {
  const tbl = document.querySelector(".dataview.table-view-table");
  if (!tbl) return null;
  return Array.from(tbl.querySelectorAll("tr")).map(tr => Array.from(tr.querySelectorAll("td,th")).map(c=>c.textContent.trim()).join(" | "));
});
console.log("Dataview TABLE file.size/ctime/mtime rows:", JSON.stringify(rows, null, 1));
await browser.close();
