# Jarvis web app — design

Date: 2026-10-26. Requested by Lucky in the "Jarvis Obsidian dashboard" thread, after using the Obsidian hub
(`docs/specs/2026-10-23-jarvis-hub-design.md`, PRs #1 and #2): "we will need to make some interactivity changes or
create this as an app for better useability. It is restricted in obsidian."

## Goal

A local web app on the PC, opened in the browser, that shows every task waiting on Lucky across all registered projects
in order of urgency, and runs the right process for a task with one Execute click, inside the app, where Lucky can watch
it, answer it and stop it. It also lets Lucky talk directly to a project's Claude.

Done looks like: Lucky opens the Jarvis link, sees the Tasks tab with MarketBrain's and BetBrain's items most urgent
first, clicks Execute on "5 proposals wait on /review", watches the `/review` run stream in a panel, answers its
questions there, approves a permission ask with a button, and sees the row turn done. No PowerShell paste, no Obsidian.

## What Lucky said (2026-10-26)

- Problems with the Obsidian note: "buttons werent interactive, lots of scrolling, no separate tabs", and "I couldn't
  communicate directly to certain agents or workflows".
- Want: "see tasks I need to handle in order of urgency and by project and just click execute to kick off the right
  processes to handle it".
- Chose: a **local web app in the browser** (over a desktop app or staying in Obsidian), and Execute runs **inside the
  app with a live log** (over opening a terminal window).
- Approved the design summary in chat ("yes").

## Assumptions (stated to Lucky, not corrected)

- Only reachable from the PC itself (bound to `127.0.0.1`). Phone access over home Wi-Fi is a later add-on.
- Started by one command, and optionally at log-in by a Claude-free Windows shortcut in the Startup folder.
- The Obsidian note keeps working unchanged; the app is a second front end over the same data.

## Constraints (carried from the hub spec and RULES.md)

1. **Read-only toward projects, except Execute.** The app reads `~/.jarvis/registry.json`, `~/.jarvis/projects/*.json`
   and each project's `recent_dirs`, exactly as `src/hub/` does. It writes only under `~/.jarvis/` (runs, captures).
   The only way it changes a project is a Claude run that Lucky started with a click, in that project's own folder, under
   that project's own CLAUDE.md, settings and guard.
2. **No orders, trades or bets, ever.** Every run passes `--disallowedTools` with the order and trade tools (the Robinhood,
   Alpaca and sportsbook write tools by pattern), on top of each project's own deny lists.
3. **Commands come from the project.** Execute runs only a queue item's `action.command` from that project's export, and
   only when it matches that project's `allowed_commands` prefixes in the registry. The browser never sends a command
   line; it sends a queue item id.
4. **No new hole on localhost.** The server listens on `127.0.0.1` only, requires a random token (made at first start,
   kept in `~/.jarvis/app-token`) on every request, checks `Origin`/`Host` so another website cannot drive it, and has
   no generic file or shell endpoint.
5. `macos/`, `ios/` and `companion/` stay untouched; code is borrowed from them by copying into `app/` with credit.
6. No private data in the repo, fixtures or logs (holdings, account numbers, balances, family details).
7. Tests: `npm test` (`node:test`). The server may add one runtime dependency, `ws`, which `companion/` already uses.

## Approaches considered

1. **Node server with typed endpoints, reused widget code in the browser (chosen).** The server runs `src/hub/` in Node
   and exposes a small API; the browser renders tabs with the existing DOM helpers and widget views, fed from that API.
2. **Shim the Obsidian globals like `macos/web/macos-bootstrap.js`** (a browser `require("fs")` and `child_process`
   backed by the server). Fastest reuse, but it puts generic file and shell access on localhost. Rejected (constraint 4).
3. **A fresh React app.** Cleaner, but rewrites every widget and adds a build step. Rejected for now (YAGNI).

## Architecture

```
browser (http://127.0.0.1:4317/?t=<token>)
   │  GET /api/state          (hub state, every 10 s or on push)
   │  POST /api/runs          {project, item_id} or {project, prompt}
   │  WS  /api/runs/<id>      (stream events; send reply / approve / deny / stop)
   │  POST /api/capture, POST /api/refresh/<project>
   ▼
app/server (Node, no build step)
   ├─ state.js     wraps src/hub/hub-store.js + recent.js → one JSON state
   ├─ urgency.js   ranks the merged queue
   ├─ runs.js      run manager: spawns claude (stream-json both ways), keeps run logs
   ├─ policy.js    allowed_commands check, disallowed tools, token and origin checks
   └─ http.js      routes, static files from app/web/
app/web (plain JS modules + the existing theme and styles)
```

### Units

- **`app/server/state.js`** — `buildState({fs, jarvisHome, now})` returns `{projects, queue, agents, learning,
  suggestions, metrics, recent, errors}` by calling the existing `src/hub/hub-store.js` and `src/hub/recent.js`
  (loaded the same way the tests load them). Every queue item gets a stable `id` = sha1 of `project|kind|title`.
- **`app/server/urgency.js`** — `rank(items)` sorts by urgency then age. Urgency comes from the item's optional
  `urgency` field (`high|normal|low`, schema v1 additive, see below) and otherwise from kind:
  `failed-run` and a `pr` with a conflict → high; `pr` and `proposal` → normal; `lint-error` → low. Within a level,
  older first. Ties keep project order from the registry.
- **`app/server/runs.js`** — `startRun({entry, prompt, sessionId?})` spawns `claude -p --input-format stream-json
  --output-format stream-json --include-partial-messages --verbose` in `entry.path` with no shell, `--disallowedTools`
  from policy, and stdin left open. It forwards stream events to subscribers, turns `control_request` permission asks
  into `{type: "permission", tool, input, request_id}` events, and writes Lucky's answers back as `control_response`
  (the pattern of `companion/modules/claude-runner.js`; the plan's first task confirms on the PC which flag makes the
  installed CLI send permission asks over stdio, e.g. `--permission-prompt-tool stdio`). Lucky's typed replies are sent as stream-json user messages.
  Stop kills the process tree (`taskkill /T /F` on Windows). Each run is logged to `~/.jarvis/runs/<id>.jsonl` with a
  summary in `~/.jarvis/runs/index.json` (project, item, started, ended, status `running|done|failed|stopped`). At
  most 3 runs at once; a fourth is refused with a clear message. A run with no events for 10 minutes is marked
  `stalled` (not killed).
- **`app/server/policy.js`** — `commandFor(entry, item)` returns the command only if `item.action.command` starts with
  one of `entry.allowed_commands`; `promptFor(command)` turns `claude "/review"` into the prompt `/review` (the
  supported form is `claude "<prompt>"`; anything else is refused in this version). Also `DISALLOWED_TOOLS`,
  `checkToken(req)`, `checkOrigin(req)`.
- **`app/server/http.js`** — node `http` plus `ws`. Routes:
  `GET /` and static files; `GET /api/state`; `POST /api/runs` (`{project, item_id}` for Execute or
  `{project, prompt}` for Chat); `GET /api/runs` (history); `WS /api/runs/<id>` (events out; `reply`, `allow`,
  `deny`, `stop` in); `POST /api/refresh/<project>` (runs that project's `export_command` through the same policy, as a
  run, so it shows in the log); `POST /api/capture` (reuses `src/hub/capture.js`).
- **`app/web/`** — `index.html`, `app.js` (tab router, state polling), `views/*.js`. Views reuse `src/core/theme.js`,
  `styles.js` and `helpers.js` where they do not touch Obsidian, and the existing widget views where they only read
  `ctx.hub`.

### Tabs

1. **Tasks** (default): the ranked queue, grouped by project with a project filter, each row showing kind, title, age,
   urgency and an **Execute** button (disabled with the reason when the command is not allowed). Clicking Execute opens
   the run panel on the right.
2. **One tab per project** (MarketBrain, BetBrain, any new registry entry): health, agents and schedules, queue, what
   it learned, fix-next suggestions, metrics, recent pages, and a Refresh button.
3. **Chat**: pick a project, type, and talk to its Claude in the run panel; the conversation resumes the same session
   until Lucky starts a new one. Slash commands (`/ask`, `/tune`, `/desk`) work as typed, since the run starts in the
   project folder and loads its skills.
4. **Runs**: history of runs with status, open any to read its log.

### Run panel

Streams Claude's text and tool calls as they happen (tool calls collapsed to one line each), shows a permission card
with Approve and Deny for each ask, a reply box, Stop, and a done, failed, stopped or stalled badge at the end. The
Tasks row of the item shows the same badge.

## Schema change (additive, v1 stays)

`queue[].urgency` (`"high" | "normal" | "low"`, optional) and `queue[].id` (string, optional) are added to
`schema/hub-export-v1.json`. Old exports stay valid. The MarketBrain exporter sets `urgency` in a small follow-up PR in
MarketBrain; BetBrain may adopt it through its own handoff.

## Registry change

Each entry gains `allowed_commands` (list of command prefixes Execute may run; default `["claude \""]`, i.e. Claude
prompts only, plus the entry's own `export_command` for Refresh). `examples/registry.example.json` shows it.

## Error handling

- Missing registry or export: the same messages as the Obsidian hub, shown on the Tasks tab with what to fix.
- `claude` not found: the run panel says "set hub.claudePath in config" and names the paths it tried.
- A run that exits non-zero: badge failed, last 20 lines of stderr shown.
- Server restart while a run is going: runs are child processes of the server, so they stop with it; on start, any
  `running` entry in the index is marked `stopped (server restarted)`.

## Testing

- Unit (`node:test`): urgency ranking, item ids, `commandFor` allow and refuse cases, token and origin checks,
  `promptFor`, state building from the fixtures, run manager with a fake `claude` script (a Node file that prints
  stream-json, emits one `control_request`, and echoes replies), stop, the 3-run limit, the stalled mark, restart
  cleanup.
- HTTP: start the server on a random port in the test and hit each route, including refused requests without the token
  or with a foreign `Origin`.
- On the PC (Claude runs this, not Lucky): start the server, open it with Playwright, take screenshots of each tab, run
  Execute on a real proposal item with `/review` and on a Chat `/ask`, approve one permission ask, stop one run.

## Out of scope (later)

Phone access over Wi-Fi; a desktop window or tray icon; voice; Execute without a click; running non-Claude command
lines; a BetBrain exporter (BetBrain's own project).

## Phases

1. Server core: state, urgency, policy, run manager, HTTP and tests.
2. Web front end: tabs, Tasks with Execute, run panel, project tabs, Chat, Runs.
3. Start script and docs (`app/README.md`, `npm run app`), PC check with screenshots, then merge into `dev`.
4. MarketBrain follow-up: `urgency` in `mb hub export` (separate MarketBrain PR).
