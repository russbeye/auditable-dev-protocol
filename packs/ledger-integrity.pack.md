=== ADP PACK ledger-integrity/v1 · {{index.generated}} ===
corpus: {{index.project}} · {{ticket_count}} tickets · {{advisory_counts.total}} advisories
phantom {{advisory_counts.phantom}} · contradiction {{advisory_counts.contradiction}} · dead-anchor {{advisory_counts.dead_anchor}} · near-miss {{advisory_counts.near_miss}} · wid-shape {{advisory_counts.wid_shape}} · misplaced {{advisory_counts.misplaced}} · control-byte {{advisory_counts.control_byte}} · undated-window {{advisory_counts.undated_window}}

LEDGER ADVISORIES, BY KIND
{{#advisories}}- [{{kind}}] {{tid}} {{id}}{{#detail}} · {{detail}}{{/detail}}
{{/advisories}}{{^advisories}}- none: the corpus linted clean. Every landed record names a row or a
  card, no second record contradicts a first, and no log carries a shape the
  conventions forbid.
{{/advisories}}
An advisory is a silent failure, never a contract finding: the log is valid
and something a person wrote moved nothing. Read each kind for what it means.
A phantom record names no table row and no card, so the closure it states
never landed. A contradiction is a second record for an id the first one
already settled, and the first one won. A dead-anchor aims a re-anchor at a
watch the row already dates or a closure written above it already ended. A
near-miss is closure intent on a known id whose record never landed, which is
the kind a sweep clears by writing the record. A wid-shape is a watch id the ledger
grammar cannot address, so no record can ever close that row. A misplaced
section sits above the section the order convention gives it, named with the
key it should follow. A control-byte is a raw control byte in a log, named
with its UTF-8 byte offset. An undated-window is a live watch whose window is
the dash while its exit condition names a date, so the board can never date
it. Fix each by appending to the record. Never edit a landed line: a wrong
record is corrected by the next record, and a row whose window must move
closes with a disposition while a successor row opens.
=== END PACK ===
