// Tasks tab — the ranked queue grouped by project, with a project filter and one Execute button per row.
import { taskRows } from "../models.js";
import { el, badge, storage, projectDot } from "../dom.js";

const FILTER_KEY = "jarvis.tasks.filter";

export function renderTasks(container, ctx) {
  const { state } = ctx;
  const projects = state.projects || [];
  let filter = storage.get(FILTER_KEY, "") || "";
  if (filter && !projects.some(p => p.name === filter)) filter = "";

  const total = (state.queue || []).length;
  const subtitle = total === 0 ? "All clear" : total === 1 ? "1 thing waits on you" : `${total} things wait on you`;

  const head = el("div", { class: "view-head" },
    el("div", {}, el("h1", { class: "view-title", text: "Tasks" }), el("p", { class: "view-sub", text: subtitle })),
    projects.length > 1 ? el("div", { class: "chips", attrs: { role: "group", "aria-label": "Project filter" } },
      chip("All", "", filter, ctx, projects),
      projects.map(p => chip(p.label || p.name, p.name, filter, ctx, projects, p.color))) : null);
  container.append(head);

  for (const err of state.errors || []) {
    container.append(el("div", { class: "notice notice-warn", text: err }));
  }

  const groups = taskRows(state, filter || undefined);
  if (!groups.length) {
    container.append(el("div", { class: "empty" },
      el("div", { class: "empty-title", text: total === 0 ? "Nothing waits on you" : "Nothing in this project" }),
      el("div", { class: "empty-text", text: total === 0 ? "Every registered project is clear." : "Pick another project or All." })));
    return;
  }

  for (const group of groups) {
    const section = el("section", { class: "group" },
      el("h2", { class: "group-head" }, projectDot(group.color),
        el("span", { class: "group-label", text: group.label }),
        el("span", { class: "group-count", text: String(group.rows.length) })),
      el("div", { class: "rows" }, group.rows.map(row => taskRow(row, group, ctx))));
    container.append(section);
  }
}

function chip(label, value, current, ctx, projects, color) {
  return el("button", { class: `chip${current === value ? " active" : ""}`, type: "button",
    attrs: { "aria-pressed": current === value ? "true" : "false" },
    onclick: () => { storage.set(FILTER_KEY, value); ctx.navigate("#tasks"); } },
    color ? projectDot(color) : null, label);
}

export function taskRow(row, group, ctx) {
  const live = row.badge && ["running", "waiting", "stalled"].includes(row.runStatus);
  const button = el("button", { class: `btn ${live ? "btn-ghost" : "btn-primary"}`, type: "button",
    text: row.buttonLabel, disabled: !!row.disabledReason,
    title: row.disabledReason || (live ? "Open the live run" : `Run ${row.buttonLabel}`),
    onclick: () => live ? ctx.openRun(row.runId) : ctx.execute(group.project, row.id) });

  const side = el("div", { class: "row-side" });
  if (row.badge) {
    const b = badge(row.runStatus);
    if (row.runId) {
      side.append(el("button", { class: "badge-btn", type: "button", title: "Open this run",
        onclick: () => ctx.openRun(row.runId) }, b));
    } else side.append(b);
  }
  side.append(button);

  return el("article", { class: `task-row u-${row.urgency}`, dataset: { id: row.id, project: group.project } },
    el("span", { class: `pip pip-${row.urgency}`, title: `${row.urgency} urgency`, attrs: { "aria-label": `${row.urgency} urgency` } }),
    el("div", { class: "row-main" },
      el("div", { class: "row-title", text: row.title }),
      el("div", { class: "row-meta" },
        el("span", { class: `kind kind-${row.kind}`, text: row.kindLabel }),
        el("span", { class: "meta-sep", text: "·" }),
        el("span", { text: row.ageText }),
        row.urgency === "high" ? el("span", { class: "meta-urgent", text: "urgent" }) : null)),
    side,
    row.disabledReason ? el("span", { class: "row-reason", text: row.disabledReason }) : null);
}
