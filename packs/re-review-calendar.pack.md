=== ADP PACK re-review-calendar/v1 · {{index.generated}} ===
corpus: {{index.project}} · {{ticket_count}} tickets · dated live watches in due order

{{#calendar}}{{due}}  {{tid}} {{wid}}  [{{state}}]  {{what}}
{{/calendar}}{{^calendar}}(no dated live watch on record)
{{/calendar}}
Each line is a date the record committed to. On the date, or at once for
a line already past it, open the ticket's log, read the watch's exit
condition, and rule the watch with a CLOSED ledger line. Before the date,
only a fired signal closes a watch. A re-review that finds no new
observable closes VALIDATED, the acceptance recorded in its closing note.
Undated watches are not on this calendar: a watch with a relative window,
or a dated exit condition beside a dash window, gains its date with a
RE-ANCHORED line; a watch with neither stays undated.
=== END PACK ===
