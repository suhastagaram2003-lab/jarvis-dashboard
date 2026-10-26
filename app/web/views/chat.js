// Chat tab — talk to a project's Claude. The first send starts a chat run; later sends reply on the same run,
// which resumes the session. "New conversation" forgets the run. The last run per project sits in localStorage.
import { isLive } from "../models.js";
import { el, storage, projectDot } from "../dom.js";

const PROJECT_KEY = "jarvis.chat.project";
const runKey = (name) => `jarvis.chat.run.${name}`;
let draft = "";
let busy = false;

export function renderChat(container, ctx) {
  const projects = ctx.state.projects || [];
  let selected = storage.get(PROJECT_KEY, "");
  if (!projects.some(p => p.name === selected)) selected = projects[0] ? projects[0].name : "";
  const project = projects.find(p => p.name === selected) || null;
  const runId = selected ? storage.get(runKey(selected), "") : "";

  const select = el("select", { class: "select chat-project", value: selected, disabled: !projects.length,
    attrs: { "aria-label": "Project" } },
    projects.length ? projects.map(p => el("option", { value: p.name, text: p.label || p.name, selected: p.name === selected }))
      : el("option", { text: "No projects registered" }));
  select.addEventListener("change", () => { storage.set(PROJECT_KEY, select.value); ctx.navigate("#chat"); });

  const input = el("textarea", { class: "textbox chat-input", rows: 3, value: draft,
    placeholder: project ? `Message ${project.label || project.name}'s Claude… slash commands work as typed`
      : "Register a project first" });
  input.addEventListener("input", () => { draft = input.value; });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); send(); }
  });
  const sendBtn = el("button", { class: "btn btn-primary chat-send", type: "button", text: runId ? "Send" : "Start",
    disabled: !project, onclick: () => send() });

  async function send() {
    const text = input.value.trim();
    if (!text || !project || busy) return;
    busy = true;
    sendBtn.disabled = true;
    try {
      const key = runKey(project.name);
      const stored = storage.get(key, "");
      if (stored && await canContinue(ctx, stored)) {
        ctx.openRun(stored);
        await ctx.panel.open(stored);
        if (!ctx.panel.send({ type: "reply", text })) throw new Error("the run's stream is not open; try again");
      } else {
        if (stored) storage.remove(key);
        const run = await ctx.api.chat(project.name, text);
        storage.set(key, run.id);
        ctx.openRun(run.id);
      }
      draft = "";
      input.value = "";
      ctx.loadRuns();
    } catch (e) {
      ctx.toast(e.message, "error");
    } finally {
      busy = false;
      sendBtn.disabled = false;
      ctx.render(); // the conversation line and the button label, without touching the hash
    }
  }

  const convo = runId
    ? el("div", { class: "chat-convo" },
      el("span", { class: "hint", text: "Continuing conversation " }),
      el("a", { href: `#run/${runId}`, text: runId, class: "mono" }),
      el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "New conversation",
        onclick: () => { storage.remove(runKey(selected)); ctx.closeRun(); } }))
    : el("div", { class: "chat-convo" }, el("span", { class: "hint", text: "A new conversation starts with your first message." }));

  container.append(
    el("div", { class: "view-head" },
      el("div", {}, el("h1", { class: "view-title", text: "Chat" }),
        el("p", { class: "view-sub", text: "Talk to a project's Claude in its own folder; the run shows in the panel." }))),
    el("div", { class: "chat" },
      el("label", { class: "chat-row" }, el("span", { class: "chat-label", text: "Project" }),
        project ? projectDot(project.color) : null, select),
      convo,
      input,
      el("div", { class: "chat-foot" },
        el("span", { class: "hint", text: "Enter sends · Shift+Enter for a new line · /ask, /tune and /desk work as typed" }),
        sendBtn)));
  if (project) input.focus({ preventScroll: true });
}

// A stored chat run can take another message while it is live or when it left a session to resume.
async function canContinue(ctx, id) {
  try {
    const r = await ctx.api.getRun(id);
    return r && r.summary && r.summary.kind === "chat" && (isLive(r.summary.status) || !!r.summary.session_id);
  } catch { return false; }
}
