const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadModule, readJson } = require("./load-module");

const scan = loadModule("hub/stats-scan.js");
const store = loadModule("hub/hub-store.js", { hubSchema: readJson("schema/hub-export-v1.json") });
const osCompat = loadModule("core/os-compat.js");

function line(model, input, output) {
  return JSON.stringify({ type: "assistant", timestamp: "2026-10-22T09:00:00Z",
    message: { model, usage: { input_tokens: input, output_tokens: output }, content: [] } });
}
// A tiny stand-in for upstream's parseFullSession/aggregateStats (both live in the worker and the stats engine).
const parse = (file) => {
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
  const tokens = lines.reduce((n, r) => n + r.message.usage.input_tokens + r.message.usage.output_tokens, 0);
  return { mtime: fs.statSync(file).mtimeMs, tokens };
};
const aggregate = (cache) => {
  const ss = Object.values(cache.sessions);
  return { totalSessions: ss.length, totalTokens: ss.reduce((n, s) => n + s.tokens, 0), totalCost: 0 };
};

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-stats-"));
  const put = (dir, name, text) => {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, name), text + "\n");
  };
  put("C--Users-u-Documents-Suhas", "a.jsonl", line("opus", 10, 5));
  put("C--Users-u-Documents-Suhas--claude-worktrees-feat-x", "b.jsonl", line("opus", 1, 1));
  put("C--Users-u-Documents-BetBrain", "c.jsonl", line("sonnet", 100, 0));
  put("C--Users-u-Desktop", "d.jsonl", line("haiku", 1000, 0));
  return root;
}
const entries = [{ label: "MarketBrain", claude_projects_prefix: "C--Users-u-Documents-Suhas" },
                 { label: "BetBrain", claude_projects_prefix: "C--Users-u-Documents-BetBrain" }];
const deps = (root, cachePath, over = {}) => ({ fs, path, rootPath: root, entries, cachePath, periodDays: 30,
  cacheMs: 300000, parseFullSession: parse, aggregateStats: aggregate, isClaudeProjectDir: osCompat.isClaudeProjectDir,
  projectForDir: store.projectForDir, mergeStats: store.mergeStats, now: Date.now(), ...over });

test("stats per registered project, worktrees included, other folders left out", () => {
  const root = tree();
  const r = scan.scanProjectStats(deps(root, path.join(root, "cache.json")));
  assert.deepEqual(r.byProject, [
    { project: "MarketBrain", sessions: 2, tokens: 17, cost: 0 },
    { project: "BetBrain", sessions: 1, tokens: 100, cost: 0 },
  ]);
  assert.equal(r.totalSessions, 3);
});

test("the cache lives at the given path and is reused", () => {
  const root = tree();
  const cachePath = path.join(root, "jarvis", "stats-cache.json");
  scan.scanProjectStats(deps(root, cachePath));
  assert.ok(fs.existsSync(cachePath));
  fs.rmSync(path.join(root, "C--Users-u-Documents-BetBrain"), { recursive: true });
  assert.equal(scan.scanProjectStats(deps(root, cachePath)).totalSessions, 3); // fresh cache: not rescanned
  assert.equal(scan.scanProjectStats(deps(root, cachePath, { cacheMs: 0 })).totalSessions, 2);
});

test("without a registry every Claude folder counts as one group", () => {
  const root = tree();
  const r = scan.scanProjectStats(deps(root, path.join(root, "c.json"), { entries: [] }));
  assert.deepEqual(r.byProject.map(p => [p.project, p.sessions]), [["All projects", 4]]);
});
