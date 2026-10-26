const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRunManager } = require("../app/server/runs");
const { startProcess } = require("../app/server/claude-process");

const FAKE = path.join(__dirname, "fixtures", "fake-claude.js");
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-runs-"));
let seq = 0;

function manager(over = {}) {
  const jarvisHome = over.jarvisHome || home();
  const clock = { t: Date.parse("2026-10-26T10:00:00Z") };
  const m = createRunManager({
    jarvisHome, fs, startProcess, claude: { file: process.execPath, prefixArgs: [FAKE] },
    now: () => new Date(clock.t), idFn: () => `run-${++seq}`, ...over,
  });
  return { m, clock, jarvisHome };
}
const execute = (over = {}) => ({ kind: "execute", project: "marketbrain", label: "MarketBrain", item_id: "abc123abc123",
  title: "5 proposals wait", cwd: __dirname, prompt: "/review", ...over });
// Resolves with the run's summary once fn(summary) is true.
function until(m, id, fn) {
  return new Promise((resolve) => {
    const check = () => { const s = m.get(id).summary; if (fn(s)) { off(); resolve(s); } };
    const off = m.subscribe(id, check);
    check();
  });
}

test("a run waits on its ask, runs after the answer, ends done and is logged", async (t) => {
  const { m, jarvisHome } = manager();
  t.after(() => m.close());
  const run = m.start(execute());
  assert.equal(run.status, "running");
  await until(m, run.id, s => s.status === "waiting");
  const ask = m.get(run.id).events.find(e => e.type === "permission");
  m.answer(run.id, ask.request_id, true);
  const done = await until(m, run.id, s => s.status === "done");
  assert.equal(done.session_id, "fake-1");
  assert.ok(done.ended);
  const log = fs.readFileSync(path.join(jarvisHome, "runs", `${run.id}.jsonl`), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(log.map(e => e.type).filter(x => x !== "text"),
    ["process", "user", "session", "tool", "permission", "answer", "result", "exit"]);
  assert.ok(log.every(e => e.ts));
  const index = JSON.parse(fs.readFileSync(path.join(jarvisHome, "runs", "index.json"), "utf8"));
  assert.equal(index.find(r => r.id === run.id).status, "done");
});

test("a fourth live run is refused", async (t) => {
  const { m } = manager({ claude: { file: process.execPath, prefixArgs: [FAKE] }, env: { FAKE_HANG: "1" } });
  t.after(() => m.close());
  for (let i = 0; i < 3; i++) m.start(execute({ item_id: `item${i}` }));
  assert.throws(() => m.start(execute({ item_id: "item9" })), (e) => e.code === "LIMIT" && /3 runs are going/.test(e.message));
});

test("Execute on an item with a live run returns that run", (t) => {
  const { m } = manager({ env: { FAKE_HANG: "1" } });
  t.after(() => m.close());
  const a = m.start(execute());
  const b = m.start(execute());
  assert.equal(a.id, b.id);
  assert.equal(m.list().length, 1);
});

test("no event for stallMs marks stalled; a new event clears it", async (t) => {
  const { m, clock } = manager({ env: { FAKE_HANG: "1" }, stallMs: 1000 });
  t.after(() => m.close());
  const run = m.start(execute());
  await until(m, run.id, s => !!s.session_id);
  clock.t += 1500;
  m.tick();
  assert.equal(m.get(run.id).summary.status, "stalled");
  m.reply(run.id, "still there?");
  assert.equal(m.get(run.id).summary.status, "running");
});

test("a restart marks runs left running as stopped", () => {
  const jarvisHome = home();
  fs.mkdirSync(path.join(jarvisHome, "runs"));
  fs.writeFileSync(path.join(jarvisHome, "runs", "index.json"), JSON.stringify([
    { id: "old-1", status: "running", started: "2026-10-26T09:00:00Z" },
    { id: "old-2", status: "done", started: "2026-10-26T08:00:00Z" }]));
  const { m } = manager({ jarvisHome });
  m.close();
  const index = JSON.parse(fs.readFileSync(path.join(jarvisHome, "runs", "index.json"), "utf8"));
  assert.deepEqual(index.map(r => [r.id, r.status, r.error || ""]),
    [["old-1", "stopped", "server restarted"], ["old-2", "done", ""]]);
  assert.deepEqual(m.list().map(r => r.id), ["old-1", "old-2"]);
});

test("a reply after done resumes the session in the same run", async (t) => {
  const { m, jarvisHome } = manager();
  t.after(() => m.close());
  const run = m.start(execute());
  await until(m, run.id, s => s.status === "waiting");
  m.answer(run.id, "r1", true);
  await until(m, run.id, s => s.status === "done");
  m.reply(run.id, "and then?");
  assert.equal(m.get(run.id).summary.status, "running");
  await until(m, run.id, s => s.status === "done");
  const events = m.get(run.id).events;
  assert.ok(events.some(e => e.type === "text" && e.text.includes("echo: and")));
  const log = fs.readFileSync(path.join(jarvisHome, "runs", `${run.id}.jsonl`), "utf8");
  assert.match(log, /"type":"process","resume":"fake-1"/);
});

test("a refresh run runs the export command and streams its output", async (t) => {
  const { m } = manager();
  t.after(() => m.close());
  const run = m.start({ kind: "refresh", project: "marketbrain", label: "MarketBrain", title: "Refresh MarketBrain",
    cwd: __dirname, command: "node -e \"console.log('exported')\"" });
  const s = await until(m, run.id, x => x.status === "done" || x.status === "failed");
  assert.equal(s.status, "done");
  assert.ok(m.get(run.id).events.some(e => e.type === "text" && e.text === "exported"));
});

test("a failing run is failed with its stderr tail; a stopped run is stopped", async (t) => {
  const { m } = manager({ env: { FAKE_FAIL: "1" } });
  t.after(() => m.close());
  const run = m.start(execute());
  const s = await until(m, run.id, x => x.status === "failed");
  assert.match(s.error, /boom/);
  const { m: m2 } = manager({ env: { FAKE_HANG: "1" } });
  t.after(() => m2.close());
  const r2 = m2.start(execute());
  m2.stop(r2.id);
  assert.equal((await until(m2, r2.id, x => x.status === "stopped")).status, "stopped");
});
