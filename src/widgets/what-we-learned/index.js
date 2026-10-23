// What We Learned Widget
// Every project's `learning` feed, newest first: date, kind chip, title and citation.
// A row with a link opens it (an obsidian:// page in that project's vault) with os-compat.open.
// Returns: HTMLElement

const { el, T, isNarrow, createSectionTitle, hubStore, osCompat } = ctx;

const KIND_LABEL = { "lesson": "lesson", "strategy-update": "strategy", "tune": "tune" };

const section = el("div", { position: "relative", zIndex: "2", marginBottom: isNarrow ? "24px" : "40px" });
const titleSlot = el("div");
section.appendChild(titleSlot);
const panel = el("div", {
  background: T.panelBg, border: `1px solid ${T.panelBorder}`, borderRadius: "12px",
  padding: isNarrow ? "6px 12px" : "6px 18px",
});
section.appendChild(panel);

function chip(text, color) {
  return el("span", {
    fontSize: "9px", fontWeight: "700", letterSpacing: "1px", textTransform: "uppercase",
    color, background: color + "14", border: `1px solid ${color}33`,
    padding: "2px 7px", borderRadius: "8px", whiteSpace: "nowrap", flexShrink: "0",
  }, text);
}

function row(item, isLast) {
  const color = item.color || T.accent;
  const r = el("div", {
    display: "flex", alignItems: "center", gap: "10px", padding: "10px 0", flexWrap: isNarrow ? "wrap" : "nowrap",
    borderBottom: isLast ? "none" : `1px solid ${T.panelBorder}`, cursor: item.link ? "pointer" : "default",
  });
  r.appendChild(el("span", { fontSize: "11px", color: T.textMuted, whiteSpace: "nowrap", flexShrink: "0" }, item.date));
  r.appendChild(chip(item.project, color));
  r.appendChild(chip(KIND_LABEL[item.kind] || item.kind, T.purple));
  r.appendChild(el("span", {
    flex: "1", minWidth: "0", fontSize: "13px", color: T.text,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isNarrow ? "normal" : "nowrap",
  }, item.title));
  if (item.citation) {
    r.appendChild(el("span", {
      fontSize: "11px", color: T.textDim, whiteSpace: "nowrap", flexShrink: "0",
      fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
    }, item.citation));
  }
  if (item.link) {
    r.title = "Open " + item.link;
    r.addEventListener("click", () => osCompat.open(item.link));
  }
  return r;
}

function render() {
  const rows = hubStore.learningFeed(ctx.hub.projects);
  titleSlot.textContent = "";
  panel.textContent = "";
  titleSlot.appendChild(createSectionTitle("What We Learned", { marginBottom: "16px", color: T.purple }));
  if (rows.length === 0) {
    panel.appendChild(el("div", { padding: "12px 0", fontSize: "13px", color: T.textMuted }, "Nothing new in 14 days"));
    return;
  }
  rows.forEach((item, i) => panel.appendChild(row(item, i === rows.length - 1)));
}

render();
ctx.onHubUpdate.push(render);

return section;
