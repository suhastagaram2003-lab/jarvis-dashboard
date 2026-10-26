// Command Box Widget
// Pick a project, ask a question: runs `claude -p "/ask <question>"` in the project folder with read-only tools
// (src/hub/ask.js), without a shell, and shows the cited answer and the command it ran. "Open full session" opens a
// Windows Terminal tab running `claude` in the project folder.
// Returns: HTMLElement

const { el, T, config, isNarrow, createSectionTitle, osCompat, markdownRenderer } = ctx;
const _require = ctx.require || require;

function loadHub(rel) {
  const code = ctx.nodeFs.readFileSync(ctx.nodePath.join(ctx._srcDir, "hub", rel), "utf8");
  return new Function("ctx", code)(ctx);
}
const ask = loadHub("ask.js");

const section = el("div", { position: "relative", zIndex: "2", marginBottom: isNarrow ? "24px" : "40px" });
section.appendChild(createSectionTitle("Ask", { marginBottom: "16px" }));
const panel = el("div", {
  background: T.panelBg, border: `1px solid ${T.panelBorder}`, borderRadius: "12px", padding: "14px 16px",
});
section.appendChild(panel);

const controls = el("div", { display: "flex", gap: "8px", marginBottom: "10px", flexWrap: "wrap", alignItems: "center" });
panel.appendChild(controls);

const fieldStyle = {
  background: T.bg, color: T.text, border: `1px solid ${T.panelBorder}`, borderRadius: "6px",
  padding: "6px 8px", fontSize: "13px", fontFamily: "inherit",
};
const picker = el("select", { ...fieldStyle });
controls.appendChild(picker);

const askBtn = el("button", {
  fontSize: "11px", fontWeight: "600", letterSpacing: "1px", textTransform: "uppercase",
  color: T.accent, background: "transparent", border: `1px solid ${T.accent}55`, borderRadius: "6px",
  padding: "6px 12px", cursor: "pointer",
}, "Ask");
controls.appendChild(askBtn);

const sessionBtn = el("button", {
  fontSize: "11px", fontWeight: "600", letterSpacing: "1px", textTransform: "uppercase",
  color: T.textMuted, background: "transparent", border: `1px solid ${T.panelBorder}`, borderRadius: "6px",
  padding: "6px 12px", cursor: "pointer",
}, "Open full session");
controls.appendChild(sessionBtn);

const input = el("textarea", { ...fieldStyle, width: "100%", minHeight: "56px", resize: "vertical", boxSizing: "border-box" });
input.placeholder = "Ask a project's memory, e.g. what did we learn about ORB?";
panel.appendChild(input);

const answer = el("div", { marginTop: "12px", fontSize: "13px", color: T.text, lineHeight: "1.6" });
panel.appendChild(answer);
const commandLine = el("div", {
  marginTop: "8px", fontSize: "10px", color: T.textDim, wordBreak: "break-all",
  fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
});
panel.appendChild(commandLine);

let running = false;

function entries() {
  return (ctx.hub.projects || []).map(p => p.entry);
}

function selectedEntry() {
  return entries().find(e => e.name === picker.value) || entries()[0] || null;
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
  const none = entries().length === 0;
  askBtn.disabled = none || running;
  sessionBtn.disabled = none;
}

function whereOutput() {
  const cp = _require("child_process");
  try {
    if (process.platform === "win32") return cp.execFileSync("where.exe", ["claude"], { encoding: "utf8", timeout: 3000, windowsHide: true });
    return cp.execFileSync("which", ["-a", "claude"], { encoding: "utf8", timeout: 3000 });
  } catch { return ""; }
}

function showError(text) {
  answer.textContent = "";
  answer.appendChild(el("div", { color: T.red, whiteSpace: "pre-wrap" }, text));
}

async function runQuestion() {
  const entry = selectedEntry();
  const question = (input.value || "").trim();
  if (!entry || !question || running) return;
  const found = ask.findClaude(ctx.nodeFs, _require("os").homedir(), config.hub?.claudePath || "", whereOutput());
  if (found.error) { showError(found.error); commandLine.textContent = ""; return; }
  running = true;
  askBtn.disabled = true;
  askBtn.textContent = "Asking…";
  answer.textContent = "";
  answer.appendChild(el("div", { color: T.textMuted }, `Asking ${entry.label || entry.name}…`));
  commandLine.textContent = "";
  try {
    const r = await ask.runAsk({ entry, question, claudePath: found.path, spawn: _require("child_process").spawn });
    answer.textContent = "";
    if (r.ok) answer.appendChild(markdownRenderer ? markdownRenderer.renderMarkdown(r.text) : el("div", {}, r.text));
    else showError(r.text);
    commandLine.textContent = "$ " + r.command;
  } finally {
    running = false;
    askBtn.textContent = "Ask";
    askBtn.disabled = entries().length === 0;
  }
}

askBtn.addEventListener("click", runQuestion);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault && e.preventDefault(); runQuestion(); }
});
sessionBtn.addEventListener("click", () => {
  const entry = selectedEntry();
  if (entry) osCompat.launch(entry.path, null);
});
sessionBtn.title = "Opens a terminal in the project folder running claude";

renderPicker();
ctx.onHubUpdate.push(renderPicker);

return section;
