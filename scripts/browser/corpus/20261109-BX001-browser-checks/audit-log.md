# BX-001 — browser check fixture

## Problem Statement
**What the problem is:** The browser tests need one ticket whose text is hostile, whose watch window is long prose, and whose log is taller than the stage. <img src=x onerror="window.__adpHostile='img'"> <script>window.__adpHostile='script'</script>
**What the problem is not:** It is not a real run. [a script link](javascript:window.__adpHostile='link') and <a href="javascript:window.__adpHostile='anchor'">a raw anchor</a> stay text.
**Human-level definition of done:** Every check reads this ticket and the fixture corpus, and nothing on the page runs script from the log.
**Confirmed by:** fixture   **Date:** 2026-11-09
**Revision history:** —

## Knowledge Gap Document

We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. 

## Recommendation Brief

We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. 

## Pre-Mortem Report

We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. 

## Decision Log

### [DL-001] The fixture holds hostile markup in a decision card
- **Decision:** The card holds `<b>code</b>` and raw <svg onload="window.__adpHostile='svg'"></svg> markup.
- **Alternatives considered:** <iframe src="javascript:window.__adpHostile='iframe'"></iframe>
- **Rationale:** We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. 
- **Confidence:** LOW
- **Confidence basis:** DEVELOPER ASSERTION — the fixture says so.
- **Assumptions:** The parser escapes every tag.
- **Monitoring signal:** UNOBSERVABLE — a fixture has no production.
- **Created:** 2026-11-09, Phase 5
- **Status:** OPEN

## Test Adversary Document

We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. 

## PR Summary

We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. 

## Deployment Risk Statement

We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. We hold this paragraph long enough that the full log runs taller than the stage, so the scroll spy has sections to pass. The words carry no meaning for the checks beyond their height. 

## Obligation Ticket List
| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |
|-----------|------------------|------------------------|----------|----------------|--------------------|
| OT-BX001-1 | DL-001 | The parser escapes every tag | LOW | The window ends with no script run → VALIDATED | until the developer's next live session with the testbed, no later than the start of the following quarter's release train |

**Decision Log status:** OPEN   **Closed by:** —   **Date:** —

## Review findings — PR #1 round 2 (2026-11-09)
- **Review file:** `.adp/20261109-BX001-browser-checks/pr-review-PR1-20261109-r2.md`
- **Verdict:** APPROVE
