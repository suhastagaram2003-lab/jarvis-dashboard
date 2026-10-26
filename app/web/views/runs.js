// Runs tab — the run history; a click opens the run in the panel, replayed from its log.
import { runRows } from "../models.js";
import { el, badge } from "../dom.js";

export function renderRuns(container, ctx) {
  const rows = runRows(ctx.runs || []);
  container.append(el("div", { class: "view-head" },
    el("div", {}, el("h1", { class: "view-title", text: "Runs" }),
      el("p", { class: "view-sub", text: rows.length ? `${rows.length} run${rows.length === 1 ? "" : "s"} logged under ~/.jarvis/runs`
        : "Nothing has run yet." }))));
  if (!rows.length) {
    container.append(el("div", { class: "empty" },
      el("div", { class: "empty-title", text: "No runs yet" }),
      el("div", { class: "empty-text", text: "Execute a task or start a chat; every run is logged here." })));
    return;
  }
  const table = el("table", { class: "runs-table" },
    el("thead", {}, el("tr", {}, ["Started", "Project", "Title", "Kind", "Status", "Took"].map(h => el("th", { text: h })))),
    el("tbody", {}, rows.map(r => {
      const tr = el("tr", { class: `run-row${r.live ? " is-live" : ""}`, dataset: { id: r.id }, tabIndex: 0,
        title: r.error ? r.error : `Open ${r.id}`,
        onclick: () => ctx.openRun(r.id),
        onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ctx.openRun(r.id); } } },
        el("td", { class: "mono muted", text: r.startedText }),
        el("td", { text: r.label }),
        el("td", { class: "run-title" }, el("span", { text: r.title }),
          r.error ? el("div", { class: "run-error", text: r.error }) : null),
        el("td", { class: "muted", text: r.kind }),
        el("td", {}, badge(r.status)),
        el("td", { class: "mono muted", text: r.durationText }));
      return tr;
    })));
  container.append(el("div", { class: "table-wrap" }, table));
}
