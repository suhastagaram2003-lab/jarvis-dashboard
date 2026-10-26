const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadModule } = require("./load-module");

const cc = loadModule("core/config-cascade.js");

function tmpSrc(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-src-"));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test("arrays replace, objects merge", () => assert.deepEqual(
  cc.deepMerge({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { c: 3 }, l: [9] }), { a: { b: 1, c: 3 }, l: [9] }));
test("deepMerge does not change its inputs", () => {
  const a = { a: { b: 1 } };
  cc.deepMerge(a, { a: { b: 2 } });
  assert.deepEqual(a, { a: { b: 1 } });
});
test("missing personal config is fine", () => {
  const dir = tmpSrc({ "config/config.example.json": '{"x":1}' });
  assert.deepEqual(cc.loadConfig(fs, dir), { x: 1 });
});
test("example, then config, then local", () => {
  const dir = tmpSrc({
    "config/config.example.json": '{"x":1,"y":{"a":1,"b":1},"layout":[1,2,3]}',
    "config/config.json": '{"y":{"a":2},"layout":[4]}',
    "config/config.local.json": '{"y":{"b":3}}',
  });
  assert.deepEqual(cc.loadConfig(fs, dir), { x: 1, y: { a: 2, b: 3 }, layout: [4] });
});
test("missing example config throws", () => assert.throws(() => cc.loadConfig(fs, tmpSrc({}))));
test("a throwing widget becomes an error", async () => {
  const r = await cc.safeWidget("agent-cards", async () => { throw new Error("boom"); });
  assert.deepEqual(r, { el: null, error: "agent-cards: boom" });
});
test("a widget that builds returns its element", async () => {
  const el = { tag: "div" };
  assert.deepEqual(await cc.safeWidget("x", async () => el), { el, error: null });
});
test("a widget that returns nothing is an error", async () =>
  assert.deepEqual(await cc.safeWidget("x", async () => undefined), { el: null, error: "x: returned no element" }));
