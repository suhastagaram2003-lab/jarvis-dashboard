# Jarvis web app

A local web app on the PC that shows every task waiting on you across the registered projects, most urgent first,
and runs the right Claude process for a task with one **Execute** click. The run streams live in the app, where you
can approve or deny each permission ask, reply, and stop it. It also has a tab per project, a Chat tab to talk to a
project's Claude, and a Runs tab with every run's log. It reads the same files as the Obsidian note, which keeps
working unchanged. Design: [docs/specs/2026-10-26-jarvis-web-app-design.md](../docs/specs/2026-10-26-jarvis-web-app-design.md).

## Start it

```
npm install
npm run app
```

The server prints a link like `http://127.0.0.1:4317/?t=<token>`. Open it once in your browser; it sets a cookie, so
afterwards `http://127.0.0.1:4317/` is enough. To start it at log-in, run
`powershell -ExecutionPolicy Bypass -File app\scripts\install-startup.ps1` once (add `-Remove` to undo). That puts a
`Jarvis` shortcut in your Startup folder; it does not start anything at install time.

## What it reads and writes

- Reads `~/.jarvis/registry.json`, `~/.jarvis/projects/<name>.json` and each project's `recent_dirs`, like the note.
- Writes only under `~/.jarvis/`: `app-token` (the link's secret), `runs/` (one `<id>.jsonl` log per run plus
  `index.json`) and `inbox/<project>/` (Quick Capture).
- It never writes into a project folder itself. A Claude run you start with a click works in that project's folder
  under that project's own CLAUDE.md, settings and guard.

## Settings

- **`allowed_commands`** in each registry entry: the command prefixes Execute may run. The default is
  `["claude \""]`, i.e. Claude prompts only. Only the form `claude "<prompt>"` runs from Jarvis; any other queue
  command shows a disabled Execute button with the reason.
- **Refresh** on a project tab runs that entry's own `export_command`, unchanged, and shows its output as a run.
- **`hub.claudePath`** in `src/config/config.json`: where `claude.exe` is, if it is not at
  `%USERPROFILE%\.local\bin\claude.exe` or on `PATH`.
- **`hub.permissionModes`** in `src/config/config.json`, e.g. `{"execute": "default"}`: the permission mode for
  Execute and Chat runs. Unset, a run inherits your own Claude settings (auto mode on the PC: the classifier allows
  safe steps and blocks risky ones without asking). `"default"` makes every action that is not pre-allowed wait for
  Approve or Deny in the run panel.
- **`hub.port`** (default `4317`), or `JARVIS_PORT`; `JARVIS_HOME` overrides `hub.jarvisHome`.

## Safety

- Listens on `127.0.0.1` only. Every request needs the token, and the server refuses a foreign `Host` or `Origin`,
  so another website cannot drive it. There is no generic file or shell endpoint: the browser sends a task id, a
  reply or a decision, never a command line.
- Every Claude run blocks the order, trade and money-moving tools (`app/server/policy.js` and
  `app/server/claude-flags.js`) on top of each project's own deny lists. No orders, trades or bets, ever.
- At most 3 runs at once. A run with no output for 10 minutes is marked stalled, not killed. If the server stops,
  its runs stop with it and show as "stopped (server restarted)".

## Code

`app/server/` (Node, one dependency `ws`): `state.js` wraps the note's own `src/hub/` modules, `urgency.js` ranks the
queue, `policy.js` decides what may run, `claude-process.js` drives `claude -p` with stream-json both ways,
`runs.js` keeps runs and logs, `http.js` serves the API and `app/web/`. Tests: `npm test`.
