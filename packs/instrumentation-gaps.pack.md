=== ADP PACK instrumentation-gaps/v1 · {{index.generated}} ===
corpus: {{index.project}} · {{gap_counts.total}} of {{gap_counts.open}} open decisions name no observable
no signal at all {{gap_counts.missing}} · declared UNOBSERVABLE {{gap_counts.unobservable}} · pointing at no row {{gap_counts.dangling}}

OPEN DECISIONS WITHOUT A LIVE SIGNAL
{{#instrumentation_gaps}}- {{tid}} {{id}} [{{confidence}}] {{gap}} · {{title}}
{{/instrumentation_gaps}}{{^instrumentation_gaps}}- none: every open entry in this corpus names an observable.
{{/instrumentation_gaps}}
This is the instrumentation debt the record already admits. An entry listed
here is open, so its assumption is unsettled, and nothing a reader can check
says what would disprove it. A card that points at a Pre-Mortem row is read
through to that row, so an entry listed here is one whose own signal and
whose pointed-at signal both fail to name an observable.

Each entry takes one of two answers. Write a signal: the observable a person
can check with no tooling, the threshold at which the failure mode counts as
happening, and the nearest benign condition that produces the same reading.
Or rule the entry: append a CLOSED line with the date and the disposition,
which settles it without editing its card.

Read the three kinds differently. "no signal" means the card states nothing,
which is the cheapest to fix. "UNOBSERVABLE" claims that no observable
exists, which is a stronger claim than nobody wired one: test it against the
ticket that carries it, because an UNOBSERVABLE assumption is validated by a
dated re-review and not by silence, so its watch window must name a date and
that date must still be ahead. "pointing at no row" means the card's signal
quotes a Pre-Mortem failure mode that the ticket's own table does not carry,
so the entry's one signal of record addresses nothing: find the row the
author meant, or write the signal on the card.
=== END PACK ===
