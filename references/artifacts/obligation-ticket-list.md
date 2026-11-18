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

**Closing or re-anchoring a ticket, on the record.** A watch closes or re-anchors by appending
one ledger line to the log — under the ticket list or any later section — never by rewriting
the row that opened it. The same line shape rules a Decision Log entry. The forms, exactly:

```
- **OT-XXX-1 CLOSED 2026-10-12 → VALIDATED.** The window ended with the signal wired and quiet.
- **OT-XXX-2 RE-ANCHORED 2026-08-27 → 2026-12-24.** The relative window gains its absolute date.
- **DL-002 CLOSED 2026-10-12 → VALIDATED.** The ruling that settles the entry, on the record.
```

The disposition after CLOSED is the outcome — VALIDATED, INVALIDATED, or UNKNOWN — and the
free prose after the bold form carries the closing note. The date after CLOSED is the day of
the ruling. RE-ANCHORED carries the day of the ruling, then the absolute due date it grants a
watch that had only a relative window. A ruled entry's card keeps its own Status line verbatim;
the recorded ruling is what the index and every board prefer, and a closed watch never settles
its entries by itself — only a recorded ruling does. The corpus index reads these lines
(`adp-index/1` harvests the first record per id), so write them character-exact: a near-miss
line is prose, and the ticket stays live on the board until the line is fixed. A mis-recorded
line is corrected by fixing it in place, never by appending a second ruling. A re-anchor never
moves a date the ticket list already set — a window that must move closes with a disposition,
and a successor ticket opens — and a closed ticket takes no re-anchor at all. A ruling line
may sit anywhere from the Decision Log section onward, so an entry invalidated in review
closes on the record even before a ticket list exists.

A live watch whose window is the dash while its exit condition names a calendar date is the shape
the window rule above forbids: the harvest reads a due date from the window alone, so the ticket
sits on every board as unanchored and its date is invisible. `lintCorpus` reports it as an
`undated-window` advisory naming the watch id. A RE-ANCHORED line granting the date silences it
for a row already on record; a new row writes the date in its window. The advisory never fails a
check and never enters an index document.

Obligation ticket ids take the `OT-` shape — `OT-<TASKID>-<n>`, like `OT-MC001-3` — and the
ledger addresses only that shape and `DL-` entry ids. An id outside those shapes cannot close
on the record, so hold every new ticket list to it.

Copy a line from the block above and replace the values rather than retyping the form — the
arrow especially. The bare templates:

```
- **<ID> CLOSED <YYYY-MM-DD> → <OUTCOME>.** <closing note>
- **<OT-ID> RE-ANCHORED <YYYY-MM-DD> → <YYYY-MM-DD>.** <why this date>
```

A window that must move closes and succeeds. The worked motion — one closing line, one
successor row:

```
- **OT-XXX-2 CLOSED 2026-11-01 → UNKNOWN.** The window must move; the signal was never wired.

| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |
|-----------|------------------|------------------------|----------|----------------|--------------------|
| OT-XXX-3 | DL-002 | The same assumption, rewatched with the signal wired | MED | Signal quiet through the window → VALIDATED | 2027-02-01 |
```
