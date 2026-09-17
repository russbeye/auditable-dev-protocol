/* The resume packs, end to end: the fill's three constructs and nothing
   else, the context's classifications over the fixture corpus, the shipped
   pack texts against the record, and one golden per pack, byte-compared.
   The composition lives in fixtures/packs/regen.js, which also rewrites the
   goldens after a deliberate change:

     node scripts/tests/fixtures/packs/regen.js

   Read the diff before committing it. A changed golden is a changed pack, a
   changed context, or a changed index shape, and the review should know
   which one it was. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../adp-shell-lib.js");
const R = require("./fixtures/packs/regen.js");

// ---- the fill ----

test("fillPack inserts values by path and renders a missing path empty", () => {
  const ctx = {a: "x", n: 0, o: {p: "deep", q: null}};
  assert.equal(S.fillPack("<{{a}}|{{n}}|{{o.p}}|{{o.q}}|{{o.zz}}|{{nope.deeper}}>", ctx),
    "<x|0|deep|||>");
});

test("fillPack repeats a list section per item with the item's keys over the context", () => {
  const ctx = {name: "outer", rows: [{name: "one", v: 1}, {v: 2}]};
  assert.equal(S.fillPack("{{#rows}}[{{name}}:{{v}}]{{/rows}}", ctx), "[one:1][outer:2]");
});

test("fillPack renders the inverse body on an empty list and nothing for the section", () => {
  const tpl = "{{#rows}}- {{v}}\n{{/rows}}{{^rows}}- none\n{{/rows}}";
  assert.equal(S.fillPack(tpl, {rows: []}), "- none\n");
  assert.equal(S.fillPack(tpl, {rows: [{v: 1}, {v: 2}]}), "- 1\n- 2\n");
  assert.equal(S.fillPack(tpl, {}), "- none\n");
});

test("fillPack renders a section over a present value once and its inverse when absent", () => {
  const tpl = "state{{#pr}} · pr {{pr}}{{/pr}}{{^pr}} · no pr{{/pr}}";
  assert.equal(S.fillPack(tpl, {pr: "#7"}), "state · pr #7");
  assert.equal(S.fillPack(tpl, {pr: null}), "state · no pr");
  assert.equal(S.fillPack(tpl, {}), "state · no pr");
});

test("fillPack leaves every other brace construct verbatim", () => {
  const tpl = "{{! note}} {{> partial}} {{a|b}} {{ spaced }} {{#x}}{{/y}} {{{a}}}";
  assert.equal(S.fillPack(tpl, {a: "A"}), "{{! note}} {{> partial}} {{a|b}} {{ spaced }} {{#x}}{{/y}} {A}");
});

test("packSlots lists each construct once in first-use order, closers excluded", () => {
  const tpl = "{{a}} {{#rows}}{{a}} {{b}}{{/rows}} {{^rows}}none{{/rows}} {{a}}";
  assert.deepEqual(S.packSlots(tpl), ["{{a}}", "{{#rows}}", "{{b}}", "{{^rows}}"]);
});

// ---- the context ----

const idx = R.buildFixtureIndex();
const ticket = id => idx.tickets.find(t => t.id === id);

test("a ruled entry and a closed watch are absent from the ticket's context", () => {
  // FX003's two cards say OPEN and the ledger rules both VALIDATED; its first
  // watch is closed. The pack must read the record the way the ledger does.
  const t = ticket("FX003");
  assert.equal(t.decisions.every(d => d.status === "OPEN"), true);
  const ctx = S.packContext(idx, t, idx.generated);
  assert.deepEqual(ctx.open_decisions, []);
  assert.deepEqual(ctx.watches.map(w => w.wid), ["OT-FX003-2", "OT-FX003-3"]);
  assert.deepEqual(ctx.watches.map(w => w.state), ["34D LEFT", "11D LEFT"]);
});

test("an open entry names its live cover, and the closed watch beside it is not live", () => {
  const ctx = S.packContext(idx, ticket("FX004"), idx.generated);
  assert.deepEqual(ctx.open_decisions, [{id: "DL-002", title: ticket("FX004").decisions[1].title,
    confidence: "LOW", created: "2026-09-11", watch: "OT-FX004-1"}]);
  assert.deepEqual(ctx.watches, [{wid: "OT-FX004-1", what: "Companions sit after the ticket list",
    dl: "DL-002", due: "2026-10-13", state: "OVERDUE 38D"}]);
  assert.equal(ctx.missing, "none");
  assert.equal(ctx.ticket.dir, "20260911-FX004-section-vocabulary");
});

test("the corpus-wide lists are the board's rows by state, in the board's order", () => {
  const ctx = S.packContext(idx, ticket("FX004"), idx.generated);
  assert.deepEqual(ctx.overdue.map(w => w.tid + " " + w.wid), ["FX004 OT-FX004-1", "FX001 OT-FX001-1"]);
  assert.deepEqual(ctx.soon.map(w => w.wid), ["OT-FX002-1", "OT-FX003-3"]);
  assert.deepEqual(ctx.unanchored.map(w => w.tid + " " + w.wid), ["AV090 OT-1", "AV090 OT-2"]);
  assert.equal(ctx.ticket_count, idx.tickets.length);
  assert.equal(ctx.index.generated, "2026-11-20");
});

test("no watch row carries window prose; dates come from due and anchored alone", () => {
  // OT-SWEEP006-1's exit condition: the packs read the window only through
  // due and anchored. An unanchored row shows its label and no date.
  const ctx = S.packContext(idx, ticket("AV090"), idx.generated);
  for (const list of [ctx.watches, ctx.overdue, ctx.soon, ctx.unanchored])
    for (const w of list) assert.equal("window" in w, false, w.wid);
  assert.deepEqual(ctx.watches.map(w => [w.due, w.state]), [["", "UNANCHORED"], ["", "UNANCHORED"]]);
});

test("the unwatched list is the ledger's rank-zero rows", () => {
  const D = require("../adp-derive-lib.js");
  const want = D.ledgerRows(idx.tickets, idx.generated).decisions.filter(r => r.rank === 0)
    .map(r => r.tid + " " + r.id);
  const ctx = S.packContext(idx, null, idx.generated);
  assert.deepEqual(ctx.unwatched.map(r => r.tid + " " + r.id), want);
  // A null ticket renders every ticket slot empty and every ticket list empty.
  assert.equal(ctx.ticket, null);
  assert.deepEqual([ctx.missing, ctx.open_decisions, ctx.watches], ["", [], []]);
});

test("the live set, its calendar, and the counts are the board's rows and chips", () => {
  const ctx = S.packContext(idx, null, idx.generated);
  assert.deepEqual(ctx.live_watches.map(w => w.wid),
    ["OT-FX004-1", "OT-FX001-1", "OT-FX002-1", "OT-FX003-3", "OT-FX003-2", "OT-1", "OT-2"]);
  // The calendar is the dated live rows in due order, which the board's
  // day-based order already is; the undated two fall off it.
  assert.deepEqual(ctx.calendar.map(w => w.due),
    ["2026-10-13", "2026-10-15", "2026-12-01", "2026-12-01", "2026-12-24"]);
  assert.deepEqual(ctx.watch_counts, {live: 7, overdue: 2, soon: 2, upcoming: 1, unanchored: 2, closed: 2});
});

test("open entries age oldest first, undated last and named, each with its cover", () => {
  const ctx = S.packContext(idx, null, idx.generated);
  assert.deepEqual(ctx.open_by_age.map(r => [r.tid + " " + r.id, r.age, r.watch]), [
    ["AV090 DL-001", "142d", "OT-1"],
    ["FX004 DL-002", "70d", "OT-FX004-1"],
    ["FX001 DL-002", "undated", "OT-FX001-1"]]);
});

test("packBasisKind classifies a basis by its leading phrase", () => {
  assert.equal(S.packBasisKind("DIRECT EVIDENCE — the suite pins it"), "direct");
  assert.equal(S.packBasisKind("Direct evidence for the markup; inference for the rest"), "direct");
  assert.equal(S.packBasisKind("INFERENCE FROM CONVENTION — one prior stage"), "inference");
  assert.equal(S.packBasisKind("DEVELOPER ASSERTION — rbeye said so"), "assertion");
  assert.equal(S.packBasisKind("MEASURED — a count"), "other");
  assert.equal(S.packBasisKind(null), "none");
  assert.equal(S.packBasisKind("  "), "none");
});

test("the evidence mix groups open entries by basis kind and counts them", () => {
  const ctx = S.packContext(idx, null, idx.generated);
  assert.deepEqual(ctx.basis_inference.map(r => r.id), ["DL-002"]);
  assert.deepEqual(ctx.basis_assertion.map(r => r.tid), ["AV090"]);
  assert.deepEqual(ctx.basis_none.map(r => r.tid + " " + r.id), ["FX001 DL-002"]);
  assert.deepEqual(ctx.basis_counts, {direct: 0, inference: 1, assertion: 1, other: 0, none: 1});
});

test("tickets in review list their PR, open entries, and live watches; the fixtures have none", () => {
  assert.deepEqual(S.packContext(idx, null, idx.generated).in_review, []);
  const B = require("../adp-index-builder-lib.js");
  const log = ["---", "state: in-review", 'pr: "#9"', "---", "# T", "", "## Decision Log", "",
    "### [DL-001] a", "- **Decision:** x", "- **Confidence:** HIGH", "- **Status:** OPEN", "",
    "### [DL-002] b", "- **Decision:** y", "- **Confidence:** LOW", "- **Status:** VALIDATED", "",
    "## Obligation Ticket List", "",
    "| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |",
    "|---|---|---|---|---|---|",
    "| OT-RV1-1 | DL-001 | it holds | HIGH | done → VALIDATED | 2026-12-01 |",
    "| OT-RV1-2 | DL-001 | it held | LOW | done → VALIDATED | 2026-11-01 |", "",
    "- **OT-RV1-2 CLOSED 2026-11-02 → VALIDATED.** Quiet.", ""].join("\n");
  const one = B.buildIndex([{path: "20260901-RV1-review/audit-log.md", text: log}],
    {project: "p", generated: "2026-11-20", source: "snapshot"});
  assert.deepEqual(S.packContext(one, null, "2026-11-20").in_review,
    [{id: "RV1", dir: "20260901-RV1-review", pr: "#9", open_count: 1, live_count: 1}]);
});

// ---- the shipped packs ----

test("every shipped pack carries a versioned banner naming its own file, and an end line", () => {
  for (const file of R.packFiles()){
    const lines = fs.readFileSync(path.join(R.PACKS_DIR, file), "utf8").split("\n");
    const name = file.replace(/\.pack\.md$/, "");
    assert.equal(lines[0], `=== ADP PACK ${name}/v1 · {{index.generated}} ===`, file);
    assert.equal(lines[lines.length - 2], "=== END PACK ===", file);
    assert.equal(lines[lines.length - 1], "", file + " ends with a newline");
  }
});

test("the bootstrap pack states the record's watch convention, not the mockup's", () => {
  const text = fs.readFileSync(path.join(R.PACKS_DIR, "bootstrap-project.pack.md"), "utf8");
  assert.match(text, /anchored to an\s+event/);
  assert.match(text, /relative window/);
  assert.match(text, /RE-ANCHORED/);
  assert.match(text, /CLOSED/);
  assert.doesNotMatch(text, /ABSOLUTE due date/);
});

test("the shipped packs use only slots the context provides", () => {
  const ctx = S.packContext(idx, ticket("FX004"), idx.generated);
  const known = new Set(Object.keys(ctx));
  const watchKeys = ["tid", "wid", "what", "due", "state"];
  const entryKeys = ["tid", "id", "title", "confidence"];
  const rowKeys = {open_decisions: ["id", "title", "confidence", "created", "watch"],
    watches: ["wid", "what", "dl", "due", "state"],
    overdue: watchKeys, soon: watchKeys, unanchored: watchKeys, live_watches: watchKeys, calendar: watchKeys,
    unwatched: entryKeys, basis_direct: entryKeys, basis_inference: entryKeys,
    basis_assertion: entryKeys, basis_other: entryKeys, basis_none: entryKeys,
    open_by_age: entryKeys.concat("age", "watch"),
    in_review: ["id", "dir", "pr", "open_count", "live_count"]};
  for (const file of R.packFiles()){
    const tpl = fs.readFileSync(path.join(R.PACKS_DIR, file), "utf8");
    // Every opener goes on the stack and every closer pops one, so a value
    // section inside a list never pops the list; only list names resolve keys.
    const inside = [];
    for (const slot of tpl.match(/\{\{[#^/]?[\w.]+\}\}/g) || []){
      const kind = slot[2], p = slot.replace(/^\{\{[#^/]?/, "").replace(/\}\}$/, "");
      if (kind === "/"){ inside.pop(); continue; }
      const head = p.split(".")[0];
      const ok = known.has(head) || inside.some(list => (rowKeys[list] || []).includes(head));
      assert.equal(ok, true, `${file}: ${slot} names nothing the context carries`);
      if (kind === "#" || kind === "^") inside.push(p);
    }
  }
});

// ---- the goldens ----

test("every shipped pack fills to its golden byte for byte, and no golden is stale", () => {
  const packs = R.packFiles();
  assert.ok(packs.length >= 4, "the four packs ship");
  for (const file of packs){
    const got = R.fillFixturePack(file, idx);
    const want = fs.readFileSync(R.goldenPath(file), "utf8");
    assert.equal(got, want, file + " differs from its golden; regenerate deliberately");
  }
  const goldens = fs.readdirSync(path.dirname(R.goldenPath("x.pack.md")))
    .filter(f => f.endsWith("." + R.TICKET + ".txt")).sort();
  assert.deepEqual(goldens, packs.map(f => path.basename(R.goldenPath(f))).sort());
});

test("the fill is a pure function of the index and the pack: same index in, same bytes out", () => {
  const files = R.readCorpus(R.CORPUS);
  const shuffled = files.slice().reverse();
  const B = require("../adp-index-builder-lib.js");
  const again = B.buildIndex(shuffled, R.OPTS);
  for (const file of R.packFiles())
    assert.equal(R.fillFixturePack(file, again), R.fillFixturePack(file, idx), file);
});
