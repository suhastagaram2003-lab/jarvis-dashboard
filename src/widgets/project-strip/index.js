// Project Strip Widget
// One card per registered project: color, health dot, queue count, export age, reason and a Refresh button.
// Refresh runs the registry's export_command in the project folder (only on a click), then reloads the hub.
// Without ~/.jarvis/registry.json it shows a setup card instead.
// Returns: HTMLElement

const { el, T, isNarrow, createSectionTitle, hubStore, osCompat } = ctx;

const DOT_COLOR = { ok: T.green, warn: T.orange, grey: T.textMuted };
const DOT_TITLE = { ok: "Healthy", warn: "Needs attention: lint errors or a failed or missed run", grey: "No usable export" };
const refreshFailures = new Map(); // project name → { code, timedOut, stderrTail }
const refreshing = new Set();

const section = el("div", {
  position: "relative", zIndex: "2",
  marginBottom: isNarrow ? "24px" : "40px",
});
const titleSlot = el("div");
section.appendChild(titleSlot);
const body = el("div");
section.appendChild(body);

function setupCard(message) {
  const card = el("div", {
    background: T.panelBg, border: `1px dashed ${T.accentDim}`, borderRadius: "12px",
    padding: "18px 20px", color: T.text, fontSize: "13px", lineHeight: "1.6",
  });
  card.appendChild(el("div", { fontWeight: "700", letterSpacing: "1px", marginBottom: "6px", color: T.accent },
    "Set up the hub"));
  card.appendChild(el("div", { color: T.textMuted }, message));
  card.appendChild(el("div", { color: T.textMuted, marginTop: "6px" },
    "Then add each project's export to ~/.jarvis/projects/<name>.json (until an exporter exists, copy "
    + "examples/projects/marketbrain.json there)."));
  return card;
}

function projectCardEl(p) {
  const vm = hubStore.projectCard(p, new Date());
  const color = vm.color || T.accent;
  const name = p.entry.name;
  const card = el("div", {
    background: T.panelBg, border: `1px solid ${T.panelBorder}`, borderRadius: "12px",
    padding: "14px 16px", position: "relative", overflow: "hidden",
    opacity: vm.dot === "grey" ? "0.75" : "1", minWidth: "0",
  });
  card.appendChild(el("div", {
    position: "absolute", top: "0", left: "0", right: "0", height: "2px",
    background: vm.dot === "grey" ? T.textDim : `linear-gradient(90deg, transparent, ${color}, transparent)`,
  }));

  const top = el("div", { display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" });
  card.appendChild(top);
  const dot = el("span", {
    width: "8px", height: "8px", borderRadius: "50%", display: "inline-block", flexShrink: "0",
    background: DOT_COLOR[vm.dot], boxShadow: vm.dot === "grey" ? "none" : `0 0 6px ${DOT_COLOR[vm.dot]}`,
  });
  dot.title = DOT_TITLE[vm.dot];
  top.appendChild(dot);
  top.appendChild(el("span", {
    fontSize: "14px", fontWeight: "700", color: vm.dot === "grey" ? T.textMuted : color, letterSpacing: "1px",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  }, vm.label));

  const stats = el("div", { display: "flex", gap: "12px", fontSize: "11px", color: T.textMuted, flexWrap: "wrap" });
  card.appendChild(stats);
  if (vm.dot !== "grey" || p.status === "stale") {
    stats.appendChild(el("span", {}, vm.queueCount === 1 ? "1 waiting" : `${vm.queueCount} waiting`));
  }
  if (vm.ageText) stats.appendChild(el("span", {}, `exported ${vm.ageText}`));

  if (vm.reason) {
    card.appendChild(el("div", {
      fontSize: "11px", color: p.status === "stale" ? T.orange : T.textMuted, marginTop: "6px",
      wordBreak: "break-word",
    }, vm.reason));
  }

  const fail = refreshFailures.get(name);
  if (fail) {
    card.appendChild(el("div", { fontSize: "11px", color: T.red, marginTop: "6px", fontWeight: "600" },
      fail.timedOut ? "export failed (timed out)" : `export failed (exit ${fail.code})`));
    if (fail.stderrTail) {
      card.appendChild(el("pre", {
        fontSize: "10px", color: T.red, background: "rgba(231,76,60,0.06)", margin: "4px 0 0",
        padding: "6px 8px", borderRadius: "6px", whiteSpace: "pre-wrap", wordBreak: "break-word",
        fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
      }, fail.stderrTail));
    }
  }

  const command = p.entry.export_command;
  if (command) {
    const busy = refreshing.has(name);
    const btn = el("button", {
      marginTop: "10px", fontSize: "10px", fontWeight: "600", letterSpacing: "1px", textTransform: "uppercase",
      color: color, background: "transparent", border: `1px solid ${color}55`, borderRadius: "6px",
      padding: "4px 10px", cursor: busy ? "wait" : "pointer",
    }, busy ? "Refreshing…" : "Refresh");
    btn.title = `Runs in ${p.entry.path}:\n${command}`;
    btn.disabled = busy;
    btn.addEventListener("click", async () => {
      if (refreshing.has(name)) return;
      refreshing.add(name);
      render();
      const r = await osCompat.runCommand(command, p.entry.path, 120000);
      refreshing.delete(name);
      if (r.code === 0 && !r.timedOut) refreshFailures.delete(name);
      else refreshFailures.set(name, { code: r.code, timedOut: r.timedOut, stderrTail: r.stderrTail });
      ctx.hub.reload(); // fires onHubUpdate, which re-renders this strip
      render();
    });
    card.appendChild(btn);
  }
  return card;
}

function render() {
  const hub = ctx.hub;
  titleSlot.textContent = "";
  body.textContent = "";
  titleSlot.appendChild(createSectionTitle("Projects", {
    marginBottom: "16px",
    badge: hub.registryError ? null : { text: `${hub.projects.length} REGISTERED` },
  }));
  if (hub.registryError) {
    body.appendChild(setupCard(hub.registryError));
    return;
  }
  if (hub.projects.length === 0) {
    body.appendChild(setupCard(`The registry at ${hub.jarvisHome} lists no projects yet.`));
    return;
  }
  const grid = el("div", {
    display: "grid",
    gridTemplateColumns: isNarrow ? "1fr" : "repeat(auto-fill, minmax(220px, 1fr))",
    gap: isNarrow ? "10px" : "14px",
  });
  hub.projects.forEach(p => grid.appendChild(projectCardEl(p)));
  body.appendChild(grid);
}

render();
ctx.onHubUpdate.push(render);

return section;
