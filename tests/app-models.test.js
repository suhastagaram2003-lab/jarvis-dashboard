// Pure view models of the web front end (app/web/models.js), imported into Node as an ES module.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { pathToFileURL } = require("url");

const MODELS = pathToFileURL(path.join(__dirname, "..", "app", "web", "models.js")).href;
const load = () => import(MODELS);

const item = (project, over = {}) => ({
  project, label: project === "marketbrain" ? "MarketBrain" : "Demo", color: "#00d4ff", kind: "proposal",
  title: `${project} item`, age_days: 2, urgency: "normal", id: "a".repeat(12), allowed: true, run: null,
  action: { label: "Review", command: 'claude "/review"' }, ...over,
});

const twoProjects = () => ({
  projects: [
    { name: "marketbrain", label: "MarketBrain", color: "#00d4ff", status: "ok", queue: [item("marketbrain")] },
    { name: "demo", label: "Demo", color: "#44c98f", status: "ok", queue: [item("demo")] },
  ],
  queue: [
    item("demo", { id: "b".repeat(12), urgency: "high", kind: "failed-run", title: "nightly failed", age_days: 0 }),
    item("marketbrain", { id: "c".repeat(12), title: "Update strategies/orb" }),
    item("demo", { id: "d".repeat(12), urgency: "low", kind: "lint-error", title: "lint", age_days: 9,
      allowed: "only Claude prompts can run from Jarvis", action: { label: "Fix", command: "uv run mb lint --fix" } }),
    item("marketbrain", { id: "e".repeat(12), title: "running one", run: { id: "r1", status: "running" } }),
  ],
  errors: [],
});

test("taskRows groups by project in rank order and carries reasons, badges and button labels", async () => {
  const { taskRows } = await load();
  const groups = taskRows(twoProjects());
  assert.deepEqual(groups.map(g => g.project), ["demo", "marketbrain"]);
  assert.equal(groups[0].label, "Demo");
  assert.equal(groups[0].rows[0].urgency, "high");
  assert.equal(groups[0].rows[0].ageText, "today");
  assert.equal(groups[0].rows[1].disabledReason, "only Claude prompts can run from Jarvis");
  assert.equal(groups[0].rows[1].ageText, "9 days");
  const mb = groups[1].rows;
  assert.deepEqual([mb[0].buttonLabel, mb[0].disabledReason, mb[0].badge], ["Review", null, null]);
  assert.deepEqual([mb[1].buttonLabel, mb[1].badge], ["Open run", "Running"]);
  assert.ok(mb.every(r => /^[a-f0-9]{12}$/.test(r.id)));
});

test("taskRows filters to one project and names the other badges", async () => {
  const { taskRows, badgeFor } = await load();
  const only = taskRows(twoProjects(), "marketbrain");
  assert.deepEqual(only.map(g => g.project), ["marketbrain"]);
  assert.equal(badgeFor("waiting"), "Needs you");
  assert.deepEqual(["done", "failed", "stopped", "stalled"].map(badgeFor), ["Done", "Failed", "Stopped", "Stalled"]);
  assert.equal(taskRows({ projects: [], queue: [], errors: [] }).length, 0);
});

test("tabList has Tasks first, one tab per project, then Chat and Runs last", async () => {
  const { tabList } = await load();
  const tabs = tabList(twoProjects());
  assert.deepEqual(tabs.map(t => t.id), ["tasks", "project:marketbrain", "project:demo", "chat", "runs"]);
  assert.equal(tabs[0].count, 4);
  assert.equal(tabs[1].label, "MarketBrain");
  assert.equal(tabs[tabs.length - 1].label, "Runs");
});

test("panelLines merges text deltas, keeps asks with their request id and marks answered ones", async () => {
  const { panelLines } = await load();
  const lines = panelLines([
    { type: "process", resume: null },
    { type: "user", text: "/review" },
    { type: "session", session_id: "fake-1" },
    { type: "text", text: "Hel" }, { type: "text", text: "lo" },
    { type: "tool", name: "Bash", summary: '{"command":"echo hi"}' },
    { type: "permission", request_id: "r1", tool: "Bash", input: { command: "echo hi" } },
    { type: "permission", request_id: "r2", tool: "Edit", input: { file_path: "x" } },
    { type: "answer", request_id: "r1", allow: true },
    { type: "stderr", text: "warn" },
    { type: "text", text: "allowed" },
    { type: "result", is_error: false, text: "done" },
    { type: "exit", code: 0 },
  ]);
  assert.deepEqual(lines.map(l => l.kind), ["user", "text", "tool", "permission", "permission", "status", "stderr", "text"]);
  assert.equal(lines[1].text, "Hello");
  assert.match(lines[2].text, /Bash/);
  assert.deepEqual([lines[3].request_id, lines[3].answered, lines[3].tool], ["r1", true, "Bash"]);
  assert.deepEqual([lines[4].request_id, lines[4].answered], ["r2", false]);
  assert.match(lines[5].text, /Approved Bash/);
  assert.equal(lines[7].text, "allowed");
});

test("panelLines reports failures and resumed sessions as status lines", async () => {
  const { panelLines } = await load();
  const lines = panelLines([
    { type: "process", resume: "fake-1" }, { type: "user", text: "more" },
    { type: "result", is_error: true, text: "rate limited" }, { type: "exit", code: 3 },
  ]);
  assert.deepEqual(lines.map(l => l.kind), ["status", "user", "status", "status"]);
  assert.match(lines[0].text, /Resumed/);
  assert.match(lines[2].text, /rate limited/);
  assert.match(lines[3].text, /code 3/);
});
