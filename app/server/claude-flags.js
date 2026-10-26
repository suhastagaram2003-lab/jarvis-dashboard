// Claude CLI flags the run manager depends on, checked on the PC (app/scripts/probe-claude.js and the PC check).
// PERMISSION_FLAGS make `claude -p` send permission asks over stdio as control_request lines.
// EXTRA_DISALLOWED: order, trade and money-moving tools found on the PC (2026-10-26) beyond policy.js's built-in list.
const ROBINHOOD_PC = "mcp__6470aae0-ecce-4513-a1c8-78d3b30271dc__";
const ALPACA = "mcp__alpaca__";

module.exports = {
  PERMISSION_FLAGS: ["--permission-prompt-tool", "stdio"],
  EXTRA_DISALLOWED: [
    ...["place_equity_order", "place_option_order", "place_crypto_order", "review_equity_order", "review_option_order",
      "preview_crypto_order", "cancel_equity_order", "cancel_option_order", "cancel_crypto_order", "exercise_option",
      "cancel_option_exercise", "decline_trade_approval"].map(t => ROBINHOOD_PC + t),
    ...["place_stock_order", "place_option_order", "place_crypto_order", "replace_order_by_id", "cancel_order_by_id",
      "cancel_all_orders", "close_position", "close_all_positions", "exercise_options_position",
      "do_not_exercise_options_position", "update_account_config"].map(t => ALPACA + t),
  ],
};
