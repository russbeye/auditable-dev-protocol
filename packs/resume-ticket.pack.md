=== ADP PACK resume-ticket/v1 · {{index.generated}} ===
ticket: {{ticket.dir}}
state: {{ticket.state}} ({{ticket.state_source}}) · log reached phase {{ticket.phase}}{{#ticket.pr}} · pr {{ticket.pr}}{{/ticket.pr}}
sections missing: {{missing}}

OPEN DECISIONS
{{#open_decisions}}- [{{confidence}}] {{id}} {{title}} · watch: {{watch}}
{{/open_decisions}}{{^open_decisions}}- none
{{/open_decisions}}
LIVE WATCHES
{{#watches}}- {{wid}} {{what}} · due {{due}} · {{state}}
{{/watches}}{{^watches}}- none
{{/watches}}
Resume this ticket from the phase its log reached. Read
.adp/{{ticket.dir}}/audit-log.md before writing code, the Decision Log first.
Log every non-trivial decision as you make it. Never rewrite an entry: a
changed decision is a new entry whose Supersedes field names the old one.
=== END PACK ===
