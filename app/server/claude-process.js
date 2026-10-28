// Claude Process — one `claude -p` child with stream-json in both directions
// The stdin/stdout handling (newline-delimited JSON, stream_event text deltas, control_request asks answered with
// control_response, stdin closed on result) is copied from upstream's companion/modules/claude-runner.js
// (AndrewKochulab/jarvis-dashboard, MIT). Spawned without a shell: the prompt only ever travels as a JSON message.
const childProcess = require("child_process");
const { PERMISSION_FLAGS } = require("./claude-flags");
const { DISALLOWED_TOOLS } = require("./policy");

const SESSION_ID = /^[A-Za-z0-9][\w-]{0,127}$/;

// "default" makes every non-allowed tool wait for Approve/Deny in the panel; unset, a run inherits the user's own
// settings (auto mode on Lucky's PC, where the classifier decides and never asks). Never a bypass mode.
const PERMISSION_MODES = new Set(["default", "acceptEdits", "auto", "plan"]);

function claudeArgs({ sessionId, permissionMode } = {}) {
  if (sessionId && !SESSION_ID.test(sessionId)) throw new Error(`bad session id: ${sessionId}`);
  if (permissionMode && !PERMISSION_MODES.has(permissionMode)) throw new Error(`bad permission mode: ${permissionMode}`);
  return [
    ...(sessionId ? ["--resume", sessionId] : []),
    ...(permissionMode ? ["--permission-mode", permissionMode] : []),
    "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--include-partial-messages", ...PERMISSION_FLAGS,
    "--disallowedTools", DISALLOWED_TOOLS.join(","),
  ];
}

function childEnv(extra) {
  const env = { ...process.env, FORCE_COLOR: "0", ...(extra || {}) };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_MAX_OUTPUT_TOKENS;
  return env;
}

function userLine(text) {
  return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n";
}

function killTree(child) {
  if (process.platform === "win32") {
    childProcess.execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
    return;
  }
  try { child.kill("SIGTERM"); } catch {}
  const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 3000);
  t.unref();
}

function startProcess({ file, args, cwd, prompt, env, spawn = childProcess.spawn, onEvent }) {
  const child = spawn(file, args, { cwd, env: childEnv(env), shell: false, windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"] });
  let sessionSent = false, outBuf = "", errBuf = "", exited = false, closing = false;
  // A claude that exits before reading stdin makes the next write fail with EPIPE asynchronously; without this
  // handler that error would take the whole server down.
  child.stdin.on("error", (e) => onEvent({ type: "stderr", text: `stdin: ${e.message}` }));
  child.stdout.setEncoding("utf8"); // a multibyte character split across chunks stays whole
  child.stderr.setEncoding("utf8");
  const write = (line) => {
    if (closing || !child.stdin.writable) return false;
    try { child.stdin.write(line); return true; } catch { return false; }
  };

  function handle(msg) {
    if (msg.session_id && !sessionSent) {
      sessionSent = true;
      onEvent({ type: "session", session_id: msg.session_id });
    }
    if (msg.type === "control_request") {
      const req = msg.request || {};
      if (req.subtype === "can_use_tool") {
        onEvent({ type: "permission", request_id: msg.request_id, tool: req.tool_name, input: req.input || {} });
      }
      return;
    }
    const evt = msg.type === "stream_event" ? msg.event : msg;
    if (evt && evt.type === "content_block_delta" && evt.delta && evt.delta.type === "text_delta") {
      onEvent({ type: "text", text: evt.delta.text });
    } else if (msg.type === "assistant" && msg.message && Array.isArray(msg.message.content)) {
      for (const block of msg.message.content) {
        if (block.type === "tool_use") {
          onEvent({ type: "tool", name: block.name, summary: JSON.stringify(block.input || {}).slice(0, 120) });
        }
      }
    } else if (msg.type === "result") {
      closing = true; // from here on the process only exits; replies go to a resumed process instead
      onEvent({ type: "result", is_error: msg.is_error === true, text: typeof msg.result === "string" ? msg.result : "" });
      if (child.stdin.writable) child.stdin.end();
    }
  }

  function lines(buf, chunk, each) {
    const parts = (buf + chunk).split(/\r?\n/);
    const rest = parts.pop();
    for (const p of parts) if (p.trim()) each(p);
    return rest;
  }

  child.stdout.on("data", (d) => {
    outBuf = lines(outBuf, d, (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { onEvent({ type: "stderr", text: line }); return; }
      handle(msg);
    });
  });
  child.stderr.on("data", (d) => {
    errBuf = lines(errBuf, d, (line) => onEvent({ type: "stderr", text: line }));
  });
  const finish = (code) => {
    if (exited) return;
    exited = true;
    if (outBuf.trim()) { try { handle(JSON.parse(outBuf)); } catch { onEvent({ type: "stderr", text: outBuf }); } }
    if (errBuf.trim()) onEvent({ type: "stderr", text: errBuf });
    onEvent({ type: "exit", code });
  };
  child.on("error", (e) => { onEvent({ type: "stderr", text: e.message }); finish(null); });
  child.on("close", (code) => finish(code));

  write(userLine(prompt));
  return {
    pid: child.pid,
    accepting: () => !closing && !exited && child.stdin.writable,
    send: (text) => write(userLine(text)),
    answer: (requestId, allow, input) => write(JSON.stringify({ type: "control_response", response: {
      subtype: "success", request_id: requestId,
      response: allow ? { behavior: "allow", updatedInput: input || {} }
        : { behavior: "deny", message: "Denied by Lucky in Jarvis" },
    } }) + "\n"),
    stop: () => { if (!exited) killTree(child); },
  };
}

module.exports = { SESSION_ID, PERMISSION_MODES, claudeArgs, startProcess, childEnv, killTree };
