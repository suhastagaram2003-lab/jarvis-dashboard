// Jarvis web app — `npm run app` starts the local server on 127.0.0.1 and prints the link to open.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { loadAppConfig } = require("./config");
const { loadOrCreateToken } = require("./policy");
const { createRunManager } = require("./runs");
const { startProcess } = require("./claude-process");
const { createServer } = require("./http");
const { loadSrc } = require("./load-src");

function locateClaude(configured) {
  let where = "";
  try {
    where = execFileSync(process.platform === "win32" ? "where" : "which", ["claude"],
      { encoding: "utf8", windowsHide: true, timeout: 5000 });
  } catch {}
  if (process.platform === "win32") {
    const found = loadSrc("hub/ask.js").findClaude(fs, os.homedir(), configured, where);
    if (found.path) return { file: found.path, error: null };
  } else {
    const file = (configured && fs.existsSync(configured)) ? configured : where.split(/\r?\n/)[0].trim();
    if (file) return { file, error: null };
  }
  const tried = [configured, path.join(os.homedir(), ".local", "bin", "claude.exe"), "claude on PATH"].filter(Boolean);
  return { file: null, error: `claude.exe not found; set hub.claudePath in src/config/config.json (tried: ${tried.join(", ")})` };
}

function main() {
  const config = loadAppConfig();
  const token = loadOrCreateToken(fs, config.jarvisHome);
  const claude = locateClaude(config.claudePath);
  const runs = createRunManager({ jarvisHome: config.jarvisHome, fs, startProcess,
    claude: { file: claude.file, prefixArgs: [] } });
  const server = createServer({ jarvisHome: config.jarvisHome, fs, token, runs, theme: config.theme,
    claudeMissing: claude.error });
  server.listen(config.port, "127.0.0.1", () => {
    console.log(`Jarvis: http://127.0.0.1:${config.port}/?t=${token}`);
    if (claude.error) console.log(claude.error);
  });
  const shutdown = () => { runs.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); };
  // Backstop: one bad child stream must not take every live run down with the server.
  process.on("uncaughtException", (e) => console.error("Jarvis: unexpected error:", e && e.stack ? e.stack : e));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) main();

module.exports = { main, locateClaude };
