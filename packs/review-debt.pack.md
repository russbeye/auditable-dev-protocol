=== ADP PACK review-debt/v1 · {{index.generated}} ===
corpus: {{index.project}} · {{ticket_count}} tickets

TICKETS IN REVIEW
{{#in_review}}- {{id}} {{dir}}{{#pr}} · pr {{pr}}{{/pr}} · {{open_count}} open decisions · {{live_count}} live watches
{{/in_review}}{{^in_review}}- none
{{/in_review}}
A ticket in review holds an open Decision Log beside its review. For each
ticket listed: answer every Mandatory Review Item, and rule the open
entries the review can rule. When the PR merges, write the post-merge note:
one CLOSED ledger line per watch whose window ends at the merge, and the
front matter's state and merged brought up to date.
=== END PACK ===
