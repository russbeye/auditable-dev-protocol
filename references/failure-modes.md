# Failure-Mode Reference & Toolchain

Consult this when a production issue surfaces (to find which artifact to open first) or when setting up
where the artifacts live. It is not needed on every run.

## Where to look first when something breaks

| What happened | Open this first |
|---------------|-----------------|
| Production bug | **Decision Log** — find the OPEN or LOW-confidence entry closest to the failure. |
| Tests passed, production failed | **Test Adversary Document** — check the gap that matches the failure mode. |
| Wrong problem solved | **Problem Statement Document** — was it confirmed? Amended without logging? |
| Architecture doesn't fit constraints | **Knowledge Gap Document** — was the constraint listed? Resolved or accepted? |
| Reviewer missed something | **PR Summary** — was it a LOW-confidence item? Flagged? Did reviewers respond? |
| Follow-up work forgotten | **Obligation Ticket List** — is there a ticket? If not, the protocol wasn't completed. |

## Toolchain (tool-agnostic)

Artifacts may live in any system — files, GitHub, Linear, Notion, Confluence. The only hard
requirements:

1. Each artifact references the ones that preceded it.
2. Each artifact is linked to the Decision Log entries it produced or consumed.
3. Everything is accessible to anyone who would need to audit a production failure.
4. Obligation Tickets reference their Decision Log entry by ID in whatever ticket system is used.

In a Claude Code session the natural home is markdown: artifacts inline in the conversation, and the
Decision Log persisted to a file (e.g. `docs/decision-log-<feature>.md`) when work spans sessions so it
survives context loss.

## Meta

This protocol is itself subject to the protocol. Amendments require a logged reason in a revision
history. "We changed it because it was inconvenient" is not a logged reason.
