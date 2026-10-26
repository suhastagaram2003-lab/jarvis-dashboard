// Recent Activity Widget — Orchestrator
// Recently changed notes across the registered projects' vaults (each entry's recent_dirs, src/hub/recent.js).
// A click opens the note in that project's Obsidian vault.
// Returns: HTMLElement

const { el, T, config, isNarrow, createSectionTitle, osCompat } = ctx;
const actCfg = config.widgets?.recentActivity || {};
const count = actCfg.count || 10;
const RESCAN_MS = 5 * 60 * 1000;
const recent = new Function("ctx", ctx.nodeFs.readFileSync(ctx.nodePath.join(ctx._srcDir, "hub", "recent.js"), "utf8"))(ctx);

function timeAgo(ms) {
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function createRow(r, isLast) {
  const color = r.color || T.green;
  const row = el("div", {
    display: "flex", alignItems: "center", gap: "12px",
    padding: isNarrow ? "10px 14px" : "12px 24px",
    borderBottom: isLast ? "none" : `1px solid ${T.panelBorder}`,
    cursor: "pointer", transition: "background 0.2s",
  });
  row.title = r.rel;
  row.addEventListener("mouseenter", () => { row.style.background = T.hoverBg; });
  row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
  row.addEventListener("click", () => osCompat.open(r.link));
  row.appendChild(el("span", { fontSize: "14px", color, flexShrink: "0" }, "\u25c8"));
  row.appendChild(el("span", {
    fontSize: isNarrow ? "12px" : "13px", color: T.text, fontWeight: "500", flex: "1", minWidth: "0",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  }, r.title));
  row.appendChild(el("span", {
    fontSize: "9px", fontWeight: "700", letterSpacing: "1px", textTransform: "uppercase",
    color, background: color + "14", border: `1px solid ${color}33`,
    padding: "2px 7px", borderRadius: "8px", whiteSpace: "nowrap", flexShrink: "0",
  }, r.project));
  row.appendChild(el("span", { fontSize: "11px", color: T.textDim, whiteSpace: "nowrap", flexShrink: "0" }, timeAgo(r.mtime)));
  return row;
}

const section = el("div", {
  position: "relative",
  zIndex: "2",
  marginBottom: isNarrow ? "24px" : "40px",
});

// Title
section.appendChild(createSectionTitle("Recent Activity", { color: T.green }));

// Panel
const panel = el("div", {
  background: T.panelBg, border: `1px solid ${T.panelBorder}`,
  borderRadius: "12px", overflow: "hidden",
  position: "relative",
  animation: "jarvisCardFadeIn 0.5s ease-out 0.5s both",
});
section.appendChild(panel);

panel.appendChild(el("div", {
  position: "absolute", top: "0", left: "0", right: "0", height: "2px",
  background: `linear-gradient(90deg, transparent, ${T.green}, transparent)`,
}));

const list = el("div");
panel.appendChild(list);

let lastScan = 0;
function render(force) {
  if (!force && Date.now() - lastScan < RESCAN_MS) return;
  lastScan = Date.now();
  let rows = [];
  try {
    rows = recent.recentFiles(ctx.nodeFs, ctx.nodePath, (ctx.hub?.projects || []).map(p => p.entry), count);
  } catch {}
  list.textContent = "";
  if (rows.length === 0) {
    list.appendChild(el("div", {
      padding: "20px 24px", fontSize: "12px", color: T.textDim, letterSpacing: "0.5px",
    }, "No recent activity found."));
    return;
  }
  rows.forEach((r, idx) => list.appendChild(createRow(r, idx === rows.length - 1)));
}

// Populate after the first paint, then on hub updates at most every 5 minutes
setTimeout(() => render(true), 150);
ctx.onHubUpdate.push(() => render(false));

return section;
