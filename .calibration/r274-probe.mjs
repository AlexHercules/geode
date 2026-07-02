/**
 * R274 desktop probe — editor right-click menu Open in new tab / Open to the right
 * on the real Tauri / WKWebView binary. Browser E2E covers MemoryVaultAdapter;
 * this loads a probe plugin into a real fs vault, opens a note, dispatches the
 * editor context menu, clicks both native menu items, and writes observed layout
 * state back to the vault.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r274-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r274-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "desk-r274.md"), "# Desktop R274\n\nbody\n");

const probe = `module.exports = {
  id: "r274-probe", name: "r274-probe",
  onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r274-results.md", b).catch(() => app.vault.modify("r274-results.md", b).catch(() => {})); };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const layout = () => ({
      active: app.workspace.getActiveFile(),
      panes: app.workspace.getPanes().map((p) => ({ id: p.id, tabs: p.tabs.map((t) => t.filePath), activeTabId: p.activeTabId })),
    });
    const menuItems = () => [...document.querySelectorAll('[data-testid="compat-menu-item"]')].map((el) => ({
      text: (el.textContent || "").trim(),
      hasSvg: !!el.querySelector('.menu-item-icon svg'),
      missing: !!el.querySelector('.geode-icon-missing'),
      warning: el.classList.contains('is-warning'),
    }));
    const openMenu = async () => {
      for (let i = 0; i < 80 && !app.documents.getActiveView(); i++) await wait(50);
      const active = app.documents.getActiveView();
      if (!active) throw new Error("active editor not mounted");
      const view = active.view;
      const r = view.contentDOM.getBoundingClientRect();
      view.contentDOM.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + 35), clientY: Math.round(r.top + 12) }));
      for (let i = 0; i < 80 && !document.querySelector('[data-testid="compat-menu"]'); i++) await wait(50);
    };
    const clickByText = (label) => {
      const item = [...document.querySelectorAll('[data-testid="compat-menu-item"]')].find((el) => (el.textContent || "").trim() === label);
      if (item) item.click();
      return !!item;
    };
    void (async () => {
      try {
        try { localStorage.setItem("geode.locale", "en"); } catch {}
        for (let i = 0; i < 80 && !(app.commands && app.commands.list().some((c) => c.id === "file-explorer:open-to-right")); i++) await wait(50);
        app.workspace.openFile("desk-r274.md");
        await wait(300);
        const tab = app.workspace.getActiveTab();
        if (tab) app.workspace.setTabMode(tab.id, "live");
        await wait(300);
        const openNewCmd = app.commands.list().find((c) => c.id === "file-explorer:open-in-new-tab");
        const openRightCmd = app.commands.list().find((c) => c.id === "file-explorer:open-to-right");
        if (!openNewCmd || !openRightCmd) throw new Error("R274 commands not registered");
        const openNew = typeof openNewCmd.name === "function" ? openNewCmd.name() : openNewCmd.name;
        const openRight = typeof openRightCmd.name === "function" ? openRightCmd.name() : openRightCmd.name;
        rec("commandNames", { openNew, openRight });
        await openMenu();
        rec("items", menuItems());
        const beforeTabs = layout().panes.reduce((n, p) => n + p.tabs.length, 0);
        rec("clickedNew", clickByText(openNew));
        await wait(250);
        rec("afterNew", { beforeTabs, layout: layout() });
        await openMenu();
        const beforePanes = layout().panes.length;
        rec("clickedRight", clickByText(openRight));
        await wait(350);
        rec("afterRight", { beforePanes, layout: layout() });
        rec("done", true);
      } catch (e) { rec("error", String(e && (e.stack || e.message) || e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r274-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 22000;
let raw = null;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) { raw = readFileSync(RESULTS, "utf8"); if (raw.includes("done=true")) break; }
  await new Promise((r) => setTimeout(r, 300));
}
try { process.kill(-child.pid); } catch { /* gone */ }
if (raw === null) { console.error("no result file produced — probe did not run"); process.exit(1); }

const data = {};
for (const line of raw.split("\n")) {
  const i = line.indexOf("=");
  if (i === -1) continue;
  try { data[line.slice(0, i)] = JSON.parse(line.slice(i + 1)); } catch { /* partial */ }
}

console.log("— editor menu actions on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("command names resolved", data.commandNames?.openNew === "Open in new tab" && data.commandNames?.openRight === "Open to the right", JSON.stringify(data.commandNames));
const labels = Array.isArray(data.items) ? data.items.map((i) => i.text) : [];
ok("menu contains Open in new tab", labels.includes("Open in new tab"), JSON.stringify(labels));
ok("menu contains Open to the right", labels.includes("Open to the right"), JSON.stringify(labels));
for (const label of ["Open in new tab", "Open to the right"]) {
  const item = data.items?.find((i) => i.text === label);
  ok(`${label} has real icon`, item?.hasSvg === true && item?.missing === false, JSON.stringify(item));
}
ok("clicked Open in new tab", data.clickedNew === true);
const tabsAfter = data.afterNew?.layout?.panes?.reduce((n, p) => n + p.tabs.length, 0) ?? 0;
ok("new-tab click adds one tab", tabsAfter === (data.afterNew?.beforeTabs ?? -10) + 1, JSON.stringify(data.afterNew));
ok("clicked Open to the right", data.clickedRight === true);
ok("right-open click adds one pane", data.afterRight?.layout?.panes?.length === (data.afterRight?.beforePanes ?? -10) + 1, JSON.stringify(data.afterRight));
ok("active file remains desk-r274.md", data.afterRight?.layout?.active === "desk-r274.md", JSON.stringify(data.afterRight));

console.log(`\nR274 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
