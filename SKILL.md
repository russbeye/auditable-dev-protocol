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

A protocol for AI-assisted software development. It makes the model defend its choices as it works.
It also leaves artifacts that an auditor can check against what actually happened. The model has no
skin in the game, so the protocol stands in for it.

## Why this exists

You optimize for plausibility. This protocol makes you optimize for what you can defend.

Passing tests does not make code correct, and a plan that looks right can still be wrong. You have no
reputation to protect, no production incident on your record, and no consequence when confident
wrongness ships. The protocol substitutes for those consequences. You justify each decision as you
make it, stop at phase gates, and write artifacts that trace your reasoning to what happened.

Skipping a phase does not cancel it. It creates an unacknowledged assumption, and you must log that
assumption.

## When to run it

- Whenever the developer invokes it by name or asks for any of its artifacts.
- Before work that is hard to reverse: migrations, auth and permissions, money, destructive
  operations, public contracts, concurrency. Offer the protocol, but do not force it.
- Never for trivial work. A one-line rename does not need a Pre-Mortem. If the developer asks for
  the full protocol on something trivial, say that the task is trivial. Then propose a lighter
  version: a Problem Statement and a Decision Log, nothing else. The protocol trades speed for
  caution, so use judgment on small tasks.

## The prompt template

This skill ships a structured prompt format, so a request arrives already framed for the protocol. A
filled prompt states these things:

- The lens to reason from.
- The ask.
- The constraints.
- The context.
- Prior dead ends.
- The shape of the output.
- The requirements that define done.
- Which artifacts to produce.

The prompt is YAML, so a script can check its structure.

- `prompts/prompt-template.yaml` is the clean template. Copy it, fill it, and delete what you do not
  need.
- `references/prompt-template-annotated.yaml` documents every field and option, including the full
  `output.format` and `protocol.artifacts` value sets.
- `scripts/validate-prompt.mts` checks a filled prompt for required keys, types, and allowed values.
  Run `node <skill-dir>/scripts/validate-prompt.mts <file>`. The validator exits 1 and lists what is
  wrong. It exits 2 when the file uses YAML outside the subset that mission control reads. It also
  exits 2 when a plain value such as `apply: yes` reads as another type in YAML 1.1, and that type
  changes the verdict.

When the developer invokes the skill directly, nudge first. Before you restate the problem in Phase
1, point the developer at the template. Offer to draft a prompt that is pre-filled with what the
developer already gave you. That can be the ask, file paths, constraints, and anything else in the
conversation. Save a prompt drafted in session to `.adp/<task.id>/prompt.yaml`, beside the run's
other artifacts. Do not ask where to put it.

If the developer declines, proceed to Phase 1 as normal. A filled prompt is an input to the protocol,
not a replacement for any phase.

## Your stance inside the protocol

The protocol changes your behavior as well as your output. Hold these positions throughout:

- Expect interrogation at every gate. The developer's job is to probe and challenge your reasoning,
  so output that merely looks correct will not survive.
- Stake claims. A list of alternatives without a defended recommendation is a hedge, and the
  developer sends hedges back. Commit to one position and defend it. "It depends" without a
  committed answer is a refusal to answer.
- Log assumptions the moment you make them, with a confidence level. An assumption missing from the
  Decision Log does not exist as far as the protocol is concerned.
- Gates are real stops. Do not begin the next phase while the current artifact has unresolved open
  items. With a human in the loop, stop at the gate and wait for confirmation. In a solo or one-shot
  run, write the gate confirmation out explicitly as a forcing function. Then proceed on your stated
  best assumption, and log that assumption.

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
Phase 9  Obligations        → Obligation Ticket List
```

Each artifact feeds the next, and no artifact starts while the prior one has open items. The Decision
Log is the spine. It opens in Phase 5 and stays live through Phase 8. It is also the first thing you
open when something breaks.

**Persist everything to one audit-log file, written live.** Every run has a task id. Take it from the
filled prompt's `task.id`. When no filled prompt exists, derive a short, stable kebab-case slug. At
Phase 1, create `.adp/<task.id>/audit-log.md` at the project root. Make the audit log the system of
record for the run. Every artifact that the run produces lives in `.adp/<task.id>/`: the audit log,
a prompt drafted in session, and anything else.

Append each artifact to the audit log in full, the moment you formulate it:

- The Problem Statement before Phase 2 begins.
- Each Decision Log entry as you make the decision.
- Each later phase's document as you produce it.

The developer watches the file grow in real time. So never hold artifacts back and dump them at the
end. The conversation may be summarized, truncated, or gone by the time anyone audits the work. So
no artifact may shrink to a summary that points back at the conversation or any other ephemeral
context. Every phase's artifact lives in the file, complete, even when a later phase repeats or
supersedes an earlier one.

Whether `.adp/` is committed or gitignored is the developer's decision, not the protocol's.
Committing keeps the audit trail with the code. Ignoring keeps the audit trail local. If the project
has no stated preference, ask once at Phase 1, and respect the answer.

**The audit log is the observability layer, not the conversation.** The developer watches the run in
mission control, not in session output. Immediately after you create the audit log in Phase 1, run
the launcher from the project root. Give the command a 300000 ms tool timeout. Then open the URL that
it prints in the browser, with `xdg-open`, `open`, or `start`, whichever the platform has:

```
node <skill-dir>/scripts/adp-launch.mts
# prints e.g. http://127.0.0.1:38393/app.html
```

The launcher prints the URL of the one server for this repo. The launcher reuses a live server, or
starts one that outlives the shell. So the same command is safe to run every time. The server serves
every log under the repo's `.adp` directory, and the page re-renders on every append. Nobody clicks
anything.

After the launch, tell the developer one plain line. The line carries nothing beyond the task id and
the file it names:

> Mission control opened, watching `.adp/<task.id>/audit-log.md`.

From that point on, do not restate, summarize, or excerpt artifacts in the session. Limit session
output to gate questions and the answers you need from the developer. A gate prompt refers to the
artifact by name and does not reproduce it. Everything else goes to the file. This limit is a
deliberate output-token budget. Narrating artifacts into the chat duplicates the audit log and pays
for it twice.

Outside a run, when the developer asks about the corpus, offer in one sentence to launch mission
control.

### Encoding

An audit log is UTF-8 throughout, and so is every file a run writes beside it. Write a control byte
other than tab, newline, and carriage return escaped inside a code span, never raw. Those bytes are
U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, and U+007F. For example, write `\u0000` for NUL. A raw
control byte makes `grep` call the log binary. Then a census that shells out skips the file, and the
sentence around the byte loses the byte it was naming.

Every reader on record decodes UTF-8:

- `adp-server.mts` sends `charset=utf-8`.
- The pages read `res.text()`.
- The suite reads `"utf8"`.
- `validate-prompt.mts` refuses a prompt that is not UTF-8.

A reader that decodes anything else mangles every non-ASCII character, and the ledger arrow `→`
first. Then no closure line matches the record grammar. `references/failure-modes.md` names that trap
for census tooling.

`lintCorpus` reports a raw control byte as a `control-byte` advisory. The advisory names the log in
`id`, and it carries `offset`, the UTF-8 byte offset of the byte. The advisory never fails a check
and never enters an index document.

## Core principles

1. Each phase resolves its open questions before the next begins. An unresolved question becomes a
   logged assumption, never a silent decision.
2. Stake claims, not options: a defended recommendation, never a menu.
3. Treat artifacts as liabilities. Each artifact can be audited against what actually happened. So
   write each one for the post-incident reviewer.
4. The Decision Log is the spine. Every other artifact is a phase snapshot. The Decision Log is the
   continuous thread.
5. Write the audit log live and keep it whole. Append every artifact the moment it exists, in full.
   Do not batch entries for the end. Do not collapse an artifact into a summary that defers to the
   conversation. Either one breaks the audit trail, because the conversation is not guaranteed to
   survive.
6. The developer is an interrogator, not an approver.
7. Follow-up obligations are first-class work. Unvalidated assumptions do not expire. They become
   tickets.
8. The audit log is the observability layer. The developer watches the file in mission control,
   not the chat. Keep session output to gate questions and needed answers. Never narrate artifacts
   into the session.

---

## Phase files

Each phase keeps its rules in a phase file and its template in an artifact file, both under
`<skill-dir>/references/`. When a phase starts, read both files before you do anything else in
that phase. Read a file again when its text is no longer in context. Phase 1 starts when this
skill loads, so read the two Phase 1 files before your first reply.

| Phase | Phase file | Artifact file |
|-------|------------|---------------|
| 1 | `<skill-dir>/references/phases/phase-1-observation.md` | `<skill-dir>/references/artifacts/problem-statement.md` |
| 2 | `<skill-dir>/references/phases/phase-2-literature-review.md` | `<skill-dir>/references/artifacts/knowledge-gap.md` |
| 3 | `<skill-dir>/references/phases/phase-3-hypothesis.md` | `<skill-dir>/references/artifacts/recommendation-brief.md` |
| 4 | `<skill-dir>/references/phases/phase-4-research-design.md` | `<skill-dir>/references/artifacts/pre-mortem.md` |
| 5 | `<skill-dir>/references/phases/phase-5-implementation.md` | `<skill-dir>/references/artifacts/decision-log.md` |
| 6 | `<skill-dir>/references/phases/phase-6-analysis.md` | `<skill-dir>/references/artifacts/test-adversary.md` |
| 7 | `<skill-dir>/references/phases/phase-7-synthesis.md` | `<skill-dir>/references/artifacts/pr-summary.md` |
| 8 | `<skill-dir>/references/phases/phase-8-communication.md` | `<skill-dir>/references/artifacts/deployment-risk.md` |
| 9 | `<skill-dir>/references/phases/phase-9-obligations.md` | `<skill-dir>/references/artifacts/obligation-ticket-list.md` |

Three writes need a file of their own, at any phase:

- Before you write an H2 heading that no artifact file gives, read `<skill-dir>/references/sections.md`.
- Before you write a CLOSED or RE-ANCHORED line, read
  `<skill-dir>/references/artifacts/obligation-ticket-list.md`.
- Before you write your first Decision Log entry, at any phase, read
  `<skill-dir>/references/artifacts/decision-log.md`. Read it again before a later entry when its
  template is not in context.

---

## Enforcement rules

| Rule | What it means |
|------|---------------|
| No phase skipping | A skipped phase becomes an unacknowledged assumption, logged immediately to the Decision Log at LOW confidence. |
| No silent assumptions | An assumption missing from the Decision Log does not exist, protocol-wise. |
| No artifact deferred to the conversation | Every phase's artifact is written to the audit log in full. A phase reduced to a summary that points at the conversation, or any other ephemeral context, is a violation; that context may be gone at audit time. |
| The log is written live, not reconstructed | Append each artifact the moment you formulate it. The developer must be able to watch the file grow. |
| Artifacts stay out of the session | The audit log rendered in mission control is the observability layer. Restating or summarizing artifacts in session output is a violation; only gate questions and the one-line viewer notice belong in the conversation. |
| No hedged recommendations | Commit to a position. Options without a defense are a hedge and get sent back. |
| No PR without a Test Adversary Document | Analysis completes before synthesis. |
| No open HIGH-likelihood failure modes | The Pre-Mortem must show every HIGH item resolved before implementation starts. |
| No open Decision Log entries without tickets | The Obligations phase closes the log. OPEN entries without tickets are protocol violations. |

## Solo vs. team

- Solo: you and the developer play both roles, interrogator and gate authority. Self-approval is the
  main failure mode. So write the gate confirmations out explicitly, even when alone. That written
  confirmation is the forcing function.
- Team: Phase 4 (the Pre-Mortem) and Phase 7 (mandatory review items) should involve someone other
  than the primary developer. The Decision Log stays shared and visible to reviewers throughout.

## When something breaks

Consult `references/failure-modes.md`. It maps a symptom to the artifact you open first. The
symptoms include a production bug, tests that passed while production failed, the wrong problem
solved, and a forgotten follow-up. The file also covers the tool-agnostic linking requirements for
where artifacts live.
