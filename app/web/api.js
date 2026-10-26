// API — the browser's only ways of talking to the server: typed JSON routes and one WebSocket per open run.
// The browser never sends a command line; it sends item ids, prompts, replies and decisions.

async function call(method, url, body) {
  const init = { method, cache: "no-store", credentials: "same-origin", headers: {} };
  if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    const err = new Error((json && json.error) || text.trim() || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export const getState = () => call("GET", "/api/state");
export const getRuns = () => call("GET", "/api/runs");
export const getRun = (id) => call("GET", `/api/runs/${encodeURIComponent(id)}`);
export const execute = (project, itemId) => call("POST", "/api/runs", { project, item_id: itemId });
export const chat = (project, prompt, sessionId) => call("POST", "/api/runs",
  sessionId ? { project, prompt, session_id: sessionId } : { project, prompt });
export const refresh = (project) => call("POST", `/api/refresh/${encodeURIComponent(project)}`, {});
export const capture = (project, text) => call("POST", "/api/capture", { project, text });

// Opens the run's stream. handlers.message gets every server message (replay, events, summary, error);
// handlers.close gets the close event. send() returns false when the socket is not open.
export function stream(id, handlers) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/api/runs/${encodeURIComponent(id)}/stream`);
  ws.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handlers.message(msg);
  });
  ws.addEventListener("close", (ev) => { if (handlers.close) handlers.close(ev); });
  ws.addEventListener("error", () => { /* close follows */ });
  return {
    send(msg) {
      if (ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    close() { try { ws.close(); } catch { /* already closed */ } },
  };
}
