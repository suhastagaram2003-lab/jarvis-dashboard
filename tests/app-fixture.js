// Builds a throwaway ~/.jarvis home for the web app tests: a registry with MarketBrain (fresh export from
// examples/projects/marketbrain.json, a project folder with one wiki page) and Demo (no export yet).
const fs = require("fs");
const os = require("os");
const path = require("path");

const EXAMPLE = path.join(__dirname, "..", "examples", "projects", "marketbrain.json");

function makeHome({ registry = true, now = new Date(), exportOver = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-app-"));
  const home = path.join(root, ".jarvis");
  const projectDir = path.join(root, "projects", "MarketBrainRepo");
  fs.mkdirSync(path.join(home, "projects"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "vault", "wiki"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "vault", "wiki", "NVDA.md"), "# NVDA\n");
  if (registry) {
    fs.writeFileSync(path.join(home, "registry.json"), JSON.stringify({ projects: [
      { name: "marketbrain", label: "MarketBrain", path: projectDir, color: "#00d4ff",
        export_command: "node -e \"console.log('exported')\"", vault: "Suhas", recent_dirs: ["vault/wiki"] },
      { name: "demo", label: "Demo", path: path.join(root, "projects", "Demo"), color: "#44c98f",
        export_command: "", recent_dirs: [] },
    ] }));
  }
  const data = { ...JSON.parse(fs.readFileSync(EXAMPLE, "utf8")), exported_at: now.toISOString(), ...exportOver };
  fs.writeFileSync(path.join(home, "projects", "marketbrain.json"), JSON.stringify(data));
  return { root, home, projectDir };
}

module.exports = { makeHome };
