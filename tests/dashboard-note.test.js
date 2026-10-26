// The dashboard notes' dataviewjs blocks must survive Dataview's own wrapper. Dataview runs a block that contains
// `await` as eval("(async () => { " + source + " })()") with no newline before the closing brace, so a `//` comment
// on the block's last line swallows the `})()` and Obsidian shows "SyntaxError: Unexpected end of input".
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function dataviewBlocks(text) {
  return [...text.replace(/\r\n/g, "\n").matchAll(/^```dataviewjs\n([\s\S]*?)\n```$/gm)].map(m => m[1]);
}

for (const note of ["Jarvis Dashboard.md"]) {
  test(`${note} parses inside Dataview's async wrapper`, () => {
    const blocks = dataviewBlocks(fs.readFileSync(path.join(ROOT, note), "utf8"));
    assert.ok(blocks.length > 0, "no dataviewjs block found");
    for (const source of blocks) {
      const wrapped = source.includes("await") ? "(async () => { " + source + " })()" : source;
      assert.doesNotThrow(() => new Function(wrapped), SyntaxError);
    }
  });
}
