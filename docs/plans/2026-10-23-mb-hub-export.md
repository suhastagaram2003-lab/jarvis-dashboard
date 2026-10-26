# `mb hub export` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MarketBrain writes its Jarvis status file (`~/.jarvis/projects/marketbrain.json`, schema v1) and imports the
hub's Quick Capture inbox; plus the BetBrain handoff note.

**Architecture:** One module, `src/marketbrain/hub.py`: small pure functions that turn existing data (proposals, lint,
sources, journal, git, Task Scheduler, tune report, trader-bot var files, usage report) into schema rows; a pydantic
model validates the result and a privacy check refuses to write a file that matches the deny list. A `hub` Typer
group adds `mb hub export` and `mb hub import`. Subprocess calls go through an injected `run` so tests never touch
Windows, git remotes or the network.

**Tech Stack:** Python 3.12, Typer, pydantic 2 (already a dependency), pytest, PowerShell (`Get-ScheduledTask`).

**Spec:** `docs/superpowers/specs/2026-10-23-jarvis-hub-design.md` (phases 3 and 5). Schema v1 source of truth is the
hub repo's `schema/hub-export-v1.json` (hub base plan, Task 2); a copy lives at `tests/fixtures/hub-export-v1.json`.

## Global Constraints

- Read-only toward MarketBrain: the exporter writes only its output file; the importer writes only through
  `sources.add` and deletes only the inbox files it added.
- Output dir: `$JARVIS_HOME` if set, else `~/.jarvis`; file `projects/marketbrain.json`; inbox `inbox/marketbrain/`.
- Privacy deny list (refuse to write, exit 2, name the field path): regexes `(account|acct|IRA|Roth)\D{0,3}\d{6,}`,
  `\b[A-Z]\d{8}\b`, `\b\d{3}-\d{6}\b`, `\b\d+(\.\d+)? shares\b`; words `holdings`, `cost basis`, `position value`
  (case-insensitive). Never export holdings, share counts, position values, cost bases or account numbers.
- Every field present; a section with no data is `[]` or zeros.
- Every `mb` command accepts `--json` (`tests/test_cli.py::test_every_command_accepts_json`).
- `.agents/skills/` mirrors `.claude/skills/` byte for byte (`tests/test_repo_wiring.py:151-158`).
- Scheduled and skill calls use `uv run --no-sync mb ...` (a running `mb mcp` holds `mb.exe`).
- Keep encodings and CRLF line endings of edited files.

## Review Focus

- **Exporter runs where a source is missing** (worktree with no `trader-bot/var`, no `docs/tune/`, not Windows, git
  without `origin/dev`): each section degrades to `[]`, the export still writes. Test in Task 4.
- **Privacy false positive on a lesson title** (e.g. "Buyback shares rally"): the bare word "shares" is not on the list,
  only "<number> shares". Test in Task 1.
- **Interrupted write**: the hub must never read half a file; `write_export` writes a temp file and `os.replace`s it.
  Test in Task 4.
- **Inbox file that fails to add** (bad URL, unsupported type): it stays in the inbox and the error is reported; the
  rest still import. Test in Task 5.
- **PowerShell returns one task as an object, not a list**, or never-run tasks (`LastTaskResult` 267011): normalised.
  Test in Task 2.

---

### Task 1: Schema model, privacy check, atomic write

**Files:**
- Create: `src/marketbrain/hub.py`
- Create: `tests/fixtures/hub-export-v1.json` (copy of the hub repo schema; until the hub repo exists, write it from the
  spec's "Export schema v1" block with `required` listing every key and the enums from the spec)
- Test: `tests/test_hub.py`

**Interfaces:**
- Produces:
  - `SCHEMA = 1`, `OBSIDIAN_VAULT = "Suhas"`
  - pydantic models `Agent, QueueItem, Action, Health, Learning, Suggestion, Metric, Link, HubExport` matching the
    spec field names and enums exactly (`Agent.kind: Literal["bot","skill","schedule"]`,
    `Agent.status: Literal["ok","failed","missed","idle"]`, `QueueItem.kind: Literal["proposal","failed-run","lint-error","pr"]`,
    `Learning.kind: Literal["lesson","strategy-update","tune"]`, `Suggestion.source: Literal["tune","lint"]`,
    `Metric.trend: Literal["up","down","flat"]`)
  - `privacy_problems(data: dict) -> list[str]` — JSON-path strings of offending values, e.g. `"learning[2].title"`
  - `hub_home(env=os.environ) -> Path`
  - `write_export(data: dict, path: Path) -> Path` — validates with `HubExport`, raises `ValidationError` (the
    `marketbrain.errors` one) on schema or privacy problems, writes `<path>.tmp` then `os.replace`

- [ ] **Step 1: Write the failing tests**

```python
def test_model_matches_schema_copy():
    schema = json.loads((FIXTURES / "hub-export-v1.json").read_text(encoding="utf-8"))
    assert set(schema["required"]) == set(hub.HubExport.model_fields)

def test_privacy_flags_account_and_holdings_not_plain_shares():
    data = empty_export() | {"learning": [learn("Buyback shares rally"), learn("acct 12345678"), learn("Holdings up")]}
    assert hub.privacy_problems(data) == ["learning[1].title", "learning[2].title"]

def test_write_export_refuses_private_data(tmp_path):
    data = empty_export() | {"metrics": [metric("Pos", "120 shares")]}
    with pytest.raises(ValidationError):
        hub.write_export(data, tmp_path / "m.json")
    assert not (tmp_path / "m.json").exists()

def test_write_export_is_atomic_and_valid(tmp_path):
    out = hub.write_export(empty_export(), tmp_path / "p" / "m.json")
    assert json.loads(out.read_text(encoding="utf-8"))["schema"] == 1
    assert not list(tmp_path.glob("p/*.tmp"))

def test_hub_home_env(tmp_path):
    assert hub.hub_home({"JARVIS_HOME": str(tmp_path)}) == tmp_path
```

(`empty_export()`, `learn(title)` and `metric(label, value)` are small helpers at the top of `tests/test_hub.py`;
`commit_page(root, rel, title)` in Task 3 writes `vault/wiki/<rel>.md` with `helpers.make_page_text` and commits it with
conftest's `git(root, ...)`; `fake_run(stdout)` and `boom` stand in for `subprocess.run`.)

- [ ] **Step 2: Run them to make sure they fail** — `uv run pytest tests/test_hub.py -q` → import error.
- [ ] **Step 3: Implement** the Produces list in `src/marketbrain/hub.py`.
- [ ] **Step 4: Run** — `uv run pytest tests/test_hub.py -q` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): export schema model, privacy check, atomic write"`

### Task 2: Agents and queue rows

**Files:**
- Modify: `src/marketbrain/hub.py`
- Test: `tests/test_hub.py`

**Interfaces:**
- Consumes: `proposals.list_pending(settings) -> list[dict]` (keys `proposal_id, title, target, created`, or
  `{proposal_id, error, path}`), `lint.run(settings) -> list[Finding]` (`severity, rule, target, message`).
- Produces:
  - `TASKS = ("MarketBrain nightly", "MarketBrain ORB", "MarketBrain weekly briefing", "MarketBrain pick tracker", "MarketBrain weekly tune")`
  - `scheduled_tasks(run=subprocess.run, platform=sys.platform) -> list[dict]` — `[{name, last_run, next_run, result}]`
    (ISO strings or `None`); `[]` off Windows or on any error. Runs
    `powershell -NoProfile -Command "Get-ScheduledTask -TaskName 'MarketBrain *' | Get-ScheduledTaskInfo | Select-Object TaskName,LastRunTime,LastTaskResult,NextRunTime | ConvertTo-Json -Compress"`, timeout 30 s.
  - `agent_rows(tasks: list[dict], briefing_ts: str | None, skills: list[tuple[str, str]], now: datetime) -> list[dict]`
  - `queue_rows(pending: list[dict], findings: list[dict], agents: list[dict], branches: list[dict], now: datetime) -> list[dict]`
  - `unmerged_branches(root: Path, now: datetime, run=subprocess.run) -> list[dict]` — `[{name, date}]` from
    `git for-each-ref refs/remotes/origin --no-merged origin/dev --format=%(refname:short)|%(committerdate:iso-strict)`,
    dropping `origin/HEAD`, `origin/main`, `origin/dev` and anything older than 14 days; `[]` on error.

Status rules for a Windows task: `result == 267011` or no `last_run` → `idle`; `next_run` more than 1 hour in the past →
`missed`; `result != 0` → `failed`; else `ok`. The weekday briefing (a Claude app task) is one `kind: bot` agent named
`briefing-daily` whose `last_run` is the newest journal entry with `agent == "briefing"`: `ok` within 3 days, else
`missed`. Skills come from `.claude/skills/*/SKILL.md` frontmatter (`name`, first 80 characters of `description`) as
`kind: skill, status: idle`.

Queue rows: each pending proposal → `kind: proposal`, title `"<title or target>"`, `age_days` from `created`,
action `{"label": "Review", "command": "claude \"/review\""}`; each `failed` or `missed` agent → `kind: failed-run`,
action `{"label": "Open log", "command": "explorer .brain\\logs"}`; each lint `error` → `kind: lint-error`, title
`"<rule>: <target>"`, action `{"label": "Lint", "command": "claude \"/lint\""}`; each branch → `kind: pr`, title
`"<branch> not merged into dev"`, action `{"label": "Open session", "command": "claude"}`. Sorted by `age_days` desc.

- [ ] **Step 1: Write the failing tests**

```python
def test_scheduled_tasks_normalises_single_object():
    run = fake_run(stdout='{"TaskName":"MarketBrain nightly","LastRunTime":"/Date(1761206400000)/","LastTaskResult":0,"NextRunTime":"/Date(1761292800000)/"}')
    rows = hub.scheduled_tasks(run=run, platform="win32")
    assert rows == [{"name": "MarketBrain nightly", "last_run": "2025-10-23T08:00:00+00:00",
                     "next_run": "2025-10-24T08:00:00+00:00", "result": 0}]

def test_scheduled_tasks_off_windows_is_empty():
    assert hub.scheduled_tasks(run=boom, platform="linux") == []

@pytest.mark.parametrize("result,last,next_,want", [
    (267011, None, None, "idle"), (0, "2026-10-22T02:00:00+00:00", "2026-10-22T20:00:00+00:00", "missed"),
    (1, "2026-10-23T02:00:00+00:00", "2026-10-24T02:00:00+00:00", "failed"),
    (0, "2026-10-23T02:00:00+00:00", "2026-10-24T02:00:00+00:00", "ok")])
def test_agent_status(result, last, next_, want):
    task = {"name": "MarketBrain nightly", "last_run": last, "next_run": next_, "result": result}
    assert hub.agent_rows([task], None, [], NOW)[0]["status"] == want      # NOW = 2026-10-23T12:00Z

def test_queue_merges_and_sorts_oldest_first():
    rows = hub.queue_rows([{"proposal_id": "p1", "title": "NVDA", "created": "2026-10-20T00:00:00Z"}],
                          [{"severity": "error", "rule": "ref", "target": "lessons/x", "message": "m"},
                           {"severity": "warn", "rule": "stale", "target": "y", "message": "m"}],
                          [{"name": "MarketBrain ORB", "status": "failed", "last_run": "2026-10-23T09:20:00+00:00"}],
                          [], NOW)
    assert [r["kind"] for r in rows] == ["proposal", "failed-run", "lint-error"]
    assert rows[0]["action"]["command"] == 'claude "/review"'
```

PowerShell 5.1 serialises dates as `/Date(<ms>)/`; parse that and plain ISO.

- [ ] **Step 2: Run to fail**, **Step 3: implement** the Produces list, **Step 4: run to pass**
  (`uv run pytest tests/test_hub.py -q`).
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): agents and waiting-on-you rows"`

### Task 3: Learning, suggestions, metrics, links

**Files:**
- Modify: `src/marketbrain/hub.py`
- Test: `tests/test_hub.py`

**Interfaces:**
- Consumes: `journal.query(settings, kind="reflection", since=<iso>, limit=20) -> list[dict]` (`id, ts, text`).
- Produces:
  - `learning_rows(root: Path, reflections: list[dict], now: datetime, run=subprocess.run) -> list[dict]` — git log
    `--since=<now-14d> --diff-filter=AM --name-only --format=@%cI -- vault/wiki/lessons vault/wiki/strategies`;
    each page → `kind` `lesson` (lessons/) or `strategy-update` (strategies/), `title` from the page frontmatter
    (fallback: stem), `citation` `[[lessons/<stem>]]`, `link`
    `obsidian://open?vault=Suhas&file=vault/wiki/<dir>/<stem>`; each reflection → `kind: lesson`, title its first 80
    characters, `citation` `journal:<id>`, `link` `""`. Newest first, at most 20.
  - `tune_suggestions(root: Path) -> list[dict]` — newest `docs/tune/*.md`; between `## Ranked suggestions` and the
    next `## `, lines matching `^### (\d+)\. (.+) \((\w+), size (\w+)\)$`; top 5 as
    `{rank, title, why: "<kind>, size <S>", source: "tune"}`; `[]` when no report.
  - `metrics_rows(var_dir: Path, usage_units: int | None) -> list[dict]`:
    - newest `var_dir/compare/*.md`: the `| ORB |` and `| Strategy 1.0 |` rows, column "P&L" (5th cell) →
      metrics `"ORB paper P&L"` and `"Strategy 1.0 paper P&L"`, value the cell text, trend from its sign;
    - `var_dir/picks/picks.json` → `"Pick hit rate"`, `100 * target_hit / (target_hit + stopped)` to 1 decimal with `%`
      (same as `picks.scorecard`), `"n/a"` when nothing closed, help `"<closed> closed picks"`;
    - `usage_units` → `"Claude units (7d)"`, formatted like `12.3M`, trend `flat`.
  - `usage_units_7d(run=subprocess.run) -> int | None` — `uv run --no-project python ~/.claude/scripts/usage_report.py --hours 168 --json`,
    timeout 120 s, returns `claude.units`; `None` on any error.
  - `LINKS` — `[{"label": "Portfolio Briefing", "url": "https://claude.ai/artifact/XGU2mRazJB6WmbJHHXZ2NQ"},
    {"label": "Tuning Report", "url": "https://claude.ai/artifact/NujBquxADSMYvJbBTgXRzd"},
    {"label": "Nightly Repo Report", "url": "https://claude.ai/artifact/EXrEw8DCR53cFrwrspyekG"},
    {"label": "Watchlist Deep Dive", "url": "https://claude.ai/artifact/Sy5ua1EFWrBMu6Z4FmKGqC"},
    {"label": "MarketBrain vault", "url": "obsidian://open?vault=Suhas"}]`

- [ ] **Step 1: Write the failing tests**

```python
def test_tune_top_five(tmp_path):
    write(tmp_path / "docs/tune/2026-10-19.md", TUNE_SAMPLE)          # 6 items, then "## Eval results"
    rows = hub.tune_suggestions(tmp_path)
    assert len(rows) == 5 and rows[0] == {"rank": 1, "source": "tune", "why": "rule, size S",
        "title": "Keep shell commands to one simple step per call"}

def test_metrics_from_var(tmp_path):
    write(tmp_path / "compare/2026-10-23.md", "| Strategy | Trades today | P&L today | Trades | P&L | Win rate | Max drawdown |\n|---|---|---|---|---|---|---|\n| ORB | 1 | $12.00 | 5 | $-40.50 | 40% | $60 |\n| Strategy 1.0 | 0 | $0 | 3 | $25.10 | 67% | $10 |\n")
    write(tmp_path / "picks/picks.json", json.dumps([{"status": "target_hit"}, {"status": "stopped"}, {"status": "target_hit"}, {"status": "watching"}]))
    rows = {m["label"]: m for m in hub.metrics_rows(tmp_path, 12_300_000)}
    assert rows["ORB paper P&L"]["value"] == "$-40.50" and rows["ORB paper P&L"]["trend"] == "down"
    assert rows["Pick hit rate"]["value"] == "66.7%"
    assert rows["Claude units (7d)"]["value"] == "12.3M"

def test_metrics_missing_var_is_empty(tmp_path):
    assert hub.metrics_rows(tmp_path / "nope", None) == []

def test_learning_from_git_and_journal(project):          # conftest fixture: git repo with policy.yaml
    commit_page(project.vault_root, "lessons/long-sessions-cost-the-most", title="Long Claude Sessions Cost the Most")
    rows = hub.learning_rows(project.vault_root, [{"id": 7, "ts": "2026-10-22T00:00:00Z", "text": "ORB lost 3R"}], NOW)
    assert rows[0]["citation"] == "[[lessons/long-sessions-cost-the-most]]"
    assert {"citation": "journal:7", "kind": "lesson"}.items() <= rows[1].items()
```

- [ ] **Step 2: Run to fail**, **Step 3: implement**, **Step 4: run to pass**.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): learning, tune suggestions, metrics and links"`

### Task 4: `build_export` and `mb hub export`

**Files:**
- Modify: `src/marketbrain/hub.py`, `src/marketbrain/cli.py` (new `hub_app = typer.Typer(no_args_is_help=True, help="Jarvis hub status file and capture inbox.")`, `app.add_typer(hub_app, name="hub")`)
- Test: `tests/test_hub.py`, `tests/test_cli.py`

**Interfaces:**
- Consumes: everything from Tasks 1-3; `sources.list_sources(settings, status="unprocessed")`.
- Produces:
  - `build_export(settings, now: datetime, *, var_dir: Path, run=subprocess.run, platform=sys.platform, usage_units: int | None = None) -> dict`
    — `health = {lint_errors, lint_warnings, stale_pages (rule == "stale"), sources_unprocessed}`; each section in its
    own `try` so one failing source leaves that section empty (`[]`/zeros) and the rest exported.
  - `var_dir` default: `$TRADERBOT_VAR`, else `<vault_root>/trader-bot/var`.
  - CLI `mb hub export [--out PATH] [--no-usage] [--json]` → writes `hub_home()/projects/marketbrain.json` (or `--out`),
    prints `{"path", "agents", "queue", "learning", "suggestions", "metrics"}` (counts) with `--json`; exit 2 with the
    privacy paths on a refusal.

- [ ] **Step 1: Write the failing tests**

```python
def test_export_in_bare_project_still_writes(project, tmp_path, monkeypatch):
    monkeypatch.setenv("JARVIS_HOME", str(tmp_path))
    out = mbj("hub", "export", "--no-usage")
    data = json.loads(Path(out["path"]).read_text(encoding="utf-8"))
    hub.HubExport.model_validate(data)
    assert data["project"] == "marketbrain" and data["metrics"] == [] and data["health"]["lint_errors"] >= 0

def test_export_counts_a_pending_proposal(project, tmp_path, monkeypatch):
    monkeypatch.setenv("JARVIS_HOME", str(tmp_path))
    draft = project.vault_root / "draft.md"; draft.write_text(make_page_text("lesson/x"), encoding="utf-8")
    mb("propose", str(draft), "--rationale", "test")       # route: human, so it stays pending
    assert mbj("hub", "export", "--no-usage")["queue"] == 1
```

- [ ] **Step 2: Run to fail**, **Step 3: implement**, **Step 4: run** `uv run pytest tests/test_hub.py tests/test_cli.py -q` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): mb hub export"`

### Task 5: `mb hub import` (Quick Capture inbox)

**Files:**
- Modify: `src/marketbrain/hub.py`, `src/marketbrain/cli.py`
- Test: `tests/test_hub.py`

**Interfaces:**
- Consumes: `sources.add(settings, path_or_url, title=None) -> SourceRecord` (a duplicate returns the existing record);
  `index.sync` as `mb add` calls it.
- Produces: `import_inbox(settings, inbox: Path) -> list[dict]` — for each `*.md` in name order: text without
  frontmatter, stripped; a single `http(s)://` line → `sources.add(settings, url)`, else
  `sources.add(settings, str(file), title=<frontmatter title or stem>)`; on success delete the file and record
  `{"file", "hash8"}`; on error keep the file and record `{"file", "error"}`. CLI `mb hub import [--json]` reads
  `hub_home()/inbox/marketbrain/` (missing folder → `[]`).

- [ ] **Step 1: Write the failing test**

```python
def test_import_adds_notes_and_keeps_failures(project, tmp_path, monkeypatch):
    inbox = tmp_path / "inbox"; inbox.mkdir()
    (inbox / "2026-10-23-0900.md").write_text("---\ntitle: Idea\n---\nNVDA supply chain note\n", encoding="utf-8")
    (inbox / "2026-10-23-0901.md").write_text("https://example.invalid/x\n", encoding="utf-8")
    real_add = hub.sources.add
    def add(s, target, title=None):
        if target.startswith("https://"):
            raise ValidationError("fetch failed")
        return real_add(s, target, title=title)
    monkeypatch.setattr(hub.sources, "add", add)
    rows = hub.import_inbox(project, inbox)
    assert "hash8" in rows[0] and rows[1]["error"] == "fetch failed"
    assert [p.name for p in inbox.iterdir()] == ["2026-10-23-0901.md"]
```

- [ ] **Step 2: Run to fail**, **Step 3: implement**, **Step 4: run to pass**.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): mb hub import for the Quick Capture inbox"`

### Task 6: Wire the export and import into the runs

**Files:**
- Modify: `scripts/nightly.ps1` (step `"hub import"` `{ uv run --no-sync mb hub import --json }` right before the
  `"clippings"` step; step `"hub export"` `{ uv run --no-sync mb hub export --json }` right after `"backup"`)
- Modify: `.claude/skills/review/SKILL.md` and `.claude/skills/tune/SKILL.md` (last step: "Run
  `uv run --no-sync mb hub export --json` so the Jarvis hub shows the new state; a failure is reported, not fixed.");
  copy both to `.agents/skills/`
- Modify: `trader-bot/claude/scheduled-tasks/briefing-daily/SKILL.md` (step 13, same sentence)
- Modify: `trader-bot/briefing/weekly.py` `BUILTIN` (add `"Bash(uv run --no-sync mb hub export *)"`)
- Test: `tests/test_nightly.py`

- [ ] **Step 1: Write the failing test**

```python
def test_nightly_feeds_the_jarvis_hub():
    nightly = (REPO / "scripts" / "nightly.ps1").read_text(encoding="utf-8")
    assert nightly.index("mb hub import") < nightly.index("mb add --clippings")
    assert nightly.index("mb hub export") > nightly.index("mb backup")
```

- [ ] **Step 2: Run to fail**, **Step 3: edit**, **Step 4: run** `uv run pytest tests/test_nightly.py tests/test_repo_wiring.py -q` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): nightly, review, tune and briefing refresh the hub"`

### Task 7: BetBrain handoff note and doc trail

**Files:**
- Create: `docs/superpowers/handoffs/2026-10-23-betbrain-hub-export.md` — for a BetBrain session: what Jarvis is,
  schema v1 (copy of the spec block and the enums), output path `~/.jarvis/projects/betbrain.json`, the privacy rule
  (no sportsbook credentials or account details), and a suggested mapping: `agents` ← its `bb` scheduled pulls
  (odds, stats, settle), `queue` ← its pending `vault/_proposals/` and unsettled bets older than 2 days, `health` ←
  its wiki lint, `metrics` ← bankroll ROI, CLV, open bets, analyst hit rate, `links` ← its BetBrain artifact
  (`https://claude.ai/artifact/GZtCHCAhGqB8Gmxceaze9Q`), and a registry line for Lucky. It states that MarketBrain
  wrote nothing in BetBrain.
- Modify: `docs/README.md` (this plan under `## Plans`; spec status), `docs/CHANGELOG.md` (dated line), this plan's
  `## Outcome`.

- [ ] **Step 1: Write the note and doc lines.**
- [ ] **Step 2: Full gate in the background** — `uv sync --all-packages`, `uv run pytest -q`, `uv run mb lint --json`
  → all pass.
- [ ] **Step 3: PC check** — `uv run --no-sync mb hub export --json` in the root checkout writes
  `~/.jarvis/projects/marketbrain.json`; open it and confirm no private data.
- [ ] **Step 4: Commit, push, PR into `dev`** assigned to Lucky.
