# PR Review — PR #1 round 1 · 20261109-BX001-browser-checks

## Review Target
- **Schema:** adp-pr-review/1
- **Task:** 20261109-BX001-browser-checks
- **Mode:** PR
- **PR:** #1
- **Branch:** bx001-fixture → main
- **Head:** aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
- **Round:** 1
- **Previous round:** —
- **Date:** 2026-11-09

## Findings

### [PR-TST-001] The fixture finding carries a confidence pill and a status pill inside its card
- **Severity:** should
- **Category:** TST — Tests
- **Location:** `scripts/browser/corpus/README.md:1` (RIGHT)
- **Claim:** The card shows its pills inline beside their labels.
- **Evidence:** The browser test reads the pills' boxes.
- **Failure scenario:** A pill drops onto a line of its own in one engine.
- **Suggested fix:** None. The finding exists for the layout check.
- **Confidence:** MEDIUM
- **Confidence basis:** INFERENCE FROM CONVENTION — the card grammar.
- **Created:** 2026-11-09, round 1
- **Status:** OPEN

## Review Verdict
- **Verdict:** COMMENT
- **Confidence:** HIGH
- **Counts:** must 0 / should 1 / question 0 / nit 0
- **Opened:** PR-TST-001
- **Closed:** —
