import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const CAL = ".calibration/calendar";
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on("pageerror", e => errs.push(String(e).slice(0,160)));
page.on("console", m => { if (m.type()==="error") errs.push("c:"+m.text().slice(0,160)); });
await page.addInitScript(({m,j}) => {
  window.__geodeObsidianPlugins = [{dir:"calendar-beta",manifestJson:j,mainJs:m,stylesCss:null,dataJson:null}];
  window.__geodeObsidianConfig = {"community-plugins.json":'["calendar-beta"]'};
  try{localStorage.setItem("geode.locale","en");}catch{}
}, {m:readFileSync(CAL+"/main.js","utf8"),j:readFileSync(CAL+"/manifest.json","utf8")});
await page.goto("http://localhost:1420");
await page.waitForFunction(()=>!!window.geode&&!!window.app,null,{timeout:15000});
await page.waitForFunction(()=>(window.geode?.app?.obsidianLoadReport?.get?.()??[]).some(r=>r.id==="calendar-beta"),null,{timeout:12000});
await page.evaluate(async () => { const leaf = window.app.workspace.getRightLeaf(false); await leaf.setViewState({ type: "calendar", active: true }); });
await new Promise(r=>setTimeout(r,700));
const opts = await page.evaluate(() => {
  const dn = window.app.internalPlugins.getPluginById("daily-notes");
  return dn && dn.instance ? dn.instance.options : null;
});
console.log("daily-notes option VALUES:", JSON.stringify(opts));
const before = await page.evaluate(() => window.app.vault.getFiles().map(f=>f.path));
// click a CURRENT-month day (.day not .adjacent-month)
const clicked = await page.evaluate(async () => {
  const days = [...document.querySelectorAll("table.calendar td .day, table.calendar .day")].filter(d => !/adjacent-month/.test(d.className) && !/adjacent-month/.test(d.parentElement?.className||""));
  const target = days.find(d => /^\d+$/.test((d.textContent||"").trim())) || days[0];
  if (!target) return "no-current-day";
  const errBefore = window.__r267errs ? window.__r267errs.length : 0;
  target.click();
  await new Promise(r=>setTimeout(r,1000));
  return "clicked day text=" + (target.textContent||"").trim() + " cls=" + target.className;
});
const after = await page.evaluate(() => window.app.vault.getFiles().map(f=>f.path));
console.log("clicked:", clicked);
console.log("new files:", JSON.stringify(after.filter(p=>!before.includes(p))));
console.log("errors:", errs.length);
errs.forEach(e=>console.log("  • "+e));
await browser.close();
