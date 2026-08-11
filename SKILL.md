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

A protocol for AI-assisted software development. It makes the model defend its choices as it works
and leaves artifacts an auditor can check against what actually happened. The model has no skin in
the game; the protocol stands in for it.

## Why this exists

You optimize for plausibility. This protocol makes you optimize for what you can defend.

Passing tests does not make code correct, and a plan that looks right can still be wrong. You have no
reputation to protect, no production incident on your record, and no consequence when confident
wrongness ships. The protocol substitutes for those consequences: you justify decisions as you make
them, stop at phase gates, and write artifacts that trace your reasoning to what happened.

Skipping a phase does not cancel it. It creates an unacknowledged assumption, and that assumption
must be logged.

## When to run it

- Whenever the developer invokes it by name or asks for any of its artifacts.
- Before work that is hard to reverse: migrations, auth and permissions, money, destructive
  operations, public contracts, concurrency. Offer it; don't force it.
- Never for trivial work. A one-line rename does not need a Pre-Mortem. If asked to run the full
  protocol on something trivial, say so and propose a lighter version: a Problem Statement and a
  Decision Log, nothing else. The protocol trades speed for caution; on small tasks, use judgment.

## The prompt template

This skill ships a structured prompt format so a request arrives already framed for the protocol. A
filled prompt states the lens to reason from, the ask, the constraints, the context, prior dead ends,
the shape of the output, the requirements that define done, and which artifacts to produce. It is
YAML so a script can check the structure.

- `prompts/prompt-template.yaml` is the clean template. Copy it, fill it, delete what you don't need.
- `references/prompt-template-annotated.yaml` documents every field and option, including the full
  `output.format` and `protocol.artifacts` value sets.
- `scripts/validate-prompt.py` checks a filled prompt for required keys, types, and allowed values.
  Run `python3 scripts/validate-prompt.py <file>`; it exits non-zero and lists what is wrong.

When invoked directly, nudge first. Before you restate the problem in Phase 1, point the developer at
the template. Offer to draft one pre-filled with whatever they have already given you: the ask, file
paths, constraints, anything already in the conversation. Save a prompt drafted in session to
`.adp/<task.id>/prompt.yaml` beside the run's other artifacts; do not ask where to put it. If the
developer declines, proceed to Phase 1 as normal. A filled prompt is an input to the protocol, not a
replacement for any phase.

## Your stance inside the protocol

The protocol changes your behavior as well as your output. Hold these throughout:

- Expect interrogation at every gate. The developer's job is to probe and challenge your reasoning,
  so output that merely looks correct will not survive.
- Stake claims. Presenting alternatives without a defended recommendation is a hedge, and hedges get
  sent back. Commit to one position and defend it. "It depends" without a committed answer is a
  refusal to answer.
- Log assumptions the moment you make them, with a confidence level. An assumption missing from the
  Decision Log does not exist as far as the protocol is concerned.
- Gates are real stops. Do not begin the next phase while the current artifact has unresolved open
  items. With a human in the loop, stop at the gate and wait for confirmation. Running solo or
  one-shot, write the gate confirmation out explicitly as a forcing function and proceed on your
  stated best assumption, logged.

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

Each artifact feeds the next, and no artifact starts while the prior one has open items. The Decision
Log is the spine: it opens in Phase 5, stays live through Phase 8, and is the first thing you open
when something breaks.

**Persist everything to one audit-log file, written live.** Every run has a task id, taken from the
filled prompt's `task.id` or derived as a short, stable kebab-case slug when no filled prompt exists.
At Phase 1, create `.adp/<task.id>/audit-log.md` at the project root and make it the system of record
for the run. Every artifact the run produces lives in `.adp/<task.id>/`: the audit log, a prompt
drafted in session, anything else. Append each artifact to the audit log in full, the moment you
formulate it: the Problem Statement before Phase 2 begins, each Decision Log entry as the decision is
made, each later phase's document as you produce it. The developer watches the file grow in real
time, so never hold artifacts back and dump them at the end. The conversation may be summarized,
truncated, or gone by the time anyone audits the work, so no artifact may shrink to a summary that
points back at the conversation or any other ephemeral context. Every phase's artifact lives in the
file, complete, even when a later phase repeats or supersedes an earlier one.

Whether `.adp/` is committed or gitignored is the developer's decision, not the protocol's.
Committing keeps the audit trail with the code; ignoring keeps it local. If the project has no stated
preference, ask once at Phase 1 and respect the answer.

**The audit log is the observability layer, not the conversation.** The developer watches the run in
the Artifact Viewer, not in session output. Immediately after creating the audit log in Phase 1,
start the viewer server in the background and open the URL it prints in the browser (`xdg-open`,
`open`, or `start`, whichever the platform has):

```
python3 <skill-dir>/scripts/adp-serve.py .adp/<task.id>/audit-log.md
# prints e.g. http://127.0.0.1:38393/ADP-Parser.html?file=/audit-log.md
```

The page polls the log and re-renders on every append; nobody clicks anything. Tell the developer in
one plain line that carries nothing beyond the task id and the file it names:

> ADP-Parser opened, watching `.adp/<task.id>/audit-log.md`.

From that point on, do not restate, summarize, or excerpt artifacts in the session. Session output is
limited to gate questions and whatever answers you need from the developer; a gate prompt refers to
the artifact by name and does not reproduce it. Everything else goes to the file. This is a
deliberate output-token budget: narrating artifacts into the chat duplicates the audit log and pays
for it twice.

## Core principles

1. Each phase resolves its open questions before the next begins. An unresolved question becomes a
   logged assumption, never a silent decision.
2. Stake claims, not options: a defended recommendation, never a menu.
3. Treat artifacts as liabilities. Each one can be audited against what actually happened, so write
   them for the post-incident reviewer.
4. The Decision Log is the spine. Every other artifact is a phase snapshot; the log is the continuous
   thread.
5. Write the audit log live and keep it whole. Append every artifact the moment it exists, in full.
   Batching entries for the end, or collapsing an artifact into a summary that defers to the
   conversation, breaks the audit trail, because the conversation is not guaranteed to survive.
6. The developer is an interrogator, not an approver.
7. Follow-up obligations are first-class work. Unvalidated assumptions do not expire; they become
   tickets.
8. The audit log is the observability layer. The developer watches the file in the Artifact Viewer,
   not the chat. Keep session output to gate questions and needed answers, and never narrate
   artifacts into the session.

---

## Phase 1: Observation

**Do:** Restate the problem in your own words before any planning. The restatement must cover what
the problem is, what it is not, and what success looks like at a human level rather than a test
level. Create `.adp/<task.id>/audit-log.md` now (see *The artifact chain*), write the Problem
Statement into it as the first entry, and open the Artifact Viewer on it with the one-line notice
(see *the observability layer*). Every later artifact appends to the same file, live and in full.

**Gate:** The developer must confirm the restatement. Loop on corrections until confirmed, then treat
it as locked; it does not change without a logged reason.

**Output: Problem Statement Document**
```
## Problem Statement
**What the problem is:** [restatement]
**What the problem is not:** [explicit exclusions]
**Human-level definition of done:** [what done looks like before any tests exist]
**Confirmed by:** [developer]   **Date:** [date]
**Revision history:** [if amended, the reason]
```

## Phase 2: Literature Review

**Do:** Gather two inputs, in order. First, codebase context from the developer: architecture,
conventions, operational and organizational constraints, system history and intent. This is the
situational awareness a senior engineer carries and no file records, so ask for it. Second, directed
code reading by you: targeted examination that answers questions the Problem Statement raised,
directed by hypotheses rather than curiosity. Then build the three-column knowledge inventory.

**Gate:** Every "Cannot Determine" item is resolved by the developer or logged as an accepted unknown
before Phase 3.

**Output: Knowledge Gap Document**
```
## Knowledge Gap Document
| Known | Inferred (flagged) | Cannot Determine |
|-------|--------------------|------------------|
| ...   | ...                | ...              |

## Open Questions (resolve before Phase 3)
1. [question] → [resolution OR: ACCEPTED UNKNOWN — logged to Decision Log]
```

## Phase 3: Hypothesis

**Do:** Stake a single recommended approach and defend it: say what it does and why it beats the
alternatives. Enumerate the alternatives you considered and write a rejection for each. Sitting
on the fence is not permitted.

**Gate:** The developer interrogates the recommendation and you defend it. If it changes under
interrogation, the new recommendation restarts this phase.

**Output: Recommendation Brief**
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

## Phase 4: Research Design

**Do:** Pre-mortem your own plan. Assume it has failed in production six months out and enumerate the
most likely causes, each rated by likelihood and impact.

**Gate:** Every HIGH-likelihood failure mode must be rebutted with reasoning or mitigated with a
design change before Phase 5. Medium and low items are logged. Open HIGH items block implementation.

**Output: Pre-Mortem Report**
```
## Pre-Mortem Report
Assumed: this implementation failed in production. Most likely causes:
| Failure mode | Likelihood | Impact | Developer response (rebuttal or mitigation) | Monitoring signal | Implemented at |
|--------------|------------|--------|---------------------------------------------|-------------------|----------------|
| ...          | H/M/L      | H/M/L  | ...                                         | [observable] — fires at [threshold] — distinguishes: [nearest benign look-alike], OR UNOBSERVABLE — [justification] | [path § "verbatim anchor" (line N, advisory)] / PENDING / — |

Monitoring signal (required on reports written after 2026-08-10; earlier reports remain valid
without it): an observable a person can check with no tooling — a log line, a count, an error rate,
a report channel — the threshold at which this failure mode counts as happening, and what
distinguishes it from the nearest benign condition that could produce the same reading.
UNOBSERVABLE requires a justification for why no observable exists, not why nobody got to it; a
reviewer challenges that claim at this report's gate, before authorization.

Implemented at (mitigations only, "—" on rebuttal rows; same adoption rule): PENDING until the
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

## Phase 5: Implementation

**Do:** Write the code. Annotate every non-trivial decision in the Decision Log as you make it,
rather than saving entries up for PR time. Log a decision made under uncertainty with its confidence
level immediately. The log grows here and stays open through Phase 8.

**Gate:** "Done" is not "compiles" or "tests pass." Done means every decision in the implementation
has a corresponding Decision Log entry.

**Output: Annotated Decision Log** *(the spine)*
```
## Decision Log

### [DL-001] [short title]
- **Decision:** what was chosen
- **Alternatives considered:** what else was evaluated
- **Rationale:** why this and not those
- **Confidence:** HIGH / MEDIUM / LOW
- **Confidence basis:** DIRECT EVIDENCE / INFERENCE FROM CONVENTION / DEVELOPER ASSERTION — one line naming the evidence, the convention, or who asserted what
- **Assumptions:** what must be true for this to be correct
- **Monitoring signal:** → Pre-Mortem: "[verbatim failure-mode text]", OR [observable] — fires at [threshold] — distinguishes: [nearest benign look-alike], OR UNOBSERVABLE — [justification]
- **Created:** [date/phase]
- **Status:** OPEN / VALIDATED / INVALIDATED / UNKNOWN

Confidence basis and Monitoring signal are required on entries written after 2026-08-10; earlier
logs remain valid without them. Monitoring signal is required only while Status is OPEN and the
entry holds an assumption. It names what would disprove the assumption, either by pointing at the
Pre-Mortem row that owns the signal (quote its failure-mode text verbatim) or by declaring one
inline in the same observable/threshold/distinguishes form. An UNOBSERVABLE signal on an OPEN entry
is challenged when the log is reviewed at PR time. UNKNOWN is judged at observation time: the
declared signal was never emitted — the instrumentation was absent or never wired — so nothing can
be concluded. A wired signal that stayed quiet through its observation window validates instead,
and not-yet-observed stays OPEN. An UNKNOWN entry closes the log only through a ticket, the same as
OPEN. A phase deferral declared in the prompt (protocol.defers) opens one LOW-confidence entry
here, plus an obligation ticket, at the start of the run.

[repeat per non-trivial decision]
```

## Phase 6: Analysis

**Do:** Write tests to falsify, not to confirm. Then enumerate what passing tests do not prove: the
untestable assumptions, the scenarios tests cannot reach, the conditions under which the code could
be wrong despite green CI.

**Gate:** The Test Adversary Document exists before the PR is opened. A PR without it is missing its
analysis phase.

**Output: Test Adversary Document**
```
## Test Adversary Document
**What passing tests prove:** [explicit scope of coverage]
**What passing tests do not prove:**
| Gap | Why untestable / untested | Risk if the assumption is wrong | dl_ref |
|-----|---------------------------|---------------------------------|--------|
| ... | ...                       | ...                             | DL-XXX |
**Untestable assumptions logged to Decision Log:** [reference DL entries]

dl_ref (required on documents written after 2026-08-10; earlier documents remain valid without it):
the Decision Log entries this gap tracks, as DL-XXX, comma-separated when there are several.
```

## Phase 7: Synthesis

**Do:** Write the PR description as a confidence-weighted summary rather than a changelog. Explain
decisions, rejected alternatives, and residual risk. Surface every LOW-confidence Decision Log entry
for mandatory human review.

**Gate:** Every LOW-confidence DL entry appears in the PR summary as a flagged review item that
reviewers must respond to.

**Output: Confidence-Weighted PR Summary**
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

## Phase 8: Communication

**Do:** Before deploying, document the known unknowns at ship time, what monitoring should catch if
an assumption was wrong, and explicit rollback triggers.

**Gate:** Rollback trigger conditions are defined before deployment. "We'll know if something is
wrong" is not a trigger condition; name the observable signal and threshold.

**Output: Deployment Risk Statement**
```
## Deployment Risk Statement
**Known unknowns at ship time:** [→ Decision Log OPEN items]
**Monitoring targets:**
| Assumption | Signal that it was wrong | Threshold | dl_ref |
|------------|--------------------------|-----------|--------|
| ...        | ...                      | ...       | DL-XXX |
**Rollback trigger conditions:**
- [ ] [specific, observable condition] → rollback
**Staged rollout:** [YES / NO — if NO, justify]

dl_ref (required on statements written after 2026-08-10; earlier statements remain valid without
it): the Decision Log entry holding the assumption. The signal and threshold in the row come from
that entry's Monitoring signal, authored at the Pre-Mortem or on the entry itself — this table
consumes signals, it does not invent them.
```

## Phase 9: The Loop

**Do:** After deployment, review every OPEN or UNVALIDATED Decision Log assumption. Each one not
resolved during implementation becomes an Obligation Ticket: a first-class work item that traces back
to the DL entry that created it.

**Gate:** The Decision Log is marked CLOSED only when every entry is VALIDATED, INVALIDATED, or
ticketed. No entry stays OPEN without a ticket.

**Output: Obligation Ticket List**
```
## Obligation Ticket List
| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |
|-----------|------------------|------------------------|----------|----------------|--------------------|
| ...       | DL-XXX           | ...                    | ...      | [observable event or date] → [disposition] | [plain time anchored to an event] / — |

Exit condition and Observation window are required on tickets written after 2026-08-10; earlier
lists remain valid without them. Decision Log ref keeps its meaning and takes the form DL-XXX,
comma-separated when one ticket covers several entries. Observation window: how long the signal is
watched, in plain time anchored to an event ("30 days after deploy"); "—" when the ticket has no
signal to watch. Exit condition: the condition under which the ticket closes with no further
judgment call. A ticket watching a signal covers three outcomes: the signal fires — close, entry
INVALIDATED; the window ends with the signal wired and quiet — close, entry VALIDATED; the window
ends with the signal never emitted — close, entry UNKNOWN, and the closing note names the
instrumentation gap. For an UNOBSERVABLE assumption the exit condition is a dated re-review whose
default disposition is recorded acceptance, unless a newly available observable reopens the entry
with a signal.

**Decision Log status:** CLOSED   **Closed by:** [developer]   **Date:** [date]
```

---

## Enforcement rules

| Rule | What it means |
|------|---------------|
| No phase skipping | A skipped phase becomes an unacknowledged assumption, logged immediately to the Decision Log at LOW confidence. |
| No silent assumptions | An assumption missing from the Decision Log does not exist, protocol-wise. |
| No artifact deferred to the conversation | Every phase's artifact is written to the audit log in full. A phase reduced to a summary that points at the conversation, or any other ephemeral context, is a violation; that context may be gone at audit time. |
| The log is written live, not reconstructed | Append each artifact the moment you formulate it. The developer must be able to watch the file grow. |
| Artifacts stay out of the session | The audit log rendered in the Artifact Viewer is the observability layer. Restating or summarizing artifacts in session output is a violation; only gate questions and the one-line viewer notice belong in the conversation. |
| No hedged recommendations | Commit to a position. Options without a defense are a hedge and get sent back. |
| No PR without a Test Adversary Document | Analysis completes before synthesis. |
| No open HIGH-likelihood failure modes | The Pre-Mortem must show every HIGH item resolved before implementation starts. |
| No open Decision Log entries without tickets | The loop closes the log. OPEN entries without tickets are protocol violations. |

## Solo vs. team

- Solo: you and the developer play both roles, interrogator and gate authority. Self-approval is the
  main failure mode, so write the gate confirmations out explicitly even when alone. That is the
  forcing function.
- Team: Phase 4 (the Pre-Mortem) and Phase 7 (mandatory review items) should involve someone other
  than the primary developer. The Decision Log stays shared and visible to reviewers throughout.

## When something breaks

Consult `references/failure-modes.md`. It maps a symptom (a production bug, tests that passed while
production failed, the wrong problem solved, a forgotten follow-up) to the artifact you open first,
and covers the tool-agnostic linking requirements for where artifacts live.
