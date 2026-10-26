// Runs — the run manager: every Claude (or refresh) process the app starts, with its live events and its log
// Logs go to ~/.jarvis/runs/<id>.jsonl (one event per line) and ~/.jarvis/runs/index.json (summaries). At most
// maxLive processes at once; a live run with no event for stallMs is marked stalled, never killed.
const childProcess = require("child_process");
const crypto = require("crypto");
const path = require("path");
const { claudeArgs, childEnv, killTree } = require("./claude-process");

// Server-side backstop for the deny list: an ask for any order, position, exercise or account-changing tool is
// denied here and never shown, whatever MCP prefix the tool has on this PC.
const ORDER_TOOL = /(^|__)((place|cancel|replace|review|preview)_\w*orders?(_by_id)?|close_(all_)?positions?|(do_not_)?exercise_\w*|cancel_option_exercise|decline_trade_approval|update_account_config)$/i;
const isOrderTool = (name) => ORDER_TOOL.test(String(name || ""));

const LIMIT_TEXT = (n) => `${n} runs are going; wait for one to finish or stop one`;
const LIVE = new Set(["running", "waiting", "stalled"]);
const pad = (n) => String(n).padStart(2, "0");

function defaultId(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-`
    + `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${crypto.randomBytes(2).toString("hex")}`;
}

// Refresh: the registry's export_command is a shell line Lucky wrote (as src/core/os-compat.js runCommand runs it).
function startShell({ command, cwd, env, onEvent, timeoutMs = 120000 }) {
  const child = childProcess.spawn(command, { cwd, shell: true, windowsHide: true, env: childEnv(env),
    detached: process.platform !== "win32" });
  let done = false;
  const bufs = { out: "", err: "" };
  const feed = (key, type) => (d) => {
    const parts = (bufs[key] + d).split(/\r?\n/);
    bufs[key] = parts.pop();
    for (const line of parts) if (line.trim()) onEvent({ type, text: line });
  };
  child.stdin.on("error", () => {});
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", feed("out", "text"));
  child.stderr.on("data", feed("err", "stderr"));
  const timer = setTimeout(() => {
    onEvent({ type: "stderr", text: `timed out after ${Math.round(timeoutMs / 1000)} s` });
    killTree(child);
  }, timeoutMs);
  const finish = (code) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (bufs.out.trim()) onEvent({ type: "text", text: bufs.out });
    if (bufs.err.trim()) onEvent({ type: "stderr", text: bufs.err });
    onEvent({ type: "exit", code });
  };
  child.on("error", (e) => { onEvent({ type: "stderr", text: e.message }); finish(null); });
  child.on("close", finish);
  return { pid: child.pid, send: () => false, answer: () => false, stop: () => { if (!done) killTree(child); } };
}

function createRunManager({ jarvisHome, fs, startProcess, claude, env, now = () => new Date(), stallMs = 600000,
  maxLive = 3, idFn }) {
  const dir = path.join(jarvisHome, "runs");
  const indexFile = path.join(dir, "index.json");
  fs.mkdirSync(dir, { recursive: true });
  const runs = new Map(); // id -> { summary, events, proc, subs, asks, stderr, lastEventAt, stopping, failedResult }
  let index = [];
  try { index = JSON.parse(fs.readFileSync(indexFile, "utf8")); } catch { index = []; }
  if (!Array.isArray(index)) index = [];
  let changed = false;
  for (const r of index) {
    if (LIVE.has(r.status)) { r.status = "stopped"; r.error = "server restarted"; changed = true; }
  }

  function saveIndex() {
    const tmp = indexFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(index, null, 1));
    fs.renameSync(tmp, indexFile);
  }
  if (changed) saveIndex();

  const iso = () => now().toISOString();
  const liveCount = () => [...runs.values()].filter(r => r.proc).length;
  const notify = (run, msg) => { for (const fn of [...run.subs]) { try { fn(msg); } catch {} } };

  function setStatus(run, status, extra = {}) {
    Object.assign(run.summary, { status, ...extra });
    const i = index.findIndex(r => r.id === run.summary.id);
    if (i >= 0) index[i] = { ...run.summary }; else index.push({ ...run.summary });
    saveIndex();
    notify(run, { type: "summary", summary: { ...run.summary } });
  }

  function record(run, event) {
    const e = { ...event, ts: iso() };
    run.events.push(e);
    run.lastEventAt = now().getTime();
    try { fs.appendFileSync(path.join(dir, `${run.summary.id}.jsonl`), JSON.stringify(e) + "\n"); } catch {}
    notify(run, e);
    return e;
  }

  function onEvent(run, event) {
    if (event.type === "permission" && isOrderTool(event.tool)) {
      record(run, { type: "answer", request_id: event.request_id, allow: false, auto: true, tool: event.tool });
      if (run.proc) run.proc.answer(event.request_id, false);
      return;
    }
    record(run, event);
    const s = run.summary;
    if (s.status === "stalled" && event.type !== "exit") setStatus(run, run.asks.size ? "waiting" : "running");
    if (event.type === "session" && s.session_id !== event.session_id) setStatus(run, s.status, { session_id: event.session_id });
    else if (event.type === "permission") { run.asks.set(event.request_id, event.input); setStatus(run, "waiting"); }
    else if (event.type === "stderr") run.stderr = [...run.stderr, event.text].slice(-20);
    else if (event.type === "result" && event.is_error) run.failedResult = event.text || "claude reported an error";
    else if (event.type === "exit") {
      run.proc = null;
      run.asks.clear();
      let status = "done", error = null;
      if (run.stopping) status = "stopped";
      else if (event.code !== 0 || run.failedResult) {
        status = "failed";
        error = run.stderr.length ? run.stderr.join("\n") : (run.failedResult || `exit code ${event.code}`);
      }
      run.stopping = false;
      run.failedResult = null;
      const queued = run.queued;
      run.queued = [];
      if (queued.length && status === "done" && run.summary.session_id) {
        // Lucky replied while the last turn was closing: answer it in a resumed process.
        spawnFor(run, queued.join("\n\n"), run.summary.session_id, true);
        setStatus(run, "running");
      } else {
        setStatus(run, status, { ended: iso(), error });
      }
    }
  }

  function spawnFor(run, prompt, sessionId, alreadyRecorded = false) {
    record(run, { type: "process", resume: sessionId || null });
    if (!alreadyRecorded) record(run, { type: "user", text: prompt });
    run.proc = startProcess({
      file: claude.file, args: [...(claude.prefixArgs || []), ...claudeArgs({ sessionId })],
      cwd: run.cwd, prompt, env, onEvent: (e) => onEvent(run, e),
    });
  }

  function checkLimit() {
    if (liveCount() >= maxLive) {
      const e = new Error(LIMIT_TEXT(maxLive));
      e.code = "LIMIT";
      throw e;
    }
  }

  function start({ kind, project, label, item_id = null, title, cwd, prompt, command, sessionId = null }) {
    if (kind === "execute" && item_id) {
      const live = [...runs.values()].find(r => r.proc && r.summary.item_id === item_id);
      if (live) return { ...live.summary };
    }
    checkLimit();
    const id = idFn ? idFn() : defaultId(now());
    const run = {
      summary: { id, kind, project, label, item_id, title, started: iso(), ended: null, status: "running",
        session_id: sessionId, error: null },
      events: [], proc: null, subs: new Set(), asks: new Map(), stderr: [], cwd, queued: [],
      lastEventAt: now().getTime(), stopping: false, failedResult: null,
    };
    runs.set(id, run);
    setStatus(run, "running");
    if (kind === "refresh") {
      record(run, { type: "user", text: command });
      run.proc = startShell({ command, cwd, env, onEvent: (e) => onEvent(run, e) });
    } else {
      spawnFor(run, prompt, sessionId);
    }
    return { ...run.summary };
  }

  function need(id) {
    const run = runs.get(id);
    if (!run) { const e = new Error("no such live run"); e.code = "NOT_FOUND"; throw e; }
    return run;
  }

  function reply(id, text) {
    const run = need(id);
    if (run.proc && run.proc.accepting && !run.proc.accepting()) {
      record(run, { type: "user", text });
      run.queued.push(text); // sent to a resumed process when this one exits
      return { ...run.summary };
    }
    if (run.proc) {
      record(run, { type: "user", text });
      run.proc.send(text);
      if (run.summary.status === "stalled") setStatus(run, run.asks.size ? "waiting" : "running");
      return { ...run.summary };
    }
    if (run.summary.kind === "refresh" || !run.summary.session_id) {
      const e = new Error("this run cannot take replies"); e.code = "NO_REPLY"; throw e;
    }
    checkLimit();
    setStatus(run, "running", { ended: null, error: null });
    spawnFor(run, text, run.summary.session_id);
    return { ...run.summary };
  }

  function answer(id, requestId, allow) {
    const run = need(id);
    if (!run.proc || !run.asks.has(requestId)) return false;
    const input = run.asks.get(requestId);
    run.asks.delete(requestId);
    record(run, { type: "answer", request_id: requestId, allow: !!allow });
    run.proc.answer(requestId, !!allow, input);
    setStatus(run, run.asks.size ? "waiting" : "running");
    return true;
  }

  function stop(id) {
    const run = need(id);
    if (!run.proc) return false;
    run.stopping = true;
    run.proc.stop();
    return true;
  }

  function get(id) {
    const run = runs.get(id);
    if (run) return { summary: { ...run.summary }, events: [...run.events] };
    const summary = index.find(r => r.id === id);
    if (!summary || !/^[\w.-]+$/.test(id)) return null;
    let events = [];
    try {
      events = fs.readFileSync(path.join(dir, `${id}.jsonl`), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    } catch {}
    return { summary: { ...summary }, events };
  }

  function list() {
    return [...index].sort((a, b) => String(b.started).localeCompare(String(a.started))).map(r => ({ ...r }));
  }

  function latestByItem() {
    const out = {};
    for (const r of list()) if (r.item_id && !out[r.item_id]) out[r.item_id] = r;
    return out;
  }

  function subscribe(id, fn) {
    const run = runs.get(id);
    if (!run) return () => {};
    run.subs.add(fn);
    return () => run.subs.delete(fn);
  }

  function tick() {
    const t = now().getTime();
    for (const run of runs.values()) {
      if (run.proc && !run.asks.size && run.summary.status !== "stalled" && t - run.lastEventAt >= stallMs) {
        setStatus(run, "stalled");
      }
    }
  }

  const timer = setInterval(tick, 30000);
  timer.unref();

  function close() {
    clearInterval(timer);
    for (const run of runs.values()) if (run.proc) { run.stopping = true; run.proc.stop(); }
  }

  return { start, reply, answer, stop, get, list, latestByItem, subscribe, tick, close };
}

module.exports = { createRunManager, LIMIT_TEXT, isOrderTool };
