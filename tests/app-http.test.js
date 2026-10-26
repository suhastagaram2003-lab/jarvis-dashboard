const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");
const { createServer } = require("../app/server/http");
const { createRunManager } = require("../app/server/runs");
const { startProcess } = require("../app/server/claude-process");
const { buildState } = require("../app/server/state");
const { makeToken } = require("../app/server/policy");
const { makeHome } = require("./app-fixture");

const FAKE = path.join(__dirname, "fixtures", "fake-claude.js");

async function boot(t, over = {}) {
  const { home, root } = makeHome({ exportOver: over.exportOver || {} });
  const webRoot = path.join(root, "web");
  fs.mkdirSync(webRoot);
  fs.writeFileSync(path.join(webRoot, "index.html"), "<!doctype html><title>Jarvis</title>");
  const runs = createRunManager({ jarvisHome: home, fs, startProcess, env: over.env,
    claude: { file: process.execPath, prefixArgs: [FAKE] } });
  const token = makeToken();
  const server = createServer({ jarvisHome: home, fs, token, runs, webRoot, claudeMissing: over.claudeMissing || null });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  t.after(() => { runs.close(); server.close(); });
  const req = (method, url, { body, headers = {}, auth = true } = {}) => new Promise((resolve, reject) => {
    const h = { host: `127.0.0.1:${port}`, ...(auth ? { cookie: `jarvis_t=${token}` } : {}), ...headers };
    const data = body === undefined ? null : (typeof body === "string" ? body : JSON.stringify(body));
    if (data) h["content-type"] = "application/json";
    const r = http.request({ host: "127.0.0.1", port, method, path: url, headers: h }, (res) => {
      let text = "";
      res.on("data", d => { text += d; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
  const ws = (id) => new WebSocket(`ws://127.0.0.1:${port}/api/runs/${id}/stream`,
    { headers: { cookie: `jarvis_t=${token}`, origin: `http://127.0.0.1:${port}` } });
  const state = () => buildState({ fs, jarvisHome: home });
  return { req, ws, token, port, home, state };
}

const itemWith = (s, command) => s.queue.find(q => q.action.command === command);

test("refuses requests without the token, with a foreign Host or a foreign Origin", async (t) => {
  const b = await boot(t);
  assert.equal((await b.req("GET", "/api/state", { auth: false })).status, 401);
  assert.equal((await b.req("GET", "/", { auth: false })).text.trim(), "Open the link printed by npm run app.");
  assert.equal((await b.req("GET", "/api/state", { headers: { host: `evil.com:${b.port}` } })).status, 421);
  assert.equal((await b.req("GET", "/api/state", { headers: { origin: "http://evil.com" } })).status, 403);
});

test("the link sets the cookie and the state comes back", async (t) => {
  const b = await boot(t);
  const r = await b.req("GET", `/?t=${b.token}`, { auth: false });
  assert.equal(r.status, 302);
  assert.match(r.headers["set-cookie"][0], new RegExp(`jarvis_t=${b.token}; HttpOnly; SameSite=Strict; Path=/`));
  const s = await b.req("GET", "/api/state");
  assert.equal(s.status, 200);
  assert.ok(s.json.queue.length > 0);
  assert.equal((await b.req("GET", "/")).status, 200);
  assert.match((await b.req("GET", "/theme.css")).text, /--accent: #00d4ff/);
});

test("static files never leave the web folder", async (t) => {
  const b = await boot(t);
  assert.equal((await b.req("GET", "/../package.json")).status, 404);
  assert.equal((await b.req("GET", "/%2e%2e/package.json")).status, 404);
  assert.equal((await b.req("GET", "/..%2fpackage.json")).status, 404);
});

test("Execute starts a run once per live item and refuses gone or disallowed items", async (t) => {
  const b = await boot(t, { env: { FAKE_HANG: "1" } });
  const item = itemWith(b.state(), 'claude "/review"');
  const one = await b.req("POST", "/api/runs", { body: { project: "marketbrain", item_id: item.id } });
  assert.equal(one.status, 201);
  const two = await b.req("POST", "/api/runs", { body: { project: "marketbrain", item_id: item.id } });
  assert.deepEqual([two.status, two.json.id], [201, one.json.id]);
  const gone = await b.req("POST", "/api/runs", { body: { project: "marketbrain", item_id: "000000000000" } });
  assert.deepEqual([gone.status, gone.json.error], [404, "this task is no longer in the export; refresh"]);
  const bad = await b.req("POST", "/api/runs", { body: { project: "marketbrain", item_id: itemWith(b.state(), "claude").id } });
  assert.deepEqual([bad.status, bad.json.error], [403, "only Claude prompts can run from Jarvis"]);
  assert.equal((await b.req("POST", "/api/runs", { body: { project: "nope", item_id: item.id } })).status, 404);
  const list = await b.req("GET", "/api/runs");
  assert.equal(list.json.length, 1);
  assert.equal((await b.req("GET", `/api/runs/${one.json.id}`)).json.summary.id, one.json.id);
  assert.equal((await b.req("GET", "/api/state")).json.queue.find(q => q.id === item.id).run.id, one.json.id);
});

test("the stream replays earlier events, takes an allow, and reports done", async (t) => {
  const b = await boot(t);
  const item = itemWith(b.state(), 'claude "/review"');
  const run = (await b.req("POST", "/api/runs", { body: { project: "marketbrain", item_id: item.id } })).json;
  await new Promise(r => setTimeout(r, 300)); // let the ask arrive before we connect
  const sock = b.ws(run.id);
  const seen = [];
  const done = new Promise((resolve) => {
    sock.on("message", (data) => {
      const msg = JSON.parse(data);
      seen.push(msg);
      if (msg.type === "replay") {
        assert.ok(msg.events.some(e => e.type === "permission" && e.request_id === "r1"));
        sock.send(JSON.stringify({ type: "allow", request_id: "r1" }));
      }
      if (msg.type === "summary" && msg.summary.status === "done") resolve();
    });
  });
  await done;
  sock.close();
  assert.equal(seen[0].type, "replay");
  assert.ok(seen.some(m => m.type === "text" && m.text === "allowed"));
});

test("a stream without the cookie or from another origin is refused", async (t) => {
  const b = await boot(t);
  const status = (headers) => new Promise((resolve) => {
    const s = new WebSocket(`ws://127.0.0.1:${b.port}/api/runs/x/stream`, { headers });
    s.on("unexpected-response", (_req, res) => resolve(res.statusCode));
    s.on("open", () => { s.close(); resolve(101); });
    s.on("error", () => {});
  });
  assert.equal(await status({}), 401);
  assert.equal(await status({ cookie: `jarvis_t=${b.token}`, origin: "http://evil.com" }), 403);
});

test("chat needs a prompt; capture writes one inbox note; refresh runs the export", async (t) => {
  const b = await boot(t);
  assert.equal((await b.req("POST", "/api/runs", { body: { project: "marketbrain", prompt: "" } })).status, 400);
  assert.equal((await b.req("POST", "/api/runs", { body: { project: "marketbrain", prompt: "x".repeat(20001) } })).status, 400);
  const chat = await b.req("POST", "/api/runs", { body: { project: "marketbrain", prompt: "/ask what changed?" } });
  assert.deepEqual([chat.status, chat.json.kind], [201, "chat"]);
  const cap = await b.req("POST", "/api/capture", { body: { project: "marketbrain", text: "Look at CIEN" } });
  assert.equal(cap.status, 201);
  assert.equal(fs.readdirSync(path.join(b.home, "inbox", "marketbrain")).length, 1);
  assert.ok(!path.isAbsolute(cap.json.path));
  const ref = await b.req("POST", "/api/refresh/marketbrain");
  assert.deepEqual([ref.status, ref.json.kind], [201, "refresh"]);
  assert.equal((await b.req("POST", "/api/refresh/demo")).status, 403);
});

test("bodies over 64 KB are refused and unknown routes are 404", async (t) => {
  const b = await boot(t);
  assert.equal((await b.req("POST", "/api/capture", { body: JSON.stringify({ project: "marketbrain", text: "x".repeat(70000) }) })).status, 413);
  assert.equal((await b.req("GET", "/api/nothing")).status, 404);
  assert.equal((await b.req("DELETE", "/api/runs")).status, 404);
});

test("without claude, Execute explains how to set it", async (t) => {
  const b = await boot(t, { claudeMissing: "claude.exe not found; set hub.claudePath in src/config/config.json" });
  const item = itemWith(b.state(), 'claude "/review"');
  const r = await b.req("POST", "/api/runs", { body: { project: "marketbrain", item_id: item.id } });
  assert.deepEqual([r.status, r.json.error], [503, "claude.exe not found; set hub.claudePath in src/config/config.json"]);
});
