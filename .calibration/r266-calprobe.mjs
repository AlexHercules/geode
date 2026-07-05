import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const CAL = ".calibration/calendar";
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0,140)));
page.on("console", (m) => { if (m.type()==="error") errors.push("console: "+m.text().slice(0,120)); });
await page.addInitScript(({ m, j }) => {
  window.__geodeObsidianPlugins = [{ dir: "calendar-beta", manifestJson: j, mainJs: m, stylesCss: null, dataJson: null }];
  window.__geodeObsidianConfig = { "community-plugins.json": '["calendar-beta"]' };
  try { localStorage.setItem("geode.locale","en"); } catch {}
}, { m: readFileSync(CAL+"/main.js","utf8"), j: readFileSync(CAL+"/manifest.json","utf8") });
await page.goto("http://localhost:1420");
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.waitForFunction(() => (window.geode?.app?.obsidianLoadReport?.get?.() ?? []).some(r => r.id==="calendar-beta"), null, { timeout: 12000 }).catch(()=>{});
const report = await page.evaluate(() => (window.geode.app.obsidianLoadReport.get() ?? []).find(r => r.id==="calendar-beta") ?? null);
console.log("Calendar load:", JSON.stringify(report));
if (report?.status === "enabled") {
  // list registered views + commands; try to open the calendar view
  const info = await page.evaluate(async () => {
    const cmds = (window.app.commands.listCommands?.() ?? []).map(c=>c.id).filter(id=>/calendar/i.test(id));
    let opened = null;
    try {
      // most calendar plugins register a view type "calendar"
      const leaf = window.app.workspace.getRightLeaf ? window.app.workspace.getRightLeaf(false) : null;
      if (leaf && leaf.setViewState) { await leaf.setViewState({ type: "calendar", active: true }); opened = "setViewState"; }
    } catch(e) { opened = "ERR:"+e.message; }
    await new Promise(r=>setTimeout(r,600));
    const el = document.querySelector(".calendar, [data-type='calendar'], .workspace-leaf-content[data-type='calendar']");
    return { calendarCommands: cmds, opened, viewRendered: !!el, viewHtml: el ? el.outerHTML.slice(0,120) : null };
  });
  console.log("commands:", JSON.stringify(info.calendarCommands));
  console.log("open view:", info.opened, "| rendered:", info.viewRendered, info.viewHtml ? "| "+info.viewHtml.replace(/\n/g," ") : "");
} else {
  console.log("=> NOT loaded. lastError surfaces the blocker.");
}
console.log("errors:", errors.length, errors.slice(0,3).join(" || "));
await browser.close();
