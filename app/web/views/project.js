// Project tab — one project's health, agents, queue, lessons, suggestions, metrics, recent pages and links,
// with Refresh (its export command, run as a run) and Quick Capture (a note into ~/.jarvis/inbox).
import { projectSections } from "../models.js";
import { el, link, projectDot } from "../dom.js";
import { taskRow } from "./tasks.js";

const drafts = new Map(); // project name -> unsent capture text, kept across re-renders

export function renderProject(container, ctx) {
  const name = ctx.arg;
  const project = (ctx.state.projects || []).find(p => p.name === name);
  if (!project) {
    container.append(el("div", { class: "empty" },
      el("div", { class: "empty-title", text: `No project ${name}` }),
      el("div", { class: "empty-text", text: "It is not in ~/.jarvis/registry.json." })));
    return;
  }
  const card = project.card || {};
  const sub = project.status === "error" ? (project.reason || "not loaded")
    : [card.ageText ? `export ${card.ageText}` : "", project.status === "stale" ? "stale" : "",
      card.queueCount ? `${card.queueCount} waiting` : "all clear"].filter(Boolean).join(" · ");

  const refresh = el("button", { class: "btn", type: "button", text: "Refresh", title: "Run this project's export again",
    onclick: async () => {
      refresh.disabled = true;
      try { const run = await ctx.api.refresh(project.name); ctx.openRun(run.id); ctx.toast("Refresh started", "ok"); }
      catch (e) { ctx.toast(e.message, "error"); }
      finally { refresh.disabled = false; }
    } });

  container.append(el("div", { class: "view-head" },
    el("div", { class: "view-title-row" }, projectDot(project.color),
      el("div", {}, el("h1", { class: "view-title", text: project.label || project.name }),
        el("p", { class: `view-sub${project.status === "error" ? " tone-warn" : ""}`, text: sub }))),
    el("div", { class: "view-actions" }, refresh)));

  const grid = el("div", { class: "cards" });
  for (const section of projectSections(project)) grid.append(sectionCard(section, project, ctx));
  grid.append(captureCard(project, ctx));
  container.append(grid);
}

function sectionCard(section, project, ctx) {
  const body = el("div", { class: `card-body card-${section.key}` });
  if (!section.items.length) body.append(el("div", { class: "card-empty", text: section.empty || "Nothing here." }));
  else if (section.key === "health") body.append(el("div", { class: "stats" }, section.items.map(statTile)));
  else if (section.key === "metrics") body.append(el("div", { class: "stats" }, section.items.map(metricTile)));
  else if (section.key === "waiting") body.append(el("div", { class: "rows" },
    section.items.map(i => taskRow(i.row, { project: i.project || project.name }, ctx))));
  else if (section.key === "error") body.append(el("div", { class: "notice notice-warn", text: section.items[0].text }));
  else body.append(el("ul", { class: "list" }, section.items.map(i => listItem(section.key, i))));
  const wide = section.key === "waiting" || section.key === "health";
  return el("section", { class: `card${wide ? " card-wide" : ""}` },
    el("h2", { class: "card-title" }, section.title,
      section.items.length && section.key !== "health" ? el("span", { class: "card-count", text: String(section.items.length) }) : null),
    body);
}

function statTile(item) {
  return el("div", { class: `stat tone-${item.tone || "ok"}` },
    el("div", { class: "stat-value", text: item.value }),
    el("div", { class: "stat-label", text: item.title }));
}

function metricTile(item) {
  const arrow = item.trend === "up" ? "↗" : item.trend === "down" ? "↘" : "→";
  return el("div", { class: `stat trend-${item.trend || "flat"}`, title: item.text || "" },
    el("div", { class: "stat-value" }, item.value, el("span", { class: "stat-trend", text: arrow })),
    el("div", { class: "stat-label", text: item.title }),
    item.text ? el("div", { class: "stat-help", text: item.text }) : null);
}

function listItem(key, item) {
  const title = item.link ? link(item.title, item.link, "list-title") : el("span", { class: "list-title", text: item.title });
  return el("li", { class: `list-item${item.status ? " has-status" : ""}` },
    item.status ? el("span", { class: `dot dot-${item.status}`, title: item.status }) : null,
    el("div", { class: "list-main" },
      title,
      item.text ? el("div", { class: "list-text", text: item.text }) : null,
      item.meta ? el("div", { class: "list-meta", text: item.meta }) : null));
}

function captureCard(project, ctx) {
  const box = el("textarea", { class: "textbox capture-input", rows: 3,
    placeholder: `A thought for ${project.label || project.name}… saved to ~/.jarvis/inbox`,
    value: drafts.get(project.name) || "" });
  box.addEventListener("input", () => drafts.set(project.name, box.value));
  const save = el("button", { class: "btn btn-primary capture-save", type: "button", text: "Save to inbox",
    onclick: async () => {
      const text = box.value.trim();
      if (!text) return;
      save.disabled = true;
      try {
        const r = await ctx.api.capture(project.name, text);
        drafts.delete(project.name);
        box.value = "";
        ctx.toast(`Saved ${r.path}`, "ok");
      } catch (e) { ctx.toast(e.message, "error"); }
      finally { save.disabled = false; }
    } });
  box.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); save.click(); }
  });
  return el("section", { class: "card" },
    el("h2", { class: "card-title", text: "Quick capture" }),
    el("div", { class: "card-body capture" }, box,
      el("div", { class: "capture-foot" }, el("span", { class: "hint", text: "Ctrl+Enter saves" }), save)));
}
