const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadModule, readJson } = require("./load-module");

const hubSchema = readJson("schema/hub-export-v1.json");
const store = loadModule("hub/hub-store.js", { hubSchema });
const NOW = new Date("2026-10-23T12:00:00Z");
const fixture = (over = {}) => JSON.stringify({ ...readJson("examples/projects/marketbrain.json"),
  exported_at: "2026-10-23T06:00:00Z", ...over });

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-hub-"));
const agent = (over = {}) => ({ name: "nightly", kind: "schedule", status: "ok", last_run: "2026-10-23T05:00:00Z",
  next_run: "2026-10-24T05:00:00Z", summary: "Nightly ingest and lint", link: "", ...over });
const item = (age) => ({ kind: "proposal", title: `item ${age}`, age_days: age,
  action: { label: "Review", command: 'claude "/review"' } });
// proj(label, queue, agents, color) or proj(label, { ...export field overrides }, color)
const proj = (label, queue = [], agents = [], color = "#00d4ff") => {
  let over;
  if (!Array.isArray(queue)) { over = queue; color = typeof agents === "string" ? agents : color; }
  else over = { queue, agents };
  const blank = { learning: [], suggestions: [], metrics: [], links: [], queue: [], agents: [] };
  return {
    entry: { name: label.toLowerCase(), label, color, path: `C:\\Projects\\${label}` },
    status: "ok", reason: "",
    data: { ...readJson("examples/projects/marketbrain.json"), exported_at: "2026-10-23T06:00:00Z",
      ...(Array.isArray(queue) ? {} : blank), ...over },
  };
};
const learn = (date, over = {}) => ({ date, kind: "lesson", title: `lesson ${date}`, citation: "[[lessons/x]]",
  link: "", ...over });
const sugg = (rank, over = {}) => ({ rank, title: `fix ${rank}`, why: "because", source: "tune", ...over });
const metric = (label = "Hit rate") => ({ label, value: "58%", trend: "flat", help: "" });
const link = (label = "Vault") => ({ label, url: "obsidian://open?vault=Suhas" });
const errorProj = () => ({ entry: { name: "x", label: "X", color: "#fff", path: "C:\\x" },
  status: "error", reason: "no export yet", data: null });

const staleProj = () => ({ ...proj("Old"), status: "stale", reason: "export 48h old" });

test("example fixture validates", () => assert.deepEqual(store.validateExport(JSON.parse(fixture())), []));
test("ok export", () => assert.equal(store.parseExport(fixture(), NOW).status, "ok"));
test("stale export keeps data", () => {
  const r = store.parseExport(fixture({ exported_at: "2026-10-21T12:00:00Z" }), NOW);
  assert.deepEqual([r.status, r.reason, !!r.data], ["stale", "export 48h old", true]);
});
test("wrong schema", () => assert.equal(store.parseExport(fixture({ schema: 2 }), NOW).reason, "schema 2 not supported"));
test("broken JSON", () => assert.match(store.parseExport("{", NOW).reason, /^invalid JSON/));
test("missing export", () => assert.equal(store.parseExport(null, NOW).reason, "no export yet"));
test("bad enum", () => assert.match(store.parseExport(fixture({ agents: [{ ...agent(), status: "x" }] }), NOW).reason,
  /agents\[0\]\.status/));
test("local-offset exported_at and empty run fields are fine", () => {
  const r = store.parseExport(fixture({ exported_at: "2026-10-23T01:00:00-04:00",
    agents: [agent({ last_run: "", next_run: "", link: "" })] }), NOW);
  assert.deepEqual([r.status, r.reason], ["ok", ""]);
});
test("unknown key is rejected like the schema does", () =>
  assert.match(store.parseExport(fixture({ extra: 1 }), NOW).reason, /extra: unexpected key/));
test("non-integer health count", () =>
  assert.match(store.parseExport(fixture({ health: { lint_errors: 0.5, lint_warnings: 0, stale_pages: 0,
    sources_unprocessed: 0 } }), NOW).reason, /health\.lint_errors/));
test("missing key", () => {
  const obj = JSON.parse(fixture()); delete obj.health;
  assert.match(store.validateExport(obj)[0], /health/);
});
test("no registry", () => assert.match(store.loadRegistry(fs, tmpDir()).error, /^no registry/));
test("registry and exports load, a broken project does not hide the others", () => {
  const home = tmpDir();
  fs.mkdirSync(path.join(home, "projects"));
  fs.writeFileSync(path.join(home, "registry.json"), JSON.stringify({ projects: [
    { name: "marketbrain", label: "MarketBrain", path: "C:\\mb", color: "#00d4ff" },
    { name: "betbrain", label: "BetBrain", path: "C:\\bb", color: "#44c98f" },
    { name: "broken", label: "Broken", path: "C:\\x", color: "#e74c3c" },
  ] }));
  fs.writeFileSync(path.join(home, "projects", "marketbrain.json"), fixture());
  fs.writeFileSync(path.join(home, "projects", "broken.json"), "{nope");
  const ps = store.loadProjects({ fs, jarvisHome: home, now: NOW });
  assert.deepEqual(ps.map(p => [p.entry.label, p.status]),
    [["MarketBrain", "ok"], ["BetBrain", "error"], ["Broken", "error"]]);
  assert.equal(ps[1].reason, "no export yet");
  assert.match(ps[2].reason, /^broken\.json: invalid JSON/);
});
test("queue merge sorts oldest first across projects", () => {
  const q = store.mergeQueue([proj("MarketBrain", [item(1)]), proj("BetBrain", [item(5)]), errorProj()]);
  assert.deepEqual(q.map(i => [i.project, i.age_days]), [["BetBrain", 5], ["MarketBrain", 1]]);
});
test("waiting count", () => assert.equal(store.waitingCount([proj("A", [item(1), item(2)]), errorProj()]), 2));
test("waiting text", () => assert.deepEqual([0, 1, 3].map(store.waitingText),
  ["All clear", "1 thing waits on you", "3 things wait on you"]));
test("expandHome on Windows paths", () => assert.equal(store.expandHome("~\\.jarvis", "C:\\Users\\u"), "C:\\Users\\u\\.jarvis"));
test("expandHome on posix paths", () => assert.equal(store.expandHome("~/.jarvis", "/home/u"), "/home/u/.jarvis"));


test("card is grey for a stale export", () => assert.equal(store.projectCard(staleProj(), NOW).dot, "grey"));
test("card is grey for a missing export", () => {
  const c = store.projectCard(errorProj(), NOW);
  assert.deepEqual([c.dot, c.reason, c.ageText, c.queueCount], ["grey", "no export yet", "", 0]);
});
test("card warns on a failed agent", () => assert.equal(store.projectCard(proj("MB", [], [agent({ status: "failed" })]), NOW).dot, "warn"));
test("card warns on a missed agent", () => assert.equal(store.projectCard(proj("MB", [], [agent({ status: "missed" })]), NOW).dot, "warn"));
test("card warns on lint errors", () => {
  const p = proj("MB"); p.data.health = { ...p.data.health, lint_errors: 2 };
  assert.equal(store.projectCard(p, NOW).dot, "warn");
});
test("healthy card", () => {
  const c = store.projectCard(proj("MB", [item(1), item(2)], [agent()]), NOW);
  assert.deepEqual([c.label, c.color, c.dot, c.queueCount, c.ageText, c.reason], ["MB", "#00d4ff", "ok", 2, "6h ago", ""]);
});
test("agent cards carry project color", () => assert.deepEqual(
  store.agentCards([proj("MB", [], [agent({ name: "MarketBrain nightly" })], "#00d4ff")]).map(a => [a.name, a.color]),
  [["MarketBrain nightly", "#00d4ff"]]));
test("agent cards map fields and skip unusable projects", () => assert.deepEqual(
  store.agentCards([proj("MB", [], [agent({ status: "failed" })]), errorProj()]),
  [{ name: "nightly", displayName: "nightly", color: "#00d4ff", description: "Nightly ingest and lint",
     status: "failed", last_run: "2026-10-23T05:00:00Z", project: "MB" }]));

test("learning feed is newest first across projects", () => {
  const rows = store.learningFeed([proj("MB", { learning: [learn("2026-10-20")] }), proj("BB", { learning: [learn("2026-10-22")] })]);
  assert.deepEqual(rows.map(r => [r.project, r.date]), [["BB", "2026-10-22"], ["MB", "2026-10-20"]]);
});
test("learning feed rows carry color and respect the limit", () => {
  const rows = store.learningFeed([proj("MB", { learning: ["2026-10-01", "2026-10-02", "2026-10-03"].map(d => learn(d)) }, "#123456")], 2);
  assert.deepEqual(rows.map(r => [r.date, r.color]), [["2026-10-03", "#123456"], ["2026-10-02", "#123456"]]);
});
test("suggestions by rank, projects in registry order", () => {
  const rows = store.suggestionFeed([proj("MB", { suggestions: [sugg(2), sugg(1)] }), proj("BB", { suggestions: [sugg(1)] })]);
  assert.deepEqual(rows.map(r => [r.project, r.rank]), [["MB", 1], ["BB", 1], ["MB", 2]]);
});
test("error projects are skipped", () => assert.deepEqual(store.metricTiles([errorProj()]), []));
test("metric tiles tagged with project", () => assert.deepEqual(
  store.metricTiles([proj("MB", { metrics: [metric()] })]).map(m => [m.project, m.label]), [["MB", "Hit rate"]]));
test("links grouped per project", () => assert.equal(store.linkGroups([proj("MB", { links: [link()] })])[0].links.length, 1));
test("projects without links get no group", () => assert.deepEqual(store.linkGroups([proj("MB", { links: [] })]), []));

// ── Sessions and analytics by project ──
const entries = [{ label: "MarketBrain", claude_projects_prefix: "C--Users-u-Documents-Suhas" },
                 { label: "BetBrain", claude_projects_prefix: "C--Users-u-Documents-BetBrain" }];
const stats = (sessions, tokens, over = {}) => ({
  totalSessions: sessions, totalMessages: sessions * 10, totalTokens: tokens, totalCost: tokens / 100,
  totalToolCalls: sessions * 2, favoriteModel: "opus", favPct: 100,
  dailyActivity: { "2026-10-22": { messages: sessions * 10, sessions } },
  hourlyActivity: Array.from({ length: 24 }, (_, h) => (h === 9 ? sessions : 0)),
  modelBreakdown: [{ model: "opus", count: sessions, pct: 100, cost: tokens / 100 }], ...over,
});
test("worktree dirs map to their project", () =>
  assert.equal(store.projectForDir("C--Users-u-Documents-Suhas--claude-worktrees-x", entries).label, "MarketBrain"));
test("unknown dirs map to nothing", () => assert.equal(store.projectForDir("C--Users-u-Desktop", entries), null));
test("the longest prefix wins, case-insensitive", () => {
  const es = [...entries, { label: "Sub", claude_projects_prefix: "C--Users-u-Documents-Suhas-sub" }];
  assert.equal(store.projectForDir("c--users-u-documents-suhas-sub-x", es).label, "Sub");
});
test("entries without a prefix never match", () =>
  assert.equal(store.projectForDir("anything", [{ label: "X", claude_projects_prefix: "" }, { label: "Y" }]), null));
test("stats add up per project", () => {
  const m = store.mergeStats([{ project: "MB", stats: stats(3, 100) }, { project: "BB", stats: stats(1, 50) }]);
  assert.deepEqual([m.totalSessions, m.byProject.map(p => p.sessions)], [4, [3, 1]]);
});
test("merged stats sum activity and recompute models", () => {
  const m = store.mergeStats([
    { project: "MB", stats: stats(3, 100) },
    { project: "BB", stats: stats(1, 50, { favoriteModel: "sonnet",
      modelBreakdown: [{ model: "sonnet", count: 1, pct: 100, cost: 0.5 }] }) },
  ]);
  assert.equal(m.totalTokens, 150);
  assert.equal(m.totalMessages, 40);
  assert.equal(m.hourlyActivity[9], 4);
  assert.deepEqual(m.dailyActivity["2026-10-22"], { messages: 40, sessions: 4 });
  assert.deepEqual(m.modelBreakdown.map(b => [b.model, b.count, b.pct]), [["opus", 3, 75], ["sonnet", 1, 25]]);
  assert.deepEqual([m.favoriteModel, m.favPct], ["opus", 75]);
  assert.deepEqual(m.byProject, [{ project: "MB", sessions: 3, tokens: 100, cost: 1 }, { project: "BB", sessions: 1, tokens: 50, cost: 0.5 }]);
});
test("no projects gives empty stats", () => {
  const m = store.mergeStats([]);
  assert.deepEqual([m.totalSessions, m.favPct, m.byProject, m.hourlyActivity.length], [0, 0, [], 24]);
});
