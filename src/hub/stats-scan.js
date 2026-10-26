// Stats Scan — analytics over every ~/.claude/projects folder of every registered project
// Shared by the session worker and the main-thread stats engine, which pass in their own parseFullSession and
// aggregateStats (upstream's per-session parser and stats shape). A folder belongs to the registry entry with the
// longest matching claude_projects_prefix; with no registry, every Claude folder counts as one group.
// The per-file cache lives at cachePath (~/.jarvis/stats-cache.json), keyed by full file path.
// Returns: { scanProjectStats }

const ALL = "All projects";

function scanProjectStats(d) {
  const { fs, path, rootPath, entries, cachePath, periodDays, cacheMs, now } = d;
  const groupOf = (dir) => {
    if (!entries || entries.length === 0) return ALL;
    const e = d.projectForDir(dir, entries);
    return e ? (e.label || e.name) : null;
  };

  let cache = { computedAt: 0, sessions: {} };
  try { cache = JSON.parse(fs.readFileSync(cachePath, "utf8")); } catch {}
  if (!cache || typeof cache.sessions !== "object") cache = { computedAt: 0, sessions: {} };

  let sessions = cache.sessions;
  if (!(now - cache.computedAt < cacheMs)) {
    const cutoff = now - periodDays * 86400000;
    sessions = {};
    let dirs = [];
    try { dirs = fs.readdirSync(rootPath).filter(d.isClaudeProjectDir); } catch {}
    for (const dir of dirs) {
      if (groupOf(dir) === null) continue;
      const dirPath = path.join(rootPath, dir);
      let files = [];
      try { files = fs.readdirSync(dirPath).filter(f => f.endsWith(".jsonl")); } catch { continue; }
      for (const f of files) {
        const fp = path.join(dirPath, f);
        let mtime;
        try { mtime = fs.statSync(fp).mtimeMs; } catch { continue; }
        if (mtime < cutoff) continue;
        const old = cache.sessions[fp];
        sessions[fp] = old && old.mtime === mtime ? old : d.parseFullSession(fp);
      }
    }
    try {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify({ computedAt: now, sessions }));
    } catch {}
  }

  // Group the cached sessions by project (from each file's folder, so a registry change regroups at once).
  const groups = new Map();
  for (const [fp, s] of Object.entries(sessions)) {
    const g = groupOf(path.basename(path.dirname(fp)));
    if (g === null) continue;
    if (!groups.has(g)) groups.set(g, {});
    groups.get(g)[fp] = s;
  }
  const order = entries && entries.length ? entries.map(e => e.label || e.name) : [ALL];
  const perProject = order  // every registered project gets a row, with zeros when it has no sessions
    .map(project => ({ project, stats: d.aggregateStats({ sessions: groups.get(project) || {} }) }));
  return d.mergeStats(perProject);
}

return { scanProjectStats };
