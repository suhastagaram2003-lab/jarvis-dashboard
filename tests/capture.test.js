const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const nodePath = require("path");
const { loadModule } = require("./load-module");

const cap = loadModule("hub/capture.js");
const NOW = new Date(2026, 9, 23, 9, 0, 0);
const tmpDir = () => fs.mkdtempSync(nodePath.join(os.tmpdir(), "jarvis-inbox-"));

test("path is local time under the project's inbox", () => assert.equal(
  cap.capturePath("/in", "marketbrain", new Date(2026, 0, 2, 3, 4, 5), () => false),
  nodePath.join("/in", "marketbrain", "2026-01-02-030405.md")));
test("same second gets a suffix", () => {
  const taken = new Set(["/in/marketbrain/2026-10-23-090000.md"]);
  assert.equal(cap.capturePath("/in", "marketbrain", new Date(2026, 9, 23, 9, 0, 0), p => taken.has(p.replace(/\\/g, "/"))),
    nodePath.join("/in", "marketbrain", "2026-10-23-090000-2.md"));
});
test("third capture in the same second gets -3", () => {
  const taken = new Set(["/in/mb/2026-10-23-090000.md", "/in/mb/2026-10-23-090000-2.md"]);
  assert.match(cap.capturePath("/in", "mb", NOW, p => taken.has(p.replace(/\\/g, "/"))), /090000-3\.md$/);
});
test("note has frontmatter", () => assert.match(cap.noteText("NVDA idea\nmore", "marketbrain", NOW), /^---\ntitle: NVDA idea\nproject: marketbrain\ncaptured: /));
test("title is cut to 80 characters and quoted when YAML needs it", () => {
  const t = cap.noteText("x".repeat(100), "mb", NOW).split("\n")[1];
  assert.equal(t, "title: " + "x".repeat(80));
  assert.equal(cap.noteText("a: b # c", "mb", NOW).split("\n")[1], 'title: "a: b # c"');
});
test("save writes once and refuses empty", () => {
  const dir = tmpDir();
  const p = cap.save(fs, dir, "betbrain", "link https://x", NOW);
  assert.ok(fs.existsSync(p));
  assert.throws(() => cap.save(fs, dir, "betbrain", "  ", NOW), /nothing to capture/);
});
test("two saves in the same second keep both", () => {
  const dir = tmpDir();
  const a = cap.save(fs, dir, "mb", "one", NOW);
  const b = cap.save(fs, dir, "mb", "two", NOW);
  assert.notEqual(a, b);
  assert.match(fs.readFileSync(a, "utf8"), /one\n$/);
  assert.match(fs.readFileSync(b, "utf8"), /two\n$/);
});
test("a project name cannot leave the inbox", () => {
  assert.throws(() => cap.save(fs, tmpDir(), "../x", "t", NOW), /bad project name/);
  assert.throws(() => cap.save(fs, tmpDir(), "a\\b", "t", NOW), /bad project name/);
});
test("count of notes in a project's inbox", () => {
  const dir = tmpDir();
  assert.equal(cap.inboxCount(fs, dir, "mb"), 0);
  cap.save(fs, dir, "mb", "one", NOW);
  assert.equal(cap.inboxCount(fs, dir, "mb"), 1);
});
