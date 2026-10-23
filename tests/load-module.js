// Loads a src/ module body the way the dashboard does: new Function("ctx", code)(ctx).
// Node keeps `require` module-scoped, so the default ctx passes it in; modules that need it
// read `ctx.require || require` (in Obsidian `require` is a global).
const fs = require("fs");
const path = require("path");
const os = require("os");

const SRC = path.join(__dirname, "..", "src");

function defaultCtx() {
  return { nodeFs: fs, nodePath: path, os, require };
}

function loadModule(relPath, ctx) {
  const code = fs.readFileSync(path.resolve(SRC, relPath), "utf8");
  return new Function("ctx", code)(ctx || defaultCtx());
}

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", relPath), "utf8"));
}

module.exports = { loadModule, readJson, SRC };
