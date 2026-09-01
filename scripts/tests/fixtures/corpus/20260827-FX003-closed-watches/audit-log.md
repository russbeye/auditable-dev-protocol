# FX-003 — closure ledger fixture

## Decision Log

### [DL-001] Ledger decision
- **Decision:** We close watches on the record.
- **Confidence:** HIGH
- **Status:** OPEN

- **OT-FX003-3 CLOSED 2026-09-05 → INVALIDATED.** A record above the ticket list is prose.

## Obligation Ticket List

| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |
|-----------|------------------|------------------------|----------|----------------|--------------------|
| OT-FX003-1 | DL-001 | The closed watch leaves the board | LOW | Ruled below | 60 days after merge |
| OT-FX003-2 | DL-001 | The relative window gains its date | LOW | Ruled below | 45 days after merge |
| OT-FX003-3 | DL-001 | The live watch stays live | LOW | Still riding | Re-review 2026-12-01 |

## Review addendum

- **OT-FX003-1 CLOSED 2026-09-10 → VALIDATED.** The window ended with the signal wired and quiet.
- **OT-FX003-1 CLOSED 2026-09-20 → INVALIDATED.** A second ruling is a contradiction; the first stands.
- **OT-FX003-2 RE-ANCHORED 2026-08-27 → 2026-12-24.** The relative window gains its absolute date.
- **OT-FX003-3 RE-ANCHORED 2026-08-27 → 2026-11-30.** The row's own window already anchors it, so this line lands nowhere.
- **OT-FX003-9 CLOSED 2026-09-01 → VALIDATED.** No row carries this id, so nothing harvests.
- **OT-FX003-3 CLOSED → UNKNOWN.** A dateless near-miss stays prose.
- **OT-FX003-3 CLOSED 2026-02-30 → VALIDATED.** A rollover date fails the calendar gate.
- **OT-FX003-3 CLOSED not-a-date → VALIDATED.** A word in the date slot fails the same gate.
- **OT-FX003-1 RE-ANCHORED 2026-02-30 → 2026-12-25.** A rollover ruling date fails the gate.
- **OT-FX003-1 RE-ANCHORED 2026-09-12 → 2026-13-01.** A thirteenth month fails the target gate.
- **DL-001 CLOSED 2026-09-12 → VALIDATED.** The ruling lands on the card as a recorded pair.
- **DL-009 CLOSED 2026-09-12 → VALIDATED.** No card carries this id, so nothing harvests.

```
- **OT-FX003-3 CLOSED 2026-09-15 → VALIDATED.** A fenced ledger line never harvests.
```
