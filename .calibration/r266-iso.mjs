import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on("pageerror", e => errs.push(String(e).slice(0,90)));
page.on("console", m => { if (m.type()==="error") errs.push("c:"+m.text().slice(0,90)); });
await page.addInitScript(({m,j}) => {
  window.__geodeObsidianPlugins = [{dir:"calendar-beta",manifestJson:j,mainJs:m,stylesCss:null,dataJson:null}];
  window.__geodeObsidianConfig = {"community-plugins.json":'["calendar-beta"]'};
  try{localStorage.setItem("geode.locale","en");}catch{}
}, {m:readFileSync(".calibration/calendar/main.js","utf8"),j:readFileSync(".calibration/calendar/manifest.json","utf8")});
await page.goto("http://localhost:1420");
await page.waitForFunction(()=>!!window.geode&&!!window.app,null,{timeout:15000});
await page.waitForFunction(()=>(window.geode?.app?.obsidianLoadReport?.get?.()??[]).some(r=>r.id==="calendar-beta"),null,{timeout:12000}).catch(()=>{});
await new Promise(r=>setTimeout(r,1000));
const dom = await page.evaluate(()=>({ appContainers: document.querySelectorAll(".app-container").length, hasApp: !!document.querySelector(".app") }));
console.log("LOAD ONLY (no view opened): errors =", errs.length, "|", errs.join(" || "));
console.log(".app-container count:", dom.appContainers, "| .app present:", dom.hasApp);
await browser.close();
