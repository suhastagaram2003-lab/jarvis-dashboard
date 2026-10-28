// Probe — checks on the PC which flags make `claude -p` (stream-json in and out) send permission asks over stdio,
// and lists MCP tools that look like order, trade or bet tools, for app/server/claude-flags.js.
// Run: node app/scripts/probe-claude.js   (works in a scratch folder under the temp dir; changes nothing else)
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadSrc } = require("../server/load-src");

const ask = loadSrc("hub/ask.js");
let where = "";
try { where = execFileSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8" }); } catch {}
const found = ask.findClaude(fs, os.homedir(), process.env.CLAUDE_PATH, where);
if (!found.path) { console.log("claude not found:", found.error); process.exit(1); }
console.log("claude:", found.path);

const scratch = path.join(os.tmpdir(), "jarvis-probe");
fs.mkdirSync(scratch, { recursive: true });

const BASE = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
  "--include-partial-messages"];
const VARIANTS = [
  ["--permission-prompt-tool", "stdio"],
  ["--permission-prompt-tool", "stdio", "--permission-mode", "default"],
  ["--permission-mode", "default"],
];

function tryVariant(flags) {
  return new Promise((resolve) => {
    const env = { ...process.env, FORCE_COLOR: "0" };
    delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT;
    const child = spawn(found.path, [...BASE, ...flags], { cwd: scratch, shell: false, windowsHide: true, env });
    const types = new Set();
    let asked = false, ran = false, buf = "", stderr = "";
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, 120000);
    child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text",
      text: "Run the shell command `echo jarvis-probe-ok` with your Bash tool, then say done." }] } }) + "\n");
    child.stdout.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        types.add(m.type + (m.subtype ? ":" + m.subtype : "") + (m.request?.subtype ? ":" + m.request.subtype : ""));
        if (m.type === "control_request" && m.request?.subtype === "can_use_tool") {
          asked = true;
          child.stdin.write(JSON.stringify({ type: "control_response", response: { subtype: "success",
            request_id: m.request_id, response: { behavior: "allow", updatedInput: m.request.input } } }) + "\n");
        }
        if (JSON.stringify(m).includes("jarvis-probe-ok") && m.type === "user") ran = true;
        if (m.type === "result") child.stdin.end();
      }
    });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ flags: flags.join(" "), code, asked, ran, types: [...types].join(", "),
        stderr: stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ") });
    });
    child.on("error", (e) => resolve({ flags: flags.join(" "), error: e.message }));
  });
}

(async () => {
  for (const v of VARIANTS) {
    const r = await tryVariant(v);
    console.log(JSON.stringify(r));
    if (r.asked && r.ran) break;
  }
  try {
    const list = execFileSync(found.path, ["mcp", "list"], { encoding: "utf8", timeout: 60000, windowsHide: true });
    console.log("mcp servers:\n" + list);
  } catch (e) { console.log("mcp list failed:", e.message); }
  console.log("Next: list each server's write tools (orders, trades, bets) and add them to EXTRA_DISALLOWED.");
})();
