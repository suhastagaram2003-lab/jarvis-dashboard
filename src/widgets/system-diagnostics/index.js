// System Diagnostics Widget — Orchestrator
// 4 stat cards (sessions, tokens, est. cost, top model) and one row per registered project
// Returns: HTMLElement

const { el, T, config, isNarrow, fmtTokens, fmtCost, createSectionTitle } = ctx;
const periodDays = config.widgets?.systemDiagnostics?.periodDays || 30;

function loadSub(rel) {
  const code = ctx.nodeFs.readFileSync(
    ctx.nodePath.join(ctx._srcDir, "widgets", "system-diagnostics", rel), "utf8"
  );
  return new Function("ctx", code)(ctx);
}

const { createStatCard } = loadSub("ui/stat-card.js");

const section = el("div", {
  position: "relative",
  zIndex: "2",
  marginBottom: isNarrow ? "24px" : "40px",
});

// Section title
section.appendChild(createSectionTitle("System Diagnostics", {
  badge: {
    text: `${periodDays} DAYS`,
    fontSize: "10px",
    color: T.textMuted,
    bg: "rgba(107,123,141,0.1)",
  },
}));

// Grid
const grid = el("div", {
  display: "grid",
  gridTemplateColumns: isNarrow ? "repeat(2, 1fr)" : "repeat(4, 1fr)",
  gap: isNarrow ? "10px" : "16px",
});
section.appendChild(grid);

const cardDefs = [
  { id: "sessions", icon: "\u25c8", label: "Sessions", color: T.accent },
  { id: "tokens",   icon: "\u25c8", label: "Tokens",   color: T.purple },
  { id: "cost",     icon: "\u25c8", label: "Est. Cost", color: T.gold },
  { id: "model",    icon: "\u25c8", label: "Top Model", color: T.green },
];

const cards = {};
cardDefs.forEach((dc, idx) => {
  const card = createStatCard(dc, idx);
  grid.appendChild(card.el.card);
  cards[dc.id] = card;
});

// Per-project rows (stats.byProject from the hub's per-project scan)
const projectRows = el("div", {
  marginTop: isNarrow ? "10px" : "16px",
  background: T.panelBg, border: `1px solid ${T.panelBorder}`, borderRadius: "12px",
  padding: isNarrow ? "4px 12px" : "4px 18px", display: "none",
});
section.appendChild(projectRows);

function colorFor(label) {
  const p = (ctx.hub?.projects || []).find(x => (x.entry.label || x.entry.name) === label);
  return (p && p.entry.color) || T.accent;
}

function renderProjectRows(byProject) {
  projectRows.textContent = "";
  if (!byProject || byProject.length === 0) { projectRows.style.display = "none"; return; }
  projectRows.style.display = "block";
  byProject.forEach((p, i) => {
    const row = el("div", {
      display: "grid", gridTemplateColumns: isNarrow ? "1.4fr 1fr 1fr 1fr" : "2fr 1fr 1fr 1fr", gap: "8px",
      alignItems: "center", padding: "9px 0", fontSize: "12px",
      borderBottom: i === byProject.length - 1 ? "none" : `1px solid ${T.panelBorder}`,
    });
    row.appendChild(el("span", { color: colorFor(p.project), fontWeight: "700", letterSpacing: "1px",
      textTransform: "uppercase", fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, p.project));
    row.appendChild(el("span", { color: T.text }, `${p.sessions} sessions`));
    row.appendChild(el("span", { color: T.textMuted }, `${fmtTokens(p.tokens)} tokens`));
    row.appendChild(el("span", { color: T.textMuted }, fmtCost(p.cost)));
    projectRows.appendChild(row);
  });
}

// Register stats callback
ctx.onStatsReady.push(function(stats) {
  renderProjectRows(stats.byProject);
  cards.sessions.setValue(String(stats.totalSessions));
  cards.sessions.setSubText(`${stats.totalMessages} messages`);
  cards.tokens.setValue(fmtTokens(stats.totalTokens));
  cards.tokens.setSubText(`${stats.totalToolCalls} tool calls`);
  cards.cost.setValue(fmtCost(stats.totalCost));
  cards.cost.setSubText("input + output tokens");
  cards.model.setValue(stats.favoriteModel.toUpperCase());
  cards.model.setSubText(`${stats.favPct}% of sessions`);
});

// Store grid ref for responsive resize
ctx._diagGrid = grid;

return section;
