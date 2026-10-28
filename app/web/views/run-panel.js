// Run panel — one run, streamed live: header with badge and Stop, the lines, a card per open permission ask,
// and a reply box. Opened for #run/<id>; replays the log first, then streams.
import { panelLines, isLive, badgeFor, durationText } from "../models.js";
import { el, clear, badge } from "../dom.js";
import * as api from "../api.js";

const KIND = { execute: "Task", chat: "Chat", refresh: "Refresh" };

export function createRunPanel(root, { onClose, onSummary, toast }) {
  let current = null; // { id, socket, summary, events, nodes, replayed, resolveReplay }
  const parts = buildSkeleton(root, {
    onStop: () => { if (current) current.socket.send({ type: "stop" }); },
    onClose: () => onClose(),
    onSend: () => sendReply(),
  });

  function open(id) {
    if (current && current.id === id) { root.hidden = false; return current.replayed; }
    close();
    let resolveReplay;
    const replayed = new Promise((r) => { resolveReplay = r; });
    current = { id, summary: null, events: [], nodes: [], replayed, resolveReplay, socket: null, closed: false };
    root.hidden = false;
    parts.title.textContent = "Opening run…";
    parts.meta.textContent = id;
    clear(parts.lines);
    parts.lines.append(el("div", { class: "line line-status", text: "Connecting…" }));
    setBadge(null);
    const run = current;
    run.socket = api.stream(id, {
      message: (msg) => { if (current === run) onMessage(run, msg); },
      close: (ev) => {
        if (current !== run || run.closed) return;
        if (ev && ev.code === 4404) { setText(parts.lines, "No such run."); parts.title.textContent = "Run not found"; }
        else if (run.summary && isLive(run.summary.status)) appendStatus("Connection closed; reload to resume the stream.");
        setLive(false);
      },
    });
    return replayed;
  }

  function close() {
    if (!current) { root.hidden = true; return; }
    current.closed = true;
    current.socket.close();
    current.resolveReplay(null);
    current = null;
    root.hidden = true;
  }

  function onMessage(run, msg) {
    if (msg.type === "replay") {
      run.events = msg.events || [];
      run.summary = msg.summary;
      clear(parts.lines);
      run.nodes = [];
      renderHead(run);
      renderLines(run);
      run.resolveReplay(run.summary);
      return;
    }
    if (msg.type === "summary") {
      const before = run.summary && run.summary.status;
      run.summary = msg.summary;
      renderHead(run);
      renderLines(run);
      if (before !== msg.summary.status) onSummary(msg.summary);
      return;
    }
    if (msg.type === "error") {
      appendStatus(msg.message, "error");
      if (toast) toast(msg.message, "error");
      return;
    }
    if (msg.type) {
      run.events.push(msg);
      renderLines(run);
    }
  }

  function renderHead(run) {
    const s = run.summary;
    parts.title.textContent = s.title || s.id;
    parts.title.title = s.title || s.id;
    parts.meta.textContent = `${KIND[s.kind] || s.kind} · ${s.label || s.project}`;
    parts.meta.title = `Run ${s.id}`;
    parts.detail.textContent = s.detail && s.detail !== s.title ? s.detail : "";
    parts.detail.hidden = !parts.detail.textContent;
    setBadge(s.status);
    setLive(isLive(s.status), s);
    const canReply = s.kind !== "refresh" && (isLive(s.status) || !!s.session_id);
    parts.reply.disabled = !canReply;
    parts.send.disabled = !canReply;
    parts.reply.placeholder = canReply ? "Reply to Claude…  (Enter sends, Shift+Enter for a new line)"
      : s.kind === "refresh" ? "A refresh run takes no replies" : "This run has no session to resume";
    if (!isLive(s.status)) {
      const end = el("div", { class: `line line-end end-${s.status}` },
        badge(s.status), el("span", { text: endText(s) }));
      parts.end.replaceChildren(end);
    } else parts.end.replaceChildren();
  }

  function endText(s) {
    const ms = s.started && s.ended ? Date.parse(s.ended) - Date.parse(s.started) : NaN;
    const dur = Number.isFinite(ms) ? ` in ${durationText(ms)}` : "";
    if (s.status === "failed") return `Failed${dur}${s.error ? ": " + s.error : ""}`;
    if (s.status === "stopped") return `Stopped${dur}${s.error ? " (" + s.error + ")" : ""}`;
    return `${badgeFor(s.status)}${dur}`;
  }

  function setBadge(status) {
    parts.badge.replaceChildren();
    if (status) parts.badge.append(badge(status));
  }

  function setLive(live) {
    parts.stop.hidden = !live;
    root.classList.toggle("is-live", !!live);
  }

  function setText(node, text) {
    clear(node);
    node.append(el("div", { class: "line line-status", text }));
  }

  function appendStatus(text, tone = "muted") {
    parts.lines.append(el("div", { class: `line line-status tone-${tone}`, text }));
    scrollIfNearBottom(true);
  }

  // Reconcile the line list: only the last text line grows and only asks change state, so most nodes stay.
  function renderLines(run) {
    const stick = nearBottom();
    const lines = panelLines(run.events);
    const live = run.summary ? isLive(run.summary.status) : true;
    while (run.nodes.length > lines.length) run.nodes.pop().node.remove();
    lines.forEach((line, i) => {
      const prev = run.nodes[i];
      if (prev && prev.line.kind === line.kind && line.kind !== "permission") {
        if (prev.line.text !== line.text) prev.textEl.textContent = line.text;
      } else if (prev && line.kind === "permission" && prev.line.kind === "permission"
        && prev.line.request_id === line.request_id && prev.line.answered === line.answered && prev.live === live) {
        // unchanged ask
      } else {
        const made = lineNode(line, live, run);
        if (prev) prev.node.replaceWith(made.node); else parts.lines.append(made.node);
        run.nodes[i] = made;
      }
      run.nodes[i].line = { ...line };
    });
    scrollIfNearBottom(stick);
  }

  function lineNode(line, live, run) {
    if (line.kind === "permission") {
      const open = !line.answered && live;
      const card = el("div", { class: `ask${line.answered ? " ask-answered" : ""}`, dataset: { request: line.request_id } },
        el("div", { class: "ask-head" },
          el("span", { class: "ask-title", text: `Claude wants to use ${line.tool || "a tool"}` }),
          line.answered ? el("span", { class: `ask-verdict ${line.allow ? "ok" : "warn"}`, text: line.allow ? "approved" : "denied" }) : null),
        line.text ? el("code", { class: "ask-input", text: line.text }) : null,
        open ? el("div", { class: "ask-actions" },
          el("button", { class: "btn btn-approve approve", type: "button", text: "Approve",
            onclick: () => run.socket.send({ type: "allow", request_id: line.request_id }) }),
          el("button", { class: "btn btn-deny deny", type: "button", text: "Deny",
            onclick: () => run.socket.send({ type: "deny", request_id: line.request_id }) })) : null);
      return { node: card, textEl: card, live };
    }
    if (line.kind === "user") {
      const textEl = el("div", { class: "line-text", text: line.text });
      return { node: el("div", { class: "line line-user" }, el("span", { class: "line-who", text: "You" }), textEl), textEl };
    }
    if (line.kind === "tool") {
      const textEl = el("code", { class: "line-text", text: line.text });
      return { node: el("div", { class: "line line-tool" }, el("span", { class: "line-who", text: "tool" }), textEl), textEl };
    }
    if (line.kind === "stderr") {
      const textEl = el("code", { class: "line-text", text: line.text });
      return { node: el("div", { class: "line line-stderr" }, textEl), textEl };
    }
    if (line.kind === "status") {
      const textEl = el("span", { class: "line-text", text: line.text });
      return { node: el("div", { class: `line line-status tone-${line.tone || "muted"}` }, textEl), textEl };
    }
    const textEl = el("div", { class: "line-text", text: line.text });
    return { node: el("div", { class: "line line-claude" }, textEl), textEl };
  }

  function nearBottom() {
    const b = parts.body;
    return b.scrollHeight - b.scrollTop - b.clientHeight < 80;
  }

  function scrollIfNearBottom(stick) {
    if (stick) parts.body.scrollTop = parts.body.scrollHeight;
  }

  function sendReply() {
    if (!current) return;
    const text = parts.reply.value.trim();
    if (!text) return;
    if (!current.socket.send({ type: "reply", text })) { toast("The stream is not open; reload the run.", "error"); return; }
    parts.reply.value = "";
    parts.reply.style.height = "";
  }

  return {
    open, close,
    isOpen: () => !!current && !root.hidden,
    currentId: () => (current ? current.id : null),
    summary: () => (current ? current.summary : null),
    send: (msg) => (current ? current.socket.send(msg) : false),
  };
}

function buildSkeleton(root, { onStop, onClose, onSend }) {
  clear(root);
  const title = el("h2", { class: "panel-title", text: "" });
  const meta = el("div", { class: "panel-meta", text: "" });
  const detail = el("div", { class: "panel-detail", text: "", hidden: true });
  const badgeBox = el("span", { class: "panel-badge" });
  const stop = el("button", { class: "btn btn-danger btn-sm", type: "button", text: "Stop", hidden: true, onclick: onStop });
  const closeBtn = el("button", { class: "icon-btn", type: "button", text: "×", title: "Close (Esc)",
    attrs: { "aria-label": "Close run panel" }, onclick: onClose });
  const lines = el("div", { class: "lines" });
  const end = el("div", { class: "panel-end" });
  const body = el("div", { class: "panel-body" }, lines, end);
  const reply = el("textarea", { class: "reply", rows: 1, placeholder: "Reply to Claude…" });
  reply.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); onSend(); }
  });
  reply.addEventListener("input", () => {
    reply.style.height = "";
    reply.style.height = Math.min(reply.scrollHeight, 160) + "px";
  });
  const send = el("button", { class: "btn btn-primary", type: "button", text: "Send", onclick: onSend });
  root.append(
    el("div", { class: "panel-head" },
      el("div", { class: "panel-head-text" }, meta, title, detail),
      el("div", { class: "panel-actions" }, badgeBox, stop, closeBtn)),
    body,
    el("div", { class: "panel-foot" }, reply, send),
  );
  return { title, meta, detail, badge: badgeBox, stop, lines, end, body, reply, send };
}
