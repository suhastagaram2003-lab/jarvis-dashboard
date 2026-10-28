const test = require("node:test");
const assert = require("node:assert/strict");
const { itemId, levelOf, rank } = require("../app/server/urgency");

const it = (kind, title, age_days = 0, over = {}) => ({ kind, title, age_days, project: "mb",
  action: { label: "Go", command: 'claude "/x"' }, ...over });

test("levelOf: failed runs and conflicted PRs are high", () => {
  assert.equal(levelOf({ kind: "failed-run" }), "high");
  assert.equal(levelOf({ kind: "pr", title: "PR #9 has a merge Conflict" }), "high");
});
test("levelOf: other PRs and proposals are normal, lint errors low", () => {
  assert.equal(levelOf({ kind: "pr", title: "PR #9 waits" }), "normal");
  assert.equal(levelOf({ kind: "proposal", title: "x" }), "normal");
  assert.equal(levelOf({ kind: "lint-error", title: "x" }), "low");
});
test("levelOf: an explicit urgency wins", () => assert.equal(levelOf({ kind: "failed-run", urgency: "low" }), "low"));
test("rank orders by level, then older first, then input order", () => {
  const out = rank([
    it("lint-error", "l", 9), it("proposal", "p1", 1), it("failed-run", "f", 0),
    it("proposal", "p2", 3), it("pr", "a", 1), it("proposal", "p3", 1),
  ]);
  assert.deepEqual(out.map(x => x.title), ["f", "p2", "p1", "a", "p3", "l"]);
  assert.deepEqual(out.map(x => x.urgency), ["high", "normal", "normal", "normal", "normal", "low"]);
  assert.ok(out.every(x => /^[0-9a-f]{12}$/.test(x.id)));
});
test("rank does not change its input", () => {
  const input = [it("lint-error", "l"), it("failed-run", "f")];
  rank(input);
  assert.deepEqual(input.map(x => x.title), ["l", "f"]);
  assert.equal(input[0].id, undefined);
});
test("itemId is stable, 12 hex, title-sensitive, and honours item.id", () => {
  const a = it("proposal", "one");
  assert.equal(itemId("marketbrain", a), itemId("marketbrain", a));
  assert.match(itemId("marketbrain", a), /^[0-9a-f]{12}$/);
  assert.notEqual(itemId("marketbrain", a), itemId("marketbrain", it("proposal", "two")));
  assert.notEqual(itemId("marketbrain", a), itemId("betbrain", a));
  assert.equal(itemId("marketbrain", { ...a, id: "given-1" }), "given-1");
});
