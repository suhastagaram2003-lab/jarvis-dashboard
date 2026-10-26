const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const policy = require("../app/server/policy");

const item = (command) => ({ kind: "proposal", title: "x", age_days: 0, action: { label: "Review", command } });

test("promptFor takes the prompt out of claude \"...\"", () => {
  assert.equal(policy.promptFor('claude "/review"'), "/review");
  assert.equal(policy.promptFor('claude "/ask why \\"x\\""'), '/ask why "x"');
});
test("promptFor refuses anything but the claude \"...\" form", () => {
  assert.equal(policy.promptFor("uv run mb lint"), null);
  assert.equal(policy.promptFor('claude "/review" && del x'), null);
  assert.equal(policy.promptFor('claude ""'), null);
});
test("commandFor allows a claude prompt by default", () =>
  assert.deepEqual(policy.commandFor({ allowed_commands: undefined }, item('claude "/review"')), { prompt: "/review" }));
test("commandFor refuses a command outside allowed_commands", () =>
  assert.match(policy.commandFor({ allowed_commands: ["uv run"] }, item('claude "/review"')).error, /not allowed/));
test("commandFor refuses non-claude commands even when allowed", () =>
  assert.deepEqual(policy.commandFor({}, item("uv run mb lint --fix")),
    { error: "only Claude prompts can run from Jarvis" }));
test("commandFor refuses an item without a command", () =>
  assert.match(policy.commandFor({}, { kind: "pr", title: "x" }).error, /no command/));
test("refreshFor returns the entry's export_command unchanged", () => {
  assert.deepEqual(policy.refreshFor({ export_command: "uv run --no-sync mb hub export --json" }),
    { command: "uv run --no-sync mb hub export --json" });
  assert.match(policy.refreshFor({}).error, /no export_command/);
});
test("DISALLOWED_TOOLS blocks order tools without duplicates", () => {
  assert.ok(policy.DISALLOWED_TOOLS.includes("mcp__Robin_Hood__place_equity_order"));
  assert.ok(policy.DISALLOWED_TOOLS.includes("mcp__Robin_Hood__exercise_option"));
  assert.equal(new Set(policy.DISALLOWED_TOOLS).size, policy.DISALLOWED_TOOLS.length);
});
test("loadOrCreateToken makes the token once and keeps it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-app-"));
  const t = policy.loadOrCreateToken(fs, dir);
  assert.match(t, /^[0-9a-f]{64}$/);
  assert.equal(fs.readFileSync(path.join(dir, "app-token"), "utf8").trim(), t);
  assert.equal(policy.loadOrCreateToken(fs, dir), t);
});
test("checkToken accepts the cookie or header and nothing else", () => {
  const t = policy.makeToken();
  const wrong = "0".repeat(64);
  assert.equal(policy.checkToken({ headers: { cookie: `a=b; jarvis_t=${t}` } }, t), true);
  assert.equal(policy.checkToken({ headers: { "x-jarvis-token": t } }, t), true);
  assert.equal(policy.checkToken({ headers: { cookie: `jarvis_t=${wrong}` } }, t), false);
  assert.equal(policy.checkToken({ headers: { "x-jarvis-token": "short" } }, t), false);
  assert.equal(policy.checkToken({ headers: {} }, t), false);
});
test("checkHost allows only loopback names on our port", () => {
  assert.equal(policy.checkHost({ headers: { host: "127.0.0.1:4317" } }, 4317), true);
  assert.equal(policy.checkHost({ headers: { host: "localhost:4317" } }, 4317), true);
  assert.equal(policy.checkHost({ headers: { host: "evil.com:4317" } }, 4317), false);
  assert.equal(policy.checkHost({ headers: {} }, 4317), false);
});
test("checkOrigin allows no origin or our own", () => {
  assert.equal(policy.checkOrigin({ headers: {} }, 4317), true);
  assert.equal(policy.checkOrigin({ headers: { origin: "http://127.0.0.1:4317" } }, 4317), true);
  assert.equal(policy.checkOrigin({ headers: { origin: "http://evil.com" } }, 4317), false);
  assert.equal(policy.checkOrigin({ headers: { origin: "null" } }, 4317), false);
});
