### Section vocabulary

An audit log's H2 headings are its sections, and every section has a kind. The kinds below come
from a census of the logs on record. Thirty-two logs wrote the same fourteen canonical headings and a
small recurring set of companions. The registry in `src/lib/adp-parser-lib.ts` tags each kind, and
mission control labels a section with its kind. The set is defined, not closed. A section that the
set does not cover is `ad-hoc`, which is a named kind and never an error.

| Kind | What it is for | When a run writes it | Heading forms on record |
|------|----------------|----------------------|-------------------------|
| `artifact` | The fourteen canonical headings: the nine phase artifacts plus Open Questions, Implementation Authorization, Mandatory Review Items, Residual Risk, and Test Coverage Gaps. | Every run, once each, in phase order. A repeat of a canonical heading ("Decision Log — Stage 2", "Obligation Ticket List — amendment (date)") keeps the artifact's tag, and the index demotes the repeat to non-canonical. | The artifact names, or `Phase N: <name>` |
| `amendment` | A dated correction appended to a log that is already on record, by a sweep or by the developer, never an edit in place. | After merge, when a sweep or a later ruling has to reach a finished log. | `Sweep amendment — <what> (<date>)`, `Post-run amendment (<date>)` |
| `review` | The run's answer to a review round: the findings raised, what changed, what was refused and why. | During PR review, one section per round or per finding, or at a phase gate during the run. | `Review Response — PR #N (<date>)`, `Review finding — …`, `Review findings — …`, `Review addendum — <date>` |
| `status` | Where the run stands, in one place, for a reader who opens the log cold. | At a run start, a stage boundary, or a pause, whenever the phase chain alone would mislead. | `Run status`, `Run status — <qualifier>`, `Stage N — <name> (run start <date>)`, `Stage Na — <name> (run start <date>)` for a sub-stage |
| `evidence` | A record of something observed or measured that an artifact cites: coverage against requirements, a verification transcript, a differential render, a browser check, the files a change touched. | Phase 6 onward, whenever a claim needs its evidence beside it rather than in the conversation. | `Requirement coverage`, `Verification record (<date>)`, `Differential corpus render …`, `Browser acceptance — PR #N (<date>)`, `Files changed` |
| `ledger` | Closure records: the dated CLOSED and RE-ANCHORED lines of Phase 9, merge facts, and ticket dispositions that settle what the run left open. | After merge, or at a review round that closes a watch. Per Phase 9 a ruling line lands anywhere from the Decision Log onward. | `Ledger — <what>`, `Post-merge note — PR #N merged (<date>)`, `Ticket Dispositions (<date>, …)`, `Post-run resolutions (<date>)`, `Closure` |
| `ad-hoc` | Anything the set above does not cover. | Rarely, one or two per run at most. The heading says what the section is, and it must not start with another kind's lead word. | Whatever the section is, in plain words |

A companion section never counts toward a phase. Only the artifact heading, or its `Phase N:`
form, clears a phase from `missing` in the index. The section order convention below says where
sections sit in the log. That convention is not part of this vocabulary.

### Section order

A log is the canonical chain, then everything that happened after it. The chain is the fourteen
canonical headings, once each. They come in the order that the phase templates in
`references/artifacts/` list them, phase by phase. Every complete log on record writes them that way.

A companion section takes its place from its kind. The rule comes from a census of the thirty-three
logs on record before this rule's own run. That census counted 168 non-canonical sections on
2026-09-14, and each row cites the count it codifies.

| Kind | Where it belongs | On record |
|------|------------------|-----------|
| `amendment`, `status`, `ledger` | After the Obligation Ticket List, in the order the events happened. A log that has not reached Phase 9 appends them after its last canonical section. | 51 of 51 sections sit after the chain: 31 amendments in 30 logs, 13 status sections in 4, 7 ledgers in 6. |
| `review` naming a PR | A heading that names its PR in the form `PR #N` is a PR review round. It sits after the Obligation Ticket List, as the row above places its kinds, because a PR opens once the chain is written. | 113 of 113 sit after the chain, in 16 logs (counted 2026-10-26). |
| `review` naming no PR | Not governed. A review that names no PR answers a phase gate during the run, for example a developer browser check, so it sits where the gate was and the chain grows past it. | 6 above the chain in 2 logs, all gate browser checks, and 5 after it in 4 logs (counted 2026-10-26). |
| `evidence` | Beside the artifact that cites it, anywhere from the Decision Log onward: a Phase 6 render just before the Test Adversary Document, a coverage table inside the Phase 7 block (PR Summary through Test Coverage Gaps), or after the ticket list. A log with no Decision Log gives evidence no zone, and the lint leaves it alone. | 11 of 11 sit after the Decision Log: 3 just before the Test Adversary Document, 5 inside the Phase 7 block, 3 after the ticket list. |
| `ad-hoc` | Not governed. The heading says what the section is, and the section sits where that makes sense. | 2 after the chain, 1 inside the Phase 7 block. |

A repeat of a canonical heading ("Decision Log — Stage 2") is that artifact's amendment, not a
companion, and is not governed either. All 79 on record sit after the chain. Each later stage of a
multi-stage run opens with a status marker after the previous stage's ticket list. Then the stage
repeats the chain under suffixed headings.

Every run on record writes all nine phases before its PR opens. That is why PR review rounds land
after the chain. The lint reads that placement from the heading alone. So a review placed above a
finished chain goes unseen unless its heading names a PR.

A section can sit where the chain later grows past it, for example a status note at a pause. That
section takes the advisory and stays where it landed. History is append-only, and no log reorders to
satisfy this rule. A stage can resume a chain that its predecessor left short of Phase 9. That stage
grows the chain past the companions the predecessor wrote, and those companions take the advisory
too. Nothing on record does this, because every first stage shipped its ticket list before a second
stage opened.

`lintCorpus` reports a companion section ahead of its place as a `misplaced` advisory. The advisory
names the section key. Its `after` field names the key of the section that the companion should
follow. The advisory never fails a check and never enters an index document. Every deviation older
than this rule stands as written.
