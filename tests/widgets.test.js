// Smoke tests for the hub widgets against a fake DOM: they build, show the fixture and wire their buttons.
// Layout and look are checked by hand in Obsidian.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadModule, readJson, SRC } = require("./load-module");
const { installFakeDom } = require("./fake-dom");

installFakeDom();
const NOW_ISO = new Date().toISOString();
const config = readJson("src/config/config.example.json");
const T = config.theme;

function jarvisHome({ registry = true, broken = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-w-"));
  fs.mkdirSync(path.join(home, "projects"));
  if (registry) {
    const reg = readJson("examples/registry.example.json");
    reg.projects.forEach(p => { p.path = home; });
    reg.projects[0].export_command = 'node -e "console.error(\'mb not found\');process.exit(3)"';
    fs.writeFileSync(path.join(home, "registry.json"), JSON.stringify(reg));
  }
  const fx = { ...readJson("examples/projects/marketbrain.json"), exported_at: NOW_ISO };
  fs.writeFileSync(path.join(home, "projects", "marketbrain.json"), broken ? "{" : JSON.stringify(fx));
  return home;
}

function makeCtx(home) {
  const launched = [];
  const base = { nodeFs: fs, nodePath: path, require, T, isNarrow: false, isWide: true, config,
    animationsEnabled: false, CARD_PAD: "16px", FONT_SM: "12px", _srcDir: SRC + "/" };
  const helpers = loadModule("core/helpers.js", base);
  const realOs = loadModule("core/os-compat.js");
  const hubStore = loadModule("hub/hub-store.js", { hubSchema: readJson("schema/hub-export-v1.json") });
  const ctx = { ...base, ...helpers, hubStore, onHubUpdate: [], agentCardRefs: new Map(),
    osCompat: { ...realOs, launch: (dir, cmd) => launched.push([dir, cmd]), open: () => {} } };
  ctx.hub = {
    jarvisHome: home, projects: [], queue: [], waiting: 0, registryError: null,
    reload() {
      const now = new Date();
      ctx.hub.registryError = hubStore.loadRegistry(fs, home).error;
      ctx.hub.projects = hubStore.loadProjects({ fs, jarvisHome: home, now });
      ctx.hub.queue = hubStore.mergeQueue(ctx.hub.projects);
      ctx.hub.waiting = hubStore.waitingCount(ctx.hub.projects);
      ctx.onHubUpdate.forEach(cb => cb(ctx.hub));
    },
  };
  ctx.hub.reload();
  return { ctx, launched };
}

const buttons = (node) => node.findAll(n => n.tagName === "BUTTON");

test("project strip: one ok project, one grey with its reason", () => {
  const { ctx } = makeCtx(jarvisHome());
  const text = loadModule("widgets/project-strip/index.js", ctx).textContent;
  assert.match(text, /MarketBrain/);
  assert.match(text, /3 waiting/);
  assert.match(text, /BetBrain[\s\S]*no export yet/);
});

test("project strip: setup card without a registry", () => {
  const home = jarvisHome({ registry: false });
  const { ctx } = makeCtx(home);
  const text = loadModule("widgets/project-strip/index.js", ctx).textContent;
  assert.match(text, /Set up the hub/);
  assert.match(text, /no registry: copy examples\/registry\.example\.json to/);
});

test("project strip: broken export names the file", () => {
  const { ctx } = makeCtx(jarvisHome({ broken: true }));
  assert.match(loadModule("widgets/project-strip/index.js", ctx).textContent, /marketbrain\.json: invalid JSON/);
});

test("project strip: a failing Refresh shows exit code and stderr", async () => {
  const { ctx } = makeCtx(jarvisHome());
  const strip = loadModule("widgets/project-strip/index.js", ctx);
  const refresh = buttons(strip).find(b => /node -e/.test(b.title));
  assert.ok(refresh, "MarketBrain has a Refresh button whose tooltip shows the command");
  await refresh.click();
  assert.match(strip.textContent, /export failed \(exit 3\)/);
  assert.match(strip.textContent, /mb not found/);
});

test("waiting on you: oldest first, button launches the command in the project folder", async () => {
  const home = jarvisHome();
  const { ctx, launched } = makeCtx(home);
  const w = loadModule("widgets/waiting-on-you/index.js", ctx);
  const text = w.textContent;
  assert.ok(text.indexOf("Update strategies/orb") < text.indexOf("New lesson"));
  const btn = buttons(w)[0];
  assert.match(btn.title, /claude "\/review"/);
  await btn.click();
  assert.deepEqual(launched, [[home, 'claude "/review"']]);
});

test("waiting on you: empty state", () => {
  const { ctx } = makeCtx(jarvisHome({ registry: false }));
  assert.match(loadModule("widgets/waiting-on-you/index.js", ctx).textContent, /Nothing waits on you/);
});

test("agent cards: one card per exported agent with status", () => {
  const { ctx } = makeCtx(jarvisHome());
  const w = loadModule("widgets/agent-cards/index.js", ctx);
  assert.equal(ctx.agentCardRefs.size, 4);
  assert.match(w.textContent, /MarketBrain nightly[\s\S]*ok/);
  ctx.agentCardRefs.get("ORB bot").setActive(true);
  ctx.agentCardRefs.get("ORB bot").setActive(false);
  assert.equal(ctx.agentCardRefs.get("ORB bot").sText.textContent, "ok");
});

test("header: waiting text from the hub", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] }); // the clock and typing effect tick forever
  const { ctx } = makeCtx(jarvisHome());
  ctx.perf = {}; ctx.registerPausable = () => {}; ctx.intervals = [];
  assert.match(loadModule("widgets/header/index.js", ctx).textContent, /3 things wait on you/);
});
