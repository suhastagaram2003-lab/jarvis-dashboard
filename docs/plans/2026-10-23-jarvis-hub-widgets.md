# Jarvis hub widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the hub's remaining widgets: What We Learned, Fix Next, Metrics, Mission Control links, the command
box, Quick Capture to the hub inbox, per-project analytics and Recent Activity across vaults.

**Architecture:** Every widget renders view models computed by pure functions (in `src/hub/hub-store.js` or a small
module per concern) that `node --test` covers; widgets only build DOM. The command box spawns `claude` without a shell
and with a read-only tool list; Quick Capture writes only under `~/.jarvis/inbox/`.

**Tech Stack:** JavaScript (no build, no new dependencies), Node 24 `node:test`, Obsidian with Dataview, Claude Code
CLI (`claude.exe`).

**Spec:** `docs/superpowers/specs/2026-10-23-jarvis-hub-design.md` (phase 4; widgets 6 to 13). Runs in the hub repo on
branch `feat/hub-widgets` from `dev`, after the hub base plan
(`docs/superpowers/plans/2026-10-23-jarvis-hub-base.md`) is merged.

## Global Constraints

- Uses the hub base interfaces: `ctx.hub = {projects, queue, waiting, reload()}`, `ctx.onHubUpdate`, `hub-store.js`
  (`loadProjects`, `mergeQueue`, `projectCard`, `agentCards`, `expandHome`), `os-compat.js` (`launch`, `open`,
  `runCommand`, `isClaudeProjectDir`), `tests/load-module.js` `loadModule`.
- Registry entry fields: `name, label, path, color, export_command, vault, claude_projects_prefix, ask_tools,
  recent_dirs`.
- Command box tools: `Read`, `Grep`, `Glob` plus the entry's `ask_tools`; disallowed `Bash`, `PowerShell`, `Edit`,
  `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`, `Agent`; timeout 120 s.
- Quick Capture writes `~/.jarvis/inbox/<project name>/<YYYY-MM-DD-HHMMSS>.md` and nothing else.
- No private data in the repo, fixtures or examples.

## Review Focus

- **A question with quotes, `&`, `|` or a newline** in the command box must reach Claude as one argument and run
  nothing else: `spawn` without `shell`. Test in Task 2.
- **Only `claude.cmd` installed** (npm install): Node 24 refuses to spawn `.cmd` without a shell, so the box shows
  "claude.exe not found; set hub.claudePath" instead of failing silently. Test in Task 2.
- **Two captures in the same second** must not overwrite each other: `-2`, `-3` suffixes. Test in Task 3.
- **A project with no `ask_tools`** (BetBrain) gets only `Read, Grep, Glob`; MarketBrain's MCP tool names never leak
  to another project. Test in Task 2.
- **A large vault** (`vault/sources/` holds thousands of files): Recent Activity walks only `recent_dirs` and stops
  after 2000 files. Test in Task 5.

---

### Task 1: What We Learned, Fix Next, Metrics, Mission Control

**Files:**
- Create: `src/widgets/what-we-learned/index.js`, `src/widgets/fix-next/index.js`, `src/widgets/hub-metrics/index.js`
- Modify: `src/hub/hub-store.js`, `src/widgets/mission-control/index.js` (links from exports instead of
  `config.widgets.missionControl.dashboards`), `Jarvis Dashboard.md` (`WIDGET_MAP`), `src/config/config.example.json`
  (layout after `waiting-on-you`: `what-we-learned`, `{row, columns: 2, widgets: [fix-next, hub-metrics]}`; then
  `mission-control` before `recent-activity`)
- Test: `tests/hub-store.test.js`

**Interfaces:**
- Produces (in `hub-store.js`; each reads only `ok`/`stale` projects and tags rows with `project` label and `color`):
  - `learningFeed(projects, limit = 15) -> rows` — newest `date` first
  - `suggestionFeed(projects) -> rows` — by `rank`, projects in registry order
  - `metricTiles(projects) -> rows`
  - `linkGroups(projects) -> Array<{project, color, links}>`
- UI: a learning row shows date, kind chip, title and citation; clicking opens `link` with `os-compat.open` when it is
  non-empty. Each widget re-renders on `ctx.onHubUpdate` and has an empty state ("Nothing new in 14 days", "No
  suggestions", "No metrics yet").

- [ ] **Step 1: Write the failing tests**

```js
test("learning feed is newest first across projects", () => {
  const rows = store.learningFeed([proj("MB", { learning: [learn("2026-10-20")] }), proj("BB", { learning: [learn("2026-10-22")] })]);
  assert.deepEqual(rows.map(r => [r.project, r.date]), [["BB", "2026-10-22"], ["MB", "2026-10-20"]]);
});
test("error projects are skipped", () => assert.deepEqual(store.metricTiles([errorProj()]), []));
test("links grouped per project", () => assert.equal(store.linkGroups([proj("MB", { links: [link()] })])[0].links.length, 1));
```

- [ ] **Step 2: Run** `npm test` → fails. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): learned, fix next, metrics and mission control widgets"`

### Task 2: Command box

**Files:**
- Create: `src/hub/ask.js`, `src/widgets/command-box/index.js`
- Modify: `Jarvis Dashboard.md` (`WIDGET_MAP` `"command-box"`), `src/config/config.example.json` (layout right after
  `header`; `hub.claudePath: ""`)
- Test: `tests/ask.test.js`

**Interfaces:**
- Produces (object returned by `ask.js`):
  - `READ_TOOLS = ["Read", "Grep", "Glob"]`, `DENIED = ["Bash", "PowerShell", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Agent"]`
  - `askArgs(entry, question: string) -> string[]` —
    `["-p", "/ask " + question, "--output-format", "json", "--allowedTools", [...READ_TOOLS, ...(entry.ask_tools || [])].join(","), "--disallowedTools", DENIED.join(",")]`
  - `findClaude(fs, home: string, configured: string, whereOutput: string) -> {path: string|null, error: string|null}` —
    `configured` if set and exists; else `<home>\.local\bin\claude.exe`; else the first `.exe` line of `where claude`
    output; else error `"claude.exe not found; set hub.claudePath"`
  - `parseResult(stdout: string) -> {ok: boolean, text: string}` — Claude's JSON (`result`, `is_error`); non-JSON →
    `{ok: false, text: "unreadable reply"}`
  - `runAsk({entry, question, claudePath, spawn, timeoutMs = 120000}) -> Promise<{ok, text, command}>` — `spawn(claudePath, askArgs(...), {cwd: entry.path, shell: false})`,
    killed on timeout with text `"timed out after <seconds> s"`; `command` is the args joined for display only
- UI: project picker (registry labels), a text area, Ask (disabled while running), answer rendered with
  `ctx.markdownRenderer`, the command shown small under it, and "Open full session" → `os-compat.launch(entry.path, null)`.

- [ ] **Step 1: Write the failing tests**

```js
const ask = loadModule("hub/ask.js");
test("question stays one argument", () => {
  const q = 'is NVDA "cheap" & | rm -rf\nreally?';
  const args = ask.askArgs({ ask_tools: [] }, q);
  assert.equal(args[1], "/ask " + q);
});
test("tools per project", () => {
  assert.equal(ask.askArgs({ ask_tools: [] }, "q")[5], "Read,Grep,Glob");
  assert.equal(ask.askArgs({ ask_tools: ["mcp__marketbrain__recall"] }, "q")[5], "Read,Grep,Glob,mcp__marketbrain__recall");
  assert.ok(ask.askArgs({}, "q")[7].includes("Bash"));
});
test("only claude.cmd is an error", () => assert.equal(
  ask.findClaude(fakeFs([]), "C:\\Users\\u", "", "C:\\npm\\claude.cmd\r\n").error, "claude.exe not found; set hub.claudePath"));
test("timeout kills the run", async () => {
  const r = await ask.runAsk({ entry: { path: "." }, question: "q", claudePath: "x", spawn: hangingSpawn, timeoutMs: 50 });
  assert.equal(r.ok, false); assert.match(r.text, /^timed out after/);
});
test("reads Claude's json", () => assert.deepEqual(ask.parseResult('{"result":"Yes [^1]","is_error":false}'), { ok: true, text: "Yes [^1]" }));
```

- [ ] **Step 2: Run** `npm test` → fails. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): read-only command box"`

### Task 3: Quick Capture to the hub inbox

**Files:**
- Create: `src/hub/capture.js`
- Modify: `src/widgets/quick-capture/index.js` (project picker, write through `capture.js`, mic hidden until the voice
  phase, badge = file count in that project's inbox), `src/config/config.example.json` (layout: `{row, columns: 2,
  widgets: [command-box, quick-capture]}` replaces the lone `command-box`)
- Test: `tests/capture.test.js`

**Interfaces:**
- Produces (object returned by `capture.js`):
  - `capturePath(inboxRoot: string, project: string, now: Date, exists: (p) => boolean) -> string` —
    `<inboxRoot>/<project>/YYYY-MM-DD-HHMMSS.md` in local time; `-2`, `-3` … before `.md` while `exists`
  - `noteText(text: string, project: string, now: Date) -> string` — frontmatter `title` (first line, at most 80
    characters), `project`, `captured` (ISO), then the text
  - `save(fs, inboxRoot, project, text, now) -> string` — `mkdirSync(recursive)`, `writeFileSync` with flag `wx`, returns
    the path; empty text throws `"nothing to capture"`

- [ ] **Step 1: Write the failing tests**

```js
const cap = loadModule("hub/capture.js");
test("same second gets a suffix", () => {
  const taken = new Set(["/in/marketbrain/2026-10-23-090000.md"]);
  assert.equal(cap.capturePath("/in", "marketbrain", new Date(2026, 9, 23, 9, 0, 0), p => taken.has(p.replace(/\\/g, "/"))),
    nodePath.join("/in", "marketbrain", "2026-10-23-090000-2.md"));
});
test("note has frontmatter", () => assert.match(cap.noteText("NVDA idea\nmore", "marketbrain", NOW), /^---\ntitle: NVDA idea\nproject: marketbrain\ncaptured: /));
test("save writes once and refuses empty", () => {
  const dir = tmpDir();
  const p = cap.save(fs, dir, "betbrain", "link https://x", NOW);
  assert.ok(fs.existsSync(p));
  assert.throws(() => cap.save(fs, dir, "betbrain", "  ", NOW), /nothing to capture/);
});
```

- [ ] **Step 2: Run** `npm test` → fails. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): quick capture to the hub inbox"`

### Task 4: Sessions and analytics by project

**Files:**
- Modify: `src/hub/hub-store.js`, `src/services/session-parser.js` and `src/services/session-worker.js` (scan every
  `~/.claude/projects` dir whose name starts with a registry `claude_projects_prefix`; label = that project's
  `label`), `src/services/stats-engine.js` (all matching dirs instead of `tracked[0]`; cache file
  `~/.jarvis/stats-cache.json`), `src/widgets/system-diagnostics/index.js` (one row per project: sessions, tokens,
  cost)
- Test: `tests/hub-store.test.js`

**Interfaces:**
- Produces:
  - `projectForDir(dirName: string, entries) -> entry | null` — the longest matching `claude_projects_prefix`
    (case-insensitive)
  - `mergeStats(perProject: Array<{project, stats}>) -> stats & {byProject: Array<{project, sessions, tokens, cost}>}`
    — sums upstream's stats shape (`totalSessions, totalMessages, totalTokens, totalCost, totalToolCalls,
    dailyActivity, hourlyActivity`, `modelBreakdown` recomputed), favourite model recomputed

- [ ] **Step 1: Write the failing tests**

```js
const entries = [{ label: "MarketBrain", claude_projects_prefix: "C--Users-u-Documents-Suhas" },
                 { label: "BetBrain", claude_projects_prefix: "C--Users-u-Documents-BetBrain" }];
test("worktree dirs map to their project", () =>
  assert.equal(store.projectForDir("C--Users-u-Documents-Suhas--claude-worktrees-x", entries).label, "MarketBrain"));
test("unknown dirs map to nothing", () => assert.equal(store.projectForDir("C--Users-u-Desktop", entries), null));
test("stats add up per project", () => {
  const m = store.mergeStats([{ project: "MB", stats: stats(3, 100) }, { project: "BB", stats: stats(1, 50) }]);
  assert.deepEqual([m.totalSessions, m.byProject.map(p => p.sessions)], [4, [3, 1]]);
});
```

- [ ] **Step 2: Run** `npm test` → fails. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): sessions and analytics per project"`

### Task 5: Recent Activity across vaults

**Files:**
- Create: `src/hub/recent.js`
- Modify: `src/widgets/recent-activity/index.js` (rows from `recent.js`; click → `os-compat.open(row.link)`)
- Test: `tests/recent.test.js`

**Interfaces:**
- Produces: `recentFiles(fs, nodePath, entries, limit = 10, cap = 2000) -> Array<{project, color, title, rel, mtime, link}>`
  — walks each entry's `recent_dirs` under `path`, `.md` files only, skips dot-folders, stops after `cap` files per
  project; `title` = file stem; `link` = `obsidian://open?vault=<encoded vault>&file=<encoded rel without .md>`;
  newest first.

- [ ] **Step 1: Write the failing tests**

```js
const rec = loadModule("hub/recent.js");
test("newest first across vaults with obsidian links", () => {
  const root = tmpTree({ "mb/vault/wiki/lessons/a.md": 1, "bb/vault/wiki/b.md": 2, "mb/vault/sources/s.md": 3 });
  const rows = rec.recentFiles(fs, nodePath, [entry("MarketBrain", root + "/mb", "Suhas"), entry("BetBrain", root + "/bb", "BetBrain")]);
  assert.deepEqual(rows.map(r => r.title), ["b", "a"]);              // sources/ is not in recent_dirs
  assert.equal(rows[1].link, "obsidian://open?vault=Suhas&file=vault%2Fwiki%2Flessons%2Fa");
});
test("walk stops at the cap", () => assert.equal(rec.recentFiles(fs, nodePath, [bigEntry(50)], 100, 20).length, 20));
```

(`tmpTree` sets each file's mtime to the given number of minutes ago, so a smaller number is newer.)

- [ ] **Step 2: Run** `npm test` → fails. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): recent activity across project vaults"`

### Task 6: Obsidian check and PR

- [ ] **Step 1: Run** `npm test` → all pass.
- [ ] **Step 2: Obsidian check on the PC** with the real MarketBrain export: ask "what did we learn about ORB?" in the
  command box and get a cited answer; ask with `& echo hi` in the text and see it treated as text; capture a note and
  find it in `~/.jarvis/inbox/marketbrain/`; after the next nightly (or `uv run --no-sync mb hub import`) it is gone and
  listed as a source; What We Learned, Fix Next, Metrics and Mission Control show the export's rows; Diagnostics shows
  one row per project; Recent Activity opens a wiki page in the MarketBrain vault. Screenshot each.
- [ ] **Step 3: Doc trail** — this plan's copy in the hub repo gets `## Outcome`; MarketBrain `docs/README.md` status
  and `docs/CHANGELOG.md` line.
- [ ] **Step 4: Commit, push `feat/hub-widgets`, PR into the hub repo's `dev`** assigned to Lucky, with the screenshots.
