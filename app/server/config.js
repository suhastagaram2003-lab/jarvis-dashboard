// Config — the web app reads the same config files as the Obsidian note (src/config/config*.json, via
// src/core/config-cascade.js): hub.jarvisHome, hub.claudePath, hub.port, and theme for /theme.css.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadSrc, SRC } = require("./load-src");

function expandHome(p) {
  if (p === "~") return os.homedir();
  if (/^~[\\/]/.test(p)) return path.join(os.homedir(), p.slice(2));
  return p;
}

function loadAppConfig(srcDir = SRC) {
  const { loadConfig } = loadSrc("core/config-cascade.js");
  const config = loadConfig(fs, srcDir);
  const hub = config.hub || {};
  return {
    jarvisHome: expandHome(process.env.JARVIS_HOME || hub.jarvisHome || "~/.jarvis"),
    claudePath: hub.claudePath || "",
    port: Number(process.env.JARVIS_PORT || hub.port || 4317),
    theme: config.theme || {},
    // { execute, chat } -> "default" | "acceptEdits" | "auto" | "plan"; unset inherits the user's own settings.
    permissionModes: hub.permissionModes || {},
  };
}

function themeCss(theme) {
  const vars = Object.entries(theme).map(([k, v]) => `  --${k.replace(/[A-Z]/g, c => "-" + c.toLowerCase())}: ${v};`);
  return `:root {\n${vars.join("\n")}\n}\n`;
}

module.exports = { loadAppConfig, themeCss, expandHome };
