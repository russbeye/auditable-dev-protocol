# AV-090 — legacy inferred fixture

## Problem Statement

The template quotes DL-XXX and DL-00x, which are placeholders, never citations.

## Decision Log

```
### [DL-077] A fenced head never becomes a card
DL-055 sits inside a fence and never becomes a citation.
```

### [DL-001] Only decision
- **Supersedes:** DL-XXX stays template text, so no key is emitted.
- **Decision:** We record one decision.
- **Confidence:** LOW
- **Confidence basis:** DEVELOPER ASSERTION — fixture data.
- **Created:** 2026-07-01 / Phase 5
- **Status:** OPEN

```
An in-card fence: DL-777 stays out of every field, every ref, and the whole index.
```

## Decision Log

The duplicate heading demotes to non-canonical. Its prose cites DL-001.

## Obligation Ticket List

| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |
|-----------|------------------|------------------------|----------|----------------|--------------------|
| OT-1 | DL-001 | The fixture stays legacy | LOW | Review closes it | 60 days after merge |
| OT-2 | DL-XXX | Placeholders never reach a dl list | LOW | Review closes it | — |
| — | — | — | — | — | — |

**Decision Log status:** CLOSED   **Closed by:** fixture   **Date:** 2026-07-15
