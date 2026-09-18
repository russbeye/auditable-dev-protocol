=== ADP PACK watch-audit/v1 · {{index.generated}} ===
corpus: {{index.project}} · {{ticket_count}} tickets · {{watch_counts.live}} live watches · {{watch_counts.closed}} settled
overdue {{watch_counts.overdue}} · due within 14 days {{watch_counts.soon}} · upcoming {{watch_counts.upcoming}} · unanchored {{watch_counts.unanchored}}

LIVE WATCHES, MOST OVERDUE FIRST
{{#live_watches}}- {{tid}} {{wid}} [{{state}}] {{what}}{{#due}} · due {{due}}{{/due}}
{{/live_watches}}{{^live_watches}}- none
{{/live_watches}}
Audit each watch against its own exit condition in its ticket's Obligation
Ticket List: the signal fired, the window ended with the signal wired and
quiet, the signal was never wired, or, for an UNOBSERVABLE assumption, the
re-review its window dates came due. Close a watch only with a CLOSED
ledger line appended under that list, and rule the entries it covers with
their own lines. A watch whose window must move closes with a disposition
and a successor row opens; a closed watch never re-anchors.
=== END PACK ===
