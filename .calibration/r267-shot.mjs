import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
await page.goto("http://localhost:1420");
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await new Promise(r=>setTimeout(r,800));
const layout = await page.evaluate(() => {
  const wrap = document.querySelector("body > .app-container");
  const app = document.querySelector(".app-container > #root .app, #root .app");
  return {
    wrapperOutsideRoot: !!wrap && wrap.contains(document.getElementById("root")),
    appContainerCount: document.querySelectorAll(".app-container").length,
    appPresent: !!app, appHeight: app ? Math.round(app.getBoundingClientRect().height) : 0,
    editorOrSidebar: !!document.querySelector(".sidebar, .workspace, .cm-editor, .main"),
  };
});
console.log("layout:", JSON.stringify(layout));
await page.screenshot({ path: ".calibration/r267-layout.png" });
console.log("screenshot saved");
await browser.close();
