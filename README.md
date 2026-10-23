<p align="center">
  <img src="https://raw.githubusercontent.com/AndrewKochulab/jarvis-dashboard/main/assets/banner.svg" alt="J.A.R.V.I.S. Dashboard" width="100%">
</p>

## Hub fork

This fork turns Jarvis into one hub for several Claude projects (MarketBrain, BetBrain and any project added later),
run as an Obsidian note on Windows. It is based on [AndrewKochulab/jarvis-dashboard](https://github.com/AndrewKochulab/jarvis-dashboard)
at commit `ab4e274` (MIT; the licence and credit stay). Design: [docs/specs/2026-10-23-jarvis-hub-design.md](docs/specs/2026-10-23-jarvis-hub-design.md);
plans: [docs/plans/](docs/plans/). The upstream README follows below this section.

**What changed from upstream**

- **Projects through status files.** The hub reads `~/.jarvis/registry.json` (one entry per project) and each
  project's export `~/.jarvis/projects/<name>.json` (schema in [schema/hub-export-v1.json](schema/hub-export-v1.json)).
  It never writes into a project folder. An export that is missing, older than 36 hours, of another schema version or
  not valid JSON turns that project's card grey with the reason; the other projects still render.
- **New widgets:** Project Strip (a card per project with health dot, queue count, export age and a Refresh button
  that runs the project's `export_command` in its folder) and Waiting On You (every project's queue, oldest first,
  with action buttons). Agent Cards now come from the exports, with a status dot from each agent's last run. The
  header says how many things wait on you. What We Learned, Fix Next, Metrics and Mission Control show each export's
  `learning`, `suggestions`, `metrics` and `links`.
- **Ask box:** pick a project and ask; it runs `claude -p "/ask ..."` in the project folder without a shell, with only
  `Read`, `Grep`, `Glob` and the project's own read-only MCP tools (`ask_tools`), and shows the cited answer and
  the command. It needs `claude.exe` (the native install, or set `hub.claudePath` in `src/config/config.json`).
- **Quick Capture** saves a dated note in the hub-owned inbox `~/.jarvis/inbox/<project>/`; each project's nightly
  imports its own folder. The hub never writes into a project.
- **By project:** Live Sessions labels sessions with their project (`claude_projects_prefix`, worktrees included),
  System Diagnostics has a row per project (cache in `~/.jarvis/stats-cache.json`), and Recent Activity lists notes
  from each project's `recent_dirs` and opens them in that project's vault.
- **Windows port** (`src/core/os-compat.js`): `tasklist` instead of `pgrep`, Windows Terminal (`wt.exe`) instead of
  `osascript`, the Windows URL and file handler instead of `open -a`, and Claude's Windows project folders (`C--Users-...`) are recognised.
  Buttons run a command only on a click, in a new Windows Terminal tab in the project folder, and show the command in
  their tooltip.
- **Sturdier loader:** config cascade (`config.example.json`, then `config.json`, then `config.local.json`), and a
  widget that throws shows a small red error card instead of hiding every widget after it.
- **Layout:** Focus Timer, Quick Launch and Voice Command are out of the default layout (voice returns in a later
  phase). `macos/`, `ios/` and `companion/` are kept untouched and not built.
- **Tests:** `npm test` (Node's built-in `node:test`, no dependencies).

**Setup on Windows**

1. Clone this repo to `C:\Users\<you>\Documents\Jarvis` and open the folder as an Obsidian vault.
2. Install the Dataview community plugin and turn on **Enable JavaScript Queries** in its settings.
3. Create `%USERPROFILE%\.jarvis\projects\`, copy `examples/registry.example.json` to
   `%USERPROFILE%\.jarvis\registry.json` and replace each `<you>` with your Windows user name.
4. Until a project's exporter exists, copy `examples/projects/marketbrain.json` to `%USERPROFILE%\.jarvis\projects\`
   (set its `exported_at` to a recent time, or the card shows it as stale).
5. Optional: put personal settings in `src/config/config.json` (gitignored); it only needs the keys you change.
6. Open `Jarvis Dashboard.md`.

<h1 align="center">J.A.R.V.I.S. Dashboard</h1>

<p align="center">
  <strong>A modular AI command center for monitoring Claude Code sessions, voice interaction, analytics, and productivity — across 4 platforms from a single codebase.</strong>
</p>

<p align="center">
  Voice Commands &bull; Live Sessions &bull; Agent Fleet &bull; 30-Day Analytics &bull; Focus Timer &bull; Multi-Platform &bull; Configurable Everything
</p>

<p align="center">
  <a href="#see-it-in-action">See it in Action</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#platforms">Platforms</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="docs/README.md">Documentation</a>
</p>

---

## Why?

| Problem | Jarvis Solution |
|---|---|
| Claude Code runs headless in a terminal | Real-time session monitoring with Live Sessions widget |
| No usage analytics or cost tracking | 30-day stats: sessions, tokens, cost, model breakdown |
| Voice interaction requires complex setup | One-click voice commands with neural TTS + whisper-cpp STT |
| AI agents are invisible config files | Visual agent fleet with animated robot avatars |
| Scattered productivity tools | Focus timer, quick capture, bookmarks — all in one dashboard |
| Mobile AI access is clunky | Native iOS app with full voice interaction |
| One-size-fits-all dashboard | Fully configurable layout, theme, and widgets via JSON |

## See it in Action

<p align="center">
  <img src="assets/jarvis-realtime-testing.gif" alt="JARVIS Voice Command Demo" width="100%">
</p>

<details>
<summary><strong>Widget Gallery</strong> (click to expand)</summary>

| Widget | Preview |
|---|---|
| Voice Command | <img src="assets/widgets/jarvis-voice-command.png" width="600"> |
| Live Sessions | <img src="assets/widgets/live-sessions.png" width="600"> |
| Agent Cards | <img src="assets/widgets/agent-cards.png" width="600"> |
| Focus Timer | <img src="assets/widgets/focus-timer.png" width="300"> |
| Quick Capture | <img src="assets/widgets/quick-capture.png" width="300"> |
| Activity Analytics | <img src="assets/widgets/activity-analytics.png" width="600"> |
| System Diagnostics | <img src="assets/widgets/system-diagnostics.png" width="600"> |
| Communication Link | <img src="assets/widgets/communication-link.png" width="600"> |
| Quick Launch | <img src="assets/widgets/quick-launch.png" width="300"> |
| Mission Control | <img src="assets/widgets/mission-control.png" width="300"> |
| Recent Activity | <img src="assets/widgets/recent-activity.png" width="600"> |

</details>

## Quick Start

```bash
# 1. Clone
git clone https://github.com/AndrewKochulab/jarvis-dashboard.git
cd jarvis-dashboard

# 2. Configure
cp src/config/config.example.json src/config/config.json
# Edit config.json — set projects.mode to "auto" and adjust paths

# 3. Open
# Place in your Obsidian vault and open "Jarvis Dashboard.md"
```

For mobile, macOS app, or iOS app setup, see the [Setup Guide](docs/setup/README.md).

## Platforms

Jarvis runs on **4 platforms** from one shared JavaScript codebase:

| Platform | Type | Dashboard | Voice | Claude Execution |
|---|---|---|---|---|
| **Obsidian Desktop** | DataviewJS note | Full (13 widgets) | Local (Piper/Say) | Local CLI |
| **Obsidian Mobile** | DataviewJS note | Voice only | Via server | Via server |
| **macOS** | Tauri 2.0 app | Full (13 widgets) | Local (Piper/Say) | Local (Rust spawn) |
| **iOS/iPadOS** | SwiftUI app | Voice only | Via server | Via server |

- [Obsidian Setup](docs/obsidian/README.md)
- [macOS App Build](docs/macos/README.md)
- [iOS App Build](docs/ios/README.md)
- [Companion Server](docs/server/README.md) (required for mobile)

## Features

### Voice Command System
- Full-duplex voice interaction with Claude Code
- Three TTS engines: **Piper** (neural), **macOS Say**, browser speechSynthesis
- Speech-to-text via **whisper-cpp** with multi-language auto-detection
- **Interactive mode** with tool permission cards and question handling
- Multi-session tab bar with drag & drop reordering
- **JARVIS personality** system with customizable prompts
- [Voice Command docs](docs/widgets/voice-command.md) | [TTS docs](docs/text-to-speech/README.md) | [STT docs](docs/speech-to-text/README.md)

### 13 Widgets

| Category | Widgets |
|---|---|
| **AI Interaction** | Voice Command, Live Sessions, Agent Cards |
| **Analytics** | System Diagnostics, Activity Analytics (heatmap, peak hours, model breakdown) |
| **Productivity** | Focus Timer, Quick Capture (with voice dictation) |
| **Navigation** | Quick Launch, Mission Control, Communication Link, Recent Activity |
| **Chrome** | Header (title, clock, status), Footer |

All widgets are independently configurable and removable. Control order and layout via the `layout` array in `config.json`. [Widget docs](docs/widgets/README.md)

### Real-time Monitoring
- Live session tracking with token/cost display, model badges
- Agent detection and cross-widget status updates
- 30-day analytics with GitHub-style heatmaps
- Configurable polling intervals and caching

### Cross-Platform Architecture
- Shared JavaScript codebase with no build step
- Platform adapters abstract file system, process, and vault operations
- Module loading via `new Function("ctx", code)` — no import/export
- [Architecture docs](docs/architecture/README.md)

### Companion Server
- WebSocket server for mobile client support
- TLS with self-signed CA certificate chain
- Token authentication with timing-safe comparison
- Claude CLI process management, TTS synthesis, audio transcription
- Auto-start via macOS LaunchAgent
- [Server docs](docs/server/README.md) | [Security docs](docs/security/README.md)

## Configuration

Four-file config cascade — only override what you need:

```
config.example.json     (defaults, tracked)
  → config.json         (personal overrides, gitignored)
    → config.local.json (credentials, gitignored)
      → platform overrides
```

Key customization areas:
- **15 theme colors** — full UI theming
- **Layout array** — widget order, grouping, column counts
- **Projects** — auto-scan or manual project list
- **Voice** — TTS engine, model, personality prompt
- **Performance** — polling intervals, animation toggle

[Full config reference](docs/customizations/README.md)

## Documentation

Complete documentation is in the [`docs/`](docs/README.md) folder:

| Section | Description |
|---|---|
| [Setup Guide](docs/setup/README.md) | Installation for all platforms |
| [Architecture](docs/architecture/README.md) | Module system, ctx object, patterns |
| [API Reference](docs/api/README.md) | WebSocket protocol, Tauri commands |
| [Security](docs/security/README.md) | TLS, tokens, rate limiting |
| [Certificates](docs/certificates/README.md) | Certificate creation & iOS installation |
| [Companion Server](docs/server/README.md) | Server setup & LaunchAgent |
| [Customization](docs/customizations/README.md) | Every config key documented |
| [TTS](docs/text-to-speech/README.md) / [STT](docs/speech-to-text/README.md) / [Voice Models](docs/voice-models/README.md) | Voice system |
| [Widgets](docs/widgets/README.md) | All 13 widgets + creating custom ones |
| [Troubleshooting](docs/troubleshooting/README.md) | Solutions by category |

## Project Structure

```
src/                    Shared source (core, services, widgets)
shared/                 Cross-platform loader and adapters
companion/              WebSocket server for mobile support
ios/                    iOS SwiftUI app
macos/                  macOS Tauri 2.0 app
docs/                   Documentation
```

[Full annotated tree](docs/architecture/project-structure.md)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Follow the [module contract](docs/architecture/README.md#module-contract) — no import/export, all state via `ctx`
4. Test in at least one platform (Obsidian is easiest)
5. Submit a pull request

## License

MIT
