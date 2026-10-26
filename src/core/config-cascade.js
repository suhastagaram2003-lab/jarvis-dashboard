// Config Cascade — config loading and safe widget building
// loadConfig merges config/config.example.json (required), then config/config.json, then config/config.local.json
// (each optional). Objects merge, arrays and scalars replace.
// Returns: { deepMerge, loadConfig, safeWidget }

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(a, b) {
  const result = { ...a };
  for (const key of Object.keys(b || {})) {
    result[key] = isPlainObject(b[key]) && isPlainObject(result[key])
      ? deepMerge(result[key], b[key])
      : b[key];
  }
  return result;
}

function joinPath(...parts) {
  return parts.map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, ""))).join("/");
}

function readJsonFile(fs, file, required) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) {
    if (required) throw new Error(`missing ${file}`);
    return {};
  }
  try { return JSON.parse(text); } catch (e) {
    throw new Error(`${file}: invalid JSON: ${e.message}`);
  }
}

function loadConfig(fs, srcDir) {
  let config = readJsonFile(fs, joinPath(srcDir, "config", "config.example.json"), true);
  config = deepMerge(config, readJsonFile(fs, joinPath(srcDir, "config", "config.json"), false));
  config = deepMerge(config, readJsonFile(fs, joinPath(srcDir, "config", "config.local.json"), false));
  return config;
}

async function safeWidget(name, buildFn) {
  try {
    const el = await buildFn();
    if (!el) return { el: null, error: `${name}: returned no element` };
    return { el, error: null };
  } catch (e) {
    return { el: null, error: `${name}: ${e && e.message ? e.message : String(e)}` };
  }
}

return { deepMerge, loadConfig, safeWidget };
