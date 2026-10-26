// Hub Store — registry and export loading, validation and view models
// Reads ~/.jarvis/registry.json and ~/.jarvis/projects/<name>.json; never writes anything.
// ctx.hubSchema: the parsed schema/hub-export-v1.json (the loader reads it; tests pass it in).
// Returns: { expandHome, validateExport, parseExport, loadRegistry, loadProjects, mergeQueue, waitingCount,
//            waitingText, projectCard, agentCards, learningFeed, suggestionFeed, metricTiles, linkGroups,
//            projectForDir, mergeStats }

const SCHEMA = ctx.hubSchema;
const SUPPORTED_SCHEMA = 1;

function expandHome(p, home) {
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return home + p.slice(1);
  return p;
}

function joinPath(dir, name) {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.replace(/[\\/]+$/, "") + sep + name;
}

// ── Validation: a small interpreter for the subset of JSON Schema the export schema uses ──
function typeOk(type, v) {
  switch (type) {
    case "object": return v !== null && typeof v === "object" && !Array.isArray(v);
    case "array": return Array.isArray(v);
    case "string": return typeof v === "string";
    case "integer": return Number.isInteger(v);
    case "number": return typeof v === "number" && Number.isFinite(v);
    default: return true;
  }
}

function check(node, v, at, errors) {
  const where = at || "(root)";
  if ("const" in node && v !== node.const) {
    errors.push(`${where}: expected ${JSON.stringify(node.const)}`);
    return;
  }
  if (node.type && !typeOk(node.type, v)) {
    errors.push(`${where}: expected ${node.type}`);
    return;
  }
  if (node.enum && !node.enum.includes(v)) {
    errors.push(`${where}: bad value '${v}'`);
    return;
  }
  if (typeof node.minimum === "number" && typeof v === "number" && v < node.minimum) {
    errors.push(`${where}: below ${node.minimum}`);
  }
  if (node.format === "date-time" && typeof v === "string" && Number.isNaN(Date.parse(v))) {
    errors.push(`${where}: not a date-time`);
  }
  if (node.type === "object") {
    const props = node.properties || {};
    for (const key of node.required || []) {
      if (!(key in v)) errors.push(`${at ? at + "." : ""}${key}: missing`);
    }
    for (const key of Object.keys(v)) {
      const sub = at ? `${at}.${key}` : key;
      if (props[key]) check(props[key], v[key], sub, errors);
      else if (node.additionalProperties === false) errors.push(`${sub}: unexpected key`);
    }
  }
  if (node.type === "array" && node.items) {
    v.forEach((item, i) => check(node.items, item, `${where}[${i}]`, errors));
  }
}

// PowerShell 5.1's "-Encoding UTF8" writes a byte order mark, which JSON.parse rejects.
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function validateExport(obj) {
  if (!SCHEMA) return ["hub schema not loaded"];
  const errors = [];
  check(SCHEMA, obj, "", errors);
  return errors;
}

function parseExport(text, now, maxAgeHours = 36) {
  if (text === null || text === undefined) return { status: "error", reason: "no export yet", data: null };
  let obj;
  try { obj = JSON.parse(stripBom(text)); } catch (e) {
    return { status: "error", reason: `invalid JSON: ${e.message}`, data: null };
  }
  if (obj && typeof obj === "object" && obj.schema !== SUPPORTED_SCHEMA) {
    return { status: "error", reason: `schema ${obj.schema} not supported`, data: null };
  }
  const errors = validateExport(obj);
  if (errors.length) return { status: "error", reason: errors[0], data: null };
  const ageHours = (now.getTime() - Date.parse(obj.exported_at)) / 3600000;
  if (ageHours > maxAgeHours) {
    return { status: "stale", reason: `export ${Math.floor(ageHours)}h old`, data: obj };
  }
  return { status: "ok", reason: "", data: obj };
}

function loadRegistry(fs, jarvisHome) {
  const file = joinPath(jarvisHome, "registry.json");
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch {
    return { projects: [], error: `no registry: copy examples/registry.example.json to ${file}` };
  }
  try {
    const reg = JSON.parse(stripBom(text));
    if (!reg || !Array.isArray(reg.projects)) return { projects: [], error: `${file}: "projects" must be a list` };
    return { projects: reg.projects, error: null };
  } catch (e) {
    return { projects: [], error: `${file}: invalid JSON: ${e.message}` };
  }
}

function loadProjects({ fs, jarvisHome, now }) {
  const reg = loadRegistry(fs, jarvisHome);
  return reg.projects.map(entry => {
    const file = joinPath(joinPath(jarvisHome, "projects"), `${entry.name}.json`);
    let text = null;
    try { text = fs.readFileSync(file, "utf8"); } catch { text = null; }
    const r = parseExport(text, now || new Date());
    if (r.status === "error" && text !== null) r.reason = `${entry.name}.json: ${r.reason}`;
    return { entry, ...r };
  });
}

function usable(p) {
  return (p.status === "ok" || p.status === "stale") && p.data;
}

function mergeQueue(projects) {
  const rows = [];
  for (const p of projects) {
    if (!usable(p)) continue;
    for (const item of p.data.queue || []) {
      rows.push({ ...item, project: p.entry.label || p.entry.name, color: p.entry.color, path: p.entry.path });
    }
  }
  return rows.sort((a, b) => (b.age_days || 0) - (a.age_days || 0));
}

function waitingText(n) {
  if (!n) return "All clear";
  return n === 1 ? "1 thing waits on you" : `${n} things wait on you`;
}

function waitingCount(projects) {
  return projects.filter(usable).reduce((n, p) => n + (p.data.queue || []).length, 0);
}

// ── View models ──
function ageText(iso, now) {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const h = Math.floor(ms / 3600000);
  if (h < 1) return "just now";
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function projectCard(p, now) {
  const data = usable(p) ? p.data : null;
  let dot = "ok";
  if (p.status !== "ok" || !data) dot = "grey";
  else if ((data.health?.lint_errors || 0) > 0
    || (data.agents || []).some(a => a.status === "failed" || a.status === "missed")) dot = "warn";
  return {
    label: p.entry.label || p.entry.name,
    color: p.entry.color,
    dot,
    queueCount: data ? (data.queue || []).length : 0,
    ageText: data ? ageText(data.exported_at, now) : "",
    reason: p.reason || "",
  };
}

function agentCards(projects) {
  const cards = [];
  for (const p of projects) {
    if (!usable(p)) continue;
    for (const a of p.data.agents || []) {
      cards.push({
        name: a.name, displayName: a.name, color: p.entry.color, description: a.summary,
        status: a.status, last_run: a.last_run, project: p.entry.label || p.entry.name,
      });
    }
  }
  return cards;
}

// ── Feeds for the learning, suggestions, metrics and links widgets (ok/stale projects only) ──
function tagged(projects, field) {
  const rows = [];
  projects.forEach((p, order) => {
    if (!usable(p)) return;
    for (const row of p.data[field] || []) {
      rows.push({ ...row, project: p.entry.label || p.entry.name, color: p.entry.color, order });
    }
  });
  return rows;
}

function learningFeed(projects, limit = 15) {
  return tagged(projects, "learning")
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.order - b.order)
    .slice(0, limit);
}

function suggestionFeed(projects) {
  return tagged(projects, "suggestions").sort((a, b) => (a.rank - b.rank) || (a.order - b.order));
}

function metricTiles(projects) {
  return tagged(projects, "metrics");
}

function linkGroups(projects) {
  return projects
    .filter(p => usable(p) && (p.data.links || []).length > 0)
    .map(p => ({ project: p.entry.label || p.entry.name, color: p.entry.color, links: p.data.links }));
}

// ── Sessions and analytics by project ──
// A ~/.claude/projects folder belongs to the registry entry with the longest matching claude_projects_prefix
// (worktrees add a suffix to the project's folder name, so they match too).
function projectForDir(dirName, entries) {
  const name = String(dirName).toLowerCase();
  let best = null;
  for (const e of entries || []) {
    const prefix = String(e.claude_projects_prefix || "").toLowerCase();
    if (!prefix || !name.startsWith(prefix)) continue;
    if (!best || prefix.length > best.claude_projects_prefix.length) best = e;
  }
  return best;
}

// Sums upstream's stats shape across projects and adds byProject rows.
function mergeStats(perProject) {
  const out = {
    totalSessions: 0, totalMessages: 0, totalTokens: 0, totalCost: 0, totalToolCalls: 0,
    dailyActivity: {}, hourlyActivity: new Array(24).fill(0), byProject: [],
  };
  const models = {};
  for (const { project, stats } of perProject) {
    const st = stats || {};
    out.totalSessions += st.totalSessions || 0;
    out.totalMessages += st.totalMessages || 0;
    out.totalTokens += st.totalTokens || 0;
    out.totalCost += st.totalCost || 0;
    out.totalToolCalls += st.totalToolCalls || 0;
    for (const [day, d] of Object.entries(st.dailyActivity || {})) {
      const t = out.dailyActivity[day] || (out.dailyActivity[day] = { messages: 0, sessions: 0 });
      t.messages += d.messages || 0;
      t.sessions += d.sessions || 0;
    }
    (st.hourlyActivity || []).forEach((n, h) => { out.hourlyActivity[h] += n || 0; });
    for (const b of st.modelBreakdown || []) {
      const m = models[b.model] || (models[b.model] = { count: 0, cost: 0 });
      m.count += b.count || 0;
      m.cost += b.cost || 0;
    }
    out.byProject.push({ project, sessions: st.totalSessions || 0, tokens: st.totalTokens || 0, cost: st.totalCost || 0 });
  }
  const total = out.totalSessions;
  out.modelBreakdown = Object.entries(models).map(([model, m]) => ({
    model, count: m.count, pct: total > 0 ? Math.round((m.count / total) * 100) : 0, cost: m.cost,
  })).sort((a, b) => b.count - a.count);
  const fav = out.modelBreakdown[0];
  out.favoriteModel = fav ? fav.model : "sonnet";
  out.favPct = fav && total > 0 ? Math.round((fav.count / total) * 100) : 0;
  return out;
}

return {
  projectForDir, mergeStats,
  learningFeed, suggestionFeed, metricTiles, linkGroups,
  expandHome, validateExport, parseExport, loadRegistry, loadProjects, mergeQueue, waitingCount, waitingText,
  projectCard, agentCards,
};
