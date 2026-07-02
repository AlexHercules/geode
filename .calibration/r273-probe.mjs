/**
 * R273 desktop probe — verifies attachment-folder dropdown state on the REAL
 * Tauri / WKWebView binary. Browser E2E covers the DOM surface; this probe
 * opens Settings via app command, clicks Files & Links, selects modes, and
 * writes the observed localStorage/UI state back to the vault.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r273-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r273-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "n.md"), "# n\n");

const probe = `module.exports = {
  id: "r273-probe", name: "r273-probe",
  onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r273-results.md", b).catch(() => app.vault.modify("r273-results.md", b).catch(() => {})); };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    void (async () => {
      try {
        try { localStorage.setItem("geode.locale", "en"); } catch {}
        for (let i = 0; i < 80 && !(window.app && window.app.commands); i++) await wait(50);
        window.app.commands.executeCommandById("app:open-settings");
        for (let i = 0; i < 80 && !document.querySelector('[data-testid="settings-modal"]'); i++) await wait(50);
        const nav = [...document.querySelectorAll(".settings-nav-item")].find((n) => /Files & links|文件与链接/.test(n.textContent || ""));
        rec("navFound", !!nav);
        nav && nav.click();
        for (let i = 0; i < 80 && !document.querySelector('[data-testid="settings-attachment-folder"]'); i++) await wait(50);
        const snap = (label) => {
          const sel = document.querySelector('[data-testid="settings-attachment-folder"]');
          const path = document.querySelector('[data-testid="settings-attachment-folder-path"]');
          rec(label, { tag: sel && sel.tagName, mode: sel && sel.value, pathVisible: !!path, pathValue: path && path.value, stored: localStorage.getItem("geode.attachmentFolder") });
        };
        snap("initial");
        const sel = document.querySelector('[data-testid="settings-attachment-folder"]');
        const setMode = async (mode) => { sel.value = mode; sel.dispatchEvent(new Event("change", { bubbles: true })); await wait(120); };
        await setMode("root"); snap("root");
        await setMode("subfolder");
        let path = document.querySelector('[data-testid="settings-attachment-folder-path"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(path, "pics"); path.dispatchEvent(new Event("input", { bubbles: true })); await wait(120); snap("subfolder");
        await setMode("specified");
        path = document.querySelector('[data-testid="settings-attachment-folder-path"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(path, "assets2"); path.dispatchEvent(new Event("input", { bubbles: true })); await wait(120); snap("specified");
        rec("done", true);
      } catch (e) { rec("error", String(e && e.stack || e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r273-probe.js"), probe);
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

console.log("— attachment dropdown on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("Files & Links nav found", data.navFound === true);
ok("initial control is select and preserves assets default", data.initial?.tag === "SELECT" && data.initial?.mode === "specified" && data.initial?.pathValue === "assets", JSON.stringify(data.initial));
ok("root stores '/' and hides path", data.root?.mode === "root" && data.root?.stored === "/" && data.root?.pathVisible === false, JSON.stringify(data.root));
ok("subfolder + pics stores './pics'", data.subfolder?.mode === "subfolder" && data.subfolder?.stored === "./pics" && data.subfolder?.pathValue === "pics", JSON.stringify(data.subfolder));
ok("specified + assets2 stores 'assets2'", data.specified?.mode === "specified" && data.specified?.stored === "assets2" && data.specified?.pathValue === "assets2", JSON.stringify(data.specified));

console.log(`\nR273 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
