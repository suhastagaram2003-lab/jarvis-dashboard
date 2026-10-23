const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./load-module");

const os = loadModule("core/os-compat.js");

test("Windows project dirs count", () => {
  assert.ok(os.isClaudeProjectDir("C--Users-sutag-Documents-Suhas"));
  assert.ok(os.isClaudeProjectDir("-Users-andrew-vault"));
  assert.ok(!os.isClaudeProjectDir("jarvis-dashboard-cache.json"));
});
test("tasklist listing", () => assert.ok(os.hasClaudeProcess('"claude.exe","4120","Console","1","210,000 K"', "win32")));
test("tasklist without claude", () => assert.ok(!os.hasClaudeProcess('"node.exe","4120","Console","1","210,000 K"', "win32")));
test("pgrep listing keeps upstream's rule", () => {
  assert.ok(os.hasClaudeProcess("123 /usr/local/bin/claude --resume", "darwin"));
  assert.ok(!os.hasClaudeProcess("124 pgrep -fa claude", "darwin"));
});
test("launch keeps a spaced path as one argument", () => assert.deepEqual(
  os.launchArgs("C:\\My Docs\\Suhas", 'claude "/review"', "win32").args,
  ["-w", "0", "nt", "-d", "C:\\My Docs\\Suhas", "cmd", "/k", 'claude "/review"']));
test("launch defaults to claude", () => assert.deepEqual(os.launchArgs("C:\\p", null, "win32"),
  { file: "wt.exe", args: ["-w", "0", "nt", "-d", "C:\\p", "cmd", "/k", "claude"] }));
test("open on Windows passes the target as one argument, no shell", () => assert.deepEqual(
  os.openArgs("C:\\My Docs\\a.md", "win32"), { file: "rundll32.exe", args: ["url.dll,FileProtocolHandler", "C:\\My Docs\\a.md"] }));
test("open on Windows keeps & in a URL (cmd would split the line there)", () => assert.deepEqual(
  os.openArgs("obsidian://open?vault=Suhas&file=a", "win32").args[1], "obsidian://open?vault=Suhas&file=a"));
test("launch escapes ; so Windows Terminal does not split the command", () => assert.deepEqual(
  os.launchArgs("C:\\p", "echo a; echo b", "win32").args.slice(-1), ["echo a\\; echo b"]));
test("open on macOS", () => assert.deepEqual(os.openArgs("/a b.md", "darwin"), { file: "open", args: ["/a b.md"] }));
test("runCommand reports failure and stderr tail", async () => {
  const r = await os.runCommand('node -e "console.error(1);console.error(2);process.exit(3)"', process.cwd());
  assert.deepEqual([r.code, r.stderrTail.trim()], [3, "1\n2"]);
});
test("runCommand keeps the last 5 stderr lines", async () => {
  const r = await os.runCommand('node -e "for (let i = 1; i <= 8; i++) console.error(i)"', process.cwd());
  assert.equal(r.stderrTail.trim(), "4\n5\n6\n7\n8");
});
test("runCommand times out", async () => {
  const r = await os.runCommand('node -e "setTimeout(()=>{}, 10000)"', process.cwd(), 300);
  assert.equal(r.timedOut, true);
});
