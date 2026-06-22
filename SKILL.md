---
name: auditable-dev-protocol
description: >-
  A binding 9-phase protocol for rigorous, auditable AI-assisted development: it makes the model stake
  one defensible recommendation instead of hedging, log every non-trivial decision and assumption
  (with confidence) as it's made, and produce traceable artifacts — Problem Statement, Recommendation
  Brief, Pre-Mortem, live Decision Log, Test Adversary doc, confidence-weighted PR summary, deployment
  risk statement. Trigger when the user asks to apply this protocol or to produce these artifacts for a
  code change, AND proactively before high-stakes, hard-to-reverse work: schema/data migrations,
  auth/session/permissions, payments or billing, destructive/irreversible ops, public API/contract
  changes, concurrency/locking. Do NOT trigger for trivial edits (renames, one-liners), routine
  reversible work (dependency bumps, mechanical refactors, UI/CSS fixes), read-only "how does X work"
  questions, security reviews of existing code, or casual non-software uses (a "decision log" for
  standup, a "pre-mortem" for an event).
license: MIT
---

# Auditable AI-Assisted Development Protocol

A protocol for AI-assisted software development that enforces epistemic rigor, produces traceable
artifacts, and compensates for the model's absence of skin in the game.

## Why this exists

You optimize for **plausibility**. This protocol forces you to optimize for **defensibility**.

Passing tests is not correctness. A plan that looks right is not a plan that is right. You have no
reputation to protect, no production incident on your record, no consequence for confident wrongness.
This protocol manufactures synthetic accountability through forced justification, phase gates, and
auditable artifacts — so your reasoning is always on record and always traceable to what actually
happened.

Skipping a phase does not cancel it. It creates an unacknowledged assumption that must be logged.

## When to run it

- **Explicitly**, whenever the developer invokes it by name or asks for any of its artifacts.
- **Proactively**, before high-stakes or hard-to-reverse work — migrations, auth/permissions, money,
  destructive operations, public contracts, concurrency. Offer it; don't force it.
- **Not at all** for trivial work. A one-line rename does not need a Pre-Mortem. If asked to run the
  full protocol on something trivial, say so and propose a lightweight version (Problem Statement +
  Decision Log only). The protocol biases toward caution over speed; for small tasks, use judgment.

## The prompt template

This skill ships a structured prompt format so a request arrives already framed for the protocol. A
filled prompt states the lens to reason from, the ask, the constraints, the context, prior dead ends,
the shape of the output, the requirements that define done, and which artifacts to produce. It is YAML
so the structure can be validated.

- **`prompts/prompt-template.yaml`** — the clean template. Copy it, fill it, delete what you don't need.
- **`references/prompt-template-annotated.yaml`** — every field and every option documented, including
  the full `output.format` and `protocol.artifacts` value sets.
- **`scripts/validate-prompt.py`** — checks a filled prompt for required keys, types, and allowed
  values. Run `python3 scripts/validate-prompt.py <file>`; it exits non-zero and lists what is wrong.

**When invoked directly, nudge first.** Before you restate the problem in Phase 1, point the developer
at the template. Offer to draft one pre-filled with whatever they have already given you — the ask,
file paths, constraints, anything already in the conversation — and ask where to save it. If they
decline, proceed to Phase 1 as normal. A filled prompt is an input to the protocol, not a replacement
for any phase.

## Your stance inside the protocol

The protocol changes how you behave, not just what you output. Hold these throughout:

- **You are being interrogated, not approved.** The developer's job at each gate is to probe and
  challenge. Expect to defend your reasoning. Output that merely "looks correct" is not the goal.
- **Stake claims, don't offer options.** Presenting alternatives without a defended recommendation is
  a hedge, and hedges are rejected and sent back. Commit to one position and defend it. "It depends"
  without a committed answer is not an answer.
- **No silent assumptions.** Any assumption not written into the Decision Log does not exist as far as
  the protocol is concerned. Log it the moment you make it — with its confidence level — not at PR time.
- **Gates are real stops.** Do not begin the next phase while the current artifact has unresolved open
  items. When working with a human in the loop, stop at the gate and wait for confirmation. When that
  isn't possible (you're running solo or one-shot), write the gate confirmation out explicitly as a
  forcing function and proceed on your stated best assumption, logged.

## The artifact chain

```
Phase 1  Observation        → Problem Statement Document
Phase 2  Literature Review  → Knowledge Gap Document
Phase 3  Hypothesis         → Recommendation Brief
Phase 4  Research Design    → Pre-Mortem Report
Phase 5  Implementation     → Annotated Decision Log   (live — the spine)
Phase 6  Analysis           → Test Adversary Document
Phase 7  Synthesis          → Confidence-Weighted PR Summary
Phase 8  Communication      → Deployment Risk Statement
Phase 9  The Loop           → Obligation Ticket List
```

Each artifact feeds the next; none may be produced while the prior one has open items. The **Decision
Log** is the spine — it opens in Phase 5, stays live through Phase 8, and is the first thing you open
when something breaks.

**Persist everything to one audit-log file, written live.** At Phase 1, create a single markdown file
(e.g. `docs/audit-log-<feature>.md`) and make it the system of record for the entire run. Append each
artifact to it **in full, the moment it is formulated** — the Problem Statement before Phase 2 begins,
each Decision Log entry as the decision is made, each later phase's document as you produce it. The file
is a living document the developer watches grow in real time; it is never reconstructed or dumped in one
shot at the end. The conversation is a mirror of the file, never its replacement — it may be summarized,
truncated, or gone by the time anyone audits the work. Therefore **no artifact may be reduced to a
summary that points back to "the conversation" (or any other ephemeral context).** Every phase's
artifact lives in the file, complete, even when a later phase repeats or supersedes an earlier one.

## Core principles

1. **No ambiguity is carried forward.** Each phase resolves its open questions before the next begins.
   Unresolved questions become logged assumptions, not silent decisions.
2. **Stake claims, not options.** A defended recommendation, never a menu.
3. **Artifacts are liabilities, not deliverables.** Each one can be audited against what actually
   happened. Write them as if a post-incident reviewer will read them.
4. **The Decision Log is the spine.** Every other artifact is a phase snapshot; the log is the
   continuous thread.
5. **The audit log is written live and kept whole.** Every artifact is appended to the persisted file
   the moment it exists, in full. Nothing is batched for the end; nothing is collapsed into a summary
   that defers to the conversation — the conversation is not guaranteed to survive.
6. **The developer is an interrogator, not an approver.**
7. **Follow-up obligations are first-class.** Unvalidated assumptions don't expire — they become tickets.

---

## Phase 1 — Observation

**Do:** Restate the problem in your own words before any planning. The restatement must cover what the
problem **is**, what it is **not**, and what success looks like at a human level (not a test level).
Create the persisted audit-log file now (see *The artifact chain*) and write this Problem Statement into
it as the first entry — every later artifact appends to the same file, live, in full.

**Gate:** The developer must confirm the restatement. Loop on corrections until confirmed, then treat
it as locked — it doesn't change without a logged reason.

**Output — Problem Statement Document:**
```
## Problem Statement
**What the problem is:** [restatement]
**What the problem is not:** [explicit exclusions]
**Human-level definition of done:** [what done looks like before any tests exist]
**Confirmed by:** [developer]   **Date:** [date]
**Revision history:** [if amended, the reason]
```

## Phase 2 — Literature Review

**Do:** Two inputs, in order. (1) **Codebase context from the developer** — architecture, conventions,
operational and org constraints, system history and intent; the situational awareness a senior engineer
carries that lives in no file. Ask for it. (2) **Directed code reading by you** — targeted examination
to answer questions the Problem Statement raised. Directed by hypotheses, not curiosity. Then build a
three-column knowledge inventory.

**Gate:** Every "Cannot Determine" item is resolved by the developer or explicitly logged as an
accepted unknown before Phase 3.

**Output — Knowledge Gap Document:**
```
## Knowledge Gap Document
| Known | Inferred (flagged) | Cannot Determine |
|-------|--------------------|------------------|
| ...   | ...                | ...              |

## Open Questions (resolve before Phase 3)
1. [question] → [resolution OR: ACCEPTED UNKNOWN — logged to Decision Log]
```

## Phase 3 — Hypothesis

**Do:** Stake a single recommended approach and defend it — not just what it does, but why it beats the
alternatives. Enumerate the alternatives you considered and give a written rejection of each. Sitting on
the fence is not permitted.

**Gate:** The developer interrogates the recommendation; you defend it. If it changes under
interrogation, the new recommendation restarts this phase.

**Output — Recommendation Brief:**
```
## Recommendation Brief
**Recommended approach:** [single, specific]
**Defense:** [why this beats the alternatives]
**Alternatives considered:**
| Alternative | Reason rejected |
|-------------|-----------------|
| ...         | ...             |
**Assumptions this depends on:** [each becomes a tracked Decision Log item]
```

## Phase 4 — Research Design

**Do:** Pre-mortem your own plan. Assume it has failed in production six months out and enumerate the
most likely causes, each rated by likelihood and impact.

**Gate:** Every HIGH-likelihood failure mode must be rebutted with reasoning or mitigated with a design
change before Phase 5. Medium/low items are logged. Open HIGH items **block implementation**.

**Output — Pre-Mortem Report:**
```
## Pre-Mortem Report
Assumed: this implementation failed in production. Most likely causes:
| Failure mode | Likelihood | Impact | Developer response (rebuttal or mitigation) |
|--------------|------------|--------|---------------------------------------------|
| ...          | H/M/L      | H/M/L  | ...                                         |

## Implementation Authorization
All HIGH-likelihood items resolved: [YES / NO — if NO, blocked]
Authorized by: [developer]
```

## Phase 5 — Implementation

**Do:** Write the code. Annotate every non-trivial decision in the Decision Log **as you make it** — no
silent choices, no batching it up for PR time. A decision made under uncertainty is logged with its
confidence level immediately. The log is a living document that grows here and stays open through Phase 8.

**Gate:** "Done" is not "compiles" or "tests pass." Done is: every decision in the implementation has a
corresponding Decision Log entry.

**Output — Annotated Decision Log** *(the spine):*
```
## Decision Log

### [DL-001] [short title]
- **Decision:** what was chosen
- **Alternatives considered:** what else was evaluated
- **Rationale:** why this and not those
- **Confidence:** HIGH / MEDIUM / LOW
- **Assumptions:** what must be true for this to be correct
- **Created:** [date/phase]
- **Status:** OPEN / VALIDATED / INVALIDATED

[repeat per non-trivial decision]
```

## Phase 6 — Analysis

**Do:** Write tests to **falsify**, not to confirm. Then enumerate what passing tests do **not** prove —
the untestable assumptions, the scenarios tests can't reach, the conditions under which the code could
be wrong despite green CI.

**Gate:** The Test Adversary Document exists before the PR is opened. A PR without it is missing its
analysis phase.

**Output — Test Adversary Document:**
```
## Test Adversary Document
**What passing tests prove:** [explicit scope of coverage]
**What passing tests do not prove:**
| Gap | Why untestable / untested | Risk if the assumption is wrong |
|-----|---------------------------|---------------------------------|
| ... | ...                       | ...                             |
**Untestable assumptions logged to Decision Log:** [reference DL entries]
```

## Phase 7 — Synthesis

**Do:** Write the PR description as a confidence-weighted summary — not a changelog. Explain decisions,
rejected alternatives, and residual risk. Surface every LOW-confidence Decision Log entry for
**mandatory** (not optional) human review.

**Gate:** Every LOW-confidence DL entry appears in the PR summary as a flagged review item that
reviewers must respond to.

**Output — Confidence-Weighted PR Summary:**
```
## PR Summary
**Problem being solved:** [→ Problem Statement Document]
**Approach taken:** [→ Recommendation Brief; note any deviations and why]
**Key decisions:** [→ Decision Log; HIGH summarized, MED/LOW flagged]

## 🚩 Mandatory Review Items (LOW-confidence decisions)
- [ ] [DL-XXX]: [decision] — [why confidence is low] — reviewer must respond

## Residual Risk
[what is still unknown or unvalidated at merge time]

## Test Coverage Gaps
[→ Test Adversary Document — what reviewers should know tests don't cover]
```

## Phase 8 — Communication

**Do:** Before deploying, document the known unknowns at ship time, what monitoring should catch if an
assumption was wrong, and explicit rollback triggers.

**Gate:** Rollback trigger conditions are defined before deployment. "We'll know if something is wrong"
is not a trigger condition — name the observable signal and threshold.

**Output — Deployment Risk Statement:**
```
## Deployment Risk Statement
**Known unknowns at ship time:** [→ Decision Log OPEN items]
**Monitoring targets:**
| Assumption | Signal that it was wrong | Threshold |
|------------|--------------------------|-----------|
| ...        | ...                      | ...       |
**Rollback trigger conditions:**
- [ ] [specific, observable condition] → rollback
**Staged rollout:** [YES / NO — if NO, justify]
```

## Phase 9 — The Loop

**Do:** After deployment, review every OPEN or UNVALIDATED Decision Log assumption. Each one not
resolved during implementation becomes an Obligation Ticket — a first-class work item, not a
suggestion — that traces back to the DL entry that created it.

**Gate:** The Decision Log is marked CLOSED only when every entry is VALIDATED, INVALIDATED, or has a
corresponding ticket. No entry stays OPEN without a ticket.

**Output — Obligation Ticket List:**
```
## Obligation Ticket List
| Ticket ID | Decision Log ref | Assumption to validate | Priority |
|-----------|------------------|------------------------|----------|
| ...       | DL-XXX           | ...                    | ...      |
**Decision Log status:** CLOSED   **Closed by:** [developer]   **Date:** [date]
```

---

## Enforcement rules

| Rule | What it means |
|------|---------------|
| No phase skipping | Skipping a phase doesn't cancel it — it creates an unacknowledged assumption, logged immediately to the Decision Log at LOW confidence. |
| No silent assumptions | An assumption not in the Decision Log does not exist, protocol-wise. |
| No artifact deferred to the conversation | Every phase's artifact is written to the audit-log file in full. A phase reduced to a summary that points at "the conversation" (or any ephemeral context) is a violation — that context may be gone at audit time. |
| The log is written live, not reconstructed | Each artifact is appended the moment it is formulated, never held in memory and dumped at the end. The developer must be able to watch the file grow. |
| No hedged recommendations | Commit to a position. Options without a defense are a hedge and are rejected. |
| No PR without a Test Adversary Document | Analysis must complete before synthesis. |
| No open HIGH-likelihood failure modes | The Pre-Mortem must show all HIGH items resolved before implementation. |
| No open Decision Log entries without tickets | The loop closes the log. OPEN entries without tickets are protocol violations. |

## Solo vs. team

- **Solo:** You and the developer play both roles — interrogator and gate authority. Self-approval is
  the main failure mode. Write the gate confirmations out explicitly even alone; that's the forcing
  function.
- **Team:** Phase 4 (Pre-Mortem) and Phase 7 (mandatory review items) should involve someone other than
  the primary developer. The Decision Log is shared and visible to reviewers throughout.

## When something breaks

Consult `references/failure-modes.md` — it maps a symptom (production bug, "tests passed but production
failed", wrong problem solved, forgotten follow-up) to the artifact you open first. It also covers the
tool-agnostic linking requirements for where artifacts live.
