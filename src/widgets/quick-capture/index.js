// Quick Capture Widget — Orchestrator
// Pick a project, write a note or paste a link: saved as a dated Markdown file in the hub-owned inbox
// ~/.jarvis/inbox/<project>/ (src/hub/capture.js). Each project's nightly imports its own folder; the hub never
// writes into a project. The mic stays hidden until the voice phase.
// Returns: HTMLElement

const { el, T, isNarrow, nodeFs, nodePath, addHoverEffect } = ctx;
const inboxRoot = nodePath.join(ctx.hub.jarvisHome, "inbox");

function loadSub(rel) {
  const code = nodeFs.readFileSync(
    nodePath.join(ctx._srcDir, "widgets", "quick-capture", rel), "utf8"
  );
  return new Function("ctx", code)(ctx);
}

const { createCaptureInput } = loadSub("ui/capture-input.js");
const capture = new Function("ctx", nodeFs.readFileSync(nodePath.join(ctx._srcDir, "hub", "capture.js"), "utf8"))(ctx);

const section = el("div", {
  background: T.panelBg, border: `1px solid ${T.panelBorder}`,
  borderRadius: "12px", padding: isNarrow ? "16px 14px" : "20px 24px",
  position: "relative", overflow: "hidden",
  animation: "jarvisCardFadeIn 0.5s ease-out 0.35s both",
  display: "flex", flexDirection: "column",
});

section.appendChild(el("div", {
  position: "absolute", top: "0", left: "0", right: "0", height: "2px",
  background: `linear-gradient(90deg, transparent, ${T.purple}, transparent)`,
}));

// Title with count
const titleRow = el("div", {
  fontSize: "11px", fontWeight: "700", letterSpacing: "2px",
  textTransform: "uppercase", color: T.textMuted,
  marginBottom: "14px", marginTop: "4px",
  display: "flex", alignItems: "center", justifyContent: "space-between",
});
titleRow.appendChild(el("span", {}, "Quick Capture"));

const badge = el("span", {
  fontSize: "9px", fontWeight: "600", color: T.purple,
  background: "rgba(124,107,255,0.1)",
  padding: "2px 8px", borderRadius: "8px", letterSpacing: "1px",
});
titleRow.appendChild(badge);
section.appendChild(titleRow);

// Project picker
const picker = el("select", {
  background: "rgba(0,0,0,0.3)", color: T.text, border: `1px solid ${T.panelBorder}`, borderRadius: "6px",
  padding: "6px 8px", fontSize: "12px", marginBottom: "10px", fontFamily: "inherit",
});
section.appendChild(picker);

function entries() {
  return (ctx.hub.projects || []).map(p => p.entry);
}
function selected() {
  return entries().find(e => e.name === picker.value) || entries()[0] || null;
}
function updateBadge() {
  const e = selected();
  badge.textContent = e ? `${capture.inboxCount(nodeFs, inboxRoot, e.name)} IN ${(e.label || e.name).toUpperCase()} INBOX` : "NO PROJECTS";
}
function renderPicker() {
  const current = picker.value;
  picker.textContent = "";
  for (const e of entries()) {
    const opt = document.createElement("option");
    opt.value = e.name;
    opt.textContent = e.label || e.name;
    picker.appendChild(opt);
  }
  if (current && entries().some(e => e.name === current)) picker.value = current;
  else if (entries()[0]) picker.value = entries()[0].name;
  updateBadge();
}
picker.addEventListener("change", updateBadge);
renderPicker();
ctx.onHubUpdate.push(renderPicker);

// Textarea
const captureInput = createCaptureInput("Capture a thought or paste a link...");
section.appendChild(captureInput.el.input);

// Button row
const buttonRow = el("div", {
  display: "flex", gap: "8px", marginTop: "12px", alignItems: "stretch",
});
section.appendChild(buttonRow);

const btn = el("div", {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  gap: "8px", padding: "10px 20px",
  border: `1px solid ${T.purple}55`, borderRadius: "8px",
  background: "rgba(124,107,255,0.06)",
  cursor: "pointer", transition: "all 0.3s ease",
  flex: "1", boxSizing: "border-box",
});
btn.appendChild(el("span", { fontSize: "14px", color: T.purple }, "\u2726"));
btn.appendChild(el("span", {
  fontSize: "11px", fontWeight: "700", letterSpacing: "2px",
  textTransform: "uppercase", color: T.purple,
  fontFamily: "'SF Mono', 'Fira Code', monospace",
}, "Capture"));
buttonRow.appendChild(btn);

addHoverEffect(btn, {
  boxShadow: "0 0 20px rgba(124,107,255,0.3), 0 0 40px rgba(124,107,255,0.1)",
  borderColor: T.purple + "88",
  transform: "scale(1.02)",
  background: "rgba(124,107,255,0.1)",
}, {
  boxShadow: "none",
  borderColor: T.purple + "55",
  transform: "scale(1)",
  background: "rgba(124,107,255,0.06)",
});

btn.addEventListener("click", () => {
  const entry = selected();
  if (!entry) { new Notice("No project to capture to: set up ~/.jarvis/registry.json first."); return; }
  try {
    const file = capture.save(nodeFs, inboxRoot, entry.name, captureInput.getValue(), new Date());
    captureInput.clear();
    updateBadge();
    new Notice(`Captured for ${entry.label || entry.name}: ${nodePath.basename(file)}`);
  } catch (e) {
    new Notice(e.message === "nothing to capture"
      ? "Nothing to capture \u2014 type something first."
      : "Capture failed: " + e.message);
  }
});

return section;
