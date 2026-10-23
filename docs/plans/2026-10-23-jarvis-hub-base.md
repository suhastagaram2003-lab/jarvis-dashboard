# Jarvis hub base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fork of jarvis-dashboard that runs in Obsidian on Windows and shows the Project Strip, Waiting On You
and Agent Cards from `~/.jarvis/` status files, working from a fixture before any exporter exists.

**Architecture:** Keep upstream's module contract (function bodies run as `new Function("ctx", code)`, returning an
object or an `HTMLElement`). Add `src/hub/hub-store.js` (registry and export loading, validation, view models) and
`src/core/os-compat.js` (Windows process, launch and command helpers); patch the macOS call sites to use os-compat;
fix the inline loader in `Jarvis Dashboard.md` (config cascade, per-widget error cards, `ctx.hub`). Pure functions are
tested with `node --test` by loading the module bodies the same way the loader does. DOM is checked by hand in
Obsidian.

**Tech Stack:** JavaScript (no build, no new dependencies), Node 24 `node:test`, Obsidian with Dataview (JavaScript
queries on), Windows Terminal (`wt.exe`).

**Spec:** `docs/superpowers/specs/2026-10-23-jarvis-hub-design.md` (phase 2). This plan runs in the hub repo
(`C:\Users\sutag\Documents\Jarvis`); Task 1 copies the spec and this plan into its `docs/`.

## Global Constraints

- Upstream: `https://github.com/AndrewKochulab/jarvis-dashboard`, commit `ab4e274`, MIT (keep `LICENSE` and credit).
- Fork: `suhastagaram2003-lab/jarvis`; `dev` is the integration and default branch; never push or PR into `main`.
- The hub only reads `~/.jarvis/registry.json` and `~/.jarvis/projects/*.json`; it never writes into a project folder.
- An export is usable when it parses, `schema === 1` and `exported_at` is at most 36 hours old; otherwise its card is
  grey with the reason and the other projects still render.
- Buttons run commands only on a click, in a new Windows Terminal tab in the project folder, with the command shown in
  the button's tooltip.
- `macos/`, `ios/`, `companion/` stay untouched. Focus Timer, Quick Launch, Quick Capture and Voice Command leave the
  layout (Quick Capture and the command box return in the widgets plan).
- No holdings, account numbers or other private data in the repo, fixtures or examples.

## Review Focus

- **No `~/.jarvis/registry.json` yet** (first run): a setup card says where to copy `examples/registry.example.json`,
  not a blank note. Test in Task 2.
- **One widget throws** (upstream has no try/catch, so every widget after it vanished): an error card names the widget
  and the rest render. Pinned by Task 4's manual check list and `safeWidget` test.
- **Claude's Windows project dirs** (`C--Users-...`) were dropped by upstream's `startsWith("-")` filter, so Live
  Sessions showed nothing. Test in Task 3.
- **Paths with spaces** in `wt.exe -d` and `start`: arguments are passed as an array, never a joined shell string.
  Test in Task 3.
- **Export command that hangs or fails** on Refresh: killed after 120 s; the card shows exit code and the last 5
  stderr lines. Test in Task 3.

---

### Task 1: Fork, repo rules, test runner

**Files:**
- Create: `RULES.md` (copy of MarketBrain's), `CLAUDE.md`, `package.json`, `tests/load-module.js`,
  `tests/smoke.test.js`, `docs/specs/2026-10-23-jarvis-hub-design.md`, `docs/plans/` (copies of the four Jarvis plans)
- Modify: `.gitignore` (add `src/config/config.json`, `src/config/config.local.json` if not there)

**Interfaces:**
- Produces: `loadModule(relPath: string, ctx?: object) -> any` in `tests/load-module.js` — reads
  `src/<relPath>`, runs it as `new Function("ctx", code)(ctx)` with `ctx` defaulting to
  `{ nodeFs: require("fs"), nodePath: require("path"), os: require("os") }`, returns the module result.

- [ ] **Step 1: Lucky forks** `AndrewKochulab/jarvis-dashboard` on GitHub as `suhastagaram2003-lab/jarvis` (an
  outward-facing action: ask first, Lucky clicks Fork).
- [ ] **Step 2: Clone and branch** —
  `git clone https://github.com/suhastagaram2003-lab/jarvis C:\Users\sutag\Documents\Jarvis`,
  `git remote add upstream https://github.com/AndrewKochulab/jarvis-dashboard`, `git switch -c dev`,
  `git push -u origin dev`; Lucky sets `dev` as the default branch in the repo settings.
- [ ] **Step 3: Write the rule files.** `CLAUDE.md` says: `@RULES.md`; this repo is the Jarvis hub; it reads projects
  only through `~/.jarvis/` and never writes into a project folder or any wiki; no private data; tests with
  `npm test`; Obsidian check before merge; upstream fixes come in with `git merge upstream/main` on a branch.
- [ ] **Step 4: Test runner** — `package.json` `{"name": "jarvis-hub", "private": true, "scripts": {"test": "node --test tests/"}}`;
  `tests/smoke.test.js` asserts `loadModule` runs a temp module body `return ctx.x + 1` with `{x: 1}` and gets `2`.
  Work from here happens on branch `feat/hub-base` cut from `dev`.
- [ ] **Step 5: Run** `npm test` → 1 pass.
- [ ] **Step 6: Commit** — `git commit -m "chore: hub repo rules, specs and test runner"`

### Task 2: Schema, registry and export loading

**Files:**
- Create: `schema/hub-export-v1.json` (JSON Schema draft 2020-12 of the spec's "Export schema v1": every top-level key
  required, enums exactly as in the spec)
- Create: `src/hub/hub-store.js`
- Create: `examples/registry.example.json`, `examples/projects/marketbrain.json` (valid fixture, `exported_at`
  placeholder replaced at load time in tests)
- Test: `tests/hub-store.test.js`

**Interfaces:**
- Produces (object returned by `hub-store.js`):
  - `expandHome(p: string, home: string) -> string` — leading `~` or `~/`/`~\` → `home`
  - `validateExport(obj) -> string[]` — hand-written checks (no dependency): required keys present, `schema === 1`,
    list fields are arrays, `health` numbers, enum values from the schema file; messages like `"agents[0].status: bad value 'x'"`
  - `parseExport(text: string | null, now: Date, maxAgeHours = 36) -> {status: "ok"|"stale"|"error", reason: string, data: object|null}`
    — `null` text → `error` "no export yet"; bad JSON → `error` "invalid JSON: <message>"; schema other than 1 →
    `error` "schema <n> not supported"; validation errors → `error` with the first message; too old → `stale`
    "export <h>h old" (data kept)
  - `loadRegistry(fs, jarvisHome: string) -> {projects: object[], error: string|null}` — missing file → `error`
    "no registry: copy examples/registry.example.json to <path>"
  - `loadProjects({fs, jarvisHome, now}) -> Array<{entry, status, reason, data}>`
  - `mergeQueue(projects) -> Array<item & {project: label, color, path}>` — only `ok`/`stale` projects, sorted by
    `age_days` desc
  - `waitingCount(projects) -> number`
- Registry entry fields (example file): `name, label, path, color, export_command, vault, claude_projects_prefix,
  ask_tools, recent_dirs` — MarketBrain: prefix `C--Users-<you>-Documents-Suhas`, export
  `uv run --no-sync mb hub export --json`, ask_tools `mcp__marketbrain__recall, mcp__marketbrain__wiki_search,
  mcp__marketbrain__wiki_get`, recent_dirs `["vault/wiki"]`; BetBrain: prefix `C--Users-<you>-Documents-BetBrain`,
  export `uv run --no-sync bb hub export --json`, ask_tools `[]`, recent_dirs `["vault/wiki"]`.

- [ ] **Step 1: Write the failing tests**

```js
const store = loadModule("hub/hub-store.js");
const NOW = new Date("2026-10-23T12:00:00Z");
const fixture = (over = {}) => JSON.stringify({ ...readJson("examples/projects/marketbrain.json"),
  exported_at: "2026-10-23T06:00:00Z", ...over });

test("ok export", () => assert.equal(store.parseExport(fixture(), NOW).status, "ok"));
test("stale export keeps data", () => {
  const r = store.parseExport(fixture({ exported_at: "2026-10-21T12:00:00Z" }), NOW);
  assert.deepEqual([r.status, r.reason, !!r.data], ["stale", "export 48h old", true]);
});
test("wrong schema", () => assert.equal(store.parseExport(fixture({ schema: 2 }), NOW).reason, "schema 2 not supported"));
test("broken JSON", () => assert.match(store.parseExport("{", NOW).reason, /^invalid JSON/));
test("missing export", () => assert.equal(store.parseExport(null, NOW).reason, "no export yet"));
test("bad enum", () => assert.match(store.parseExport(fixture({ agents: [{ ...agent(), status: "x" }] }), NOW).reason,
  /agents\[0\]\.status/));
test("no registry", () => assert.match(store.loadRegistry(fs, tmpDir()).error, /^no registry/));
test("queue merge sorts oldest first across projects", () => {
  const q = store.mergeQueue([proj("MarketBrain", [item(1)]), proj("BetBrain", [item(5)]), errorProj()]);
  assert.deepEqual(q.map(i => [i.project, i.age_days]), [["BetBrain", 5], ["MarketBrain", 1]]);
});
test("expandHome on Windows paths", () => assert.equal(store.expandHome("~\\.jarvis", "C:\\Users\\u"), "C:\\Users\\u\\.jarvis"));
```

- [ ] **Step 2: Run** `npm test` → fails (module missing).
- [ ] **Step 3: Implement** the Produces list; write the schema and example files.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): export schema v1, registry and export loading"`

### Task 3: Windows compatibility

**Files:**
- Create: `src/core/os-compat.js`
- Modify: `src/services/session-parser.js:47-48,71,95-103,365`, `src/services/session-worker.js:29-30,311`,
  `src/widgets/agent-cards/ui/agent-card.js:33-39`, `src/widgets/communication-link/index.js:28-37`,
  `src/core/helpers.js:47`
- Test: `tests/os-compat.test.js`

**Interfaces:**
- Produces (object returned by `os-compat.js`; it needs no `ctx` fields and uses `require` itself, so the worker can
  load it with `new Function("ctx", fs.readFileSync(<path>, "utf8"))({})`):
  - `isClaudeProjectDir(name: string) -> boolean` — `/^-|^[A-Za-z]--/`
  - `hasClaudeProcess(listing: string, platform: string) -> boolean` — win32: a line containing `claude.exe`
    (case-insensitive); else upstream's rule (`/claude` and not `pgrep`)
  - `processListing(platform = process.platform) -> string` — win32: `execFileSync("tasklist", ["/FO", "CSV", "/NH"])`;
    else `pgrep -fa claude`; `""` on error; timeout 3000 ms
  - `launchArgs(dir: string, command: string | null, platform) -> {file: string, args: string[]}` — win32:
    `{file: "wt.exe", args: ["-w", "0", "nt", "-d", dir, "cmd", "/k", command || "claude"]}`; darwin: upstream's
    osascript form
  - `openArgs(target: string, platform) -> {file, args}` — win32: `{file: "cmd", args: ["/c", "start", "", target]}`;
    darwin: `{file: "open", args: [target]}`
  - `launch(dir, command)`, `open(target)` — `execFile` of the above, detached, errors shown with `new Notice`
  - `runCommand(command: string, cwd: string, timeoutMs = 120000) -> Promise<{code: number|null, stdout: string, stderrTail: string, timedOut: boolean}>`
    — `spawn` with `shell: true` (registry export commands are shell lines the user wrote), killed on timeout,
    `stderrTail` = last 5 lines
- Call-site changes: parser and worker use `hasClaudeProcess(processListing())` and `isClaudeProjectDir`; agent card
  and communication link use `open` and `launch(vaultPath, null)`; `describeAction` splits on `/[\\/]/`.

- [ ] **Step 1: Write the failing tests**

```js
const os = loadModule("core/os-compat.js");
test("Windows project dirs count", () => {
  assert.ok(os.isClaudeProjectDir("C--Users-sutag-Documents-Suhas"));
  assert.ok(os.isClaudeProjectDir("-Users-andrew-vault"));
  assert.ok(!os.isClaudeProjectDir("jarvis-dashboard-cache.json"));
});
test("tasklist listing", () => assert.ok(os.hasClaudeProcess('"claude.exe","4120","Console","1","210,000 K"', "win32")));
test("launch keeps a spaced path as one argument", () => assert.deepEqual(
  os.launchArgs("C:\\My Docs\\Suhas", 'claude "/review"', "win32").args,
  ["-w", "0", "nt", "-d", "C:\\My Docs\\Suhas", "cmd", "/k", 'claude "/review"']));
test("runCommand reports failure and stderr tail", async () => {
  const r = await os.runCommand('node -e "console.error(1);console.error(2);process.exit(3)"', process.cwd());
  assert.deepEqual([r.code, r.stderrTail.trim()], [3, "1\n2"]);
});
test("runCommand times out", async () => {
  const r = await os.runCommand('node -e "setTimeout(()=>{}, 10000)"', process.cwd(), 300);
  assert.equal(r.timedOut, true);
});
```

- [ ] **Step 2: Run** `npm test` → fails.
- [ ] **Step 3: Implement** os-compat and patch the five call sites.
- [ ] **Step 4: Run** `npm test` → PASS; `git grep -n "osascript\|open -a\|pgrep" src` → only inside `os-compat.js`.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): Windows process, launch and command helpers"`

### Task 4: Loader fixes and `ctx.hub`

**Files:**
- Create: `src/core/config-cascade.js`
- Modify: `Jarvis Dashboard.md` (inline loader), `src/config/config.example.json` (layout, `hub.jarvisHome: "~/.jarvis"`,
  `hub.refreshMs: 30000`, `projects.mode: "registry"`), `src/widgets/header/index.js` (status text from `ctx.hub`)
- Test: `tests/config-cascade.test.js`

**Interfaces:**
- Consumes: `hub-store.loadProjects`, `waitingCount` (Task 2).
- Produces:
  - `config-cascade.js` → `{deepMerge(a, b) -> object, loadConfig(fs, srcDir) -> object, safeWidget(name, buildFn) -> Promise<{el: HTMLElement|null, error: string|null}>}`
    — `loadConfig` merges `config/config.example.json`, then `config/config.json`, then `config/config.local.json`, each
    optional except the first; arrays replace; `safeWidget` awaits `buildFn()` and turns a throw into
    `{el: null, error: "<name>: <message>"}`.
  - `ctx.hub = {projects, queue, waiting, reload()}` — set before widgets render, `reload()` re-reads files; an
    interval of `hub.refreshMs` registered with `ctx.registerPausable` calls `reload()` and fires
    `ctx.onHubUpdate` callbacks (an array, like `onStatsReady`).
  - `WIDGET_MAP` gains `"project-strip"` and `"waiting-on-you"`; layout:
    `header, project-strip, waiting-on-you, live-sessions, agent-cards, communication-link, system-diagnostics,
    activity-analytics, recent-activity, footer`.
  - Header status: `"<n> things wait on you"`, `"1 thing waits on you"` or `"All clear"`, refreshed on hub updates.
  - A failed widget renders a small red card with its error text in its slot.

- [ ] **Step 1: Write the failing tests**

```js
const cc = loadModule("core/config-cascade.js");
test("arrays replace, objects merge", () => assert.deepEqual(
  cc.deepMerge({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { c: 3 }, l: [9] }), { a: { b: 1, c: 3 }, l: [9] }));
test("missing personal config is fine", () => {
  const dir = tmpSrc({ "config/config.example.json": '{"x":1}' });
  assert.deepEqual(cc.loadConfig(fs, dir), { x: 1 });
});
test("a throwing widget becomes an error", async () => {
  const r = await cc.safeWidget("agent-cards", async () => { throw new Error("boom"); });
  assert.deepEqual(r, { el: null, error: "agent-cards: boom" });
});
```

- [ ] **Step 2: Run** `npm test` → fails. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): config cascade, safe widgets and ctx.hub"`

### Task 5: Project Strip, Waiting On You, Agent Cards from exports

**Files:**
- Create: `src/widgets/project-strip/index.js`, `src/widgets/waiting-on-you/index.js`
- Modify: `src/hub/hub-store.js` (view models), `src/widgets/agent-cards/index.js`,
  `src/widgets/agent-cards/ui/agent-card.js`, `Jarvis Dashboard.md` (`ctx.agents` from exports instead of the registry
  note)
- Test: `tests/hub-store.test.js`

**Interfaces:**
- Consumes: `ctx.hub` (Task 4), `os-compat.runCommand`, `launch`, `open` (Task 3).
- Produces (added to `hub-store.js`):
  - `projectCard(p, now: Date) -> {label, color, dot: "ok"|"warn"|"grey", queueCount, ageText, reason}` — `grey` for
    `error`/`stale`, `warn` when `health.lint_errors > 0` or any agent `failed`/`missed`, else `ok`; `ageText` like
    `"6h ago"`
  - `agentCards(projects) -> Array<{name, displayName, color, description, status, last_run, project}>` —
    `displayName` = agent `name`, `color` = project color, `description` = `summary`
- UI: Project Strip cards show label, dot, queue count, age, reason and a Refresh button
  (`runCommand(entry.export_command, entry.path)`, then `ctx.hub.reload()`; on non-zero exit or timeout the card shows
  `"export failed (exit <code>)"` and `stderrTail`). Waiting On You lists `mergeQueue` rows (project chip in its color,
  title, age, button `action.label` with tooltip `action.command` → `launch(item.path, action.command)`), empty state
  "Nothing waits on you". Agent cards show a status dot (`ok` green, `failed` red, `missed` orange, `idle` grey), the
  status word and `last_run`; `setActive` from Live Sessions still works for agent names it detects.

- [ ] **Step 1: Write the failing tests**

```js
test("card is grey for a stale export", () => assert.equal(store.projectCard(staleProj(), NOW).dot, "grey"));
test("card warns on a failed agent", () => assert.equal(store.projectCard(proj("MB", [], [agent({ status: "failed" })]), NOW).dot, "warn"));
test("agent cards carry project color", () => assert.deepEqual(
  store.agentCards([proj("MB", [], [agent({ name: "MarketBrain nightly" })], "#00d4ff")]).map(a => [a.name, a.color]),
  [["MarketBrain nightly", "#00d4ff"]]));
```

- [ ] **Step 2: Run** `npm test` → fails. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): project strip, waiting on you and agent cards from exports"`

### Task 6: Obsidian check and PR

**Files:**
- Modify: `README.md` (a "Hub fork" section at the top: what changed from upstream, setup on Windows: Dataview with
  JavaScript queries on, copy `examples/registry.example.json` to `~/.jarvis/registry.json` and
  `examples/projects/marketbrain.json` to `~/.jarvis/projects/` until the exporter exists), `docs/plans/` copy of this
  plan with `## Outcome`
- MarketBrain side (same day, small PR or with the export PR): `docs/README.md` plan line and status,
  `docs/CHANGELOG.md` line.

- [ ] **Step 1: Run** `npm test` → all pass.
- [ ] **Step 2: Obsidian check on the PC** — open the hub vault, open `Jarvis Dashboard.md`; with the fixture: Project
  Strip shows MarketBrain (ok) and BetBrain (grey, "no export yet"); Waiting On You lists the fixture queue; an action
  button opens a Windows Terminal tab in the project folder; Live Sessions shows this running session; renaming
  `marketbrain.json` to break it shows the error card and the rest still renders; a deliberately throwing widget
  (temporary layout entry `{ "type": "nope" }` pointing at a bad path) shows an error card. Screenshot each.
- [ ] **Step 3: Commit, push `feat/hub-base`, PR into the hub repo's `dev`** assigned to Lucky, with the screenshots.
