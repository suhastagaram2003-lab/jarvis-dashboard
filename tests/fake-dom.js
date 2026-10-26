// A very small DOM stand-in, enough for the widgets' el()/appendChild/textContent/click use.
class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.style = {};
    this.children = [];
    this.dataset = {};
    this.title = "";
    this.disabled = false;
    this._text = "";
    this._listeners = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(" "); }
  async click() { for (const fn of this._listeners.click || []) await fn({}); }
  findAll(pred) {
    const out = [];
    const walk = (n) => { if (pred(n)) out.push(n); n.children.forEach(walk); };
    walk(this);
    return out;
  }
}

function installFakeDom() {
  globalThis.document = { createElement: (tag) => new FakeNode(tag), hidden: false };
}

module.exports = { FakeNode, installFakeDom };
