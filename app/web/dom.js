// DOM — small helpers shared by the views. Data reaches the page only through textContent and element
// properties; nothing here (or in any view) assigns innerHTML.
import { badgeFor } from "./models.js";

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "style") Object.assign(node.style, value);
    else if (key === "attrs") for (const [a, v] of Object.entries(value)) node.setAttribute(a, v);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node[key] = value;
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function badge(status, extraClass = "") {
  const text = badgeFor(status);
  if (!text) return null;
  return el("span", { class: `badge badge-${status} ${extraClass}`.trim(), text });
}

// Only vault and web links open from the page; anything else (javascript:, file:) is shown as plain text.
export function safeHref(url) {
  return /^(obsidian:|https?:\/\/)/i.test(String(url || "")) ? String(url) : null;
}

export function link(label, url, cls = "link") {
  const href = safeHref(url);
  if (!href) return el("span", { class: cls, text: label });
  return el("a", { class: cls, text: label, href, target: href.startsWith("http") ? "_blank" : undefined,
    rel: "noopener" });
}

// localStorage can be missing or throw (private windows, blocked storage); every access is guarded.
export const storage = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, String(value)); } catch { /* unavailable: a per-viewer convenience only */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* unavailable */ }
  },
};

const pad = (n) => String(n).padStart(2, "0");

export function clock(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function projectDot(color) {
  const dot = el("span", { class: "project-dot", attrs: { "aria-hidden": "true" } });
  if (color) dot.style.setProperty("--project-color", String(color));
  return dot;
}
