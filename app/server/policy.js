// Policy — what the web app may run, and who may ask it to
// Execute runs only a queue item's own `claude "<prompt>"` command, and only when it starts with one of the
// registry entry's allowed_commands. The browser never sends a command line. Every Claude run blocks the order,
// trade and bet tools in DISALLOWED_TOOLS on top of the project's own deny lists.
const crypto = require("crypto");
const path = require("path");
const { EXTRA_DISALLOWED } = require("./claude-flags");

const ROBINHOOD_WRITES = [
  "place_equity_order", "place_option_order", "place_crypto_order",
  "cancel_equity_order", "cancel_option_order", "cancel_crypto_order",
  "exercise_option", "cancel_option_exercise", "review_equity_order", "review_option_order",
].map(t => `mcp__Robin_Hood__${t}`);

const DISALLOWED_TOOLS = [...new Set([...ROBINHOOD_WRITES, ...EXTRA_DISALLOWED])];
const DEFAULT_ALLOWED = ['claude "'];
const ONLY_CLAUDE = "only Claude prompts can run from Jarvis";

function promptFor(command) {
  const m = /^claude "((?:[^"\\]|\\.)+)"$/s.exec(String(command || "").trim());
  return m ? m[1].replace(/\\(["\\])/g, "$1") : null;
}

function commandFor(entry, item) {
  const command = item && item.action && item.action.command;
  if (!command) return { error: "this task has no command" };
  const prompt = promptFor(command);
  if (prompt === null) return { error: ONLY_CLAUDE };
  const allowed = (entry && entry.allowed_commands) || DEFAULT_ALLOWED;
  if (!allowed.some(prefix => command.startsWith(prefix))) {
    return { error: `not allowed by this project's allowed_commands: ${command}` };
  }
  return { prompt };
}

function refreshFor(entry) {
  const command = entry && entry.export_command;
  return command ? { command } : { error: "this project has no export_command in the registry" };
}

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

function loadOrCreateToken(fs, jarvisHome) {
  const file = path.join(jarvisHome, "app-token");
  try {
    const t = fs.readFileSync(file, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(t)) return t;
  } catch {}
  fs.mkdirSync(jarvisHome, { recursive: true });
  const t = makeToken();
  fs.writeFileSync(file, t + "\n", { mode: 0o600 });
  return t;
}

function cookieValue(header, name) {
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function sameSecret(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function checkToken(req, token) {
  const given = req.headers["x-jarvis-token"] || cookieValue(req.headers.cookie, "jarvis_t");
  return sameSecret(given, token);
}

function loopbacks(port) {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

function checkHost(req, port) {
  return loopbacks(port).includes(String(req.headers.host || "").toLowerCase());
}

function checkOrigin(req, port) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  return loopbacks(port).map(h => `http://${h}`).includes(String(origin).toLowerCase());
}

module.exports = {
  DISALLOWED_TOOLS, ONLY_CLAUDE, promptFor, commandFor, refreshFor,
  makeToken, loadOrCreateToken, cookieValue, checkToken, checkHost, checkOrigin,
};
