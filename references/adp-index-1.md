# adp-index/1 — the corpus index contract

The mission-control shell consumes one artifact: an index document describing every ticket in an
`.adp/` corpus. This file is the contract for that document. It opens with the decision record,
then gives the normative specification as numbered rules. `scripts/adp-index-lib.js` enforces
the machine-checkable rules; `scripts/tests/index-contract.test.js` runs the fixture corpus
under `scripts/tests/fixtures/index/` against them.

## ADR — freezing the corpus conventions as an API

**Context.** A ticket directory holds one `audit-log.md` and one `prompt.yaml`; the nine protocol
artifacts are H2 sections of the log. The mission-control shell (MC-001) needs corpus-wide state
— watches, decisions, lifecycle — as data, and three different producers must agree on it: a
Node builder invoked by tests and by `adp-serve.py`, the same builder running in a browser over
a user-picked directory, and a checked-in demo snapshot. Nothing agreed on the shape until now;
the corpus conventions existed only as habits of the existing logs.

**Decision.** We freeze the conventions as `adp-index/1`, specified here as numbered rules with
a validator and fixtures. The index is metadata-only: it carries derived facts and verbatim
tokens, never section bodies and never rendered HTML. Consumers load a ticket's raw
`audit-log.md` through the same source seam that produced the index (serve route, checked-in
file, or picked FileList) when they need content. The index is a pure function of
(path, text) pairs, so every producer yields identical bytes for the same corpus.

**Consequences.** Corpus edits invalidate only the index's derived facts, not embedded copies of
content. The builder can run anywhere strings exist, which is what the no-build-step online mode
requires. The cost is a second fetch when the inspector opens a ticket, and a spec that must be
versioned with care — hence the evolution rule.

**Evolution rule.** Consumers ignore keys they do not know. A new optional field may join
`adp-index/1`. Any removal, rename, retype, or change to the meaning of an existing field bumps
the schema to `adp-index/2`. Shape is not the whole test: an additive field that changes what an
existing field means is a semantic change and bumps the major version. Because semantic drift
has no machine signal before it ships, every PR that touches this file must state the change's
evolution class (additive or major) in its PR summary, and review holds that line.

## The index document

A JSON object. The normative key order for every object type is the order shown here, and every
key shown is required: optionality is expressed by null, never by omission. Fields added by a
later additive revision are optional until adp-index/2 makes them core. In prose below, "date"
always means the `YYYY-MM-DD` form of rule IDX-004.

```json
{
  "schema": "adp-index/1",
  "project": "auditable-dev-protocol",
  "generated": "2026-08-24",
  "source": "working-tree",
  "tickets": []
}
```

- `schema` — the literal string `adp-index/1`.
- `project` — the corpus name. Caller-supplied.
- `generated` — the build date. Caller-supplied: the builder never reads a clock.
- `source` — which seam produced the index: `working-tree` (adp-serve.py, live),
  `snapshot` (the checked-in demo file), or `picked` (a browser directory selection).
- `tickets` — one entry per ticket directory, sorted ascending by `dir`. Attention ordering,
  overdue-first sorting, and every other presentation order is derived by the shell, never
  baked into the artifact.

### Ticket

```json
{
  "id": "AV014",
  "dir": "20260817-AV014-loose-list-numbering",
  "slug": "loose-list-numbering",
  "date": "2026-08-17",
  "title": "AV-014 — Loose list numbering · audit log",
  "state": "shipped",
  "state_source": "inferred",
  "pr": "#13",
  "merged": null,
  "phase": 9,
  "sections": [],
  "refs": {},
  "decisions": [],
  "watches": [],
  "missing": []
}
```

Identity comes from the directory name, never from the H1 (H1 titles are free-form in the real
corpus; `title` carries the H1 text verbatim when one exists, else null).

Directory-name grammar. New-convention names are `yyyymmdd-TASKID-slug` with the task-id dash
collapsed (`MC001`, not `MC-001`), so splitting on `-` is deterministic: date, id, slug. Legacy
names fall back to a leading `LETTERS-DIGITS` pair as the id (collapsed into `id`, for example
`AV-001` → `AV001`) with the remainder as slug and a null date. A directory matching neither
form indexes with null `id`, null `date`, and the whole name as `slug`. Deep links address
tickets by `id`, falling back to `dir` when `id` is null.

Lifecycle. `state` is one of `open`, `in-review`, `shipped`, `closed`. The declared mechanism is
YAML front matter at the top of `audit-log.md` (rule IDX-032); a log without it gets its state
inferred from section presence and prose, and the index labels which happened via
`state_source: "declared" | "inferred"`. `pr` carries the pull-request reference verbatim;
`merged` is the absolute merge date when one is known.

`phase` is the highest canonical phase with a section present in the log, 1 through 9, or 0 for
a ticket with no attributable sections (a prompt-only ticket is a valid ticket).

### Section

```json
{ "key": "sec-decision-log", "title": "Decision Log", "phase": 5, "canonical": true }
```

`sections` lists every H2 of the log in document order. `key` is the section's stable address,
computed by adp-parser-lib's `sectionKeys` (slug of the title, with a numeric suffix on
repeats). `title` is verbatim. `phase` is the attributed protocol phase or null; `canonical` is
true exactly when `phase` is non-null. Attribution follows the alias table below. A duplicate
canonical heading demotes to non-canonical rather than overwriting the first (its `phase` is
null and its `key` carries the dedupe suffix). Non-canonical sections pass through verbatim —
they are never filtered, renamed, or dropped.

The alias table. adp-parser-lib's `ART` registry is the single owner of title matching; this
spec documents it and adds one form, and no other component may grow its own matcher.

| Attributed phase | Titles that match |
|------------------|-------------------|
| 1 | Problem Statement |
| 2 | Knowledge Gap; Open Questions |
| 3 | Recommendation Brief |
| 4 | Pre-Mortem Report; Implementation Authorization |
| 5 | Decision Log |
| 6 | Test Adversary; Test Coverage Gaps |
| 7 | PR Summary; Mandatory Review Items; Residual Risk |
| 8 | Deployment Risk |
| 9 | Obligation Tickets |
| N | `Phase N: <anything>` — the numeric prefix form used by other corpora |

Matching is substring-based, so the longer heading forms the legacy corpus writes (for
example "Knowledge Gap Document") attribute to the same rows.

`missing` lists the canonical artifact names absent from the log, in canonical order: Problem
Statement, Knowledge Gap, Recommendation Brief, Pre-Mortem Report, Decision Log, Test
Adversary, PR Summary, Deployment Risk, Obligation Tickets. Companion
headings (Open Questions and kin) attribute to a phase but are never "missing" — only the nine
artifacts are.

### Refs

```json
{ "sec-pre-mortem-report": ["DL-002"], "sec-review-addendum": ["DL-002", "OT-1"] }
```

`refs` maps a section `key` to the id tokens that section's body cites, deduplicated, in first
appearance order. Every key must name a section of the same ticket. Refs are keyed by section
key, never by phase number: JSON object keys that look like integers are reordered ahead of
string keys by JavaScript engines, which silently breaks the normative key order.

An id token is `DL-` followed by digits, or `OT-` followed by letters, digits, and hyphens.
Watch ids repeat across tickets in the real corpus (`OT-1` is everywhere), so corpus-wide
identity is always the pair (`dir`, token); the index never invents qualified ids. Placeholder
tokens — `DL-XXX`, `DL-00x`, `DL-0xx`, any `DL-` form whose tail is not purely digits — are
template text, not citations, and appear nowhere in an index.

### Decision

```json
{ "id": "DL-002", "title": "Blank lines extend a list only toward a same-kind item",
  "confidence": "MEDIUM", "basis": "DIRECT EVIDENCE — …", "status": "OPEN",
  "created": "2026-08-17" }
```

One entry per `### [DL-NNN]` heading in the Decision Log section. `id` is unique within the
ticket. `title`, `confidence`, and `status` are nonempty; `confidence` and `status` carry the
source token verbatim — the known vocabularies (HIGH/MEDIUM/LOW, fully qualified with no aliases;
OPEN/VALIDATED/INVALIDATED/UNKNOWN) exist for rendering, and an unknown token is data, not an
error. That is the open-vocabulary principle: the index reports what the log says, and the
shell marks unknown tokens instead of normalizing them. `basis` is the one-line confidence
basis or null; `created` is the entry's date or null.

### Watch

```json
{ "wid": "OT-1", "dl": ["DL-002"], "what": "Blank-gap continuation matches author intent",
  "due": "2026-10-17", "anchored": true, "window": "60 days after merge" }
```

One entry per row of the Obligation Tickets section. `wid` is the ticket-local id verbatim, unique
within the ticket. `dl` is the list of Decision Log ids the row covers (the source column is
comma-separated when one ticket covers several entries). `what` is the assumption under watch.
`window` preserves the source phrasing verbatim or is null.

`anchored` is true exactly when `due` holds an absolute date. The real legacy corpus writes
relative windows ("60 days after merge") with no machine-readable merge date; those index as
`anchored: false` with a null `due` and surface as a warn state — the builder must never guess
a date. New logs record an absolute due date at creation, per the MC-001 constraints.

## Rules

Each rule is one testable sentence. The marker names its proof: `[fixture]` rules have at least
one invalid fixture named `IDX-NNN-<slug>.json` that violates exactly that rule; `[valid]`
rules are proven by a valid fixture that must pass; `[prose]` rules bind the builder or the
serializer and are exercised from stage 2 on. The contract test fails if any `[fixture]` rule
lacks a fixture.

- **IDX-001** [fixture] The document is an object whose `schema` is exactly `"adp-index/1"`.
- **IDX-002** [fixture] Every object carries all of its core keys in the normative order, and
  unknown keys follow all known keys in ascending order.
- **IDX-003** [fixture] `project` is a nonempty string.
- **IDX-004** [fixture] Every date field holds `YYYY-MM-DD` with a month of 01–12 and a day of
  01–31; `generated` is such a date.
- **IDX-005** [fixture] `source` is one of `"working-tree"`, `"snapshot"`, `"picked"`.
- **IDX-006** [fixture] `tickets` is an array sorted ascending by `dir` with no duplicate
  `dir`.
- **IDX-007** [fixture] Every ticket's `dir` is a nonempty string.
- **IDX-008** [fixture] `id` is null or letters followed by digits.
- **IDX-009** [fixture] `slug`, `title`, and `pr` are each null or a nonempty string.
- **IDX-010** [fixture] `date` and `merged` are each null or a date.
- **IDX-011** [fixture] `state` is one of `"open"`, `"in-review"`, `"shipped"`, `"closed"`.
- **IDX-012** [fixture] `state_source` is `"declared"` or `"inferred"`.
- **IDX-013** [fixture] `phase` is an integer from 0 through 9.
- **IDX-014** [fixture] `sections` is an array of objects each holding `key`, `title`,
  `phase`, and `canonical`.
- **IDX-015** [fixture] Section keys are nonempty, unique within the ticket, and never wholly
  numeric.
- **IDX-016** [fixture] Every section `title` is a nonempty string.
- **IDX-017** [fixture] `canonical` is true exactly when `phase` is non-null, and a non-null
  `phase` is an integer from 1 through 9.
- **IDX-018** [fixture] Every `refs` key names a section of the same ticket.
- **IDX-019** [fixture] Every `refs` value is an array of well-formed id tokens with no
  duplicates.
- **IDX-020** [fixture] Placeholder tokens appear nowhere: not in `refs`, not as decision ids,
  not in watch `dl` lists.
- **IDX-021** [fixture] Every decision `id` is `DL-` followed by digits and is unique within
  the ticket.
- **IDX-022** [fixture] Every decision's `title`, `confidence`, and `status` are nonempty
  strings; `basis` is null or nonempty; `created` is null or a date.
- **IDX-023** [valid] `confidence` and `status` are verbatim source tokens; membership in the
  known vocabularies is never a validity requirement.
- **IDX-024** [fixture] Every watch's `wid` is nonempty and unique within the ticket, and its
  `what` is nonempty.
- **IDX-025** [fixture] Every watch's `dl` is an array of `DL-`digit tokens, possibly empty.
- **IDX-026** [fixture] `anchored` is true exactly when `due` is non-null; a non-null `due` is
  a date; `window` is null or a nonempty string.
- **IDX-027** [fixture] `missing` lists only canonical artifact names, in canonical order,
  with no duplicates.
- **IDX-028** [prose] An index file serializes as `JSON.stringify(doc, null, 2)` plus a
  trailing newline.
- **IDX-029** [prose] The builder derives the index from (path, text) pairs alone — no clock,
  no filesystem metadata, no git state; `generated` and `source` are caller inputs.
- **IDX-030** [prose] Non-canonical sections pass through verbatim and are never filtered; a
  duplicate canonical heading demotes to non-canonical.
- **IDX-031** [prose] Title-to-phase attribution follows adp-parser-lib's `ART` registry plus
  the `Phase N:` prefix form; no other matcher may exist.
- **IDX-032** [prose] The declared lifecycle block is YAML front matter at the top of
  audit-log.md with keys `state`, `pr`, and `merged`; when present, `state_source` is
  `"declared"`. Corpus logs do not adopt the block until adp-parser-lib strips front matter
  before rendering, so the untouched standalone viewer never shows it as prose.
