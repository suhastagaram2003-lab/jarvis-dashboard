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

test("what we learned: fixture lesson, click opens its link", async () => {
  const { ctx } = makeCtx(jarvisHome());
  const opened = []; ctx.osCompat.open = (t) => opened.push(t);
  const w = loadModule("widgets/what-we-learned/index.js", ctx);
  assert.match(w.textContent, /Wide opening ranges fail more often/);
  const row = w.findAll(n => /^Open obsidian:/.test(n.title))[0];
  await row.click();
  assert.match(opened[0], /^obsidian:\/\/open\?vault=Suhas/);
});

test("fix next, metrics and mission control show the fixture; empty states without a registry", () => {
  const { ctx } = makeCtx(jarvisHome());
  assert.match(loadModule("widgets/fix-next/index.js", ctx).textContent, /#1[\s\S]*Split the nightly report/);
  assert.match(loadModule("widgets/hub-metrics/index.js", ctx).textContent, /\+1\.8%[\s\S]*ORB paper P&L/);
  assert.match(loadModule("widgets/mission-control/index.js", ctx).textContent, /MarketBrain[\s\S]*Vault/);
  const empty = makeCtx(jarvisHome({ registry: false })).ctx;
  assert.match(loadModule("widgets/what-we-learned/index.js", empty).textContent, /Nothing new in 14 days/);
  assert.match(loadModule("widgets/fix-next/index.js", empty).textContent, /No suggestions/);
  assert.match(loadModule("widgets/hub-metrics/index.js", empty).textContent, /No metrics yet/);
  assert.match(loadModule("widgets/mission-control/index.js", empty).textContent, /No links yet/);
});

test("command box: a question with & and quotes reaches claude as one argument", { skip: process.platform === "win32" }, async () => {
  const { ctx } = makeCtx(jarvisHome());
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-claude-"));
  const fake = path.join(bin, "claude");
  fs.writeFileSync(fake, "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ result: 'got: ' + process.argv[3] + ' cwd-ok:' + (process.cwd().length > 0), is_error: false }));\n");
  fs.chmodSync(fake, 0o755);
  ctx.config = { ...ctx.config, hub: { ...ctx.config.hub, claudePath: fake } };
  ctx.markdownRenderer = { renderMarkdown: (t) => { const d = document.createElement("div"); d.textContent = t; return d; } };
  const w = loadModule("widgets/command-box/index.js", ctx);
  const [area] = w.findAll(n => n.tagName === "TEXTAREA");
  area.value = 'what about "ORB" & echo hi';
  await buttons(w).find(b => b.textContent === "Ask").click();
  assert.match(w.textContent, /got: \/ask what about "ORB" & echo hi cwd-ok:true/);
  assert.match(w.textContent, /--disallowedTools Bash,PowerShell/);
});

test("command box: missing claude shows the setup hint", async () => {
  const { ctx } = makeCtx(jarvisHome());
  ctx.config = { ...ctx.config, hub: { claudePath: "/nope/claude.exe" } };
  const w = loadModule("widgets/command-box/index.js", { ...ctx, require: (m) => m === "child_process"
    ? { ...require("child_process"), execFileSync: () => "" }
    : m === "os" ? { ...require("os"), homedir: () => "/nonexistent-home" } : require(m) });
  const [area] = w.findAll(n => n.tagName === "TEXTAREA");
  area.value = "q";
  await buttons(w).find(b => b.textContent === "Ask").click();
  assert.match(w.textContent, /claude\.exe not found; set hub\.claudePath/);
});

test("quick capture: writes the picked project's inbox and nothing else", async () => {
  const home = jarvisHome();
  const { ctx } = makeCtx(home);
  const notices = [];
  globalThis.Notice = class { constructor(m) { notices.push(m); } };
  const w = loadModule("widgets/quick-capture/index.js", ctx);
  assert.match(w.textContent, /0 IN MARKETBRAIN INBOX/);
  const [picker] = w.findAll(n => n.tagName === "SELECT");
  picker.value = "betbrain";
  const [area] = w.findAll(n => n.tagName === "TEXTAREA");
  area.value = "https://example.com/line-movement";
  const btn = w.findAll(n => (n._listeners.click || []).length > 0 && /Capture/.test(n.textContent))[0];
  await btn.click();
  const files = fs.readdirSync(path.join(home, "inbox", "betbrain"));
  assert.equal(files.length, 1);
  assert.match(files[0], /^\d{4}-\d{2}-\d{2}-\d{6}\.md$/);
  assert.equal(fs.existsSync(path.join(home, "inbox", "marketbrain")), false);
  assert.equal(area.value, "");
  assert.match(notices[0], /Captured for BetBrain/);
  delete globalThis.Notice;
});

test("system diagnostics: one row per project", () => {
  const { ctx } = makeCtx(jarvisHome());
  ctx.onStatsReady = [];
  const w = loadModule("widgets/system-diagnostics/index.js", ctx);
  const merged = ctx.hubStore.mergeStats([
    { project: "MarketBrain", stats: { totalSessions: 3, totalTokens: 1500, totalCost: 1.25, modelBreakdown: [] } },
    { project: "BetBrain", stats: { totalSessions: 0, totalTokens: 0, totalCost: 0, modelBreakdown: [] } },
  ]);
  ctx.onStatsReady.forEach(cb => cb(merged));
  assert.match(w.textContent, /MarketBrain 3 sessions 1\.5K tokens \$1\.25[\s\S]*BetBrain 0 sessions/);
});

test("recent activity: notes from the registered vaults, click opens the obsidian link", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const home = jarvisHome();
  fs.mkdirSync(path.join(home, "vault", "wiki"), { recursive: true });
  fs.writeFileSync(path.join(home, "vault", "wiki", "NVDA.md"), "# NVDA\n");
  const { ctx } = makeCtx(home);
  const opened = []; ctx.osCompat.open = (l) => opened.push(l);
  const w = loadModule("widgets/recent-activity/index.js", ctx);
  t.mock.timers.tick(200);
  assert.match(w.textContent, /NVDA[\s\S]*MarketBrain/);
  const row = w.findAll(n => n.title === "vault/wiki/NVDA.md")[0];
  await row.click();
  assert.equal(opened[0], "obsidian://open?vault=Suhas&file=vault%2Fwiki%2FNVDA");
});

test("header: waiting text from the hub", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] }); // the clock and typing effect tick forever
  const { ctx } = makeCtx(jarvisHome());
  ctx.perf = {}; ctx.registerPausable = () => {}; ctx.intervals = [];
  assert.match(loadModule("widgets/header/index.js", ctx).textContent, /3 things wait on you/);
});
