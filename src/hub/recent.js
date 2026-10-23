// Recent — recently changed Markdown files across the registered projects' vaults
// Walks only each entry's recent_dirs under its path (never all of vault/, which can hold thousands of sources),
// skips dot-folders, and stops after `cap` Markdown files per project. Read-only.
// Returns: { recentFiles }

function recentFiles(fs, nodePath, entries, limit = 10, cap = 2000) {
  const rows = [];
  for (const entry of entries || []) {
    if (!entry || !entry.path) continue;
    let seen = 0;
    const stack = (entry.recent_dirs || []).map(d => String(d).replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));
    while (stack.length && seen < cap) {
      const relDir = stack.shift();
      let names;
      try { names = fs.readdirSync(nodePath.join(entry.path, relDir), { withFileTypes: true }); } catch { continue; }
      for (const d of names) {
        if (seen >= cap) break;
        if (d.name.startsWith(".")) continue;
        const rel = relDir ? `${relDir}/${d.name}` : d.name;
        if (d.isDirectory()) { stack.push(rel); continue; }
        if (!d.isFile() || !d.name.toLowerCase().endsWith(".md")) continue;
        seen++;
        let mtime;
        try { mtime = fs.statSync(nodePath.join(entry.path, rel)).mtimeMs; } catch { continue; }
        rows.push({
          project: entry.label || entry.name, color: entry.color, title: d.name.replace(/\.md$/i, ""), rel, mtime,
          link: `obsidian://open?vault=${encodeURIComponent(entry.vault || "")}`
            + `&file=${encodeURIComponent(rel.replace(/\.md$/i, ""))}`,
        });
      }
    }
  }
  return rows.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

return { recentFiles };
