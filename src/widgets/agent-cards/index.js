// Agent Cards Widget — Orchestrator
// Robot avatars and a status dot from each agent's last run, built from every project's export (ctx.hub)
// Returns: HTMLElement

const { el, T, isNarrow, isWide, agentCardRefs, createSectionTitle, hubStore } = ctx;

function loadSub(rel) {
  const code = ctx.nodeFs.readFileSync(
    ctx.nodePath.join(ctx._srcDir, "widgets", "agent-cards", rel), "utf8"
  );
  return new Function("ctx", code)(ctx);
}

const { createAgentCard } = loadSub("ui/agent-card.js");

const section = el("div", {
  position: "relative",
  zIndex: "2",
  marginBottom: isNarrow ? "24px" : "40px",
});

const titleSlot = el("div");
section.appendChild(titleSlot);

// Grid
const grid = el("div", {
  display: "grid",
  gridTemplateColumns: isNarrow ? "1fr" : (isWide ? "repeat(3, 1fr)" : "1fr"),
  gap: isNarrow ? "12px" : "20px",
});
section.appendChild(grid);

let lastKey = null;
function render() {
  const agents = hubStore.agentCards(ctx.hub.projects);
  const key = JSON.stringify(agents);
  if (key === lastKey) return; // unchanged: keep the cards (and their live "Working" state)
  lastKey = key;
  const attention = agents.filter(a => a.status === "failed" || a.status === "missed").length;
  titleSlot.textContent = "";
  titleSlot.appendChild(createSectionTitle("Agents", {
    marginBottom: "20px",
    badge: attention
      ? { text: `${attention} NEED ATTENTION`, color: T.orange, bg: "rgba(255,107,53,0.1)" }
      : { text: `${agents.length} AGENTS` },
  }));
  grid.textContent = "";
  agentCardRefs.clear();
  if (agents.length === 0) {
    grid.appendChild(el("div", { fontSize: "13px", color: T.textMuted },
      "No agents yet: they come from each project's export."));
    return;
  }
  agents.forEach((agent, idx) => {
    const result = createAgentCard(agent, idx);
    grid.appendChild(result.el.card);
    agentCardRefs.set(agent.name, { ...result.refs, setActive: result.setActive });
  });
}

render();
ctx.onHubUpdate.push(render);

// Store grid ref for responsive resize
ctx._agentsGrid = grid;

return section;
