const test = require("node:test");
const assert = require("node:assert/strict");
const { taskHeader, promptHeader, runName } = require("../app/server/names");

const t = (kind, title) => ({ kind, title });

test("task headers say what to do in plain words", () => {
  assert.equal(taskHeader(t("proposal", "Long Claude Sessions Cost the Most")), "Review wiki change: Long Claude Sessions Cost the Most");
  assert.equal(taskHeader(t("failed-run", "Nightly briefing (MarketBrain) failed")), "Fix failed run: Nightly briefing (MarketBrain)");
  assert.equal(taskHeader(t("failed-run", "Tune (MarketBrain) missed")), "Fix missed run: Tune (MarketBrain)");
  assert.equal(taskHeader(t("lint-error", "ref: lessons/x")), "Fix wiki issue: lessons/x (ref)");
  assert.equal(taskHeader(t("lint-error", "5 more lint errors")), "Fix 5 more wiki issues");
  assert.equal(taskHeader(t("pr", "feat/hub-export not merged into dev")), "Finish branch: feat/hub-export");
  assert.equal(taskHeader(t("pr", "PR #9 has a merge conflict")), "Fix merge conflict: PR #9 has a merge conflict");
  assert.equal(taskHeader(t("other", "Something odd")), "Something odd");
});

test("prompts become a short header", () => {
  assert.equal(promptHeader("/ask what did the agents learn this week?"), "Question: What did the agents learn this week?");
  assert.equal(promptHeader("/review"), "Review wiki proposals");
  assert.equal(promptHeader("/lint"), "Wiki health check");
  assert.equal(promptHeader("/tune"), "Tune workflows");
  assert.equal(promptHeader("/desk   AAOI  wheel setup"), "Desk: AAOI wheel setup");
  assert.equal(promptHeader("/deep-dive NVDA AVGO"), "Deep dive: NVDA AVGO");
  assert.equal(promptHeader("hey can you check why the briefing PDF overflows. It failed twice."),
    "Hey can you check why the briefing PDF overflows");
});

test("long headers are cut at a word with an ellipsis", () => {
  const h = promptHeader("/ask " + "word ".repeat(40));
  assert.ok(h.length <= 60, h);
  assert.match(h, /^Question: Word word .*…$/);
});

test("empty input still gives a header", () => {
  assert.equal(promptHeader("   "), "Chat");
  assert.equal(taskHeader({ kind: "proposal" }), "Review wiki change");
});

test("a repeat count reads as a plain suffix, even after a title that ends in brackets", () => {
  assert.equal(taskHeader({ kind: "proposal", title: "Tune (MarketBrain)", count: 4 }),
    "Review wiki change: Tune (MarketBrain) · 4 drafts");
  assert.equal(taskHeader({ kind: "failed-run", title: "Nightly failed", count: 2 }), "Fix failed run: Nightly · 2 times");
});

test("branch rows use the export's summary, and say Claude work for app-made branch names", () => {
  assert.equal(taskHeader({ kind: "pr", title: "claude/vigorous-dhawan-c19678 not merged into dev",
    summary: "feat(app): fold repeated tasks into one row" }), "Finish branch: Fold repeated tasks into one row");
  assert.equal(taskHeader({ kind: "pr", title: "claude/vigorous-dhawan-c19678 not merged into dev" }),
    "Finish unmerged Claude work");
  assert.equal(taskHeader({ kind: "pr", title: "claude/project-thread-rvwynx not merged into dev" }),
    "Finish unmerged Claude work");
  assert.equal(taskHeader({ kind: "pr", title: "feat/hub-export not merged into dev" }), "Finish branch: feat/hub-export");
});

test("runName gives runs saved before headers existed a header, a detail and a kind", () => {
  assert.deepEqual(runName({ id: "a", kind: "chat", title: "/ask what changed?" }),
    { id: "a", kind: "chat", title: "Question: What changed?", detail: "/ask what changed?" });
  assert.deepEqual(runName({ id: "b", kind: "execute", title: "Tune", item_id: "x" }, { kind: "proposal", header: "Review wiki change: Tune" }),
    { id: "b", kind: "execute", title: "Review wiki change: Tune", detail: "Tune", item_id: "x", item_kind: "proposal" });
  const fresh = { id: "c", kind: "chat", title: "Question: Hi", detail: "/ask hi" };
  assert.equal(runName(fresh), fresh);
  assert.deepEqual(runName({ id: "d", kind: "execute", title: "Gone", item_id: "y" }),
    { id: "d", kind: "execute", title: "Gone", item_id: "y" });
});
