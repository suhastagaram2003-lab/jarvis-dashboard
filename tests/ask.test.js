const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { loadModule } = require("./load-module");

const ask = loadModule("hub/ask.js");

const fakeFs = (existing) => ({ existsSync: (p) => existing.includes(p) });

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; setImmediate(() => child.emit("close", null, "SIGKILL")); return true; };
  return child;
}
const hangingSpawn = () => fakeChild();
function replyingSpawn(stdout, code = 0, calls = []) {
  return (file, args, opts) => {
    calls.push({ file, args, opts });
    const child = fakeChild();
    setImmediate(() => { child.stdout.emit("data", Buffer.from(stdout)); child.emit("close", code, null); });
    return child;
  };
}

test("question stays one argument", () => {
  const q = 'is NVDA "cheap" & | rm -rf\nreally?';
  const args = ask.askArgs({ ask_tools: [] }, q);
  assert.equal(args[1], "/ask " + q);
});
test("tools per project", () => {
  assert.equal(ask.askArgs({ ask_tools: [] }, "q")[5], "Read,Grep,Glob");
  assert.equal(ask.askArgs({ ask_tools: ["mcp__marketbrain__recall"] }, "q")[5], "Read,Grep,Glob,mcp__marketbrain__recall");
  assert.ok(ask.askArgs({}, "q")[7].includes("Bash"));
});
test("argument layout", () => assert.deepEqual(ask.askArgs({}, "q"), ["-p", "/ask q", "--output-format", "json",
  "--allowedTools", "Read,Grep,Glob",
  "--disallowedTools", "Bash,PowerShell,Edit,Write,NotebookEdit,WebFetch,WebSearch,Agent"]));
test("a project's tools never leak into another's", () => {
  ask.askArgs({ ask_tools: ["mcp__marketbrain__recall"] }, "q");
  assert.equal(ask.askArgs({ ask_tools: [] }, "q")[5], "Read,Grep,Glob");
  assert.deepEqual(ask.READ_TOOLS, ["Read", "Grep", "Glob"]);
});
test("only claude.cmd is an error", () => assert.equal(
  ask.findClaude(fakeFs([]), "C:\\Users\\u", "", "C:\\npm\\claude.cmd\r\n").error, "claude.exe not found; set hub.claudePath"));
test("configured path wins when it exists", () => assert.deepEqual(
  ask.findClaude(fakeFs(["D:\\tools\\claude.exe", "C:\\Users\\u\\.local\\bin\\claude.exe"]), "C:\\Users\\u", "D:\\tools\\claude.exe", ""),
  { path: "D:\\tools\\claude.exe", error: null }));
test("native install under .local\\bin", () => assert.equal(
  ask.findClaude(fakeFs(["C:\\Users\\u\\.local\\bin\\claude.exe"]), "C:\\Users\\u", "", "").path,
  "C:\\Users\\u\\.local\\bin\\claude.exe"));
test("first .exe from where", () => assert.equal(
  ask.findClaude(fakeFs([]), "C:\\Users\\u", "", "C:\\npm\\claude.cmd\r\nC:\\bin\\claude.exe\r\n").path, "C:\\bin\\claude.exe"));
test("timeout kills the run", async () => {
  const r = await ask.runAsk({ entry: { path: "." }, question: "q", claudePath: "x", spawn: hangingSpawn, timeoutMs: 50 });
  assert.equal(r.ok, false); assert.match(r.text, /^timed out after/);
});
test("runAsk spawns without a shell in the project folder", async () => {
  const calls = [];
  const r = await ask.runAsk({ entry: { path: "C:\\p", ask_tools: [] }, question: "a & b", claudePath: "C:\\c.exe",
    spawn: replyingSpawn('{"result":"Answer","is_error":false}', 0, calls) });
  assert.deepEqual([r.ok, r.text], [true, "Answer"]);
  assert.equal(calls[0].file, "C:\\c.exe");
  assert.equal(calls[0].opts.shell, false);
  assert.equal(calls[0].opts.cwd, "C:\\p");
  assert.equal(calls[0].args[1], "/ask a & b");
  assert.match(r.command, /--allowedTools/);
});
test("a non-zero exit is an error", async () => {
  const r = await ask.runAsk({ entry: { path: "." }, question: "q", claudePath: "x", spawn: replyingSpawn("oops", 2) });
  assert.equal(r.ok, false); assert.match(r.text, /exit 2/);
});
test("reads Claude's json", () => assert.deepEqual(ask.parseResult('{"result":"Yes [^1]","is_error":false}'), { ok: true, text: "Yes [^1]" }));
test("an is_error reply is not ok", () => assert.equal(ask.parseResult('{"result":"no","is_error":true}').ok, false));
test("non-JSON reply", () => assert.deepEqual(ask.parseResult("hello"), { ok: false, text: "unreadable reply" }));
