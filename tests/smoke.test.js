const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadModule } = require("./load-module");

test("loadModule runs a module body with ctx", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-smoke-"));
  fs.writeFileSync(path.join(dir, "m.js"), "return ctx.x + 1;");
  assert.equal(loadModule(path.join(dir, "m.js"), { x: 1 }), 2);
});
