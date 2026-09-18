=== ADP PACK bootstrap-project/v1 · {{index.generated}} ===
Adopt the auditable-dev-protocol conventions in this repository:
- create .adp/ at the project root, one directory per ticket, named
  yyyymmdd-TASKID-slug with the task id's dash collapsed (MC001, not MC-001)
- each ticket carries one audit-log.md whose canonical H2 sections map to
  the nine phases, plus the prompt.yaml that launched it
- a decision entry carries a confidence (HIGH, MEDIUM, or LOW, fully
  qualified), a confidence basis, and a status; an entry is never rewritten,
  a changed decision is a new entry whose Supersedes field names the old one
- an obligation ticket's observation window is plain time anchored to an
  event ("30 days after merge") and carries the calendar date the index
  reads; a watch that has only a relative window gains its date on the
  record with a RE-ANCHORED ledger line, and every watch closes with a
  CLOSED line, both appended under the ticket list, never edited in place
- non-canonical sections and unknown status tokens are preserved verbatim
=== END PACK ===
