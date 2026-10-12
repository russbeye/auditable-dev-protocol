=== ADP PACK instrumentation-gaps/v1 · {{index.generated}} ===
corpus: {{index.project}} · {{gap_counts.total}} of {{gap_counts.open}} open decisions name no observable
no signal at all {{gap_counts.missing}} · declared UNOBSERVABLE {{gap_counts.unobservable}}

OPEN DECISIONS WITHOUT A LIVE SIGNAL
{{#instrumentation_gaps}}- {{tid}} {{id}} [{{confidence}}] {{gap}} · {{title}}
{{/instrumentation_gaps}}{{^instrumentation_gaps}}- none: every open entry in this corpus names an observable.
{{/instrumentation_gaps}}
This is the instrumentation debt the record already admits. An entry listed
here is open, so its assumption is unsettled, and nothing on its card says
what would disprove it. Each one takes one of two answers. Write a signal:
the observable a person can check with no tooling, the threshold at which the
failure mode counts as happening, and the nearest benign condition that
produces the same reading. Or rule the entry: append a CLOSED line with the
date and the disposition, which settles it without editing its card.

An entry reading UNOBSERVABLE claims that no observable exists, which is a
stronger claim than nobody wired one. Test the claim against the ticket that
carries it: an UNOBSERVABLE assumption is validated by a dated re-review, not
by silence, so its watch window must name a date and that date must still be
ahead. An UNOBSERVABLE entry with no watch is an open claim nobody will come
back to.
=== END PACK ===
