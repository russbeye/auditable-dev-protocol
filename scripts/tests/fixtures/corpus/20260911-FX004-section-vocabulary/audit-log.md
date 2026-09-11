# Audit Log — FX-004 section vocabulary

This fixture writes every section kind once: the fourteen canonical headings, one section of each companion kind, and one ad hoc section. Bodies are short and cite ids so the index has refs to harvest.

## Problem Statement

**What the problem is:** A log needs one section of every kind so the viewers and the index can be checked against the whole vocabulary at once.
**What the problem is not:** A real run. Nothing here was measured.
**Human-level definition of done:** Every kind renders with its label, and the index row reads as expected.
**Confirmed by:** the fixture author   **Date:** 2026-09-11

## Knowledge Gap Document

| Known | Inferred (flagged) | Cannot Determine |
|-------|--------------------|------------------|
| The registry tags fourteen artifact headings. | Companion kinds recur. | Whether a reader ever opens this fixture. |

## Open Questions (resolve before Phase 3)

1. Does one section per kind suffice? → Yes; a second copy would only test deduping, which FX-003 covers.

## Recommendation Brief

**Recommended approach:** One heading per kind, in phase order, companions after the ticket list.
**Defense:** The smallest log that touches every registry row is the cheapest full-vocabulary assertion.
**Assumptions this depends on:** DL-001.

## Pre-Mortem Report

| Failure mode | Likelihood | Impact | Developer response (rebuttal or mitigation) | Monitoring signal | Implemented at |
|--------------|------------|--------|---------------------------------------------|-------------------|----------------|
| A kind is missing from the fixture | L | H | Mitigation: the parser suite counts kinds. | The count test — fires at any kind not seen once | `renderViewerGolden` |

## Implementation Authorization
All HIGH-likelihood items resolved: YES
Authorized by: the fixture author

## Decision Log

### [DL-001] One section per kind
- **Decision:** We write each kind exactly once.
- **Confidence:** HIGH
- **Confidence basis:** DIRECT EVIDENCE — the parser suite counts them.
- **Created:** 2026-09-11 / Phase 5
- **Status:** VALIDATED

### [DL-002] Companions sit after the ticket list
- **Decision:** We place every companion section after the Obligation Ticket List.
- **Confidence:** LOW
- **Confidence basis:** INFERENCE FROM CONVENTION — most logs on record append companions at the end.
- **Created:** 2026-09-11 / Phase 5
- **Status:** OPEN

## Test Adversary Document

**What passing tests prove:** Each kind resolves to its label and the index row holds its shape.
**What passing tests do not prove:**
| Gap | Why untestable / untested | Risk if the assumption is wrong | dl_ref |
|-----|---------------------------|---------------------------------|--------|
| Placement of companions | Order is another ticket's convention | A viewer sorts nothing | DL-002 |

## PR Summary

**Problem being solved:** The vocabulary needs a fixture.
**Approach taken:** One section per kind.
**Key decisions:** DL-001 (HIGH), DL-002 (LOW, flagged below).

## 🚩 Mandatory Review Items (LOW-confidence decisions)

- [ ] DL-002: companions after the ticket list — placement is convention, not rule — reviewer must respond

## Residual Risk

The fixture proves labels, not meaning. A section can wear the right kind and say the wrong thing.

## Test Coverage Gaps

No test reads a section body against its kind.

## Deployment Risk Statement

**Known unknowns at ship time:** DL-002.
**Monitoring targets:**
| Assumption | Signal that it was wrong | Threshold | dl_ref |
|------------|--------------------------|-----------|--------|
| Companions sit last | A log with a companion above its ticket list | One log | DL-002 |
**Rollback trigger conditions:**
- [ ] The kind count test fails on a fresh checkout → rollback
**Staged rollout:** NO — a fixture ships whole.

## Obligation Ticket List

| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |
|-----------|------------------|------------------------|----------|----------------|--------------------|
| OT-FX004-1 | DL-002 | Companions sit after the ticket list | LOW | A log breaks the convention → INVALIDATED | 30 days after merge |
| OT-FX004-2 | DL-001 | One section per kind holds | LOW | The count test stays green → VALIDATED | 2026-10-11 |

**Decision Log status:** CLOSED   **Closed by:** the fixture author   **Date:** 2026-09-11

## Requirement coverage

| Requirement | Covered by |
|-------------|------------|
| Every kind once | The parser suite's kind count, DL-001 |

## Run status

Every phase is written, the ticket list is closed, and the companions below are on the record.

## Review Response — PR #4 (2026-09-12)

The reviewer asked whether the ad hoc section needed a kind of its own. It does not: ad hoc is the kind. No change; DL-002 stays open.

## Post-merge note — PR #4 merged (2026-09-13)

- **OT-FX004-1 RE-ANCHORED 2026-09-13 → 2026-10-13.** The relative window gains its absolute date.
- **OT-FX004-2 CLOSED 2026-09-13 → VALIDATED.** The count test stayed green through the window.

## Sweep amendment — 2026-09-14

A later sweep read this log and found nothing to amend. The line exists so the kind exists.

## Naming note

Why "kind" and not "type": the index already uses type words for tokens, and a section's kind is a reading of its title, not a schema. This heading matches no row on purpose.
