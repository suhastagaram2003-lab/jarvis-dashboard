const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { startProcess, claudeArgs } = require("../app/server/claude-process");

const FAKE = path.join(__dirname, "fixtures", "fake-claude.js");

function run(prompt, env = {}, onEach) {
  const events = [];
  let resolveExit;
  const exited = new Promise(r => { resolveExit = r; });
  const proc = startProcess({
    file: process.execPath, args: [FAKE], cwd: __dirname, prompt, env,
    onEvent: (e) => { events.push(e); if (onEach) onEach(e, proc); if (e.type === "exit") resolveExit(e); },
  });
  return { proc, events, exited };
}

test("streams session, text, tool, permission, then result and exit after allow", async () => {
  const r = run("/review", {}, (e, proc) => { if (e.type === "permission") proc.answer(e.request_id, true, e.input); });
  const exit = await r.exited;
  assert.equal(exit.code, 0);
  const types = r.events.map(e => e.type);
  assert.deepEqual(types.filter(t => t !== "text"), ["session", "tool", "permission", "result", "exit"]);
  assert.equal(r.events[0].session_id, "fake-1");
  const text = r.events.filter(e => e.type === "text").map(e => e.text).join("");
  assert.equal(text, "echo: /reviewallowed");
  const ask = r.events.find(e => e.type === "permission");
  assert.deepEqual([ask.request_id, ask.tool, ask.input], ["r1", "Bash", { command: "echo hi" }]);
  assert.equal(r.events.find(e => e.type === "tool").name, "Bash");
  assert.equal(r.events.find(e => e.type === "result").is_error, false);
});

test("a denied ask says denied", async () => {
  const r = run("/review", {}, (e, proc) => { if (e.type === "permission") proc.answer(e.request_id, false); });
  await r.exited;
  assert.match(r.events.filter(e => e.type === "text").map(e => e.text).join(""), /denied$/);
});

test("a prompt with quotes, &, | and a newline arrives byte for byte", async () => {
  const prompt = 'a "b" & c | d\nnext';
  const r = run(prompt, {}, (e, proc) => { if (e.type === "permission") proc.answer(e.request_id, true, e.input); });
  await r.exited;
  assert.ok(r.events.filter(e => e.type === "text").map(e => e.text).join("").startsWith("echo: " + prompt));
});

test("a failing claude gives stderr events and its exit code", async () => {
  const r = run("/x", { FAKE_FAIL: "1" });
  const exit = await r.exited;
  assert.equal(exit.code, 3);
  assert.match(r.events.filter(e => e.type === "stderr").map(e => e.text).join("\n"), /boom/);
});

test("stop ends a hung run", async () => {
  const r = run("/x", { FAKE_HANG: "1" }, (e, proc) => { if (e.type === "session") proc.stop(); });
  const t = Date.now();
  await r.exited;
  assert.ok(Date.now() - t < 5000);
});

test("claudeArgs resumes, streams and blocks the order tools", () => {
  const a = claudeArgs({ sessionId: "s1" });
  assert.deepEqual(a.slice(0, 2), ["--resume", "s1"]);
  for (const f of ["-p", "--input-format", "--output-format", "--verbose", "--include-partial-messages",
    "--permission-prompt-tool", "--disallowedTools"]) assert.ok(a.includes(f), f);
  assert.match(a[a.indexOf("--disallowedTools") + 1], /mcp__alpaca__place_stock_order/);
  assert.ok(!claudeArgs({}).includes("--resume"));
});
