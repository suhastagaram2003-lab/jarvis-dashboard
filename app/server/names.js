// Names — short, plain headers for tasks, runs and chats (Lucky, 2026-10-28: "make sure all the tickets and
// projects and sessions are named clearly; reframe the prompts I am asking back into a simple header").
// The raw title or prompt stays available as the detail line under the header.
const MAX = 60;

const COMMANDS = {
  review: "Review wiki proposals", lint: "Wiki health check", tune: "Tune workflows", ingest: "Ingest new sources",
  reflect: "Reflect on outcomes", ask: "Question", desk: "Desk", "deep-dive": "Deep dive",
};

const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();
const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function cut(s, max = MAX) {
  if (s.length <= max) return s;
  const head = s.slice(0, max - 1);
  const at = head.lastIndexOf(" ");
  return (at > max / 2 ? head.slice(0, at) : head).replace(/[\s,;:.-]+$/, "") + "…";
}

function join(label, rest) {
  return rest ? `${label}: ${rest}` : label;
}

function taskHeader(item) {
  const title = squash(item && item.title);
  let m;
  switch (item && item.kind) {
    case "proposal":
      return cut(join("Review wiki change", title), 80);
    case "failed-run":
      m = /^(.*) (failed|missed)$/.exec(title);
      return cut(m ? `Fix ${m[2]} run: ${m[1]}` : join("Fix failed run", title), 80);
    case "lint-error":
      if ((m = /^(\d+) more lint errors?$/.exec(title))) return `Fix ${m[1]} more wiki issues`;
      m = /^([\w-]+): (.+)$/.exec(title);
      return cut(m ? `Fix wiki issue: ${m[2]} (${m[1]})` : join("Fix wiki issue", title), 80);
    case "pr":
      if (/conflict/i.test(title)) return cut(join("Fix merge conflict", title), 80);
      m = /^(\S+) (has commits )?not merged into (\S+)$/.exec(title);
      return cut(m ? `Finish branch: ${m[1]}` : join("Finish branch", title), 80);
    default:
      return cut(title || "Task", 80);
  }
}

function promptHeader(prompt) {
  const text = squash(prompt);
  if (!text) return "Chat";
  const m = /^\/([\w-]+)\s*(.*)$/.exec(text);
  if (m) {
    const name = m[1].toLowerCase();
    const label = COMMANDS[name] || capital(name.replace(/-/g, " "));
    const rest = capital(m[2]);
    return cut(COMMANDS[name] && !["ask", "desk", "deep-dive"].includes(name) && !rest ? label : join(label, rest));
  }
  const first = text.split(/(?<=[.!?])\s/)[0].replace(/\.$/, "");
  return cut(capital(first));
}

module.exports = { taskHeader, promptHeader };
