// Claude Process — one `claude -p` child with stream-json in both directions
// The stdin/stdout handling (newline-delimited JSON, stream_event text deltas, control_request asks answered with
// control_response, stdin closed on result) is copied from upstream's companion/modules/claude-runner.js
// (AndrewKochulab/jarvis-dashboard, MIT). Spawned without a shell: the prompt only ever travels as a JSON message.
const childProcess = require("child_process");
const { PERMISSION_FLAGS } = require("./claude-flags");
const { DISALLOWED_TOOLS } = require("./policy");

function claudeArgs({ sessionId } = {}) {
  return [
    ...(sessionId ? ["--resume", sessionId] : []),
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
  let sessionSent = false, outBuf = "", errBuf = "", exited = false;
  const write = (line) => {
    if (!child.stdin.writable) return false;
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
    outBuf = lines(outBuf, d.toString("utf8"), (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { onEvent({ type: "stderr", text: line }); return; }
      handle(msg);
    });
  });
  child.stderr.on("data", (d) => {
    errBuf = lines(errBuf, d.toString("utf8"), (line) => onEvent({ type: "stderr", text: line }));
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
    send: (text) => write(userLine(text)),
    answer: (requestId, allow, input) => write(JSON.stringify({ type: "control_response", response: {
      subtype: "success", request_id: requestId,
      response: allow ? { behavior: "allow", updatedInput: input || {} }
        : { behavior: "deny", message: "Denied by Lucky in Jarvis" },
    } }) + "\n"),
    stop: () => { if (!exited) killTree(child); },
  };
}

module.exports = { claudeArgs, startProcess, childEnv, killTree };
