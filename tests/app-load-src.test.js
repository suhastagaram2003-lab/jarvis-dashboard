const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSrc, hubSchema } = require("../app/server/load-src");

test("loadSrc runs a hub module body with the given ctx", () => {
  const store = loadSrc("hub/hub-store.js", { hubSchema: hubSchema() });
  assert.equal(typeof store.loadProjects, "function");
  assert.equal(typeof store.mergeQueue, "function");
});

test("loadSrc defaults ctx to node fs, path, os and require", () => {
  assert.equal(typeof loadSrc("hub/recent.js").recentFiles, "function");
});
