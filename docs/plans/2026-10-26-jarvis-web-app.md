# Jarvis web app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web app (`npm run app`, `http://127.0.0.1:4317`) that lists every task waiting on Lucky across the
registered projects, most urgent first, and runs the right Claude process for a task with one Execute click, streamed
live in the app, with Approve/Deny, reply and Stop; plus per-project tabs, Chat with a project's Claude, and run history.

**Architecture:** A Node server (`app/server/`, no build step, one dependency `ws`) loads the existing `src/hub/`
module bodies the same way the tests do, builds one state JSON, ranks the queue, and owns all Claude processes
(`claude -p` with stream-json in and out, permission asks over stdio). The browser (`app/web/`, plain ES modules) only
renders state and sends item ids, replies and decisions; it never sends a command line. View code is split into pure
"model" functions (tested in Node) and thin DOM code (checked with Playwright).

**Tech Stack:** Node 22+ (`node:http`, `node:child_process`, `node:crypto`, `node:test`), `ws@8`, plain HTML/CSS/JS
modules, Playwright (already on the PC and in cloud containers) for screenshots and the end-to-end check only.

**Spec:** `docs/specs/2026-10-26-jarvis-web-app-design.md`

## Global Constraints

- Listen on `127.0.0.1` only, port `4317` (override `JARVIS_PORT`). Never `0.0.0.0`.
- Token: 32 random bytes, hex, made at first start in `~/.jarvis/app-token` (mode `0600`), required on every request.
- The app writes only under `~/.jarvis/` (`app-token`, `runs/`, `inbox/` via `src/hub/capture.js`). It never writes
  into a project folder; only a Claude run Lucky started does, in that project's folder under its own rules.
- Execute runs only `item.action.command` from the project's export, only if it starts with one of the entry's
  `allowed_commands` (default `['claude "']`), and only in the supported form `claude "<prompt>"`.
- Refresh runs only the entry's own `export_command`, unchanged (it is Lucky's registry line, run with a shell as
  `src/core/os-compat.js` `runCommand` already does).
- Every Claude run gets `--disallowedTools` with `DISALLOWED_TOOLS` (order, trade and bet tools) on top of the project's
  own deny lists. No orders, trades or bets, ever.
- At most 3 live runs; a run with no event for 10 minutes is marked `stalled`, not killed.
- `macos/`, `ios/`, `companion/` stay untouched. Code borrowed from `companion/modules/claude-runner.js` is copied with
  a credit line.
- No private data in the repo, fixtures, examples or logs (holdings, account numbers, balances, family details).
- Tests stay in `tests/*.test.js` (the existing `npm test` glob); app tests are named `tests/app-*.test.js`.
- The Obsidian note keeps working unchanged; `src/hub/` changes are additive only.

## Review Focus

- **A queue item whose `action.command` is not `claude "<prompt>"`** (e.g. `uv run mb lint --fix`): Execute is
  disabled with the reason "only Claude prompts can run from Jarvis", never run through a shell. Test in Task 2.
- **A prompt with quotes, `&`, `|` or newlines** inside `claude "..."`: passed as one stream-json message, never on a
  command line. Test in Task 5 (the fake claude echoes the exact text back).
- **The same item clicked twice** while its run is live: the second click opens the live run instead of starting a
  second one. Test in Task 7.
- **The browser tab is closed mid-run and reopened**: the run keeps going and the panel replays its events from the
  start, then streams live. Test in Task 7.
- **An export changes between page load and Execute** (the item is gone or its command changed): the server looks the
  item up by id in fresh state and answers 404 "this task is no longer in the export; refresh". Test in Task 7.

---

### Task 1: Scaffold, source loader and the PC probe of the Claude CLI

**Files:**
- Modify: `package.json` (add `"dependencies": {"ws": "^8.18.0"}`, `"scripts": {"app": "node app/server/main.js"}`),
  `.gitignore` (nothing new: `node_modules/` is already there)
- Create: `app/server/load-src.js`, `app/scripts/probe-claude.js`, `tests/app-load-src.test.js`

**Interfaces:**
- Produces: `loadSrc(relPath: string, ctx?: object) -> any` (CommonJS, `app/server/load-src.js`): reads
  `src/<relPath>`, runs it as `new Function("ctx", code)(ctx)` with `ctx` defaulting to
  `{nodeFs, nodePath, os, require}`; `hubSchema() -> object` reads `schema/hub-export-v1.json`.
- Produces: the probe's findings, written into `app/server/claude-flags.js` as
  `module.exports = { PERMISSION_FLAGS: string[], EXTRA_DISALLOWED: string[] }`.

- [ ] **Step 1: Test** `tests/app-load-src.test.js`: `loadSrc("hub/hub-store.js", {hubSchema: hubSchema()})` returns
  an object with `loadProjects` and `mergeQueue` functions; `loadSrc("hub/recent.js")` has `recentFiles`.
- [ ] **Step 2: Run** `npm test` → the new test fails (module missing).
- [ ] **Step 3: Implement** `app/server/load-src.js` (mirror `tests/load-module.js`, paths from `__dirname`).
- [ ] **Step 4: Run** `npm install` then `npm test` → all pass. Commit `package-lock.json` too.
- [ ] **Step 5: Probe on the PC** (Claude runs it through Remote Control, not Lucky): `app/scripts/probe-claude.js`
  spawns the installed `claude.exe` (found with `src/hub/ask.js` `findClaude`) in a scratch folder under
  `%TEMP%\jarvis-probe` with `-p --input-format stream-json --output-format stream-json --verbose
  --include-partial-messages --permission-prompt-tool stdio`, sends one user message asking it to run
  `Bash(echo hi)`, and prints every line type it gets. Pass = a `control_request` with `request.subtype ===
  "can_use_tool"` arrives, and answering it with the Task 5 `control_response` makes the tool run. If no ask arrives,
  try without `--permission-prompt-tool` and with `--permission-mode default`, and record what works. The probe also
  runs `claude mcp list` and prints every MCP tool whose name matches `/order|trade|bet|wager|exercise|transfer/i`.
- [ ] **Step 6: Record** the working flags in `PERMISSION_FLAGS` and the found write-tool names in `EXTRA_DISALLOWED`
  in `app/server/claude-flags.js`.
- [ ] **Step 7: Commit** `feat(app): scaffold, source loader and claude flag probe`

### Task 2: Policy (commands, tools, token, origin)

**Files:**
- Create: `app/server/policy.js`, `tests/app-policy.test.js`

**Interfaces:**
- Consumes: `claude-flags.js` from Task 1.
- Produces (CommonJS):
  - `DISALLOWED_TOOLS: string[]` — at least `mcp__Robin_Hood__place_equity_order`, `place_option_order`,
    `place_crypto_order`, `cancel_equity_order`, `cancel_option_order`, `cancel_crypto_order`, `exercise_option`,
    `cancel_option_exercise`, `review_equity_order`, `review_option_order` (all `mcp__Robin_Hood__` prefixed), plus
    `EXTRA_DISALLOWED`, de-duplicated.
  - `promptFor(command: string) -> string | null` — `/^claude "(.*)"$/s` exact; inner `\"` unescaped to `"`.
  - `commandFor(entry, item) -> {prompt: string} | {error: string}`.
  - `refreshFor(entry) -> {command: string} | {error: string}`.
  - `makeToken() -> string` (64 hex), `loadOrCreateToken(fs, jarvisHome) -> string`.
  - `checkToken(req, token) -> boolean` — cookie `jarvis_t` or header `x-jarvis-token`, compared with
    `crypto.timingSafeEqual`.
  - `checkHost(req, port) -> boolean` — `Host` is `127.0.0.1:<port>` or `localhost:<port>`.
  - `checkOrigin(req, port) -> boolean` — no `Origin` header, or `http://127.0.0.1:<port>` / `http://localhost:<port>`.

- [ ] **Step 1: Tests** in `tests/app-policy.test.js`:
  - `promptFor('claude "/review"') === "/review"`; `promptFor('claude "/ask why \\"x\\""') === '/ask why "x"'`;
    `promptFor("uv run mb lint")` and `promptFor('claude "/review" && del x')` are `null`.
  - `commandFor({allowed_commands: undefined}, {action: {command: 'claude "/review"'}})` → `{prompt: "/review"}`.
  - `commandFor({allowed_commands: ["uv run"]}, item('claude "/review"'))` → error matching `/not allowed/`.
  - `commandFor({}, item("uv run mb lint --fix"))` → `{error: "only Claude prompts can run from Jarvis"}`.
  - `refreshFor({export_command: "uv run --no-sync mb hub export --json"})` returns that exact command;
    `refreshFor({})` → error `/no export_command/`.
  - `DISALLOWED_TOOLS` includes `mcp__Robin_Hood__place_equity_order` and has no duplicates.
  - token: `loadOrCreateToken` on an empty temp dir creates `app-token` and returns the same value on a second call.
  - `checkToken` true for the cookie, true for the header, false for a wrong token of the same length and for none.
  - `checkHost` false for `evil.com:4317`; `checkOrigin` false for `http://evil.com`, true when absent.
- [ ] **Step 2: Run** `npm test` → fail. **Step 3: Implement.** **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `feat(app): command, tool, token and origin policy`

### Task 3: Urgency, item ids, schema and registry additions

**Files:**
- Create: `app/server/urgency.js`, `tests/app-urgency.test.js`
- Modify: `schema/hub-export-v1.json` (queue item: optional `urgency` enum `high|normal|low`, optional `id` string),
  `examples/registry.example.json` (each entry gains `"allowed_commands": ["claude \""]`),
  `examples/projects/marketbrain.json` (one item with `"urgency": "high"`), `tests/hub-store.test.js` (one case)

**Interfaces:**
- Produces: `itemId(project: string, item) -> string` — `item.id` if set, else first 12 hex of
  sha1(`${project}|${kind}|${title}`); `levelOf(item) -> "high"|"normal"|"low"`;
  `rank(items) -> items` (new array; each item gets `id` and `urgency`).

- [ ] **Step 1: Tests**:
  - `levelOf({kind: "failed-run"}) === "high"`; `levelOf({kind: "pr", title: "PR #9 has a merge conflict"})
    === "high"` (title matches `/conflict/i`); `pr` otherwise and `proposal` → `normal`; `lint-error` → `low`;
    an explicit `urgency: "low"` on a `failed-run` wins.
  - `rank` orders high before normal before low; within a level larger `age_days` first; equal age keeps input order
    (input is already in registry order).
  - `itemId("marketbrain", x)` is stable across calls, 12 hex chars, differs when the title differs, and equals
    `x.id` when given.
  - hub-store: a queue item with `urgency` and `id` validates; `urgency: "urgent"` fails with `/urgency/`.
- [ ] **Step 2: Run** → fail. **Step 3: Implement** (stable sort with the original index as last key).
  **Step 4: Run** `npm test` → pass, including the existing hub-store and dashboard-note tests.
- [ ] **Step 5: Commit** `feat(app): urgency ranking, item ids, schema urgency and id`

### Task 4: State

**Files:**
- Create: `app/server/state.js`, `tests/app-state.test.js`, `tests/fixtures/app-home/` (a `registry.json` with
  MarketBrain and a second project `demo` whose export is missing, and `projects/marketbrain.json` copied from the
  example with `exported_at` filled in by the test)

**Interfaces:**
- Consumes: `loadSrc`, `hubSchema` (Task 1), `rank`, `itemId` (Task 3).
- Produces: `buildState({fs, jarvisHome, now, runsByItem?}) -> {generated_at, projects, queue, agents, learning,
  suggestions, metrics, recent, errors}` where
  - `projects[]` = `{name, label, color, status, reason, card, health, agents, queue, learning, suggestions, metrics,
    links, recent}` per registry entry (from `projectCard`, the export, and `recentFiles` limited to that entry);
  - `queue[]` = ranked merged queue items with `project` (name), `label`, `color`, `id`, `urgency`, `allowed`
    (`true` or the `commandFor` error string) and `run` (the latest run summary for that item id, or `null`);
  - `errors[]` = the registry error, if any, plus `"<label>: <reason>"` for each error project.
  - Never includes `entry.path` or `export_command` in the output (the browser does not need paths).

- [ ] **Step 1: Tests**: with the fixture home, `queue` is non-empty and sorted by `rank`; every queue item has a
  12-hex `id`; `projects.find(p => p.name === "demo").status === "error"` and `errors` mentions `Demo`; a missing
  registry gives `errors[0]` matching `/no registry/` and empty lists; `JSON.stringify(state)` does not contain the
  fixture path; `runsByItem` is reflected in `queue[i].run`.
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `feat(app): hub state for the web app`

### Task 5: Run process (spawn, stream, permissions, replies, stop)

**Files:**
- Create: `app/server/claude-process.js`, `tests/fixtures/fake-claude.js`, `tests/app-claude-process.test.js`

**Interfaces:**
- Consumes: `PERMISSION_FLAGS` (Task 1), `DISALLOWED_TOOLS` (Task 2), `findClaude` from `src/hub/ask.js`.
- Produces: `claudeArgs({sessionId?}) -> string[]` = `[--resume <id>]? -p --input-format stream-json --output-format
  stream-json --verbose --include-partial-messages ...PERMISSION_FLAGS --disallowedTools <DISALLOWED_TOOLS joined by
  ",">`; and `startProcess({file, args, cwd, prompt, spawn?, onEvent}) -> {pid, send(text), answer(requestId, allow,
  input), stop()}`. Normalized events passed to `onEvent`:
  `{type:"session", session_id}`, `{type:"text", text}` (from `text_delta`), `{type:"tool", name, summary}` (from an
  assistant `tool_use` block; `summary` = first 120 chars of the input JSON), `{type:"permission", request_id, tool,
  input}`, `{type:"result", is_error, text}`, `{type:"stderr", text}`, `{type:"exit", code}`.
  - User message on stdin: `{"type":"user","message":{"role":"user","content":[{"type":"text","text":<text>}]}}`.
  - Answer on stdin: `{"type":"control_response","response":{"subtype":"success","request_id":<id>,"response":
    {"behavior":"allow","updatedInput":<input>}}}` or `{"behavior":"deny","message":"Denied by Lucky in Jarvis"}`.
  - On `result`, stdin is closed so the process exits (as `claude-runner.js` does).
  - Spawn with `shell: false`, `windowsHide: true`, env without `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`,
    `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, plus `FORCE_COLOR=0`. `stop()` uses `taskkill /pid <pid> /T /F` on Windows, else
    `SIGTERM` then `SIGKILL` after 3 s.
- The fake claude (`node tests/fixtures/fake-claude.js`): prints a `system` init line with `session_id: "fake-1"`,
  reads the first user message, prints `text_delta` events echoing `echo: <text>`, prints a `control_request`
  (`can_use_tool`, tool `Bash`, input `{command: "echo hi"}`, `request_id: "r1"`), waits for the answer, prints
  `allowed` or `denied` as text, then a `result` line, and exits 0 when stdin closes. With `FAKE_HANG=1` it never
  prints `result`; with `FAKE_FAIL=1` it writes to stderr and exits 3.

- [ ] **Step 1: Tests** (spawn `process.execPath` with the fake script as the first arg):
  - events arrive in order `session`, `text` (`echo: /review`), `permission` (`r1`, `Bash`), and after
    `answer("r1", true, input)` a `text` `allowed`, then `result`, then `exit` with code 0.
  - `answer("r1", false)` gives `denied`.
  - a prompt `a "b" & c | d\nnext` comes back byte-for-byte in the echo.
  - `FAKE_FAIL=1` → `stderr` events and `exit` code 3.
  - `FAKE_HANG=1` then `stop()` → `exit` arrives within 5 s.
  - `claudeArgs({sessionId: "s1"})` starts with `--resume s1` and contains `--disallowedTools`.
- [ ] **Step 2: Run** → fail. **Step 3: Implement** (copy the line-buffer and `stream_event` parsing from
  `companion/modules/claude-runner.js` with a credit comment). **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `feat(app): claude stream-json process with permission answers`

### Task 6: Run manager (runs, logs, limits, stalled, restart)

**Files:**
- Create: `app/server/runs.js`, `tests/app-runs.test.js`

**Interfaces:**
- Consumes: `startProcess`, `claudeArgs` (Task 5); `runCommand`-style shell spawn for refresh (copied from
  `src/core/os-compat.js`, streaming lines as `text` events).
- Produces: `createRunManager({jarvisHome, fs, startProcess, now?, stallMs = 600000, maxLive = 3, idFn?})` →
  - `start({kind: "execute"|"chat"|"refresh", project, label, item_id?, title, cwd, prompt?, command?, sessionId?})
    -> run summary` — throws `Error("3 runs are going; wait for one to finish or stop one")` with `code = "LIMIT"`
    when `maxLive` are live; for `execute`, if a live run has the same `item_id`, returns that run instead.
  - `reply(id, text)` — writes to the live process, or, when the run has ended and has a `session_id`, starts a new
    process with `--resume` under the same run id (status back to `running`).
  - `answer(id, requestId, allow)`, `stop(id)`, `get(id) -> {summary, events}`, `list() -> summaries newest first`,
    `latestByItem() -> {[item_id]: summary}`, `subscribe(id, fn) -> unsubscribe`, `tick()` (stall check; also run
    every 30 s by a timer the manager owns and `close()` clears).
  - Summary = `{id, kind, project, label, item_id, title, started, ended, status, session_id, error}`; status is
    `running|waiting|done|failed|stopped|stalled` (`waiting` while a permission ask is open).
  - Each event is appended to `~/.jarvis/runs/<id>.jsonl` with `ts`; the index `~/.jarvis/runs/index.json` is rewritten
    by write-temp-then-rename after every status change. On create, index entries with status `running`, `waiting`
    or `stalled` become `stopped` with `error: "server restarted"`.
  - Run id = `YYYYMMDD-HHMMSS-<4 hex>` (local time).
  - `result` with `is_error` or a non-zero exit → `failed` with `error` = last 20 stderr lines; stop → `stopped`.

- [ ] **Step 1: Tests** (fake claude from Task 5, temp `jarvisHome`, fake clock):
  - a run goes `running` → `waiting` (on the ask) → `running` (after `answer`) → `done`; its `.jsonl` has every event
    and `index.json` shows `done`.
  - a fourth `start` while three `FAKE_HANG` runs are live throws with `code === "LIMIT"`.
  - `start` twice for the same `item_id` while live returns the same `id`.
  - no event for `stallMs` then `tick()` → `stalled`; a later event moves it back to `running`.
  - a manager created over an index holding a `running` entry rewrites it to `stopped`, `error: "server restarted"`.
  - `reply` after `done` restarts with `--resume fake-1` and the run's events continue in the same log.
  - a `refresh` run with `command: "node -e \"console.log('exported')\""` ends `done` with a `text` event `exported`.
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `feat(app): run manager with logs, limits and stall marks`

### Task 7: HTTP and WebSocket server

**Files:**
- Create: `app/server/http.js`, `app/server/main.js`, `app/server/config.js`, `tests/app-http.test.js`

**Interfaces:**
- Consumes: Tasks 2, 4, 6; `src/hub/capture.js` `save`; `findClaude`.
- Produces: `createServer({jarvisHome, fs, token, port, runs, claudePath, now?}) -> http.Server` (not listening) and
  `main()` which loads config, the token and the run manager, listens on `127.0.0.1:<port>` and prints
  `Jarvis: http://127.0.0.1:4317/?t=<token>`. `config.js` `loadAppConfig(repoRoot)` reads `hub.claudePath` and
  `hub.port` through `src/core/config-cascade.js` (`src/config/config*.json`).
- Routes (every one checks Host, then Origin, then the token, in that order: 421, 403, 401):
  - `GET /?t=<token>` → sets cookie `jarvis_t=<token>; HttpOnly; SameSite=Strict; Path=/` and 302 to `/`.
    `GET /` without a valid token → 401 with the one line "Open the link printed by npm run app."
  - `GET /` and `GET /<file>` → static files from `app/web/` only (`path.resolve` must stay inside it, else 404),
    plus `/theme.css` built from `src/core/theme.js` defaults.
  - `GET /api/state` → `buildState` with `runsByItem` from `runs.latestByItem()`.
  - `POST /api/runs` JSON `{project, item_id}` → looks the item up in fresh state; 404
    `"this task is no longer in the export; refresh"` when gone, 403 with the `allowed` reason when refused,
    409 for `LIMIT`, else 201 with the summary. `{project, prompt, session_id?}` → a `chat` run; `prompt` must be a
    non-empty string of at most 20,000 characters.
  - `GET /api/runs` → `runs.list()`; `GET /api/runs/<id>` → `runs.get(id)`.
  - `POST /api/refresh/<project>` → a `refresh` run with `refreshFor(entry)`.
  - `POST /api/capture` `{project, text}` → `capture.save` into `~/.jarvis/inbox`, 201 `{path}` (path relative to
    `~/.jarvis`).
  - `WS /api/runs/<id>/stream` → on connect sends `{type:"replay", events, summary}`, then each new event and
    `{type:"summary", summary}` on status changes; accepts `{type:"reply", text}`, `{type:"allow"|"deny",
    request_id}`, `{type:"stop"}`. Upgrade checks Host, Origin and the cookie like HTTP.
  - Unknown project → 404; bodies over 64 KB → 413; anything else → 404. No route takes a path or a command.
  - If `claudePath` is null, `POST /api/runs` → 503 `"claude.exe not found; set hub.claudePath in
    src/config/config.json"` (tried paths listed).

- [ ] **Step 1: Tests** (server on port 0 with the fixture home and the fake claude as `claudePath` wrapper):
  - no token → 401; wrong `Host` → 421; `Origin: http://evil.com` with a valid token → 403.
  - `GET /?t=<token>` → 302 with the cookie; `GET /api/state` with the cookie → 200 JSON with `queue`.
  - `GET /../package.json` and `GET /%2e%2e/package.json` → 404.
  - Execute on a fixture item id → 201; a second POST for the same id → 201 with the same run id.
  - Execute on an unknown id → 404 with the refresh message; on an item with `uv run ...` → 403.
  - WS: connect after the run started → first message is `replay` holding the earlier events; send `allow` for `r1`
    → a `text` `allowed` arrives; then `summary` with `done`.
  - Chat with `prompt: ""` → 400; capture writes one file under the temp `inbox/marketbrain/`.
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `feat(app): local HTTP and WebSocket server`

### Task 8: Web shell, Tasks tab and run panel

**Files:**
- Modify: `.gitignore` (add `app/scripts/out/`)
- Create: `app/web/index.html`, `app/web/app.css`, `app/web/app.js`, `app/web/api.js`, `app/web/models.js`,
  `app/web/views/tasks.js`, `app/web/views/run-panel.js`, `tests/app-models.test.js`

**Interfaces:**
- Consumes: the `/api/*` routes and WS messages of Task 7.
- Produces: `models.js` (ES module, also importable from Node tests with `import()`):
  - `taskRows(state, filterProject?) -> [{project, label, color, groupLabel, rows: [{id, kind, title, ageText,
    urgency, buttonLabel, disabledReason, badge}]}]` — grouped by project in rank order of each group's first item;
    `badge` from `item.run.status` (`running` → "Running", `waiting` → "Needs you", `done`, `failed`, `stopped`,
    `stalled`), `buttonLabel` "Open run" when a run is live, else `item.action.label` or "Execute".
  - `tabList(state) -> [{id: "tasks"|"chat"|"runs"|"project:<name>", label, count?}]` — Tasks (with queue count),
    one per project, Chat, Runs.
  - `panelLines(events) -> [{kind: "text"|"tool"|"permission"|"user"|"status"|"stderr", text, request_id?}]` — joins
    consecutive `text` deltas into one line, one line per tool call, keeps permission asks with their `request_id`.
- DOM: a top tab bar (no page scroll for the shell: tabs and the run panel scroll inside themselves), the run panel
  docked right on wide screens (≥ 1100 px) and full-screen over the tab below that. Hash routing (`#tasks`,
  `#project/marketbrain`, `#chat`, `#runs`, `#run/<id>`), so browser back works. State polls every 10 s and after
  every run status change. Colors come from `/theme.css` (the Obsidian hub's palette).
- Run panel: header (title, project, badge, Stop), the streamed lines, a permission card per open ask with Approve and
  Deny, a reply box (Enter sends, Shift+Enter new line), and the end badge.

- [ ] **Step 1: Tests** in `tests/app-models.test.js`: `taskRows` on a state with two projects keeps the high item's
  project group first; an item with `allowed: "only Claude prompts can run from Jarvis"` gets that `disabledReason`;
  a live run gives "Open run" and badge "Running"; `tabList` has Tasks first, Runs last and one tab per project;
  `panelLines` merges `text` deltas `"Hel"`, `"lo"` into `"Hello"` and keeps a permission ask's `request_id`.
- [ ] **Step 2: Run** → fail. **Step 3: Implement** models, then the DOM (`textContent` only, never `innerHTML` with
  data). **Step 4: Run** `npm test` → pass.
- [ ] **Step 5: Check in the browser:** `app/scripts/screenshot.mjs` (Playwright) starts the server on a temp
  `JARVIS_HOME` with the fixture and the fake claude, opens `/?t=<token>`, clicks Execute on the first task, clicks
  Approve, and saves `tasks.png` and `run.png` in `app/scripts/out/` (gitignored, added to `.gitignore` in this task). Pass = the run ends with the
  done badge and the Tasks row shows Done.
- [ ] **Step 6: Commit** `feat(app): web shell, Tasks tab and run panel`

### Task 9: Project tabs, Chat and Runs

**Files:**
- Create: `app/web/views/project.js`, `app/web/views/chat.js`, `app/web/views/runs.js`
- Modify: `app/web/models.js`, `tests/app-models.test.js`, `app/scripts/screenshot.mjs`

**Interfaces:**
- Produces: `projectSections(project) -> [{title, items}]` in this order: Health (lint errors and warnings, stale
  pages, unprocessed sources), Agents and schedules, Waiting on you, What it learned, Fix next, Metrics, Recent pages,
  Links; an error project returns one section "Not loaded" with its reason. `runRows(runs) -> [{id, title, label,
  kind, status, startedText, durationText}]`.
- Project tab: the sections plus a Refresh button (`POST /api/refresh/<name>`, opens its run in the panel) and a
  Quick Capture box (`POST /api/capture`). Recent pages and links open with their `obsidian://` URLs.
- Chat tab: project picker, message box; the first send starts a `chat` run; later sends `reply` on the same run (which
  resumes the session); "New conversation" forgets the run id. The last chat run per project is kept in
  `localStorage` (try/catch around every access).
- Runs tab: the run history table; a click opens the run in the panel (replayed from its log).

- [ ] **Step 1: Tests**: `projectSections` for the fixture has the eight titles in order; for an error project one
  "Not loaded" section with the reason; `runRows` sorts newest first and shows `durationText` "2m 05s" for a 125 s run
  and "running" for a live one.
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass.
- [ ] **Step 5: Check in the browser:** extend `screenshot.mjs` to open each tab and send one Chat message to the fake
  claude; save `project.png`, `chat.png`, `runs.png`, and a 390 px wide `phone.png` of Tasks (layout must not scroll
  sideways).
- [ ] **Step 6: Commit** `feat(app): project tabs, chat and run history`

### Task 10: Start script, docs, PC check and merge

**Files:**
- Create: `app/README.md`, `app/scripts/install-startup.ps1`
- Modify: `README.md` (one "Jarvis web app" section pointing to `app/README.md`), `CLAUDE.md` (hub rules: the app
  is the one place that starts Claude runs, on a click, under the rules above), this plan (`## Outcome`)

**Interfaces:**
- `install-startup.ps1` writes a shortcut `Jarvis.lnk` into the user's Startup folder that runs
  `node app\server\main.js` in the repo folder minimised; `-Remove` deletes it. It never runs at install time.

- [ ] **Step 1: Docs:** `app/README.md` covers `npm install`, `npm run app`, the printed link, `allowed_commands`,
  `hub.claudePath`, where runs are logged, the Startup shortcut, and the safety rules (127.0.0.1, token, no orders).
- [ ] **Step 2: Gate in the cloud:** `npm test` all pass; `screenshot.mjs` run end to end; review the diff against
  the spec.
- [ ] **Step 3: PR** from the thread branch into `dev`, assigned to Lucky, screenshots described in the body.
- [ ] **Step 4: PC check** (Claude runs it through Remote Control): pull the branch in `C:\Users\sutag\Documents\Jarvis`,
  `npm install`, `npm test`, start the app in the background, open it with Playwright and screenshot every tab
  against the real `~/.jarvis/` exports; Execute one real proposal item (`/review`) and approve one permission ask;
  run one Chat `/ask`; stop one run. Lucky is asked only to look at the result.
- [ ] **Step 5: Outcome** section in this plan (what shipped, PR number, what was rejected), then merge into `dev`
  after the PC check.

### Follow-up (separate MarketBrain PR, not this branch)

`mb hub export` sets `queue[].urgency` (`failed-run` and conflicted PRs `high`) and `queue[].id`, with a test against
the updated schema copy.

## Outcome

Built 2026-10-26 to 2026-10-28 in the "Build Jarvis web app" thread on branch `claude/project-thread-xc7c65`,
PR #3 into `dev`. Lucky approved the plan on 2026-10-26 and chose inline execution; Fable built the front end.

**Shipped:** the local web app (`npm run app`, 127.0.0.1:4317 behind a token cookie) with a Tasks tab ranked by
urgency and grouped by project, one Execute button per task that runs the task's own `claude "<prompt>"` with a live
log, Approve/Deny, reply and Stop, per-project tabs, Chat with a project's Claude (resumes across app restarts) and run
history. Order and trade tools are blocked by `--disallowedTools` and denied again server-side by name.
`hub.permissionModes` lets Lucky choose the permission mode for Execute and Chat runs; unset, runs inherit the PC's
auto mode, so no Approve/Deny cards appear there.

**Naming pass (Lucky, 2026-10-28):** every task, run and chat leads with a plain header (`app/server/names.js`), with
the raw title or prompt as a grey detail line: "Review wiki change: X · 4 drafts", "Fix failed run: X", "Finish
branch: <last commit subject>" (from the export's new optional `queue[].summary`), "Question: …" for `/ask` chats.
Runs say "Wiki review", "Run fix", "Wiki fix" or "Branch check" instead of "Task"; a finished run on a task row reads
"Last run: Done"; a resumed reply is timed on its own.

**MarketBrain side:** PR #92 (`queue[].urgency` and runnable prompts, merged 2026-10-26) and PR #93 (branch
`summary`, merges after this PR because the hub refuses unknown export keys).

**PC checks:** 2026-10-26 to 2026-10-28 on the laptop through Remote Control: tests 197 passed, 1 skipped at
`3ad4919`; the app loaded the real exports (18 tasks, MarketBrain and BetBrain), ran a read-only chat, resumed it
after a restart and showed the new headers.

**Rulings during the build:** `commandFor` checks the `claude "…"` form before `allowed_commands`; repeated identical
queue items fold into one row with a count.

**Deferred:** a Stop between a run's result and its exit shows "stopped"; the in-memory run map is never pruned
(both minor, from the final review). BetBrain's branch rows read "Finish unmerged Claude work" until `bb hub export`
adds `summary` (instructions handed to Lucky for the BetBrain project).

**Rejected:** merging the vaults (BetBrain hard rule); Obsidian as the main UI (Lucky found it too restrictive).

**Follow-up 2026-10-29:** Lucky's browser had no token cookie and got a bare "Open the link printed by npm run app."
page. `app/scripts/open.ps1` now opens the app signed in without printing the token, `install-startup.ps1` adds a
desktop "Jarvis" shortcut that runs it, and the sign-in page points to that shortcut.
