/* The viewer's example document, verbatim. This mirrors the EXAMPLE template
   literal in scripts/ADP-Parser.html. If that example changes, update this
   file to match, then regenerate the golden output from the repo root and
   review the diff before committing:

     node -e "const h=require('./scripts/tests/helpers.js');require('fs').writeFileSync('scripts/tests/fixtures/viewer-example.html',h.renderViewerGolden(require('./scripts/tests/fixtures/viewer-example.js')))"
*/
"use strict";

module.exports = `## Problem Statement
**What the problem is:** Add server-side validation to the signup email field so malformed addresses are rejected before they reach the users table.
**What the problem is not:** This is *not* a change to client-side validation, and *not* email deliverability/verification mail.
**Human-level definition of done:** A bad address posted to signup returns a clear 422 and never creates a row.
**Confirmed by:** rbeye   **Date:** 2026-06-18

## Knowledge Gap Document
| Known | Inferred (flagged) | Cannot Determine |
|-------|--------------------|------------------|
| Signup handler parses the body at \`src/signup/handler.ts:42\` | Validation belongs in the handler, not middleware | Whether downstream relies on bad rows |
| No validation exists today | A parser beats a regex | Email volume per day |

## Open Questions (resolve before Phase 3)
1. Should plus-addressing be allowed? → RESOLVED: yes, use a parser not a regex.
2. Reject or sanitize? → ACCEPTED UNKNOWN — logged to Decision Log.

## Recommendation Brief
**Recommended approach:** Validate in the handler with a tolerant RFC-5321 parser, return 422 on failure.
**Defense:** Smallest reversible change; keeps the rule next to persistence; a parser avoids the plus-address bug a regex caused before.
**Alternatives considered:**
| Alternative | Reason rejected |
|-------------|-----------------|
| Regex check | Rejected valid plus-addressed emails last time |
| Middleware layer | Spreads the rule away from where the row is written |

## Pre-Mortem Report
Assumed: this implementation failed in production. Most likely causes:
| Failure mode | Likelihood | Impact | Developer response | Monitoring signal | Implemented at |
|--------------|------------|--------|--------------------|-------------------|----------------|
| Parser rejects valid intl addresses | M | H | Mitigated: use a spec-tolerant parser; add intl test cases | 422 rate on /signup — fires above 2% in 1h — distinguishes: a spam wave, which spikes raw attempts too | PENDING |
| 422 breaks a client expecting 400 | L | M | Rebutted: clients treat 4xx uniformly here | UNOBSERVABLE — no client telemetry reaches us | — |

## Implementation Authorization
All HIGH-likelihood items resolved: YES
Authorized by: rbeye

## Decision Log

### [DL-001] Validate in handler, not middleware
- **Decision:** Put the check in \`handler.ts\` beside the insert.
- **Alternatives considered:** Express middleware; a DB constraint.
- **Rationale:** Keeps the invariant next to the write; easiest to test.
- **Confidence:** HIGH
- **Assumptions:** Signup is the only writer of the users.email column.
- **Status:** VALIDATED

### [DL-002] Reject rather than sanitize
- **Decision:** Return 422 instead of trying to fix the address.
- **Rationale:** Silent fixes hide client bugs.
- **Confidence:** LOW
- **Assumptions:** Product wants hard rejection, not best-effort repair.
- **Status:** OPEN

### [DL-003] Count rejections with a reason code
- **Decision:** Emit a \`signup_email_rejected\` counter tagged with the parser's reason.
- **Rationale:** The rollback trigger reads this counter; without it the 422 rate is invisible.
- **Confidence:** MEDIUM
- **Assumptions:** The metrics pipeline ships the counter to the signup dashboard.
- **Monitoring signal:** \`signup_email_rejected\` on the signup dashboard — fires above 2% of attempts in 1h — distinguishes: a spam wave, which also spikes raw attempts.
- **Status:** UNKNOWN — the counter never appeared on the dashboard by review time.

## Test Adversary Document
**What passing tests prove:** Malformed addresses get 422 and create no row; valid plus-addresses pass.
**What passing tests do not prove:**
| Gap | Why untestable / untested | Risk if the assumption is wrong |
|-----|---------------------------|---------------------------------|
| Real-world intl addresses | Test set is finite | A valid user is blocked |
| Concurrent duplicate signups | Not exercised | Race could double-insert |

## PR Summary
**Problem being solved:** Bad emails reach the users table.
**Approach taken:** Tolerant parser in the handler; 422 on failure.
**Key decisions:** DL-001 (HIGH) handler-side; DL-002 (LOW) reject-not-sanitize.

## 🚩 Mandatory Review Items (LOW-confidence decisions)
- [ ] DL-002: reject vs sanitize — confirm product wants hard rejection — reviewer must respond.

## Residual Risk
Reject-not-sanitize is unconfirmed with product; intl coverage is finite, and APPENDING more fixtures still leaves UNKNOWNS in the corpus.

## Test Coverage Gaps
Concurrency, exhaustive international address shapes, and the UNOBSERVABLES named above are not covered by tests.

## Deployment Risk Statement
**Known unknowns at ship time:** DL-002 product intent.
**Monitoring targets:**
| Assumption | Signal that it was wrong | Threshold |
|------------|--------------------------|-----------|
| Rejection is rare | 422 rate on /signup | > 2% of attempts in 1h |
**Rollback trigger conditions:**
- [ ] 422 rate on /signup exceeds 2% for 1h → rollback
**Staged rollout:** YES — 10% then 100%.

## Obligation Ticket List
| Ticket ID | Decision Log ref | Assumption to validate | Priority |
|-----------|------------------|------------------------|----------|
| GROW-6701 | DL-002 | Product confirms reject-not-sanitize | HIGH |
| GROW-6702 | DL-003 | The rejection counter reaches the dashboard | MEDIUM |
**Decision Log status:** OPEN — two tickets outstanding.`;
