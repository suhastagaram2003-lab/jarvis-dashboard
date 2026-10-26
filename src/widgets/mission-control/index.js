// Mission Control Widget — Orchestrator
// Each project's `links` from its export (artifacts, reports, the vault), grouped per project.
// A click opens the link with os-compat.open.
// Returns: HTMLElement

const { el, T, config, isNarrow, createSectionTitle, hubStore, osCompat } = ctx;

function loadSub(rel) {
  const code = ctx.nodeFs.readFileSync(
    ctx.nodePath.join(ctx._srcDir, "widgets", "mission-control", rel), "utf8"
  );
  return new Function("ctx", code)(ctx);
}

const { createNavButton } = loadSub("ui/nav-button.js");

const section = el("div", {
  position: "relative",
  zIndex: "2",
});

// Title
section.appendChild(createSectionTitle("Mission Control", { marginBottom: "20px" }));

const body = el("div");
section.appendChild(body);

function render() {
  const groups = hubStore.linkGroups(ctx.hub.projects);
  body.textContent = "";
  if (groups.length === 0) {
    body.appendChild(el("div", { fontSize: "13px", color: T.textMuted }, "No links yet"));
    return;
  }
  let idx = 0;
  for (const g of groups) {
    body.appendChild(el("div", {
      fontSize: "10px", fontWeight: "700", letterSpacing: "1.5px", textTransform: "uppercase",
      color: g.color || T.accent, margin: "4px 0 10px",
    }, g.project));
    const grid = el("div", {
      display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "repeat(auto-fill, minmax(220px, 1fr))",
      gap: "12px", marginBottom: "16px",
    });
    body.appendChild(grid);
    for (const l of g.links) {
      const navBtn = createNavButton({
        name: l.label, color: g.color || T.accent, icon: "\u203a", subtitle: l.url,
        onClick: () => osCompat.open(l.url),
      }, idx++);
      navBtn.el.btn.title = l.url;
      grid.appendChild(navBtn.el.btn);
    }
  }
}

render();
ctx.onHubUpdate.push(render);

return section;
