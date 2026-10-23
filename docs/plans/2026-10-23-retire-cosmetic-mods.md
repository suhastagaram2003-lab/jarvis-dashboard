# Retire cosmetic mods Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the 16 cosmetic and display mods from MarketBrain, keeping only `marketbrain-guard` and `blast-radius`.

**Architecture:** Pure deletion plus doc and config updates; one wiring test pins that the marketplace, the settings and the
mods folder agree on the two kept mods. Git history is the way back.

**Tech Stack:** git, pytest, `claude plugin validate|test`.

**Spec:** `docs/superpowers/specs/2026-10-23-jarvis-hub-design.md` (phase 1).

## Global Constraints

- Keep exactly `mods/marketbrain-guard` and `mods/blast-radius`; both are self-contained (they import only `claude-code`
  and their own `./rules`).
- Delete: `away-ping`, `blocked-tray`, `brain-pane`, `briefing-pane`, `cache-control`, `cockpit`, `manager`,
  `market-dashboard`, `market-status`, `next-steps`, `pc-sync-band`, `plan-progress`, `portfolio-band`, `prompt-deck`,
  `runs-band`, `session-hub`.
- Do not edit history: old specs, plans, `docs/CHANGELOG.md` entries and `vault/sources/` copies stay as written.
- Keep each file's encoding and CRLF line endings (CLAUDE.md rule 7).
- Branch: this thread's branch, one PR into `dev`.

## Review Focus

- A user-scope install of a deleted mod keeps loading from `~/.claude/plugins/cache/` after the folders are gone: the
  PR body must list the uninstall lines (Task 2).
- `.claude/settings.json` still allows `claude plugin validate *` and `claude plugin test *`: those stay, the kept mods
  use them.
- `tests/test_rules.py` `SHIPPED_WITHOUT_SPEC` names cockpit plans: it is about plan files, leave it.
- A stray reference in live docs (`mods/README.md`, CLAUDE.md, AGENTS.md) to a deleted mod: the wiring test in Task 1
  greps for it.
- `.gitignore` `/cockpit/` rule: harmless once the mod is gone, but remove it with its comment so nothing points at a
  dead mod.

---

### Task 1: Delete the mods and pin the kept set

**Files:**
- Delete: the 16 `mods/<name>/` folders listed above, and `mods/README-briefing-portfolio.md`
- Modify: `mods/.claude-plugin/marketplace.json` (drop entries manager, cockpit, session-hub, portfolio-band,
  market-dashboard; description becomes "Claude Code mods for MarketBrain: guardrails.")
- Modify: `.claude/settings.json:203-209` (`enabledPlugins` keeps only the two `true` entries)
- Modify: `.gitignore:39-40` (remove the cockpit comment and `/cockpit/`)
- Modify: `mods/README.md` (rewrite: install, update and checks for the two kept mods only; a "Retired 2026-10-23"
  line naming the 16 and pointing to the Jarvis hub spec)
- Test: `tests/test_repo_wiring.py`

**Interfaces:**
- Produces: `KEPT_MODS = {"marketbrain-guard", "blast-radius"}` in the test module.

- [ ] **Step 1: Write the failing test**

```python
KEPT_MODS = {"marketbrain-guard", "blast-radius"}
RETIRED_MODS = {"away-ping", "blocked-tray", "brain-pane", "briefing-pane", "cache-control", "cockpit", "manager",
                "market-dashboard", "market-status", "next-steps", "pc-sync-band", "plan-progress",
                "portfolio-band", "prompt-deck", "runs-band", "session-hub"}

def test_only_kept_mods_remain():
    folders = {p.name for p in (REPO / "mods").iterdir() if p.is_dir() and not p.name.startswith(".")}
    market = json.loads((REPO / "mods/.claude-plugin/marketplace.json").read_text(encoding="utf-8"))
    enabled = json.loads((REPO / ".claude/settings.json").read_text(encoding="utf-8"))["enabledPlugins"]
    assert folders == KEPT_MODS
    assert {p["name"] for p in market["plugins"]} == KEPT_MODS
    assert enabled == {f"{m}@marketbrain-mods": True for m in KEPT_MODS}
    for doc in ("mods/README.md", "CLAUDE.md", "AGENTS.md"):
        text = (REPO / doc).read_text(encoding="utf-8")
        live = text.split("Retired 2026-10-23")[0]
        assert not [m for m in RETIRED_MODS if m in live], doc
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `uv run pytest tests/test_repo_wiring.py::test_only_kept_mods_remain -q`
Expected: FAIL on `folders == KEPT_MODS`.

- [ ] **Step 3: Delete and edit**

`git rm -r` the 16 folders and `mods/README-briefing-portfolio.md`; make the four file edits listed under Files.

- [ ] **Step 4: Run the checks**

Run: `uv run pytest tests/test_repo_wiring.py -q` → PASS.
Run: `claude plugin validate mods/marketbrain-guard; claude plugin validate mods/blast-radius` → both valid.
Run (in each kept mod folder): `claude plugin test .` → pass.

- [ ] **Step 5: Commit**

```bash
git add -A mods .claude/settings.json .gitignore tests/test_repo_wiring.py
git commit -m "chore(mods): retire the 16 cosmetic mods; keep guard and blast-radius"
```

### Task 2: Doc trail and uninstall lines

**Files:**
- Modify: `docs/README.md` (Jarvis hub spec line: status "phase 1 (mods retired) merged/PR #<n>"; add this plan under
  `## Plans`)
- Modify: `docs/CHANGELOG.md` (new `## 2026-10-23` line: mods retired, the two kept, why, the spec path)
- Modify: this plan (`## Outcome`)

- [ ] **Step 1: Write the doc lines** as above.
- [ ] **Step 2: Full suite in the background**: `uv sync --all-packages` then `uv run pytest -q` → all pass.
- [ ] **Step 3: Commit, push, open the PR into `dev`** assigned to Lucky. The PR body lists, for Lucky to run once on
  the PC after merging:

```
claude plugin uninstall manager@marketbrain-mods
claude plugin uninstall cockpit@marketbrain-mods
claude plugin uninstall session-hub@marketbrain-mods
claude plugin uninstall portfolio-band@marketbrain-mods
claude plugin uninstall market-dashboard@marketbrain-mods
claude plugin marketplace update marketbrain-mods
```
