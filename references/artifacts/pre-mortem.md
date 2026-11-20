**Output: Pre-Mortem Report**
```
## Pre-Mortem Report
Assumed: this implementation failed in production. Most likely causes:
| Failure mode | Likelihood | Impact | Developer response (rebuttal or mitigation) | Monitoring signal | Implemented at |
|--------------|------------|--------|---------------------------------------------|-------------------|----------------|
| ...          | H/M/L      | H/M/L  | ...                                         | [observable] — fires at [threshold] — distinguishes: [nearest benign look-alike], OR UNOBSERVABLE — [justification] | [path § "verbatim anchor" (line N, advisory)] / PENDING / — |

Monitoring signal: an observable a person can check with no tooling — a log line, a count, an error rate,
a report channel — the threshold at which this failure mode counts as happening, and what
distinguishes it from the nearest benign condition that could produce the same reading.
UNOBSERVABLE requires a justification for why no observable exists, not why nobody got to it; a
reviewer challenges that claim at this report's gate, before authorization.

Implemented at (mitigations only, "—" on rebuttal rows): PENDING until the
mitigation lands, then a verbatim anchor copied exactly from the implementing code — an identifier,
comment text, or an exact line, unique within its file when written. Any line number is an advisory
hint. Anchor found where the hint says: the reference holds. Found elsewhere in the file: drifted —
update the hint. Absent from the file: the reference is dead and the mitigation counts as
unverified — reopen it as a Decision Log entry or ticket. A PENDING that survives implementation
reads as a promised, unimplemented mitigation.

## Implementation Authorization
All HIGH-likelihood items resolved: [YES / NO — if NO, blocked]
Authorized by: [developer]
```
