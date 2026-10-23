# Jarvis hub — design

Date: 2026-10-23. Requested by Lucky in the "Jarvis dashboard" thread: build
[AndrewKochulab/jarvis-dashboard](https://github.com/AndrewKochulab/jarvis-dashboard) into one hub that "holds all my
various claude projects agents and work in one centralized location", integrated with MarketBrain, BetBrain "plus
any others we add", powered by the self-improvement loop and the wiki.

## Goal

One Jarvis note in Obsidian on the PC shows, for every registered Claude project, what is running, what waits on
Lucky (proposals, failed runs, lint errors, open PRs), what each agent learned and what /tune says to fix next, and
launches the right skill from there. MarketBrain and BetBrain come first; a new project joins by adding one registry
line and one exporter.

Done looks like: Lucky opens `Jarvis Dashboard.md` and sees every project's health, queue, lessons and metrics without
opening a Claude session, and starts `/review`, `/ask` or a full session in a project from one button.

## Decisions (Lucky, 2026-10-22/23)

- **Surface:** Obsidian on the PC, in Jarvis's native DataviewJS mode. No phone, no Tauri or iOS build.
- **Mods:** the cosmetic and display mods are removed; only the mods that change how we work stay
  (`marketbrain-guard`, `blast-radius`). Jarvis is the main dashboard.
- **Voice:** a later phase. The first version has a text command box.
- **Data contract:** each project writes one status file to a shared schema (option A); the hub only reads files.
- **Quick Capture:** writes to a hub-owned inbox; each project imports from it. The hub never writes into a project.

## What Jarvis is (upstream, commit `ab4e274`, 2026-03-13)

An Obsidian DataviewJS note (also a macOS Tauri app, an iOS app and a companion WebSocket server) with 13 widgets:
voice command (spawns `claude` with permission cards), live sessions (parses `~/.claude/projects/*.jsonl`), agent cards
(a YAML registry), activity analytics, system diagnostics, focus timer, quick capture, quick launch, mission control,
communication link, recent activity, header and footer. Widgets are function bodies loaded with
`new AsyncFunction("ctx", code)` that return an `HTMLElement`; the `layout` array in `config.json` places them. There
is no build step. It is macOS-first: `pgrep`, `say`, `afplay`, `osascript`, `open -a` and Homebrew paths.

## Constraints

1. **Separation.** MarketBrain never touches BetBrain, and BetBrain reads nothing from MarketBrain at run time. So the
   hub is a third repo that reads each project only through that project's own export. No hub code lives in either
   project, and nothing is written into BetBrain from MarketBrain work.
2. **Vault rules hold.** The hub never writes `vault/wiki/`, sources or the journal of any project. Captures reach a
   project only through that project's own import (for MarketBrain, `mb add`). Desk output never reaches memory.
3. **Privacy.** No holdings, share counts, position values, cost bases or account numbers in any export, the hub repo
   or its notes. Paper-trading P&L and pick scorecards are allowed.
4. **Safety.** No orders, trades or bets. Hub buttons fill in or open commands; the command box runs read-only tools.

## Architecture

### Repos

- **Hub repo** `suhastagaram2003-lab/jarvis`, a fork of upstream (MIT, attribution kept) with `upstream` as a second
  remote so upstream fixes can be merged. PC folder `C:\Users\sutag\Documents\Jarvis`; the repo root is its own
  Obsidian vault (Dataview plugin with JavaScript queries on). It adopts the same `RULES.md`, `dev` integration branch,
  frozen `main` and PR flow as the other two projects, plus a short CLAUDE.md with the hub's own rules (read-only
  toward projects, privacy deny list, no project code). A copy of this spec goes into its `docs/` when it is created.
- **MarketBrain** gains `mb hub export` and loses the cosmetic mods.
- **BetBrain** gains `bb hub export`, built in a BetBrain session from a handoff note (phase 5).

### Data flow

```
MarketBrain ──mb hub export──┐
BetBrain ────bb hub export───┼──> ~/.jarvis/projects/<name>.json ──> Jarvis widgets (read-only)
future proj ─<x> hub export──┘
~/.claude/projects/*.jsonl ─────────────────────────────────────────> Live Sessions, Analytics
~/.jarvis/inbox/<project>/  <── Quick Capture;  each project's nightly imports and clears its own folder
```

- **Registry** `~/.jarvis/registry.json`: one entry per project with `name`, `label`, `path`, `color`,
  `export_command`, `vault` (Obsidian vault name for `obsidian://` links), `claude_projects_prefix` (the
  `~/.claude/projects` folder-name prefix that tags sessions, worktrees included), `ask_tools` (extra read-only tools for
  the command box) and `recent_dirs` (folders Recent Activity walks).
- **When exports run:** at the end of the nightly, after each `/review`, `/tune` and briefing run, and from a Refresh
  button on each project card that runs the registry's `export_command` in the project folder.

### Windows port (hub base)

| macOS | Windows |
|---|---|
| `pgrep -fa claude` | `tasklist /FO CSV /NH`, looking for `claude.exe` |
| `open -a <editor> <file>` | `start "" <file>` or the editor from config |
| `osascript` to open Terminal | `wt.exe -d <project path> claude` (Windows Terminal) |
| Homebrew paths | config keys, empty by default |
| `say`, `afplay`, whisper | off until the voice phase |

The `macos/`, `ios/` and `companion/` folders stay in the fork untouched and are not built. Focus Timer and Quick
Launch are removed from the layout (cosmetic; the Start menu covers launching).

## Export schema v1

Each exporter writes `~/.jarvis/projects/<name>.json`, validated against `schema/hub-export-v1.json` (a JSON Schema
file in the hub repo; a copy of the schema goes in each exporter's tests).

```json
{
  "schema": 1,
  "project": "marketbrain",
  "exported_at": "2026-10-23T06:00:00-04:00",
  "agents":      [{"name": "", "kind": "bot|skill|schedule", "status": "ok|failed|missed|idle",
                   "last_run": "", "next_run": "", "summary": "", "link": ""}],
  "queue":       [{"kind": "proposal|failed-run|lint-error|pr", "title": "", "age_days": 0,
                   "action": {"label": "", "command": ""}}],
  "health":      {"lint_errors": 0, "lint_warnings": 0, "stale_pages": 0, "sources_unprocessed": 0},
  "learning":    [{"date": "", "kind": "lesson|strategy-update|tune", "title": "", "citation": "", "link": ""}],
  "suggestions": [{"rank": 1, "title": "", "why": "", "source": "tune|lint"}],
  "metrics":     [{"label": "", "value": "", "trend": "up|down|flat", "help": ""}],
  "links":       [{"label": "", "url": ""}]
}
```

Fields a project does not have are empty lists or zeros, never missing. `action.command` is a command line the hub
shows and runs only on a click, in a new Windows Terminal tab in the project folder.

### MarketBrain mapping (`mb hub export`)

| Field | Source (all exist today) |
|---|---|
| agents | Task Scheduler last and next run of the briefing, the nightly, the ORB bot, the weekly briefing and the pick update; the newest strategy 1.0 journal entry (its runs are Claude scheduled tasks, not Windows tasks); skills as `kind: skill` |
| queue | `mb proposals --json` (title, age, action `claude "/review"`), failed scheduled runs, `mb lint` errors, branches on `origin` with commits in the last 14 days that are not merged into `dev` (local git, so no GitHub token) |
| health | `mb lint --json`, the unprocessed count from `mb sources --json` |
| learning | `lesson` and `strategy` pages approved in the last 14 days (git log of `vault/wiki/`), with their page link as `citation`; recent /reflect outcomes |
| suggestions | the top five of the newest `docs/tune/*.md` (lint errors go to `queue`) |
| metrics | paper P&L of the ORB bot and strategy 1.0, the pick scorecard hit rate, 7-day Claude usage units from `usage_report.py` |
| links | the Portfolio Briefing, Tuning Report, Nightly Repo Report and deep-dive artifacts; the vault |

The exporter is read-only toward MarketBrain and writes only its own JSON file. A test fails if the output matches the
privacy deny list (account-number patterns, the words holdings, shares, cost basis, position value) or misses the
schema.

## Widgets and layout

Jarvis's theme and card look stay.

| # | Widget | Source | Origin |
|---|---|---|---|
| 1 | Header: clock and "N things wait on you" | all exports | Jarvis |
| 2 | Project Strip: a card per project with color, health dot, queue count, export age and Refresh | exports | new |
| 3 | Waiting On You: every project's `queue`, oldest first, with action buttons | exports | new |
| 4 | Live Sessions, tagged by project through `claude_projects_dir` | jsonl | Jarvis, Windows port |
| 5 | Agent Cards: every project's `agents`, status dot from the last run | exports | Jarvis, registry replaced by exports |
| 6 | What We Learned: the `learning` feed; a click opens the page in that project's vault | exports | new |
| 7 | Fix Next: `suggestions` from /tune and lint, ranked | exports | new |
| 8 | Metrics: each project's `metrics` as tiles | exports | new |
| 9 | Command box: pick a project, ask a question; runs headless `claude -p "/ask ..."` in the project folder with only `Read`, `Grep`, `Glob` and the project's read-only MCP tools (MarketBrain: `recall`, `wiki_search`, `wiki_get`) and shows the cited answer; anything larger opens a full session in Windows Terminal | CLI | Jarvis voice command, text mode |
| 10 | Quick Capture: pick a project, write a note or paste a link; saved as a dated Markdown file in `~/.jarvis/inbox/<project>/` | registry | Jarvis |
| 11 | System Diagnostics and Activity Analytics, split by project | jsonl | Jarvis |
| 12 | Mission Control: each project's `links` | exports | Jarvis |
| 13 | Recent Activity across the registered vaults | registry | Jarvis |

MarketBrain's nightly imports `~/.jarvis/inbox/marketbrain/` with `mb add` before `/ingest` and removes each file it
added; the `/ingest` triage then decides what becomes a proposal.

## Failure handling

- A missing export, one older than 36 hours or one with another `schema` version turns that project's card grey
  with the reason; the other projects still render.
- A file that is not valid JSON shows an error card naming the file, never a blank dashboard.
- Refresh shows the exporter's exit code and the last lines of stderr on the card.
- A command box run that times out (120 seconds) or exits non-zero shows the error and the command it ran.

## Testing

- MarketBrain: pytest for `mb hub export`: schema check, privacy deny list, a project with nothing pending, and a
  failed scheduled run showing up in `queue`.
- Hub: small `node --test` checks over fixture exports (good, stale, wrong schema, broken JSON) for the loaders and
  the queue merge; a manual check of the note in Obsidian on the PC with screenshots before each merge.

## Phases

Each phase gets its own plan and PR. Phases 1 and 2 are independent and can run in parallel.

1. **Retire cosmetic mods** (MarketBrain). Delete `away-ping`, `blocked-tray`, `brain-pane`, `briefing-pane`,
   `cache-control`, `cockpit`, `manager`, `market-dashboard`, `market-status`, `next-steps`, `pc-sync-band`,
   `plan-progress`, `portfolio-band`, `prompt-deck`, `runs-band` and `session-hub`; drop them from the marketplace
   file and `enabledPlugins`; keep `marketbrain-guard` and `blast-radius`; update `mods/README.md`, CLAUDE.md,
   AGENTS.md and any test that names them; git history is the way back. Lucky uninstalls the user-scope copies with
   the `claude plugin uninstall` lines the PR lists.
2. **Hub base** (jarvis repo): fork, RULES.md and CLAUDE.md, Windows port, registry, schema file, Project Strip,
   Waiting On You and Agent Cards, shipped with a fixture export so it works before any exporter exists.
3. **`mb hub export`** (MarketBrain): the exporter and its tests, the export calls at the end of the nightly,
   `/review`, `/tune` and the briefing, and the nightly inbox import.
4. **Hub widgets 6 to 13** (jarvis repo): learning, suggestions, metrics, command box, Quick Capture, project tags in
   the analytics.
5. **BetBrain export** (BetBrain project): this thread writes a handoff note in `docs/superpowers/handoffs/` with schema v1 and a suggested mapping
   (bankroll ROI, CLV, open bets, the `bb` scheduled pulls, its proposals), and Lucky runs it in a BetBrain session.
   This thread writes nothing in BetBrain.
6. **Voice** (later, jarvis repo): whisper.cpp speech-to-text and Piper speech with Windows playback.

## Not in scope

The phone, the macOS and iOS apps and the companion server; Supabase as a data bus; approve or deny of permission asks
from the hub (the mods that did that are removed); writing any project's wiki or journal from the hub; the Focus Timer
and Quick Launch widgets.
