// Status Line — Pulsing dot + status text ("System Online", or the hub's "N things wait on you")
// Returns: { createStatusLine }  →  { el: { row }, update(state), setStatusText(text, isAlert) }

const { el, T, config, animationsEnabled } = ctx;
const dashCfg = config.dashboard || {};

function createStatusLine() {
  const row = el("div", {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    marginBottom: "16px",
  });

  const dot = el("span", {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: T.green,
    display: "inline-block",
    animation: animationsEnabled ? "jarvisPulse 1.5s ease-in-out infinite" : "none",
    willChange: animationsEnabled ? "transform, opacity" : "auto",
  });
  row.appendChild(dot);

  const label = el("span", {
    fontSize: "11px",
    fontWeight: "600",
    letterSpacing: "3px",
    textTransform: "uppercase",
    color: T.green,
  }, dashCfg.statusText || "System Online");
  row.appendChild(label);

  // Text and colour shown in the default (online) state; the header sets it from the hub.
  let defaultText = dashCfg.statusText || "System Online";
  let defaultColor = T.green;

  function update(state) {
    switch (state) {
      case "connected":
        dot.style.background = T.green;
        dot.style.animation = animationsEnabled ? "jarvisPulse 1.5s ease-in-out infinite" : "none";
        label.style.color = T.green;
        label.textContent = "System Online";
        break;
      case "connecting":
        dot.style.background = T.orange || "#f39c12";
        dot.style.animation = animationsEnabled ? "jarvisPulse 1s ease-in-out infinite" : "none";
        label.style.color = T.orange || "#f39c12";
        label.textContent = "Connecting...";
        break;
      case "reconnecting":
        dot.style.background = T.orange || "#f39c12";
        dot.style.animation = animationsEnabled ? "jarvisPulse 0.8s ease-in-out infinite" : "none";
        label.style.color = T.orange || "#f39c12";
        label.textContent = "Reconnecting...";
        break;
      case "disconnected":
        dot.style.background = T.textMuted;
        dot.style.animation = "none";
        label.style.color = T.textMuted;
        label.textContent = "Disconnected";
        break;
      default:
        dot.style.background = defaultColor;
        dot.style.animation = animationsEnabled ? "jarvisPulse 1.5s ease-in-out infinite" : "none";
        label.style.color = defaultColor;
        label.textContent = defaultText;
    }
  }

  function setStatusText(text, isAlert) {
    defaultText = text;
    defaultColor = isAlert ? (T.orange || "#ff6b35") : T.green;
    update("default");
  }

  return { el: { row }, update, setStatusText };
}

return { createStatusLine };
