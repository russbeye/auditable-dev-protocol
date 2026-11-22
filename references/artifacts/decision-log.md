**Output: Annotated Decision Log** *(the spine)*
```
## Decision Log

### [DL-001] [short title]
- **Supersedes:** [DL-XXX when this entry replaces an earlier decision; omit the line otherwise]
- **Decision:** what was chosen
- **Alternatives considered:** what else was evaluated
- **Rationale:** why this and not those
- **Confidence:** HIGH / MEDIUM / LOW
- **Confidence basis:** DIRECT EVIDENCE / INFERENCE FROM CONVENTION / DEVELOPER ASSERTION — one line naming the evidence, the convention, or who asserted what
- **Assumptions:** what must be true for this to be correct
- **Monitoring signal:** → Pre-Mortem: "[verbatim failure-mode text]", OR [observable] — fires at [threshold] — distinguishes: [nearest benign look-alike], OR UNOBSERVABLE — [justification]
- **Created:** [date/phase]
- **Status:** OPEN / VALIDATED / INVALIDATED / UNKNOWN

Monitoring signal is required only while Status is OPEN and the
entry holds an assumption. It names what would disprove the assumption, either by pointing at the
Pre-Mortem row that owns the signal (quote its failure-mode text verbatim) or by declaring one
inline in the same observable/threshold/distinguishes form. An UNOBSERVABLE signal on an OPEN entry
is challenged when the log is reviewed at PR time. UNKNOWN is judged at observation time: the
declared signal was never emitted — the instrumentation was absent or never wired — so nothing can
be concluded. A wired signal that stayed quiet through its observation window validates instead,
and not-yet-observed stays OPEN. An UNKNOWN entry closes the log only through a ticket, the same as
OPEN. A phase deferral declared in the prompt (protocol.defers) opens one LOW-confidence entry
here, plus an obligation ticket, at the start of the run.

An entry is immutable once written, apart from its Status line and a dated status note. Never
rewrite a decision: a changed or reversed decision is a new entry whose Supersedes field names
the entry it replaces, so the full chain of choices stays on the record. Gate confirmations and
any other block material — blockquotes, fenced code, tables — go before the section's first
entry, never inside one; within an entry, nothing follows the fields.

[repeat per non-trivial decision]
```
