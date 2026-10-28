const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { buildState } = require("../app/server/state");
const { rank } = require("../app/server/urgency");
const { makeHome } = require("./app-fixture");

const NOW = new Date();

test("queue is ranked, has ids and Execute permission", () => {
  const { home } = makeHome({ now: NOW });
  const s = buildState({ fs, jarvisHome: home, now: NOW });
  assert.ok(s.queue.length > 0);
  assert.deepEqual(s.queue.map(q => q.id), rank(s.queue).map(q => q.id));
  assert.ok(s.queue.every(q => /^[0-9a-f]{12}$/.test(q.id) && q.project === "marketbrain" && q.label === "MarketBrain"));
  assert.equal(s.queue[0].urgency, "high");
  assert.equal(s.queue.find(q => q.action.command === 'claude "/review"').allowed, true);
  assert.equal(s.queue.find(q => q.action.command === "claude").allowed, "only Claude prompts can run from Jarvis");
});

test("an error project is listed with its reason", () => {
  const { home } = makeHome({ now: NOW });
  const s = buildState({ fs, jarvisHome: home, now: NOW });
  const demo = s.projects.find(p => p.name === "demo");
  assert.equal(demo.status, "error");
  assert.ok(s.errors.some(e => e.startsWith("Demo:")));
  const mb = s.projects.find(p => p.name === "marketbrain");
  assert.equal(mb.status, "ok");
  assert.equal(mb.queue.length, s.queue.length);
  assert.deepEqual(mb.recent.map(r => r.title), ["NVDA"]);
  assert.ok(mb.card && mb.health && Array.isArray(mb.agents));
});

test("a missing registry gives a setup error and empty lists", () => {
  const { home } = makeHome({ registry: false, now: NOW });
  const s = buildState({ fs, jarvisHome: home, now: NOW });
  assert.match(s.errors[0], /no registry/);
  assert.deepEqual([s.projects, s.queue], [[], []]);
});

test("state never carries project paths or export commands", () => {
  const { home, projectDir } = makeHome({ now: NOW });
  const text = JSON.stringify(buildState({ fs, jarvisHome: home, now: NOW }));
  assert.ok(!text.includes(JSON.stringify(projectDir).slice(1, -1)));
  assert.ok(!text.includes("exported'"));
});

test("runsByItem shows each item's latest run", () => {
  const { home } = makeHome({ now: NOW });
  const first = buildState({ fs, jarvisHome: home, now: NOW }).queue[0];
  const run = { id: "r1", status: "running" };
  const s = buildState({ fs, jarvisHome: home, now: NOW, runsByItem: { [first.id]: run } });
  assert.deepEqual(s.queue[0].run, run);
  assert.equal(s.queue[1].run, null);
});

test("every queue item carries a plain header and keeps its raw title", () => {
  const { home } = makeHome({ now: NOW });
  const s = buildState({ fs, jarvisHome: home, now: NOW });
  const review = s.queue.find(q => q.title === "New lesson: wide opening ranges fail more often");
  assert.equal(review.header, "Review wiki change: New lesson: wide opening ranges fail more often");
  assert.equal(s.queue.find(q => q.kind === "pr").header, "Finish branch: feat/hub-export");
});

test("identical tasks fold into one row with a count", () => {
  const dup = { kind: "proposal", title: "SMA Momentum Agent", age_days: 1, action: { label: "Review", command: 'claude "/review"' } };
  const { home } = makeHome({ now: NOW, exportOver: { queue: [dup, { ...dup, age_days: 4 }, { ...dup, age_days: 2 },
    { ...dup, title: "Other page" }] } });
  const s = buildState({ fs, jarvisHome: home, now: NOW });
  assert.equal(s.queue.length, 2);
  const sma = s.queue.find(q => q.title === "SMA Momentum Agent");
  assert.deepEqual([sma.count, sma.age_days, sma.header], [3, 4, "Review wiki change: SMA Momentum Agent · 3 drafts"]);
  assert.equal(s.queue.find(q => q.title === "Other page").count, 1);
  assert.equal(s.projects.find(p => p.name === "marketbrain").queue.length, 2);
});
