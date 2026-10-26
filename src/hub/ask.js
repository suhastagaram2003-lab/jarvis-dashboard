// Ask — the command box's read-only Claude run
// `claude -p "/ask <question>"` in the project folder, spawned WITHOUT a shell (the question is one argument, so
// quotes, &, | or newlines run nothing), with only read tools plus the project's own read-only MCP tools.
// Returns: { READ_TOOLS, DENIED, askArgs, findClaude, parseResult, runAsk }

const READ_TOOLS = ["Read", "Grep", "Glob"];
const DENIED = ["Bash", "PowerShell", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Agent"];
const NOT_FOUND = "claude.exe not found; set hub.claudePath";

function askArgs(entry, question) {
  const tools = [...READ_TOOLS, ...((entry && entry.ask_tools) || [])];
  return [
    "-p", "/ask " + question,
    "--output-format", "json",
    "--allowedTools", tools.join(","),
    "--disallowedTools", DENIED.join(","),
  ];
}

function joinPath(dir, ...parts) {
  const sep = dir.includes("\\") ? "\\" : "/";
  return [dir.replace(/[\\/]+$/, ""), ...parts].join(sep);
}

// Node refuses to spawn a .cmd without a shell, and the command box never uses one, so only a .exe will do.
function findClaude(fs, home, configured, whereOutput) {
  if (configured && fs.existsSync(configured)) return { path: configured, error: null };
  const native = joinPath(home, ".local", "bin", "claude.exe");
  if (fs.existsSync(native)) return { path: native, error: null };
  const fromWhere = String(whereOutput || "").split(/\r?\n/).map(l => l.trim())
    .find(l => /\.exe$/i.test(l));
  if (fromWhere) return { path: fromWhere, error: null };
  return { path: null, error: NOT_FOUND };
}

function parseResult(stdout) {
  let obj;
  try { obj = JSON.parse(String(stdout).trim()); } catch { return { ok: false, text: "unreadable reply" }; }
  if (!obj || typeof obj.result !== "string") return { ok: false, text: "unreadable reply" };
  return { ok: obj.is_error !== true, text: obj.result };
}

function displayCommand(file, args) {
  const q = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
  return [file, ...args].map(q).join(" ");
}

function runAsk({ entry, question, claudePath, spawn, timeoutMs = 120000 }) {
  const args = askArgs(entry, question);
  const command = displayCommand(claudePath, args); // for display only, never run
  return new Promise((resolve) => {
    let stdout = "", stderr = "", done = false, timer = null;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ...r, command });
    };
    let child;
    try {
      child = spawn(claudePath, args, {
        cwd: entry.path, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      return finish({ ok: false, text: e.message });
    }
    timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ ok: false, text: `timed out after ${Math.round(timeoutMs / 1000)} s` });
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => finish({ ok: false, text: e.message }));
    child.on("close", (code) => {
      const parsed = parseResult(stdout);
      if (code === 0 || parsed.text !== "unreadable reply") return finish(code === 0 ? parsed : { ...parsed, ok: false });
      const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-5).join("\n");
      finish({ ok: false, text: `claude failed (exit ${code})${tail ? ":\n" + tail : ""}` });
    });
  });
}

return { READ_TOOLS, DENIED, askArgs, findClaude, parseResult, runAsk };
