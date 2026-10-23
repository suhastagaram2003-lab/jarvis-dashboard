// Metrics Widget
// Every project's `metrics` as tiles: value, label, trend arrow, project chip; `help` is the tooltip.
// Returns: HTMLElement

const { el, T, isNarrow, createSectionTitle, hubStore } = ctx;

const TREND = { up: { sign: "▲", color: T.green }, down: { sign: "▼", color: T.red }, flat: { sign: "◆", color: T.textMuted } };

const section = el("div", { position: "relative", zIndex: "2", marginBottom: isNarrow ? "24px" : "40px" });
const titleSlot = el("div");
section.appendChild(titleSlot);
const grid = el("div", {
  display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: isNarrow ? "10px" : "14px",
});
section.appendChild(grid);

function tile(m) {
  const color = m.color || T.accent;
  const trend = TREND[m.trend] || TREND.flat;
  const t = el("div", {
    background: T.panelBg, border: `1px solid ${T.panelBorder}`, borderRadius: "10px", padding: "12px 14px",
    position: "relative", overflow: "hidden", minWidth: "0",
  });
  t.appendChild(el("div", {
    position: "absolute", top: "0", left: "0", right: "0", height: "2px",
    background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
  }));
  if (m.help) t.title = m.help;
  const top = el("div", { display: "flex", alignItems: "baseline", gap: "6px" });
  t.appendChild(top);
  top.appendChild(el("span", { fontSize: isNarrow ? "18px" : "22px", fontWeight: "700", color: T.text }, m.value));
  top.appendChild(el("span", { fontSize: "11px", color: trend.color }, trend.sign));
  t.appendChild(el("div", { fontSize: "11px", color: T.textMuted, marginTop: "4px" }, m.label));
  t.appendChild(el("div", {
    fontSize: "9px", fontWeight: "700", letterSpacing: "1px", textTransform: "uppercase", color, marginTop: "6px",
  }, m.project));
  return t;
}

function render() {
  const tiles = hubStore.metricTiles(ctx.hub.projects);
  titleSlot.textContent = "";
  grid.textContent = "";
  titleSlot.appendChild(createSectionTitle("Metrics", { marginBottom: "16px", color: T.green }));
  if (tiles.length === 0) {
    grid.appendChild(el("div", { fontSize: "13px", color: T.textMuted }, "No metrics yet"));
    return;
  }
  tiles.forEach(m => grid.appendChild(tile(m)));
}

render();
ctx.onHubUpdate.push(render);

return section;
