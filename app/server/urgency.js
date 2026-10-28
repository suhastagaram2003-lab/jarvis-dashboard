// Urgency — ranks the merged queue for the Tasks tab
// An item's own `urgency` (schema v1, optional) wins; otherwise failed runs and conflicted PRs are high, other PRs
// and proposals normal, lint errors low. Within a level older items come first; ties keep the input (registry) order.
const crypto = require("crypto");

const LEVELS = ["high", "normal", "low"];

function itemId(project, item) {
  if (item.id) return String(item.id);
  return crypto.createHash("sha1").update(`${project}|${item.kind}|${item.title}`).digest("hex").slice(0, 12);
}

function levelOf(item) {
  if (LEVELS.includes(item.urgency)) return item.urgency;
  if (item.kind === "failed-run") return "high";
  if (item.kind === "pr") return /conflict/i.test(item.title || "") ? "high" : "normal";
  if (item.kind === "lint-error") return "low";
  return "normal";
}

function rank(items) {
  return items
    .map((item, order) => ({ item: { ...item, id: itemId(item.project, item), urgency: levelOf(item) }, order }))
    .sort((a, b) => (LEVELS.indexOf(a.item.urgency) - LEVELS.indexOf(b.item.urgency))
      || ((b.item.age_days || 0) - (a.item.age_days || 0))
      || (a.order - b.order))
    .map(x => x.item);
}

module.exports = { LEVELS, itemId, levelOf, rank };
