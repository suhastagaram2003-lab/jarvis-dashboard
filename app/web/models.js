// Models — pure view functions for the web app. No DOM, no window, no fetch: the Node tests import this file.

const LIVE = new Set(["running", "waiting", "stalled"]);
const BADGES = { running: "Running", waiting: "Needs you", done: "Done", failed: "Failed", stopped: "Stopped",
  stalled: "Stalled" };
const KIND_LABELS = { proposal: "Proposal", "failed-run": "Failed run", "lint-error": "Lint", pr: "PR" };

export function isLive(status) {
  return LIVE.has(status);
}

export function badgeFor(status) {
  return BADGES[status] || (status ? String(status) : null);
}

export function kindLabel(kind) {
  return KIND_LABELS[kind] || String(kind || "");
}

export function ageText(days) {
  const n = Number(days) || 0;
  if (n <= 0) return "today";
  return n === 1 ? "1 day" : `${n} days`;
}

// The ranked queue grouped by project; a group's place is the rank of its first item.
export function taskRows(state, filterProject) {
  const groups = [];
  const byProject = new Map();
  for (const item of (state && state.queue) || []) {
    if (filterProject && item.project !== filterProject) continue;
    let group = byProject.get(item.project);
    if (!group) {
      group = { project: item.project, label: item.label || item.project, color: item.color || "",
        groupLabel: item.label || item.project, rows: [] };
      byProject.set(item.project, group);
      groups.push(group);
    }
    const live = item.run && isLive(item.run.status);
    group.rows.push({
      id: item.id, kind: item.kind, kindLabel: kindLabel(item.kind), title: item.title,
      ageText: ageText(item.age_days), urgency: item.urgency || "normal",
      buttonLabel: live ? "Open run" : ((item.action && item.action.label) || "Execute"),
      disabledReason: item.allowed === true || item.allowed === undefined ? null : String(item.allowed),
      badge: item.run ? badgeFor(item.run.status) : null,
      runStatus: item.run ? item.run.status : null,
      runId: item.run ? item.run.id : null,
    });
  }
  for (const g of groups) g.groupLabel = `${g.label} · ${g.rows.length}`;
  return groups;
}

export function tabList(state) {
  const queue = (state && state.queue) || [];
  const projects = (state && state.projects) || [];
  return [
    { id: "tasks", label: "Tasks", count: queue.length },
    ...projects.map(p => ({ id: `project:${p.name}`, label: p.label || p.name, color: p.color || "",
      count: (p.queue || []).length || undefined, status: p.status })),
    { id: "chat", label: "Chat" },
    { id: "runs", label: "Runs" },
  ];
}

function short(value, max = 160) {
  const s = typeof value === "string" ? value : JSON.stringify(value === undefined ? {} : value);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// What a permission ask wants to do, in one line: the command, the file, or the input JSON.
export function askSummary(tool, input) {
  const i = input || {};
  if (typeof i.command === "string") return i.command;
  if (typeof i.file_path === "string") return i.file_path;
  if (typeof i.url === "string") return i.url;
  if (typeof i.pattern === "string") return i.pattern;
  const keys = Object.keys(i);
  return keys.length ? short(i) : "";
}

// The run log as display lines: text deltas joined, one line per tool call, asks kept with their request id.
export function panelLines(events) {
  const lines = [];
  const asks = new Map();
  let text = null;
  const push = (line) => { text = null; lines.push(line); return line; };
  for (const e of events || []) {
    switch (e.type) {
      case "text":
        if (text) text.text += e.text || "";
        else text = push({ kind: "text", text: e.text || "" });
        break;
      case "user":
        push({ kind: "user", text: e.text || "" });
        break;
      case "tool":
        push({ kind: "tool", text: `${e.name || "tool"}  ${toolSummary(e.summary)}`.trimEnd(), tool: e.name });
        break;
      case "permission": {
        const line = push({ kind: "permission", text: askSummary(e.tool, e.input), request_id: e.request_id,
          tool: e.tool, input: e.input || {}, answered: false });
        asks.set(e.request_id, line);
        break;
      }
      case "answer": {
        const ask = asks.get(e.request_id);
        if (ask) { ask.answered = true; ask.allow = !!e.allow; }
        push({ kind: "status", text: `${e.allow ? "Approved" : "Denied"} ${ask ? ask.tool : "the ask"}`,
          tone: e.allow ? "ok" : "warn" });
        break;
      }
      case "stderr":
        push({ kind: "stderr", text: e.text || "" });
        break;
      case "process":
        if (e.resume) push({ kind: "status", text: `Resumed session ${e.resume}`, tone: "muted" });
        break;
      case "result":
        if (e.is_error) push({ kind: "status", text: `Claude reported an error: ${e.text || "no detail"}`, tone: "error" });
        break;
      case "exit":
        if (e.code !== 0 && e.code !== null && e.code !== undefined) {
          push({ kind: "status", text: `Process exited with code ${e.code}`, tone: "error" });
        } else if (e.code === null || e.code === undefined) {
          push({ kind: "status", text: "Process ended", tone: "muted" });
        }
        break;
      default:
        break; // session and unknown events carry nothing to show
    }
  }
  return lines;
}

// A tool's summary is the first 120 chars of its input JSON, so it may be cut: show the raw text when it is.
function toolSummary(summary) {
  if (typeof summary !== "string") return "";
  try { return askSummary("", JSON.parse(summary)); } catch { return summary; }
}

export function openAsks(lines) {
  return lines.filter(l => l.kind === "permission" && !l.answered);
}

// ── Project tab ──
const SECTION_TITLES = ["Health", "Agents and schedules", "Waiting on you", "What it learned", "Fix next", "Metrics",
  "Recent pages", "Links"];

function count(n) {
  return String(Number.isFinite(Number(n)) ? Number(n) : 0);
}

export function projectSections(project) {
  const p = project || {};
  if (p.status === "error" || !p.health) {
    return [{ title: "Not loaded", key: "error", items: [{ text: p.reason || "no export yet" }] }];
  }
  const h = p.health;
  const tone = (n, bad = "warn") => (Number(n) > 0 ? bad : "ok");
  const health = [
    { title: "Lint errors", value: count(h.lint_errors), tone: tone(h.lint_errors, "error") },
    { title: "Lint warnings", value: count(h.lint_warnings), tone: tone(h.lint_warnings) },
    { title: "Stale pages", value: count(h.stale_pages), tone: tone(h.stale_pages) },
    { title: "Unprocessed sources", value: count(h.sources_unprocessed), tone: tone(h.sources_unprocessed) },
  ];
  const agents = (p.agents || []).map(a => ({
    title: a.name, text: a.summary || "", status: a.status, kind: a.kind,
    meta: [a.kind, a.last_run ? `last ${shortTime(a.last_run)}` : "", a.next_run ? `next ${shortTime(a.next_run)}` : ""]
      .filter(Boolean).join(" · "),
    link: a.link || "",
  }));
  const waiting = taskRows({ queue: p.queue || [] }).flatMap(g => g.rows.map(row => ({
    title: row.title, meta: `${row.kindLabel} · ${row.ageText}`, row, project: g.project,
  })));
  const learning = (p.learning || []).map(l => ({
    title: l.title, text: [l.date, l.kind].filter(Boolean).join(" · "), link: l.link || "", citation: l.citation || "",
  }));
  const suggestions = (p.suggestions || []).map(s => ({
    title: `${s.rank}. ${s.title}`, text: s.why || "", meta: s.source ? `from ${s.source}` : "",
  }));
  const metrics = (p.metrics || []).map(m => ({ title: m.label, value: m.value, trend: m.trend, text: m.help || "" }));
  const recent = (p.recent || []).map(r => ({ title: r.title, text: r.rel || "", link: r.link || "" }));
  const links = (p.links || []).map(l => ({ title: l.label, link: l.url }));
  const lists = [health, agents, waiting, learning, suggestions, metrics, recent, links];
  const keys = ["health", "agents", "waiting", "learning", "suggestions", "metrics", "recent", "links"];
  const empty = ["", "No agents or schedules exported.", "Nothing waits on you here.", "Nothing learned yet.",
    "No suggestions.", "No metrics exported.", "No recent pages.", "No links."];
  return SECTION_TITLES.map((title, i) => ({ title, key: keys[i], items: lists[i], empty: empty[i] }));
}

// ── Runs tab ──
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KIND_NAMES = { execute: "Execute", chat: "Chat", refresh: "Refresh" };
const two = (n) => String(n).padStart(2, "0");

export function shortTime(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso || "");
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function durationText(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return `${m}m ${two(r)}s`;
  return `${Math.floor(m / 60)}h ${two(m % 60)}m`;
}

export function kindName(kind) {
  return KIND_NAMES[kind] || String(kind || "");
}

export function runRows(runs, now = new Date()) {
  return [...(runs || [])]
    .sort((a, b) => String(b.started || "").localeCompare(String(a.started || "")))
    .map(r => {
      const live = isLive(r.status);
      const start = Date.parse(r.started);
      const end = live ? now.getTime() : Date.parse(r.ended);
      const ms = Number.isFinite(start) && Number.isFinite(end) ? end - start : NaN;
      return {
        id: r.id, title: r.title || r.id, label: r.label || r.project, project: r.project,
        kind: kindName(r.kind), kindKey: r.kind, status: r.status, badge: badgeFor(r.status),
        startedText: shortTime(r.started), durationText: live ? "running" : (Number.isFinite(ms) ? durationText(ms) : ""),
        error: r.error || "", live,
      };
    });
}
