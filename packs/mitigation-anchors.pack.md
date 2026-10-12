=== ADP PACK mitigation-anchors/v1 · {{index.generated}} ===
corpus: {{index.project}} · {{ticket_count}} tickets

PRE-MORTEM MITIGATIONS STILL PENDING
{{#pending_mitigations}}- {{tid}} [{{likelihood}}] {{mode}}
{{/pending_mitigations}}{{^pending_mitigations}}- none: every mitigation on record names where it landed.
{{/pending_mitigations}}
REBUTTED FAILURE MODES
{{#rebuttals}}- {{tid}} [{{likelihood}}] {{mode}}
{{/rebuttals}}{{^rebuttals}}- none: no Pre-Mortem row on record answers its failure mode with an argument.
{{/rebuttals}}
MITIGATIONS WITH AN ANCHOR, AS WRITTEN
{{#anchored_mitigations}}- {{tid}} [{{likelihood}}] {{implemented_at}} · {{mode}}
{{/anchored_mitigations}}{{^anchored_mitigations}}- none: no mitigation on record names the code that implements it.
{{/anchored_mitigations}}
Every list here ages, and nothing checks any of them. A PENDING mitigation is
work the Pre-Mortem Report promised and no anchor confirms, so it reads as
unimplemented until its row carries a verbatim anchor from the code. Open the
ticket's Pre-Mortem Report, find the row, and either write the anchor or say
in the row that the mitigation did not land.

A rebuttal is an argument that the failure mode will not happen, accepted
once at the Phase 4 gate and never revisited. Read each one against the
system as it is now: a rebuttal that rested on a measurement, a dependency,
or a constraint that has since moved is no longer an answer, and the row
reopens as a Decision Log entry with its own watch.

An anchor is the one claim on this list a person can settle today, and this
pack verifies none of them. The anchor is prose the index carries verbatim,
so no page can tell whether the file still holds it. Check one by opening the
file it names. Found where the hint says: the reference holds. Found
elsewhere in the file: the hint drifted, so update it. Absent from the file:
the reference is dead and the mitigation counts as unverified, so reopen it
as a Decision Log entry or a ticket.
=== END PACK ===
