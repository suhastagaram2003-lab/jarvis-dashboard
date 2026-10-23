const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Worker } = require("worker_threads");

// The worker loads core/os-compat.js itself; this checks it starts and that a Windows-named
// Claude project dir (C--Users-...) is counted, which upstream's startsWith("-") filter dropped.
test("worker counts sessions in a Windows project dir", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-worker-"));
  const proj = path.join(root, "C--Users-u-Documents-Suhas");
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, "s1.jsonl"), JSON.stringify({ type: "user", timestamp: new Date().toISOString(),
    message: { role: "user", content: "hi" } }) + "\n");
  const worker = new Worker(path.join(__dirname, "..", "src", "services", "session-worker.js"));
  try {
    const msg = await new Promise((resolve, reject) => {
      worker.on("message", resolve);
      worker.on("error", reject);
      worker.postMessage({ type: "computeStats", config: { projects: { mode: "registry", rootPath: root } } });
    });
    assert.equal(msg.type, "stats", JSON.stringify(msg));
    assert.equal(msg.stats.totalSessions, 1);
  } finally {
    await worker.terminate();
  }
});

test("worker splits stats by registered project and caches in the given file", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-worker-"));
  for (const dir of ["C--Users-u-Documents-Suhas", "C--Users-u-Documents-Suhas--claude-worktrees-x", "C--Users-u-Desktop"]) {
    fs.mkdirSync(path.join(root, dir));
    fs.writeFileSync(path.join(root, dir, "s.jsonl"), JSON.stringify({ type: "user", timestamp: new Date().toISOString(),
      message: { role: "user", content: "hi" } }) + "\n");
  }
  const cachePath = path.join(root, "jarvis", "stats-cache.json");
  const worker = new Worker(path.join(__dirname, "..", "src", "services", "session-worker.js"));
  try {
    const msg = await new Promise((resolve, reject) => {
      worker.on("message", resolve);
      worker.on("error", reject);
      worker.postMessage({ type: "computeStats", config: { projects: { mode: "registry", rootPath: root } },
        entries: [{ label: "MarketBrain", claude_projects_prefix: "C--Users-u-Documents-Suhas" },
                  { label: "BetBrain", claude_projects_prefix: "C--Users-u-Documents-BetBrain" }], cachePath });
    });
    assert.equal(msg.type, "stats", JSON.stringify(msg));
    assert.deepEqual(msg.stats.byProject.map(p => [p.project, p.sessions]), [["MarketBrain", 2], ["BetBrain", 0]]);
    assert.ok(fs.existsSync(cachePath));
  } finally {
    await worker.terminate();
  }
});
