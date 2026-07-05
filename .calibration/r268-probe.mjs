import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const T = ".calibration/tasks";
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on("pageerror", e => errs.push(String(e).slice(0,150)));
page.on("console", m => { if (m.type()==="error") errs.push("c:"+m.text().slice(0,150)); });
await page.addInitScript(({m,j}) => {
  window.__geodeObsidianPlugins = [{dir:"obsidian-tasks-plugin",manifestJson:j,mainJs:m,stylesCss:null,dataJson:null}];
  window.__geodeObsidianConfig = {"community-plugins.json":'["obsidian-tasks-plugin"]'};
  try{localStorage.setItem("geode.locale","en");}catch{}
}, {m:readFileSync(T+"/main.js","utf8"),j:readFileSync(T+"/manifest.json","utf8")});
await page.goto("http://localhost:1420");
await page.waitForFunction(()=>!!window.geode&&!!window.app,null,{timeout:15000});
await page.waitForFunction(()=>(window.geode?.app?.obsidianLoadReport?.get?.()??[]).some(r=>r.id==="obsidian-tasks-plugin"),null,{timeout:13000}).catch(()=>{});
const report = await page.evaluate(()=>(window.geode.app.obsidianLoadReport.get()??[]).find(r=>r.id==="obsidian-tasks-plugin")??null);
console.log("Tasks load:", JSON.stringify(report));
if (report?.status==="enabled") {
  const cmds = await page.evaluate(()=>(window.app.commands.listCommands?.()??[]).map(c=>c.id).filter(id=>/task/i.test(id)).slice(0,8));
  console.log("commands:", JSON.stringify(cmds));
  // seed notes with tasks + a ```tasks query
  const out = await page.evaluate(async () => {
    const v = window.geode.app.vault;
    const mk = async (p,c)=>{try{await v.create(p,c);}catch{}};
    await mk("t1.md","# N1\n\n- [ ] buy milk 📅 2026-07-01\n- [x] done thing\n");
    await mk("t2.md","# N2\n\n- [ ] write report\n");
    await new Promise(r=>setTimeout(r,1200));
    await mk("tq.md","# Q\n\n```tasks\nnot done\n```\n");
    window.geode.app.workspace.openFile("tq.md");
    const t = window.geode.app.workspace.getActiveTab(); if(t) window.geode.app.workspace.setTabMode(t.id,"preview");
    await new Promise(r=>setTimeout(r,1200));
    const block = document.querySelector(".block-language-tasks, .tasks-layout, .plugin-tasks-query-result, ul.contains-task-list");
    const err = document.querySelector(".dataview-error, .tasks-query-error, pre.language-tasks");
    return { rendered: !!block, blockClass: block?block.className.slice(0,60):null, items: block?block.querySelectorAll("li").length:0, errEl: !!err };
  });
  console.log("tasks query render:", JSON.stringify(out));
} else { console.log("=> NOT loaded."); }
console.log("errors:", errs.length); errs.slice(0,4).forEach(e=>console.log("  • "+e));
await browser.close();
