/**
 * R276 graph performance smoke — open ?bench=10000 global graph and read
 * window.__geodePerf.graphSettleMs / graphDrawMs after settle.
 * Run: node .calibration/r276-bench.mjs   (dev server :1420 up)
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420/?bench=10000";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.geode, null, { timeout: 30000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r276bench", name: "r276bench", onload(app) { window.__benchApp = app; } }));
await page.waitForFunction(() => !!window.__benchApp, null, { timeout: 5000 });
await page.evaluate(() => { window.__benchApp.workspace.openGraph(); });
await page.waitForFunction(() => !!window.__geodePerf?.graphSettleMs, null, { timeout: 120000 });
const perf = await page.evaluate(() => window.__geodePerf);
console.log(JSON.stringify(perf, null, 2));
await browser.close();
