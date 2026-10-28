const test = require("node:test");
const assert = require("node:assert/strict");
const { taskHeader, promptHeader } = require("../app/server/names");

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
