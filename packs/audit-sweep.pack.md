=== ADP PACK audit-sweep/v1 · {{index.generated}} ===
corpus: {{index.project}} · {{ticket_count}} tickets

OVERDUE WATCHES
{{#overdue}}- {{tid}} {{wid}}: {{what}} · due {{due}} · {{state}}
{{/overdue}}{{^overdue}}- none
{{/overdue}}
WATCHES DUE WITHIN 14 DAYS
{{#soon}}- {{tid}} {{wid}}: {{what}} · due {{due}} · {{state}}
{{/soon}}{{^soon}}- none
{{/soon}}
UNANCHORED WATCHES (no due date on record)
{{#unanchored}}- {{tid}} {{wid}}: {{what}}
{{/unanchored}}{{^unanchored}}- none
{{/unanchored}}
OPEN DECISIONS WITH NO LIVE WATCH
{{#unwatched}}- {{tid}} {{id}}: [{{confidence}}] {{title}}
{{/unwatched}}{{^unwatched}}- none
{{/unwatched}}
Work the lists top to bottom, each item in its own ticket's log. Close a
watch with one CLOSED ledger line and rule each entry it covers with its
own line; never batch outcomes into one entry. Give an unanchored watch its
date with a RE-ANCHORED line. Open a ticket in the Obligation Ticket List
for every open decision that no live watch covers.
=== END PACK ===
