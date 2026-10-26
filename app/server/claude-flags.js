// Claude CLI flags the run manager depends on, confirmed on the PC by app/scripts/probe-claude.js.
// PERMISSION_FLAGS make `claude -p` send permission asks over stdio as control_request lines.
// EXTRA_DISALLOWED: order, trade and bet tools found on the PC beyond policy.js's built-in list.
module.exports = {
  PERMISSION_FLAGS: ["--permission-prompt-tool", "stdio"],
  EXTRA_DISALLOWED: [],
};
