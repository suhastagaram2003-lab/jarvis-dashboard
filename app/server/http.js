// HTTP — the web app's local server: typed routes and one WebSocket per run, nothing generic
// Every request passes three checks in order: Host is a loopback name on our port (421), Origin is absent or ours
// (403), and the token cookie or header matches (401). No route takes a file path or a command line.
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");
const policy = require("./policy");
const { buildState, entryFor } = require("./state");
const { loadSrc } = require("./load-src");
const { themeCss, loadAppConfig } = require("./config");

const capture = loadSrc("hub/capture.js");
const MAX_BODY = 64 * 1024;
const MAX_PROMPT = 20000;
const GONE = "this task is no longer in the export; refresh";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".json": "application/json" };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createServer({ jarvisHome, fs, token, runs, webRoot = path.join(__dirname, "..", "web"), theme = loadAppConfig().theme,
  claudeMissing = null, now = () => new Date() }) {
  const root = path.resolve(webRoot);

  function gate(req) {
    const port = req.socket.localPort;
    if (!policy.checkHost(req, port)) return [421, "wrong host"];
    if (!policy.checkOrigin(req, port)) return [403, "wrong origin"];
    if (!policy.checkToken(req, token)) return [401, "Open the link printed by npm run app."];
    return null;
  }

  const send = (res, status, body, type = "application/json") => {
    const text = type === "application/json" ? JSON.stringify(body) : String(body);
    res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(text);
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c); // past the limit, keep draining so the 413 can still be sent
    });
    req.on("end", () => {
      if (size > MAX_BODY) return reject(new HttpError(413, "request too large"));
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(new HttpError(400, "invalid JSON")); }
    });
    req.on("error", reject);
  });

  const state = () => buildState({ fs, jarvisHome, now: now(), runsByItem: runs.latestByItem() });

  function project(name) {
    const entry = entryFor(fs, jarvisHome, name);
    if (!entry) throw new HttpError(404, `no project ${name}`);
    return entry;
  }

  function startOrThrow(spec) {
    try { return runs.start(spec); } catch (e) {
      if (e.code === "LIMIT") throw new HttpError(409, e.message);
      throw e;
    }
  }

  function postRun(body) {
    const entry = project(body.project);
    if (claudeMissing) throw new HttpError(503, claudeMissing);
    const label = entry.label || entry.name;
    if (body.item_id !== undefined) {
      const item = state().queue.find(q => q.project === entry.name && q.id === body.item_id);
      if (!item) throw new HttpError(404, GONE);
      const c = policy.commandFor(entry, item);
      if (c.error) throw new HttpError(403, c.error);
      return startOrThrow({ kind: "execute", project: entry.name, label, item_id: item.id, title: item.title,
        cwd: entry.path, prompt: c.prompt });
    }
    const prompt = body.prompt;
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT) {
      throw new HttpError(400, `prompt must be 1 to ${MAX_PROMPT} characters`);
    }
    return startOrThrow({ kind: "chat", project: entry.name, label, title: prompt.trim().split(/\r?\n/)[0].slice(0, 80),
      cwd: entry.path, prompt, sessionId: typeof body.session_id === "string" ? body.session_id : null });
  }

  function serveStatic(res, urlPath) {
    let rel;
    try { rel = decodeURIComponent(urlPath); } catch { throw new HttpError(404, "not found"); }
    if (rel === "/" || rel === "") rel = "/index.html";
    const file = path.resolve(root, "." + rel);
    if (!file.startsWith(root + path.sep)) throw new HttpError(404, "not found");
    let data;
    try { data = fs.readFileSync(file); } catch { throw new HttpError(404, "not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(data);
  }

  async function route(req, res) {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    if (req.method === "GET" && p === "/" && url.searchParams.has("t")) {
      const port = req.socket.localPort;
      if (!policy.checkHost(req, port)) return send(res, 421, "wrong host", "text/plain");
      if (!policy.checkToken({ headers: { "x-jarvis-token": url.searchParams.get("t") } }, token)) {
        return send(res, 401, "Open the link printed by npm run app.", "text/plain");
      }
      res.writeHead(302, { location: "/", "set-cookie": `jarvis_t=${token}; HttpOnly; SameSite=Strict; Path=/` });
      return res.end();
    }
    const refused = gate(req);
    if (refused) return send(res, refused[0], refused[1], "text/plain");

    let m;
    if (req.method === "GET" && p === "/api/state") return send(res, 200, state());
    if (req.method === "GET" && p === "/api/runs") return send(res, 200, runs.list());
    if (req.method === "GET" && (m = /^\/api\/runs\/([\w.-]+)$/.exec(p))) {
      const r = runs.get(m[1]);
      return r ? send(res, 200, r) : send(res, 404, { error: "no such run" });
    }
    if (req.method === "POST" && p === "/api/runs") return send(res, 201, postRun(await readBody(req)));
    if (req.method === "POST" && (m = /^\/api\/refresh\/([\w.-]+)$/.exec(p))) {
      await readBody(req);
      const entry = project(m[1]);
      const c = policy.refreshFor(entry);
      if (c.error) throw new HttpError(403, c.error);
      return send(res, 201, startOrThrow({ kind: "refresh", project: entry.name, label: entry.label || entry.name,
        title: `Refresh ${entry.label || entry.name}`, cwd: entry.path, command: c.command }));
    }
    if (req.method === "POST" && p === "/api/capture") {
      const body = await readBody(req);
      const entry = project(body.project);
      let file;
      try { file = capture.save(fs, path.join(jarvisHome, "inbox"), entry.name, body.text, now()); } catch (e) {
        throw new HttpError(400, e.message);
      }
      return send(res, 201, { path: path.relative(jarvisHome, file).split(path.sep).join("/") });
    }
    if (req.method === "GET" && p === "/theme.css") return send(res, 200, themeCss(theme), "text/css; charset=utf-8");
    if (req.method === "GET" && !p.startsWith("/api/")) return serveStatic(res, p);
    throw new HttpError(404, "not found");
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      if (res.headersSent) { res.end(); return; }
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      send(res, 500, { error: e.message || "server error" });
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY });
  server.on("upgrade", (req, socket, head) => {
    const m = /^\/api\/runs\/([\w.-]+)\/stream$/.exec(new URL(req.url, "http://localhost").pathname);
    const refused = gate(req) || (m ? null : [404, "not found"]);
    if (refused) {
      socket.end(`HTTP/1.1 ${refused[0]} ${http.STATUS_CODES[refused[0]]}\r\nConnection: close\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => streamRun(ws, m[1]));
  });

  function streamRun(ws, id) {
    const r = runs.get(id);
    if (!r) { ws.close(4404, "no such run"); return; }
    const out = (msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
    const off = runs.subscribe(id, out);
    out({ type: "replay", events: r.events, summary: r.summary });
    ws.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return out({ type: "error", message: "invalid JSON" }); }
      try {
        if (msg.type === "reply" && typeof msg.text === "string" && msg.text.trim() && msg.text.length <= MAX_PROMPT) {
          runs.reply(id, msg.text);
        } else if (msg.type === "allow" || msg.type === "deny") {
          if (!runs.answer(id, String(msg.request_id), msg.type === "allow")) out({ type: "error", message: "that ask is no longer open" });
        } else if (msg.type === "stop") {
          runs.stop(id);
        } else {
          out({ type: "error", message: "unknown message" });
        }
      } catch (e) {
        out({ type: "error", message: e.message });
      }
    });
    ws.on("close", off);
  }

  server.on("close", () => wss.close());
  return server;
}

module.exports = { createServer, GONE };
