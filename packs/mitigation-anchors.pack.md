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
Both lists age, and neither is checked by anything. A PENDING mitigation is
work the Pre-Mortem Report promised and no anchor confirms, so it reads as
unimplemented until its row carries a verbatim anchor from the code that
implements it. Open the ticket's Pre-Mortem Report, find the row, and either
write the anchor or say in the row that the mitigation did not land. A
rebuttal is an argument that the failure mode will not happen, accepted once
at the Phase 4 gate and never revisited. Read each one against the system as
it is now: a rebuttal that rested on a measurement, a dependency, or a
constraint that has since moved is no longer an answer, and the row reopens
as a Decision Log entry with its own watch.

This pack names rows; it verifies nothing. An anchor is prose the index
carries verbatim, so no page can tell whether the file still holds it. Check
an anchor by opening the file it names: found where the hint says, the
reference holds; found elsewhere, the hint drifted and the row needs the new
one; absent, the reference is dead and the mitigation counts as unverified.
=== END PACK ===
