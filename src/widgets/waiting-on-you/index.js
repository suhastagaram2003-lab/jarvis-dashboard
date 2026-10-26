// Waiting On You Widget
// Every project's queue, oldest first. Each row: project chip, title, age and an action button whose tooltip is
// the command; a click opens a new Windows Terminal tab in the project folder running it.
// Returns: HTMLElement

const { el, T, isNarrow, createSectionTitle, osCompat } = ctx;

const KIND_LABEL = { "proposal": "proposal", "failed-run": "failed run", "lint-error": "lint error", "pr": "branch" };

const section = el("div", {
  position: "relative", zIndex: "2",
  marginBottom: isNarrow ? "24px" : "40px",
});
const titleSlot = el("div");
section.appendChild(titleSlot);
const panel = el("div", {
  background: T.panelBg, border: `1px solid ${T.panelBorder}`, borderRadius: "12px",
  padding: isNarrow ? "6px 12px" : "6px 18px",
});
section.appendChild(panel);

function ageLabel(days) {
  if (!days) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

function row(item, isLast) {
  const color = item.color || T.accent;
  const r = el("div", {
    display: "flex", alignItems: "center", gap: "10px", padding: "10px 0",
    borderBottom: isLast ? "none" : `1px solid ${T.panelBorder}`, flexWrap: isNarrow ? "wrap" : "nowrap",
  });
  r.appendChild(el("span", {
    fontSize: "10px", fontWeight: "700", letterSpacing: "1px", textTransform: "uppercase",
    color, background: color + "14", border: `1px solid ${color}33`,
    padding: "2px 8px", borderRadius: "8px", whiteSpace: "nowrap", flexShrink: "0",
  }, item.project));
  r.appendChild(el("span", {
    fontSize: "10px", color: T.textDim, whiteSpace: "nowrap", flexShrink: "0",
  }, KIND_LABEL[item.kind] || item.kind));
  r.appendChild(el("span", {
    flex: "1", minWidth: "0", fontSize: "13px", color: T.text,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isNarrow ? "normal" : "nowrap",
  }, item.title));
  r.appendChild(el("span", {
    fontSize: "11px", color: item.age_days >= 3 ? T.orange : T.textMuted, whiteSpace: "nowrap", flexShrink: "0",
  }, ageLabel(item.age_days)));

  const action = item.action || {};
  if (action.command) {
    const btn = el("button", {
      fontSize: "10px", fontWeight: "600", letterSpacing: "1px", textTransform: "uppercase",
      color, background: "transparent", border: `1px solid ${color}55`, borderRadius: "6px",
      padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: "0",
    }, action.label || "Open");
    btn.title = `Opens a terminal in ${item.path}:\n${action.command}`;
    btn.addEventListener("click", () => osCompat.launch(item.path, action.command));
    r.appendChild(btn);
  }
  return r;
}

function render() {
  const queue = ctx.hub.queue || [];
  titleSlot.textContent = "";
  panel.textContent = "";
  titleSlot.appendChild(createSectionTitle("Waiting On You", {
    marginBottom: "16px",
    color: queue.length ? T.orange : T.accent,
    badge: { text: `${queue.length}`, color: queue.length ? T.orange : T.accent },
  }));
  if (queue.length === 0) {
    panel.appendChild(el("div", { padding: "12px 0", fontSize: "13px", color: T.textMuted }, "Nothing waits on you"));
    return;
  }
  queue.forEach((item, i) => panel.appendChild(row(item, i === queue.length - 1)));
}

render();
ctx.onHubUpdate.push(render);

return section;
