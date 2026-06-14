/**
 * R68 desktop probe — verifies the task: + [property] search operators on the
 * REAL Tauri/WKWebView build via __geodeSearchQuery (pure parseSearchQuery +
 * evaluateSearch on a synthetic SearchInput — deterministic, App-Nap-safe).
 *
 * Run: node .calibration/r68-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 68 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r68-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r68-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "seed.md"), "# Seed\n");

const probe = `module.exports = {
  id: "r68-probe", name: "r68-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r68-results.md", b).catch(() => app.vault.modify("r68-results.md", b).catch(() => {})); };
    try {
      const S = (globalThis).__geodeSearchQuery;
      rec("present", typeof S === "function");
      const TASKS = "intro\\n- [ ] call mom\\n- [x] buy milk\\n";
      rec("task", S("task:", { content: TASKS }));
      rec("taskNone", S("task:", { content: "plain text" }));
      rec("todo", S("task-todo:", { content: TASKS }));
      rec("doneTask", S("task-done:", { content: TASKS }));
      rec("doneOnlyTodo", S("task-done:", { content: "- [ ] x" }));
      rec("taskWord", S("task:call", { content: TASKS }));
      rec("customState", S("task-done:", { content: "- [/] in progress" }));
      rec("emptyBox", S("task:", { content: "- [] not a task" }));
      rec("propKey", S("[status]", { frontmatter: { status: "done" } }));
      rec("propVal", S("[status:done]", { frontmatter: { status: "done" } }));
      rec("propValNo", S("[status:todo]", { frontmatter: { status: "done" } }));
      rec("propArr", S("[tags:work]", { frontmatter: { tags: ["work", "home"] } }));
      rec("propEmptyVal", S("[status:]", { frontmatter: { status: "done" } }));
      rec("regress", S("content:foo", { content: "a foo b" }));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r68-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 16000;
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
const J = (v) => JSON.stringify(v);

console.log("— task:/[property] search operators on real WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeSearchQuery present", data.present === true);
ok("task: matches a checkbox note", data.task === true, J(data.task));
ok("task: rejects a no-checkbox note", data.taskNone === false, J(data.taskNone));
ok("task-todo: matches (has unchecked)", data.todo === true, J(data.todo));
ok("task-done: matches (has checked)", data.doneTask === true, J(data.doneTask));
ok("task-done: rejects a todo-only note", data.doneOnlyTodo === false, J(data.doneOnlyTodo));
ok("task:call matches text in a task line", data.taskWord === true, J(data.taskWord));
ok("task-done: matches a custom state '- [/]'", data.customState === true, J(data.customState));
ok("empty box '- []' is NOT a task", data.emptyBox === false, J(data.emptyBox));
ok("[status] matches an existing key", data.propKey === true, J(data.propKey));
ok("[status:done] matches the value", data.propVal === true, J(data.propVal));
ok("[status:todo] rejects a different value", data.propValNo === false, J(data.propValNo));
ok("[tags:work] matches an array value", data.propArr === true, J(data.propArr));
ok("[status:] (empty value) == key-exists", data.propEmptyVal === true, J(data.propEmptyVal));
ok("R21 content:foo still works", data.regress === true, J(data.regress));

console.log(`\nR68 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
