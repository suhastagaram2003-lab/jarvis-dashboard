// Fix Next Widget
// Every project's `suggestions` (from /tune and lint), ranked: rank, project chip, title and why.
// Returns: HTMLElement

const { el, T, isNarrow, createSectionTitle, hubStore } = ctx;

const section = el("div", { position: "relative", zIndex: "2", marginBottom: isNarrow ? "24px" : "40px" });
const titleSlot = el("div");
section.appendChild(titleSlot);
const panel = el("div", {
  background: T.panelBg, border: `1px solid ${T.panelBorder}`, borderRadius: "12px",
  padding: isNarrow ? "6px 12px" : "6px 18px",
});
section.appendChild(panel);

function row(item, isLast) {
  const color = item.color || T.accent;
  const r = el("div", {
    display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px 0",
    borderBottom: isLast ? "none" : `1px solid ${T.panelBorder}`,
  });
  r.appendChild(el("span", {
    fontSize: "13px", fontWeight: "700", color, minWidth: "20px", flexShrink: "0",
  }, `#${item.rank}`));
  const text = el("div", { flex: "1", minWidth: "0" });
  r.appendChild(text);
  const head = el("div", { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" });
  text.appendChild(head);
  head.appendChild(el("span", {
    fontSize: "9px", fontWeight: "700", letterSpacing: "1px", textTransform: "uppercase",
    color, background: color + "14", border: `1px solid ${color}33`, padding: "2px 7px", borderRadius: "8px",
  }, item.project));
  head.appendChild(el("span", { fontSize: "13px", color: T.text, fontWeight: "600" }, item.title));
  head.appendChild(el("span", { fontSize: "10px", color: T.textDim, textTransform: "uppercase" }, item.source));
  if (item.why) text.appendChild(el("div", { fontSize: "12px", color: T.textMuted, marginTop: "4px" }, item.why));
  return r;
}

function render() {
  const rows = hubStore.suggestionFeed(ctx.hub.projects);
  titleSlot.textContent = "";
  panel.textContent = "";
  titleSlot.appendChild(createSectionTitle("Fix Next", { marginBottom: "16px", color: T.gold }));
  if (rows.length === 0) {
    panel.appendChild(el("div", { padding: "12px 0", fontSize: "13px", color: T.textMuted }, "No suggestions"));
    return;
  }
  rows.forEach((item, i) => panel.appendChild(row(item, i === rows.length - 1)));
}

render();
ctx.onHubUpdate.push(render);

return section;
