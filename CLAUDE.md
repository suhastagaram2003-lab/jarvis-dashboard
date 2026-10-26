# Jarvis hub

@RULES.md

This repo is the Jarvis hub: a fork of [AndrewKochulab/jarvis-dashboard](https://github.com/AndrewKochulab/jarvis-dashboard)
(MIT, commit `ab4e274`) that shows every registered Claude project in one Obsidian note on the PC
(`C:\Users\sutag\Documents\Jarvis`). Design: `docs/specs/2026-10-23-jarvis-hub-design.md`; plans: `docs/plans/`.

## Hub rules

- **Read-only toward projects.** The hub reads a project only through `~/.jarvis/registry.json` and
  `~/.jarvis/projects/<name>.json`. It never writes into a project folder, and never writes any project's wiki,
  sources or journal. Buttons run a command only on a click, in a new Windows Terminal tab in the project folder.
- **No project code here.** Exporters live in their own projects (`mb hub export`, `bb hub export`).
- **No private data.** No holdings, share counts, position values, cost bases, account numbers or family details in
  the repo, fixtures, examples or notes. Examples use `<you>` placeholders.
- `macos/`, `ios/` and `companion/` are upstream's and stay untouched.
- Tests: `npm test` (Node `node:test`, no dependencies). The Obsidian check on the PC (open `Jarvis Dashboard.md`
  with the fixture) happens before every merge into `dev`.
- Upstream fixes come in with `git merge upstream/main` on a branch, through a PR into `dev`.
