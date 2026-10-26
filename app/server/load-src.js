// Load Src — runs a src/ module body the way the dashboard does: new Function("ctx", code)(ctx).
// The web app's server reuses the Obsidian hub's modules (src/hub/, src/core/) through this, unchanged.
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.join(__dirname, "..", "..");
const SRC = path.join(ROOT, "src");

function loadSrc(relPath, ctx) {
  const code = fs.readFileSync(path.resolve(SRC, relPath), "utf8");
  return new Function("ctx", code)(ctx || { nodeFs: fs, nodePath: path, os, require });
}

function hubSchema() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "schema", "hub-export-v1.json"), "utf8"));
}

module.exports = { loadSrc, hubSchema, ROOT, SRC };
