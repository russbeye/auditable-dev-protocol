**Output: Obligation Ticket List**
```
## Obligation Ticket List
| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |
|-----------|------------------|------------------------|----------|----------------|--------------------|
| ...       | DL-XXX           | ...                    | ...      | [observable event or date] → [disposition] | [plain time anchored to an event] / — |

Decision Log ref takes the form DL-XXX, comma-separated when one ticket covers several entries.
Observation window: how long the signal is
watched, in plain time anchored to an event ("30 days after deploy"). For an UNOBSERVABLE
assumption the window carries the re-review date ("re-review 2026-12-14"), so the ticket is
anchored at creation; "—" only when the ticket has neither a signal to watch nor a re-review.
Exit condition: the condition under which the ticket closes with no further judgment call. A
ticket watching a signal covers three outcomes: the signal fires — close, entry INVALIDATED; the
window ends with the signal wired and quiet — close, entry VALIDATED; the window ends with the
signal never emitted — close, entry UNKNOWN, and the closing note names the instrumentation gap.
For an UNOBSERVABLE assumption the exit condition is the re-review the window dates, named there
once and not copied into the exit condition, whose default disposition is recorded acceptance:
the entry closes VALIDATED, the closing note naming the acceptance, unless a newly available
observable reopens the entry with a signal.

**Decision Log status:** CLOSED   **Closed by:** [developer]   **Date:** [date]
```

**Closing or re-anchoring a ticket, on the record.** A watch closes or re-anchors when you append
one ledger line to the audit log. The line goes under the ticket list or under any later section.
Never rewrite the row that opened the watch. A Decision Log entry closes with the same line shape.
The forms, exactly:

```
- **OT-XXX-1 CLOSED 2026-10-12 → VALIDATED.** The window ended with the signal wired and quiet.
- **OT-XXX-2 RE-ANCHORED 2026-08-27 → 2026-12-24.** The relative window gains its absolute date.
- **DL-002 CLOSED 2026-10-12 → VALIDATED.** The ruling that settles the entry, on the record.
```

The disposition after CLOSED is the outcome: VALIDATED, INVALIDATED, or UNKNOWN. The free prose
after the bold form carries the closing note. The date after CLOSED is the day of the ruling.
RE-ANCHORED carries the day of the ruling, then the absolute due date it grants a watch that had
only a relative window.

A ruled entry's card keeps its own Status line verbatim. The index and every board prefer the
recorded ruling to that Status line. A closed watch never settles its entries by itself. Only a
recorded ruling settles them.

The corpus index reads these lines, and `adp-index/1` harvests the first record per id. So write
each line character-exact. The index reads a near-miss line as prose, and the ticket stays live on
the board until someone fixes the line. To correct a mis-recorded line, fix that line in place.
Never append a second ruling.

A re-anchor never moves a date that the ticket list already set. A window that must move closes with
a disposition, and a successor ticket opens. A closed ticket takes no re-anchor at all. A ruling
line may sit anywhere from the Decision Log section onward. So an entry that review invalidates
closes on the record even before a ticket list exists.

The window rule above forbids one shape: a live watch whose window is the dash while its exit
condition names a calendar date. The harvest reads a due date from the window alone. So that ticket
sits on every board as unanchored, and its date is invisible. `lintCorpus` reports that shape as an
`undated-window` advisory that names the watch id. For a row already on record, a RE-ANCHORED line
that grants the date silences the advisory. A new row writes the date in its window. The advisory
never fails a check and never enters an index document.

Obligation ticket ids take the `OT-` shape, `OT-<TASKID>-<n>`, for example `OT-MC001-3`. The
ledger addresses only that shape and `DL-` entry ids. An id outside those shapes cannot close on the
record. Hold every new ticket list to the `OT-` shape.

Copy a line from the block above, and replace its values. Do not retype the form, and above all
do not retype the arrow. The bare templates:

```
- **<ID> CLOSED <YYYY-MM-DD> → <OUTCOME>.** <closing note>
- **<OT-ID> RE-ANCHORED <YYYY-MM-DD> → <YYYY-MM-DD>.** <why this date>
```

A window that must move closes, and a successor takes its place. The worked motion is one closing
line and one successor row:

```
- **OT-XXX-2 CLOSED 2026-11-01 → UNKNOWN.** The window must move; the signal was never wired.

| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |
|-----------|------------------|------------------------|----------|----------------|--------------------|
| OT-XXX-3 | DL-002 | The same assumption, rewatched with the signal wired | MED | Signal quiet through the window → VALIDATED | 2027-02-01 |
```
