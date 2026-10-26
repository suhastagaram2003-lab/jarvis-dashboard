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

const fixtureProject = () => ({
  name: "marketbrain", label: "MarketBrain", color: "#00d4ff", status: "ok", reason: "",
  card: { label: "MarketBrain", dot: "ok", queueCount: 1, ageText: "2h ago" },
  health: { lint_errors: 0, lint_warnings: 3, stale_pages: 2, sources_unprocessed: 4 },
  agents: [{ name: "MarketBrain nightly", kind: "schedule", status: "ok", last_run: "2026-10-23T02:00:00-04:00",
    next_run: "2026-10-24T02:00:00-04:00", summary: "Bridges merged PRs.", link: "" }],
  queue: [item("marketbrain")],
  learning: [{ date: "2026-10-22", kind: "lesson", title: "Wide opening ranges fail more often",
    citation: "[[lessons/wide-opening-ranges]]", link: "obsidian://open?vault=Suhas&file=x" }],
  suggestions: [{ rank: 1, title: "Split the nightly report by stage", why: "Failures are hard to place.", source: "tune" }],
  metrics: [{ label: "Pick hit rate", value: "58%", trend: "flat", help: "Share of picks above entry." }],
  links: [{ label: "Vault", url: "obsidian://open?vault=Suhas" }],
  recent: [{ title: "NVDA", rel: "vault/wiki/NVDA.md", mtime: 1, link: "obsidian://open?vault=Suhas&file=vault%2Fwiki%2FNVDA" }],
});

test("projectSections lists the eight sections in order with the project's rows", async () => {
  const { projectSections } = await load();
  const sections = projectSections(fixtureProject());
  assert.deepEqual(sections.map(s => s.title), ["Health", "Agents and schedules", "Waiting on you", "What it learned",
    "Fix next", "Metrics", "Recent pages", "Links"]);
  assert.deepEqual(sections[0].items.map(i => i.title), ["Lint errors", "Lint warnings", "Stale pages", "Unprocessed sources"]);
  assert.deepEqual(sections[0].items.map(i => i.value), ["0", "3", "2", "4"]);
  assert.equal(sections[0].items[1].tone, "warn");
  assert.equal(sections[1].items[0].title, "MarketBrain nightly");
  assert.equal(sections[2].items[0].title, "marketbrain item");
  assert.match(sections[3].items[0].text, /2026-10-22/);
  assert.match(sections[4].items[0].title, /^1\. Split/);
  assert.equal(sections[5].items[0].value, "58%");
  assert.deepEqual([sections[6].items[0].title, sections[6].items[0].link], ["NVDA", "obsidian://open?vault=Suhas&file=vault%2Fwiki%2FNVDA"]);
  assert.equal(sections[7].items[0].link, "obsidian://open?vault=Suhas");
});

test("projectSections for a project that did not load is one Not loaded section", async () => {
  const { projectSections } = await load();
  const sections = projectSections({ name: "demo", label: "Demo", status: "error", reason: "no export yet",
    health: null, agents: [], queue: [], learning: [], suggestions: [], metrics: [], links: [], recent: [] });
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, "Not loaded");
  assert.equal(sections[0].items[0].text, "no export yet");
});

test("runRows sorts newest first and formats durations", async () => {
  const { runRows, durationText } = await load();
  const rows = runRows([
    { id: "a", kind: "execute", project: "marketbrain", label: "MarketBrain", title: "old", status: "done",
      started: "2026-10-26T10:00:00.000Z", ended: "2026-10-26T10:02:05.000Z" },
    { id: "b", kind: "chat", project: "marketbrain", label: "MarketBrain", title: "live", status: "running",
      started: "2026-10-26T11:00:00.000Z", ended: null },
    { id: "c", kind: "refresh", project: "demo", label: "Demo", title: "Refresh Demo", status: "failed",
      started: "2026-10-26T09:00:00.000Z", ended: "2026-10-26T09:00:07.000Z", error: "exit code 1" },
  ], new Date("2026-10-26T11:03:00.000Z"));
  assert.deepEqual(rows.map(r => r.id), ["b", "a", "c"]);
  assert.deepEqual(rows.map(r => r.durationText), ["running", "2m 05s", "7s"]);
  assert.deepEqual(rows.map(r => r.kind), ["Chat", "Execute", "Refresh"]);
  assert.equal(rows[1].label, "MarketBrain");
  assert.ok(rows[1].startedText.length > 0);
  assert.equal(durationText(3725000), "1h 02m");
});
