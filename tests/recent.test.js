const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const nodePath = require("path");
const { loadModule } = require("./load-module");

const rec = loadModule("hub/recent.js");

// Each value is how many minutes ago the file was changed, so a smaller number is newer.
function tmpTree(files) {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "jarvis-recent-"));
  for (const [rel, minutesAgo] of Object.entries(files)) {
    const p = nodePath.join(root, rel);
    fs.mkdirSync(nodePath.dirname(p), { recursive: true });
    fs.writeFileSync(p, "# x\n");
    const t = new Date(Date.now() - minutesAgo * 60000);
    fs.utimesSync(p, t, t);
  }
  return root.replace(/\\/g, "/");
}
const entry = (label, path, vault, recent_dirs = ["vault/wiki"]) => ({ label, name: label.toLowerCase(), path, vault,
  color: "#00d4ff", recent_dirs });
function bigEntry(n) {
  const files = {};
  for (let i = 0; i < n; i++) files[`vault/wiki/p${i}.md`] = i + 1;
  return entry("Big", tmpTree(files), "Big");
}

test("newest first across vaults with obsidian links", () => {
  const root = tmpTree({ "mb/vault/wiki/lessons/a.md": 1, "bb/vault/wiki/b.md": 2, "mb/vault/sources/s.md": 3 });
  const rows = rec.recentFiles(fs, nodePath, [entry("MarketBrain", root + "/mb", "Suhas"), entry("BetBrain", root + "/bb", "BetBrain")]);
  assert.deepEqual(rows.map(r => r.title), ["a", "b"]);              // sources/ is not in recent_dirs
  assert.equal(rows[0].link, "obsidian://open?vault=Suhas&file=vault%2Fwiki%2Flessons%2Fa");
  assert.deepEqual([rows[0].project, rows[0].rel], ["MarketBrain", "vault/wiki/lessons/a.md"]);
});
test("walk stops at the cap", () => assert.equal(rec.recentFiles(fs, nodePath, [bigEntry(50)], 100, 20).length, 20));
test("limit keeps the newest", () => assert.deepEqual(
  rec.recentFiles(fs, nodePath, [bigEntry(5)], 2).map(r => r.title), ["p0", "p1"]));
test("dot-folders and non-markdown files are skipped", () => {
  const root = tmpTree({ "vault/wiki/.obsidian/w.md": 1, "vault/wiki/x.txt": 1, "vault/wiki/ok.md": 5 });
  assert.deepEqual(rec.recentFiles(fs, nodePath, [entry("MB", root, "V")]).map(r => r.title), ["ok"]);
});
test("missing folders and entries without recent_dirs are fine", () => {
  const root = tmpTree({});
  assert.deepEqual(rec.recentFiles(fs, nodePath, [entry("MB", root, "V"), entry("BB", root, "B", undefined), { label: "X" }]), []);
});
