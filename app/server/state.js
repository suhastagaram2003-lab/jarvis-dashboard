// State — one JSON snapshot of the hub for the web app
// Wraps the Obsidian hub's own modules (src/hub/hub-store.js, recent.js), ranks the merged queue and marks what
// Execute may run. Paths and export commands stay on the server: the browser only ever gets ids and labels.
const nodePath = require("path");
const { loadSrc, hubSchema } = require("./load-src");
const { rank } = require("./urgency");
const { commandFor } = require("./policy");

const store = loadSrc("hub/hub-store.js", { hubSchema: hubSchema() });
const { recentFiles } = loadSrc("hub/recent.js");

function usable(p) {
  return (p.status === "ok" || p.status === "stale") && p.data;
}

function buildState({ fs, jarvisHome, now = new Date(), runsByItem = {} }) {
  const reg = store.loadRegistry(fs, jarvisHome);
  const loaded = reg.error ? [] : store.loadProjects({ fs, jarvisHome, now });
  const errors = reg.error ? [reg.error] : [];

  const items = [];
  for (const p of loaded) {
    if (!usable(p)) continue;
    for (const item of p.data.queue || []) {
      items.push({ ...item, project: p.entry.name, label: p.entry.label || p.entry.name, color: p.entry.color });
    }
  }
  const byName = Object.fromEntries(loaded.map(p => [p.entry.name, p.entry]));
  const queue = rank(items).map(item => {
    const c = commandFor(byName[item.project], item);
    return { ...item, allowed: c.error || true, run: runsByItem[item.id] || null };
  });

  const projects = loaded.map(p => {
    const data = usable(p) ? p.data : null;
    const label = p.entry.label || p.entry.name;
    if (p.status === "error") errors.push(`${label}: ${p.reason}`);
    return {
      name: p.entry.name, label, color: p.entry.color, status: p.status, reason: p.reason || "",
      card: store.projectCard(p, now),
      health: data ? data.health : null,
      agents: data ? data.agents : [],
      queue: queue.filter(q => q.project === p.entry.name),
      learning: data ? data.learning : [],
      suggestions: data ? data.suggestions : [],
      metrics: data ? data.metrics : [],
      links: data ? data.links : [],
      recent: recentFiles(fs, nodePath, [p.entry], 10),
      exported_at: data ? data.exported_at : null,
    };
  });

  return {
    generated_at: now.toISOString(), projects, queue,
    agents: store.agentCards(loaded), learning: store.learningFeed(loaded), suggestions: store.suggestionFeed(loaded),
    metrics: store.metricTiles(loaded), recent: recentFiles(fs, nodePath, loaded.map(p => p.entry), 10), errors,
  };
}

// The registry entry (with its path) for a project name, for the server only.
function entryFor(fs, jarvisHome, name) {
  return store.loadRegistry(fs, jarvisHome).projects.find(e => e && e.name === name) || null;
}

module.exports = { buildState, entryFor };
