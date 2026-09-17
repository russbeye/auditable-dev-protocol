=== ADP PACK assumption-aging/v1 · {{index.generated}} ===
corpus: {{index.project}} · {{ticket_count}} tickets · open decisions, oldest first

{{#open_by_age}}- {{age}}  {{tid}} {{id}} [{{confidence}}] {{title}} · watch: {{watch}}
{{/open_by_age}}{{^open_by_age}}- none
{{/open_by_age}}
An open decision is an assumption nobody has closed, and the oldest carry
the most drift. For each, from the top: re-read the entry's Monitoring
signal against what the code does today. If the evidence exists, rule the
entry with a DL CLOSED ledger line. If it has no live watch, open a ticket
in its log's Obligation Ticket List so the age stops growing unwatched.
=== END PACK ===
