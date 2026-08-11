# Failure-mode reference and toolchain

Consult this when a production issue surfaces and you need to know which artifact to open first, or
when deciding where the artifacts live. It is not needed on every run.

## Where to look first when something breaks

| What happened | Open this first |
|---------------|-----------------|
| Production bug | **Decision Log.** Find the OPEN or LOW-confidence entry closest to the failure. |
| Tests passed, production failed | **Test Adversary Document.** Check the gap that matches the failure mode. |
| Wrong problem solved | **Problem Statement Document.** Was it confirmed? Amended without logging? |
| Architecture doesn't fit constraints | **Knowledge Gap Document.** Was the constraint listed? Resolved or accepted? |
| Reviewer missed something | **PR Summary.** Was it a LOW-confidence item? Flagged? Did reviewers respond? |
| Follow-up work forgotten | **Obligation Ticket List.** Is there a ticket? If not, the protocol was never completed. |

## Toolchain (tool-agnostic)

Artifacts can live in any system: files, GitHub, Linear, Notion, Confluence. The hard requirements:

1. Each artifact references the ones that preceded it.
2. Each artifact is linked to the Decision Log entries it produced or consumed.
3. Everything is accessible to anyone who would need to audit a production failure.
4. Obligation Tickets reference their Decision Log entry by ID in whatever ticket system is used.

Requirements 2 and 4 have a concrete form: `dl_ref`, the DL-XXX back-reference carried by the Test
Adversary Document, the Deployment Risk Statement, and the Obligation Ticket List (whose "Decision
Log ref" column is the same reference under its original name). Walking a symptom from the table
above to its artifact and then through its `dl_ref` lands on the Decision Log entry to re-judge. A
Pre-Mortem mitigation's "Implemented at" reference works the same way toward the code: search for
its verbatim anchor by hand, treat any line number as an advisory hint, and read an absent anchor
as a mitigation that is unverified, not merely moved.

In a Claude Code session the home is `.adp/<task-id>/audit-log.md` at the project root. The model
creates it in Phase 1 and appends each artifact as it produces it, so the full chain of every phase
sits in that one file. The run's other artifacts, such as a prompt drafted in session, sit beside it
in `.adp/<task-id>/`. The file, rendered live in the Artifact Viewer, is the observability layer.
The conversation carries only gate questions and can be summarized or lost, so no artifact may live
only there. Persisting from Phase 1, even when the work fits in one session, is what lets the developer
watch the log grow and what keeps the record alive through context loss.

## Meta

This protocol is itself subject to the protocol. Amendments require a logged reason in a revision
history. "We changed it because it was inconvenient" is not a logged reason.
