/**
 * R280 desktop probe — verifies the vault manager + create-new-vault command on the
 * real Tauri/WKWebView binary. Browser E2E covers the modal rendering; this probe locks
 * the desktop-only "Create new vault" path and command registry against App Nap.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r280-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r280-results.md");

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
  id: "r280-probe", name: "r280-probe",
  onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r280-results.md", b).catch(() => app.vault.modify("r280-results.md", b).catch(() => {})); };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const safeErr = (e) => ({ msg: String(e?.message ?? e), stack: String(e?.stack ?? "") });
    void (async () => {
      try {
        try { localStorage.setItem("geode.locale", "en"); } catch {}
        for (let i = 0; i < 120 && !(window.app && window.app.commands); i++) await wait(50);

        // 1. command registry (use the Geode app passed to onload, not window.app)
        const list = app.commands.list();
        const createCmd = list.find((c) => c.id === "app:create-new-vault");
        const switchCmd = list.find((c) => c.id === "app:switch-vault");
        rec("createCmdRegistered", !!createCmd);
        rec("createCmdAvailable", createCmd ? createCmd.available() : false);
        rec("switchCmdRegistered", !!switchCmd);

        // 2. open vault manager and inspect DOM
        app.commands.execute("app:switch-vault");
        for (let i = 0; i < 120 && !document.querySelector('[data-testid="vaultmanager-modal"]'); i++) await wait(50);
        const modal = document.querySelector('[data-testid="vaultmanager-modal"]');
        rec("modalPresent", !!modal);
        rec("titlePresent", !!document.querySelector('[data-testid="vaultmanager-title"]'));
        rec("createBtnPresent", !!document.querySelector('[data-testid="vaultmanager-create-new"]'));
        rec("openOtherPresent", !!document.querySelector('[data-testid="vaultmanager-open-other"]'));

        // 3. create-new-vault command availability matches adapter
        rec("adapterKind", app.vault.adapter.kind);

        rec("done", true);
      } catch (e) { rec("error", safeErr(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r280-probe.js"), probe);
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

console.log("— Vault manager on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("app:create-new-vault registered", data.createCmdRegistered === true);
ok("app:create-new-vault available on desktop", data.createCmdAvailable === true);
ok("app:switch-vault registered", data.switchCmdRegistered === true);
ok("vault manager modal rendered", data.modalPresent === true);
ok("vault manager title rendered", data.titlePresent === true);
ok("'Create new vault' button present (desktop)", data.createBtnPresent === true);
ok("'Open another vault' button present", data.openOtherPresent === true);
ok("adapter kind is tauri", data.adapterKind === "tauri");

console.log(`\nR280 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
