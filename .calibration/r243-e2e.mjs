/**
 * R243 index markdown image embeds `![](x)` E2E — browser mode :1420.
 * Run: node .calibration/r243-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 243 additions".
 *
 * parseNote previously skipped markdown image embeds `![](x)`, so getAttachmentMap (orphan
 * detection) missed them and renames didn't rewrite them. R243 indexes them with the LinkRef
 * span EXCLUDING the leading `!`, so R16 rewrite preserves the embed marker (![](old)→![](new)).
 * Data-safety: a rename must NOT demote an embed to a plain link, and orphan detection must
 * now see embed referrers.
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
await page.waitForFunction(() => !!window.geode && !!window.__geodeRename, null, { timeout: 15000 });
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.__geodeRename, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r243", name: "r243", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await app(async () => {
  const W = window.__app;
  await W.vault.create("pic.png", "img-bytes").catch(() => {});
  // a note that references the SAME attachment via a markdown EMBED and a markdown LINK
  await W.vault.create("note.md", "# note\nbefore ![](pic.png) after\nand a [link](pic.png) too\n").catch(() => {});
  // a second note that references it ONLY via a markdown embed (the orphan-detection case)
  await W.vault.create("other.md", "see ![alt text](pic.png) here\n").catch(() => {});
});
await wait(250);

console.log("— getAttachmentMap now counts markdown image embeds (orphan detection is complete) —");
ok("the ![](pic.png) embed referrer is indexed", await app(() => {
  const refs = window.__app.metadata.getAttachmentMap().get("pic.png");
  return !!refs && refs.has("note.md") && refs.has("other.md");
}), "the orphan-detection map must see embed referrers");

console.log("— getOutgoingLinks includes the markdown embed (isolated: other.md has ONLY the embed) —");
ok("other.md's outgoing links include the ![alt](pic.png) embed (no plain link to mask it)", await app(() => {
  return window.__app.metadata.getOutgoingLinks("other.md").some((o) => o.resolvedPath === "pic.png");
}));

console.log("— renaming the attachment rewrites the embed, preserving the `!` (no demotion) —");
const after = await app(async () => {
  await window.__geodeRename("pic.png", "renamed.png");
  return { note: await window.__app.vault.read("note.md"), other: await window.__app.vault.read("other.md") };
});
ok("![](pic.png) → ![](renamed.png) (embed marker preserved)", after.note.includes("![](renamed.png)"), JSON.stringify(after.note));
ok("the embed was NOT demoted to a plain link [](renamed.png)", !after.note.includes("before [](renamed.png)"));
ok("the markdown link [link](pic.png) is also rewritten", after.note.includes("[link](renamed.png)"));
ok("no stale pic.png reference remains in note.md", !after.note.includes("pic.png"));
ok("the embed in other.md (![alt text]) is rewritten + marker preserved", after.other.includes("![alt text](renamed.png)") && !after.other.includes("pic.png"), JSON.stringify(after.other));

console.log("— after rename, getAttachmentMap tracks the new path —");
ok("getAttachmentMap now keys renamed.png with both referrers", await app(() => {
  const refs = window.__app.metadata.getAttachmentMap().get("renamed.png");
  return !!refs && refs.has("note.md") && refs.has("other.md");
}));

// data-safety §B metachar row: rename an EMBED's target into a `( ) space` name → href must
// percent-encode AND keep the `!` (the embed reuses R16's vetted markdown rewrite branch).
console.log("— embed rename into a metachar filename: percent-encode href, `!` preserved —");
const meta = await app(async () => {
  await window.__app.vault.create("mp.png", "img").catch(() => {});
  await window.__app.vault.create("memb.md", "x ![cap](mp.png) y\n").catch(() => {});
  await new Promise((r) => setTimeout(r, 60));
  await window.__geodeRename("mp.png", "m p(1).png");
  return window.__app.vault.read("memb.md");
});
ok("embed → ![cap](m%20p%281%29.png) (! preserved + ( ) space percent-encoded)", meta.includes("![cap](m%20p%281%29.png)"), JSON.stringify(meta));
ok("no raw unencoded '(' nor demotion to plain link", !meta.includes("p(1)") && !meta.includes("x [cap]("), JSON.stringify(meta));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR243 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
