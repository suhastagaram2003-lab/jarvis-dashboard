// Hub Store — registry and export loading, validation and view models
// Reads ~/.jarvis/registry.json and ~/.jarvis/projects/<name>.json; never writes anything.
// ctx.hubSchema: the parsed schema/hub-export-v1.json (the loader reads it; tests pass it in).
// Returns: { expandHome, validateExport, parseExport, loadRegistry, loadProjects, mergeQueue, waitingCount,
//            waitingText }

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

function validateExport(obj) {
  if (!SCHEMA) return ["hub schema not loaded"];
  const errors = [];
  check(SCHEMA, obj, "", errors);
  return errors;
}

function parseExport(text, now, maxAgeHours = 36) {
  if (text === null || text === undefined) return { status: "error", reason: "no export yet", data: null };
  let obj;
  try { obj = JSON.parse(text); } catch (e) {
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
    const reg = JSON.parse(text);
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

return { expandHome, validateExport, parseExport, loadRegistry, loadProjects, mergeQueue, waitingCount, waitingText };
