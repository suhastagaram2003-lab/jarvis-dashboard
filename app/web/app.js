// App — the shell: tab bar, hash router, state polling and the run panel. Views render into #tab.
import * as api from "./api.js";
import { tabList } from "./models.js";
import { el, clear, clock } from "./dom.js";
import { renderTasks } from "./views/tasks.js";
import { renderProject } from "./views/project.js";
import { renderChat } from "./views/chat.js";
import { renderRuns } from "./views/runs.js";
import { createRunPanel } from "./views/run-panel.js";

const POLL_MS = 10000;
const VIEWS = { tasks: renderTasks, project: renderProject, chat: renderChat, runs: renderRuns };

const app = {
  state: null, stateKey: "", stateError: null, updatedAt: null,
  tab: { view: "tasks", arg: null }, runs: [], pollTimer: null, refetchTimer: null,
};

const $tabs = document.getElementById("tabs");
const $right = document.getElementById("topbar-right");
const $tab = document.getElementById("tab");
const $shell = document.getElementById("shell");
const $toasts = document.getElementById("toasts");

// ── Hash routing: #tasks, #project/<name>, #chat, #runs keep a tab; #run/<id> opens a run over the current tab ──
function parseHash(hash) {
  const s = String(hash || "").replace(/^#\/?/, "");
  if (!s || s === "tasks") return { view: "tasks", arg: null };
  if (s === "chat" || s === "runs") return { view: s, arg: null };
  let m = /^project\/(.+)$/.exec(s);
  if (m) { try { return { view: "project", arg: decodeURIComponent(m[1]) }; } catch { return { view: "tasks", arg: null }; } }
  m = /^run\/([\w.-]+)$/.exec(s);
  if (m) return { view: "run", arg: m[1] };
  return { view: "tasks", arg: null };
}

const tabHash = (t = app.tab) => t.view === "project" ? `#project/${encodeURIComponent(t.arg)}` : `#${t.view}`;
const tabId = (t = app.tab) => t.view === "project" ? `project:${t.arg}` : t.view;

function navigate(hash) {
  if (location.hash === hash) onHash(); else location.hash = hash;
}

function openRun(id) {
  navigate(`#run/${id}`);
}

function closeRun() {
  panel.close();
  if (parseHash(location.hash).view === "run") history.replaceState(null, "", tabHash());
  render();
}

function onHash() {
  const route = parseHash(location.hash);
  if (route.view === "run") {
    panel.open(route.arg);
    $shell.classList.add("panel-open");
  } else {
    app.tab = route;
    panel.close();
    $shell.classList.remove("panel-open");
    if (route.view === "runs") loadRuns();
  }
  render();
}

// ── Toasts ──
function toast(text, tone = "info") {
  const node = el("div", { class: `toast toast-${tone}`, text, attrs: { role: "status" } });
  $toasts.append(node);
  setTimeout(() => node.classList.add("toast-out"), 3600);
  setTimeout(() => node.remove(), 4000);
}

// ── State ──
async function loadState() {
  try {
    const state = await api.getState();
    app.stateError = null;
    app.updatedAt = new Date();
    const { generated_at, ...rest } = state;
    const key = JSON.stringify(rest);
    const changed = key !== app.stateKey;
    app.state = state;
    app.stateKey = key;
    if (changed) render(); else renderRight();
  } catch (e) {
    app.stateError = e.message || "cannot reach the server";
    renderRight();
    if (!app.state) render();
  }
}

async function loadRuns() {
  try { app.runs = await api.getRuns(); } catch { /* keep the old list */ }
  if (app.tab.view === "runs") render();
}

// After every run status change: fresh state (the badges) and the run list, a moment later so the index is written.
function refetchSoon() {
  clearTimeout(app.refetchTimer);
  app.refetchTimer = setTimeout(() => { loadState(); loadRuns(); }, 250);
}

// ── Rendering ──
function renderTabs() {
  clear($tabs);
  const active = tabId();
  for (const t of tabList(app.state)) {
    const hash = t.id.startsWith("project:") ? `#project/${encodeURIComponent(t.id.slice(8))}` : `#${t.id}`;
    const a = el("a", { class: `tab-link${t.id === active ? " active" : ""}`, href: hash,
      attrs: { "aria-current": t.id === active ? "page" : undefined } },
      t.color ? el("span", { class: "project-dot small", style: { "--project-color": t.color } }) : null,
      el("span", { class: "tab-label", text: t.label }),
      t.count ? el("span", { class: "tab-count", text: String(t.count) }) : null);
    if (t.status === "error") a.classList.add("tab-error");
    $tabs.append(a);
  }
}

function renderRight() {
  clear($right);
  if (app.stateError) {
    $right.append(el("span", { class: "status-chip status-error", text: "offline", title: app.stateError }));
  } else if (app.updatedAt) {
    $right.append(el("span", { class: "status-chip", text: `updated ${clock(app.updatedAt)}` }));
  }
  $right.append(el("button", { class: "icon-btn", text: "↻", title: "Refresh now", attrs: { "aria-label": "Refresh now" },
    onclick: () => { loadState(); loadRuns(); } }));
}

function render() {
  renderTabs();
  renderRight();
  clear($tab);
  if (!app.state) {
    $tab.append(el("div", { class: "empty" },
      el("div", { class: "empty-title", text: app.stateError ? "Cannot reach Jarvis" : "Loading…" }),
      app.stateError ? el("div", { class: "empty-text", text: app.stateError }) : null));
    return;
  }
  const view = VIEWS[app.tab.view];
  if (!view) {
    $tab.append(el("div", { class: "empty" }, el("div", { class: "empty-title", text: "Not available yet" })));
    return;
  }
  view($tab, ctx());
}

function ctx() {
  return {
    state: app.state, runs: app.runs, arg: app.tab.arg, api, toast, openRun, closeRun, navigate, render, loadState,
    loadRuns, panel,
    async execute(project, id) {
      try {
        const run = await api.execute(project, id);
        openRun(run.id);
        refetchSoon();
      } catch (e) {
        toast(e.message, "error");
        if (e.status === 404) loadState();
      }
    },
  };
}

const panel = createRunPanel(document.getElementById("panel"), {
  onClose: closeRun,
  onSummary: refetchSoon,
  toast,
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && panel.isOpen()) closeRun();
});

window.addEventListener("hashchange", onHash);
window.addEventListener("focus", () => loadState());

onHash();
loadState();
loadRuns();
app.pollTimer = setInterval(loadState, POLL_MS);
