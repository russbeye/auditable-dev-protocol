/* The decision-log trail example: two cards, each followed by block material —
   a gate blockquote and a fenced snippet quoting an id token. The golden
   output pins that the blocks render below the card grid and never enter a
   field value. Regenerate only for a deliberate, reviewed rendering change,
   from the repo root:

     node -e "const h=require('./scripts/tests/helpers.js');require('fs').writeFileSync('scripts/tests/fixtures/dl-trail-example.html',h.parserLib.renderDecisionLog(require('./scripts/tests/fixtures/dl-trail-example.js')))"
*/
"use strict";

module.exports = [
  "Pre-entry prose stays above the cards.",
  "",
  "### [DL-001] Decision with a trailing gate quote",
  "- **Decision:** We pin the trailing quote.",
  "- **Confidence:** HIGH",
  "- **Status:** VALIDATED",
  "",
  "> **Phase 5 gate — confirmed.** The quote renders below the grid, not inside Status.",
  "",
  "### [DL-002] Decision with a trailing fence",
  "- **Supersedes:** DL-001",
  "- **Decision:** We pin the trailing fence.",
  "- **Confidence:** MEDIUM",
  "- **Status:** OPEN",
  "",
  "```",
  "reproduce with DL-777 quoted in code",
  "```"
].join("\n");
