import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const CAL = ".calibration/calendar";
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on("pageerror", e => errs.push(String(e).slice(0,140)));
page.on("console", m => { if (m.type()==="error") errs.push("c:"+m.text().slice(0,140)); });
await page.addInitScript(({m,j}) => {
  window.__geodeObsidianPlugins = [{dir:"calendar-beta",manifestJson:j,mainJs:m,stylesCss:null,dataJson:null}];
  window.__geodeObsidianConfig = {"community-plugins.json":'["calendar-beta"]'};
  try{localStorage.setItem("geode.locale","en");}catch{}
}, {m:readFileSync(CAL+"/main.js","utf8"),j:readFileSync(CAL+"/manifest.json","utf8")});
await page.goto("http://localhost:1420");
await page.waitForFunction(()=>!!window.geode&&!!window.app,null,{timeout:15000});
await page.waitForFunction(()=>(window.geode?.app?.obsidianLoadReport?.get?.()??[]).some(r=>r.id==="calendar-beta"),null,{timeout:12000});
// open the calendar view
await page.evaluate(async () => {
  const leaf = window.app.workspace.getRightLeaf(false);
  await leaf.setViewState({ type: "calendar", active: true });
});
await new Promise(r=>setTimeout(r,700));
// inspect daily-notes integration availability + the clickable day elements
const info = await page.evaluate(() => {
  const ip = window.app.internalPlugins;
  const dn = ip && ip.getPluginById && ip.getPluginById("daily-notes");
  const days = document.querySelectorAll("table.calendar td .day, table.calendar .day, table.calendar td[class*='day']");
  return {
    hasInternalPlugins: !!ip,
    dailyNotes: dn ? { enabled: dn.enabled, hasInstance: !!dn.instance, options: dn.instance ? Object.keys(dn.instance.options||{}) : null } : null,
    dayCellCount: days.length,
    firstDayClass: days[0] ? days[0].className : null,
  };
});
console.log("daily-notes integration:", JSON.stringify(info, null, 1));
// list files before
const before = await page.evaluate(() => window.geode.app.vault.getFiles ? window.geode.app.vault.getFiles().map(f=>f.path) : "n/a");
// click a day cell to trigger create-daily-note
const clicked = await page.evaluate(async () => {
  const day = document.querySelector("table.calendar td .day, table.calendar .day, table.calendar td[class*='day'] span, table.calendar td");
  if (!day) return "no-day-element";
  day.click();
  await new Promise(r=>setTimeout(r,800));
  return "clicked:" + (day.className||day.tagName);
});
const after = await page.evaluate(() => window.geode.app.vault.getFiles ? window.geode.app.vault.getFiles().map(f=>f.path) : "n/a");
console.log("\nclicked:", clicked);
console.log("new files after click:", JSON.stringify(Array.isArray(after)&&Array.isArray(before) ? after.filter(p=>!before.includes(p)) : "n/a"));
console.log("errors:", errs.length, errs.slice(0,3).join(" || "));
await browser.close();
