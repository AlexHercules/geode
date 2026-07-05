/**
 * R275 desktop probe — verifies the URI-links toggle on the REAL Tauri/WKWebView
 * binary. Browser E2E covers the reading-view click gate; this probe locks the
 * real-fs Settings UI + localStorage persistence path against App Nap.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r275-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r275-results.md");

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
  id: "r275-probe", name: "r275-probe",
  onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r275-results.md", b).catch(() => app.vault.modify("r275-results.md", b).catch(() => {})); };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const safeErr = (e) => ({ msg: String(e?.message ?? e), stack: String(e?.stack ?? "") });
    void (async () => {
      try {
        try { localStorage.setItem("geode.locale", "en"); } catch {}
        for (let i = 0; i < 120 && !(window.app && window.app.commands); i++) await wait(50);

        window.app.commands.executeCommandById("app:open-settings");
        for (let i = 0; i < 120 && !document.querySelector('[data-testid="settings-modal"]'); i++) await wait(50);
        const nav = [...document.querySelectorAll(".settings-nav-item")].find((n) => /Files & links|文件与链接/.test(n.textContent || ""));
        rec("navFound", !!nav);
        nav && nav.click();
        for (let i = 0; i < 120 && !document.querySelector('[data-testid="settings-uri-links-enabled"]'); i++) await wait(50);

        const readToggle = () => {
          const el = document.querySelector('[data-testid="settings-uri-links-enabled"]');
          return { present: !!el, checked: el ? el.getAttribute("aria-checked") === "true" : null, stored: localStorage.getItem("geode.uriLinksEnabled") };
        };
        rec("initial", readToggle());

        const toggle = document.querySelector('[data-testid="settings-uri-links-enabled"]');
        toggle && toggle.click();
        await wait(150);
        rec("afterOff", readToggle());

        const toggle2 = document.querySelector('[data-testid="settings-uri-links-enabled"]');
        toggle2 && toggle2.click();
        await wait(150);
        rec("afterOn", readToggle());

        // Also verify the gate constant is reachable in the editor module (sanity).
        rec("gateExportReachable", typeof window.__geodeUri?.handle === "function");

        rec("done", true);
      } catch (e) { rec("error", safeErr(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r275-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 25000;
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

console.log("— URI-links toggle on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("Files & Links nav found", data.navFound === true);
ok("toggle present and default ON", data.initial?.present === true && data.initial?.checked === true, JSON.stringify(data.initial));
ok("toggle OFF writes localStorage false", data.afterOff?.checked === false && data.afterOff?.stored === "false", JSON.stringify(data.afterOff));
ok("toggle ON writes localStorage true", data.afterOn?.checked === true && data.afterOn?.stored === "true", JSON.stringify(data.afterOn));
ok("__geodeUri.handle probe still reachable", data.gateExportReachable === true);

console.log(`\nR275 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
