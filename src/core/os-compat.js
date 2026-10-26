// OS Compat — process checks, terminal launch, open and command runs for Windows and macOS
// Needs no ctx fields. `require` comes from ctx.require when given (Node workers and tests), else the global
// (Obsidian). Arguments are always passed as arrays, never joined into one shell string, so paths with spaces
// stay one argument. The one exception is runCommand: registry export commands are shell lines the user wrote.
// Returns: { isClaudeProjectDir, hasClaudeProcess, processCommand, processListing, launchArgs, openArgs,
//            launch, open, runCommand }

const _require = (ctx && ctx.require) || require;
const childProcess = _require("child_process");

// Claude names project dirs after the path: "-Users-andrew-vault" on macOS, "C--Users-sutag-Documents-x" on Windows.
function isClaudeProjectDir(name) {
  return /^-|^[A-Za-z]--/.test(name);
}

function hasClaudeProcess(listing, platform = process.platform) {
  const lines = String(listing || "").split(/\r?\n/);
  if (platform === "win32") return lines.some(line => /claude\.exe/i.test(line));
  return lines.some(line => line.includes("/claude") && !line.includes("pgrep"));
}

function processCommand(platform = process.platform) {
  return platform === "win32"
    ? { file: "tasklist", args: ["/FO", "CSV", "/NH"] }
    : { file: "pgrep", args: ["-fa", "claude"] };
}

function processListing(platform = process.platform) {
  const { file, args } = processCommand(platform);
  try {
    return childProcess.execFileSync(file, args, { encoding: "utf8", timeout: 3000, windowsHide: true });
  } catch {
    return "";
  }
}

function launchArgs(dir, command, platform = process.platform, terminalApp = "Terminal") {
  const cmd = command || "claude";
  if (platform === "win32") {
    // Windows Terminal splits its command line on ";" into several commands; ";" keeps a literal one.
    return { file: "wt.exe", args: ["-w", "0", "nt", "-d", dir, "cmd", "/k", cmd.replace(/;/g, "\\;")] };
  }
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return {
    file: "osascript",
    args: [
      "-e", `tell application "${terminalApp}"`,
      "-e", `do script "cd '${esc(dir)}' && ${esc(cmd)}"`,
      "-e", "activate",
      "-e", "end tell",
    ],
  };
}

function openArgs(target, platform = process.platform) {
  // Not `cmd /c start`: cmd would split a URL like obsidian://open?vault=x&file=y at the "&".
  if (platform === "win32") return { file: "rundll32.exe", args: ["url.dll,FileProtocolHandler", target] };
  return { file: "open", args: [target] };
}

function notify(message) {
  if (typeof Notice !== "undefined") new Notice(message);
}

function spawnDetached({ file, args }, what) {
  try {
    const child = childProcess.spawn(file, args, { detached: true, stdio: "ignore", windowsHide: false });
    child.on("error", (e) => notify(`${what} failed: ${e.message}`));
    child.unref();
  } catch (e) {
    notify(`${what} failed: ${e.message}`);
  }
}

function launch(dir, command, terminalApp) {
  spawnDetached(launchArgs(dir, command, process.platform, terminalApp), `Opening a terminal in ${dir}`);
}

function open(target) {
  spawnDetached(openArgs(target), `Opening ${target}`);
}

function tail(text, n) {
  return text.split(/\r?\n/).filter(line => line.length > 0).slice(-n).join("\n");
}

function killTree(child) {
  try {
    if (process.platform === "win32") {
      childProcess.execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    try { child.kill("SIGKILL"); } catch {}
  }
}

function runCommand(command, cwd, timeoutMs = 120000) {
  return new Promise((resolve) => {
    let stdout = "", stderr = "", done = false, timer = null;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ stdout, stderrTail: tail(stderr, 5), ...result });
    };
    let child;
    try {
      child = childProcess.spawn(command, {
        cwd, shell: true, windowsHide: true,
        detached: process.platform !== "win32", // own process group, so a timeout kills the whole tree
      });
    } catch (e) {
      stderr = e.message;
      return finish({ code: null, timedOut: false });
    }
    timer = setTimeout(() => {
      killTree(child);
      stderr += `\ntimed out after ${Math.round(timeoutMs / 1000)} s`;
      finish({ code: null, timedOut: true });
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => { stderr += `\n${e.message}`; finish({ code: null, timedOut: false }); });
    child.on("close", (code) => finish({ code, timedOut: false }));
  });
}

return {
  isClaudeProjectDir, hasClaudeProcess, processCommand, processListing, launchArgs, openArgs,
  launch, open, runCommand,
};
