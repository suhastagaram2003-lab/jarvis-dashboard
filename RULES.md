# RULES

The rule core of MarketBrain. A test pins its hash, so it changes only through a PR. Lucky owns it.

## 1. Hierarchy

Higher layers win. A conflict is fixed in the lower layer as soon as it is found, in the same PR.

1. **Hard guards**: the `marketbrain-guard` mod, the settings deny lists, the pre-commit hook and the repo's rule
   tests. Only Lucky changes them, through a PR. MarketBrain's `trader-bot/agent/RULES.md` (the trading agent's
   own rules) sits at this level: reference it, never edit it from a rules change.
2. **This file.**
3. **Project layer**: the repo's CLAUDE.md (and AGENTS.md where it exists). It may add rules, never contradict these.
4. **claude.ai project instructions**: one line pointing to this file, no rules of their own.
5. **Skills**: how to do a job. They follow these rules and add none.
6. **Memory**: facts and state only. A rule found in memory moves up a layer and the memory is deleted.

## 2. Safety (never break)

- No orders, trades or sportsbook bets, ever. Trading is paper only and goes through the repo's own order script.
- Never push, open a PR into or merge into `main`. `main` is frozen until Lucky releases it.
- No secrets, keys, account numbers, holdings or family details in git, logs, artifacts or memory.
- Read-only broker and market-data tools are fine; every write tool stays denied.
- Agents never read, write or move a secret. When Lucky must edit a file or a key, give a `file:///` link to it
  and a Win+R line that opens it (`notepad <path>`), and let Lucky make the change.

## 3. Way of working

- **Every build follows superpowers:** brainstorming, a spec in `docs/superpowers/specs/`, writing-plans, a plan in
  `docs/superpowers/plans/`, then the build. Only questions, commands, `mb` operations and one-line
  configuration changes asked in chat skip it; those get a dated line in `docs/CHANGELOG.md`.
- Choices go to Lucky as 2-4 options, the recommended one first with a one-line trade-off.
- Nothing over 30 seconds runs in the foreground; full test suites run in the background.

## 4. Agents and models

- Claude does all planning, building and review. Codex runs only when Lucky explicitly says "send this to Codex".
- Opus plans, builds and reviews; Fable handles UI, design and advanced math; subagents get the model that fits
  their task; the smallest model does quick lookups.

## 5. Branches and pull requests

- `dev` is the integration branch and GitHub's default; new worktrees start from `origin/dev`.
- A thread keeps the branch the app creates (`claude/...`). Branches made by hand are `<type>/<topic>`
  (`feat`, `fix`, `docs`, `test`, `refactor`, `chore`; 2-4 kebab-case words) from `origin/dev`.
- One thread, one branch, one PR into `dev`. The PR body starts with the attribution block the session gives, and
  the PR is assigned to Lucky.
- **Gate before merging:** `uv sync --all-packages` in the thread's own worktree, the full `uv run pytest -q`, the
  repo's wiki lint when its wiki code changes, and a review of the diff against the spec and plan.
- **Claude merges** and resolves conflicts itself, after the change is checked on the PC. If the PC's auto mode
  blocks a merge, the thread posts the PR link once and waits; that is the only case where Lucky merges.

## 6. Definition of done

A thread's PR carries its doc trail: the spec, the plan with an `## Outcome` section (what shipped, PR numbers,
what was rejected), a `docs/README.md` status line and a dated `docs/CHANGELOG.md` line.

## 7. Knowledge flow

- Cloud threads cannot reach `.brain/` or `vault/_proposals/`, so they never write journal entries or proposals;
  git carries their specs, plans and change logs.
- On the PC, the bridge (`mb bridge`, run by the nightly before `/ingest`) turns those into sources and journals one
  `pr-merged` outcome per merged PR.
- `/review` ends by pushing its `wiki:` commits to `origin/dev`, so threads see the approved pages. The nightly stays
  report-only for git.
- Wiki pages are written in full sentences and cite their sources; chat styles never reach them.
