"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../adp-derive-lib.js");

const TODAY = "2026-08-27";

// A minimal contract-shaped ticket the derivations read. Tests override the
// fields they exercise.
function ticket(over){
  return Object.assign({
    id: "T1", dir: "20260801-T1-alpha", slug: "alpha", date: "2026-08-01",
    title: null, state: "closed", state_source: "inferred", pr: null,
    merged: null, phase: 9, sections: [], refs: {}, decisions: [],
    watches: [], missing: []
  }, over);
}
const watch = over => Object.assign(
  {wid: "OT-T1-1", dl: ["DL-001"], what: "w", due: null, anchored: false, window: "relative"}, over);
const decision = over => Object.assign(
  {id: "DL-001", title: "d", confidence: "HIGH", basis: null, status: "OPEN", created: null}, over);
const section = over => Object.assign(
  {key: "sec-x", title: "X", phase: null, canonical: false}, over);

// ---- date math ----

test("daysUntil is calendar-true across month and year edges", () => {
  assert.equal(D.daysUntil("2026-08-28", TODAY), 1);
  assert.equal(D.daysUntil("2026-08-27", TODAY), 0);
  assert.equal(D.daysUntil("2026-08-26", TODAY), -1);
  assert.equal(D.daysUntil("2026-09-01", "2026-08-31"), 1);
  assert.equal(D.daysUntil("2027-01-01", "2026-12-31"), 1);
  // A DST boundary sits inside this span; UTC math keeps it a whole day.
  assert.equal(D.daysUntil("2026-11-02", "2026-10-31"), 2);
});

test("dueState classifies unanchored, overdue, soon, and upcoming", () => {
  assert.equal(D.dueState(watch(), TODAY), "unanchored");
  assert.equal(D.dueState(watch({anchored: true, due: "2026-08-26"}), TODAY), "overdue");
  assert.equal(D.dueState(watch({anchored: true, due: "2026-08-27"}), TODAY), "soon");
  assert.equal(D.dueState(watch({anchored: true, due: "2026-09-10"}), TODAY), "soon");
  assert.equal(D.dueState(watch({anchored: true, due: "2026-09-11"}), TODAY), "upcoming");
});

test("dueLabel names the day counts", () => {
  assert.equal(D.dueLabel(watch(), TODAY), "UNANCHORED");
  assert.equal(D.dueLabel(watch({anchored: true, due: "2026-08-20"}), TODAY), "OVERDUE 7D");
  assert.equal(D.dueLabel(watch({anchored: true, due: "2026-09-06"}), TODAY), "10D LEFT");
});

// ---- status classification ----

test("statusKind reads the leading token of a verbatim status line", () => {
  assert.equal(D.statusKind("OPEN — ticketed as OT-X-1."), "open");
  assert.equal(D.statusKind("VALIDATED ---"), "validated");
  assert.equal(D.statusKind("INVALIDATED — superseded by DL-034"), "invalidated");
});

// ---- attention reasons ----

test("attention reasons follow the fixed priority with one entry per kind", () => {
  const t = ticket({
    watches: [
      watch({wid: "OT-1", anchored: true, due: "2026-08-25"}),
      watch({wid: "OT-2"}), watch({wid: "OT-3"})
    ],
    missing: ["Knowledge Gap", "PR Summary"],
    decisions: [decision({id: "DL-009", status: "OPEN"})]
  });
  const r = D.attentionReasons(t, TODAY);
  assert.deepEqual(r.map(x => x.txt),
    ["WATCH OVERDUE 2D", "2 WATCHES UNANCHORED", "2 SECTIONS MISSING", "1 DECISION UNWATCHED"]);
  assert.deepEqual(r.map(x => x.tone), ["bad", "warn", "warn", "warn"]);
});

test("several overdue watches collapse into one counted reason", () => {
  const t = ticket({watches: [
    watch({wid: "OT-1", anchored: true, due: "2026-08-01"}),
    watch({wid: "OT-2", anchored: true, due: "2026-08-02"})
  ]});
  assert.deepEqual(D.attentionReasons(t, TODAY).map(x => x.txt), ["2 WATCHES OVERDUE"]);
});

test("a closed ticket raises reasons too — every state reports", () => {
  const t = ticket({state: "closed", watches: [watch()]});
  assert.equal(D.attentionReasons(t, TODAY).length, 1);
});

test("an open decision covered by a watch raises nothing", () => {
  const t = ticket({
    decisions: [decision({id: "DL-002", status: "OPEN — ticketed"})],
    watches: [watch({anchored: true, due: "2026-12-01", dl: ["DL-002"]})]
  });
  assert.deepEqual(D.attentionReasons(t, TODAY), []);
});

test("coveringWatch resolves a decision's watch, first match, else null", () => {
  const w1 = watch({wid: "OT-T1-1", dl: ["DL-001", "DL-002"]});
  const w2 = watch({wid: "OT-T1-2", dl: ["DL-002"]});
  const t = ticket({watches: [w1, w2]});
  assert.equal(D.coveringWatch(t, "DL-001"), w1);
  assert.equal(D.coveringWatch(t, "DL-002"), w1);
  assert.equal(D.coveringWatch(t, "DL-009"), null);
  assert.equal(D.coveringWatch(ticket({watches: [watch({dl: null})]}), "DL-001"), null);
});

test("canonicalSection resolves a phase's canonical section, else null", () => {
  const spine = section({key: "sec-dl", title: "Decision Log", phase: 5, canonical: true});
  const stray = section({key: "sec-note", title: "Decision Log — notes", phase: 5, canonical: false});
  const t = ticket({sections: [stray, spine]});
  assert.equal(D.canonicalSection(t, 5), spine);
  assert.equal(D.canonicalSection(t, 9), null);
});

// ---- ribbon ----

test("the ribbon carries the top two reasons and the overflow count", () => {
  const t = ticket({
    watches: [watch({wid: "OT-1", anchored: true, due: "2026-08-01"}), watch({wid: "OT-2"})],
    missing: ["PR Summary"],
    decisions: [decision({id: "DL-009", status: "OPEN"})]
  });
  const m = D.ribbonModel(t, TODAY);
  assert.equal(m.reasons.length, 2);
  assert.equal(m.more, 2);
});

test("a quiet in-review ticket shows its phase line", () => {
  const t = ticket({state: "in-review", phase: 7});
  assert.deepEqual(D.ribbonModel(t, TODAY),
    {reasons: [{txt: "PHASE 7 · IN-REVIEW", tone: "warn"}], more: 0});
});

test("a quiet shipped ticket names its next watch date, or the closed loop", () => {
  const waiting = ticket({state: "shipped", watches: [
    watch({anchored: true, due: "2026-12-24"}), watch({wid: "OT-2", anchored: true, due: "2026-10-01"})
  ]});
  assert.equal(D.ribbonModel(waiting, TODAY).reasons[0].txt, "SHIPPED · WATCH 2026-10-01");
  assert.equal(D.ribbonModel(ticket({state: "closed"}), TODAY).reasons[0].txt, "CLOSED · LOOP CLOSED");
});

// ---- rail groups ----

test("needsAttention takes only what someone can act on now", () => {
  // An overdue watch pulls a ticket in, whatever its state.
  assert.equal(D.needsAttention(ticket({watches: [watch({anchored: true, due: "2026-08-01"})]}), TODAY), true);
  // So does an open decision with no covering watch.
  assert.equal(D.needsAttention(ticket({decisions: [decision({id: "DL-009", status: "OPEN"})]}), TODAY), true);
  // Missing sections matter on a log that claims to be done, not one in flight.
  assert.equal(D.needsAttention(ticket({state: "shipped", missing: ["PR Summary"]}), TODAY), true);
  assert.equal(D.needsAttention(ticket({state: "open", missing: ["PR Summary"]}), TODAY), false);
  // Unanchored watches stay ribbon-only: the reason reports, the group passes.
  const legacy = ticket({state: "closed", watches: [watch()]});
  assert.equal(D.attentionReasons(legacy, TODAY).length, 1);
  assert.equal(D.needsAttention(legacy, TODAY), false);
});

test("railGroups puts actionable attention first and sorts newest dir first inside", () => {
  const attn = ticket({id: "A", dir: "20260810-A-x",
    watches: [watch({anchored: true, due: "2026-08-01"})]});
  const attn2 = ticket({id: "B", dir: "20260820-B-y",
    decisions: [decision({id: "DL-009", status: "OPEN"})]});
  const open = ticket({id: "C", dir: "20260815-C-z", state: "open"});
  const rev = ticket({id: "D", dir: "20260816-D-w", state: "in-review"});
  const ship = ticket({id: "E", dir: "20260817-E-v", state: "shipped"});
  // Unanchored-only debt sits in its lifecycle group, ribbon intact.
  const done = ticket({id: "F", dir: "20260818-F-u", state: "closed", watches: [watch()]});
  const g = D.railGroups([attn, open, rev, ship, done, attn2], TODAY);
  assert.deepEqual(g.map(x => x[0]), ["needs attention", "in progress", "shipped", "closed"]);
  assert.deepEqual(g[0][1].map(t => t.id), ["B", "A"]);
  assert.deepEqual(g[1][1].map(t => t.id), ["D", "C"]);
  assert.deepEqual(g[2][1].map(t => t.id), ["E"]);
  assert.deepEqual(g[3][1].map(t => t.id), ["F"]);
});

// ---- section entries ----

test("sectionEntries keeps document order and trails missing artifacts", () => {
  const t = ticket({
    sections: [
      section({key: "sec-problem-statement", title: "Problem Statement", phase: 1, canonical: true}),
      section({key: "sec-notes", title: "Notes"}),
      section({key: "sec-decision-log", title: "Decision Log", phase: 5, canonical: true})
    ],
    missing: ["PR Summary", "Knowledge Gap"]
  });
  const e = D.sectionEntries(t);
  assert.deepEqual(e.map(x => x.key),
    ["sec-problem-statement", "sec-notes", "sec-decision-log", "missing:Knowledge Gap", "missing:PR Summary"]);
  assert.equal(e[3].phase, 2);
  assert.equal(e[4].phase, 7);
  assert.equal(e[3].missing, true);
});

// ---- section state ----

test("sectionState covers every rule in precedence order", () => {
  const secDL = section({key: "sec-decision-log", phase: 5, canonical: true});
  const secOT = section({key: "sec-obligation-ticket-list", phase: 9, canonical: true});
  const t = ticket({sections: [secDL, secOT]});

  assert.deepEqual(D.sectionState(t, {missing: true}, TODAY), {label: "missing", tone: "mute"});
  assert.deepEqual(D.sectionState(t, section(), TODAY), {label: "non-canonical", tone: "warn"});
  assert.deepEqual(
    D.sectionState(ticket({decisions: [decision({status: "INVALIDATED — x"})]}), secDL, TODAY),
    {label: "invalidated entries", tone: "bad"});
  assert.deepEqual(
    D.sectionState(ticket({decisions: [decision({status: "OPEN"})]}), secDL, TODAY),
    {label: "open items", tone: "warn"});
  assert.deepEqual(
    D.sectionState(ticket({watches: [watch({anchored: true, due: "2026-01-01"})]}), secOT, TODAY),
    {label: "overdue watches", tone: "bad"});
  assert.deepEqual(
    D.sectionState(ticket({watches: [watch()]}), secOT, TODAY),
    {label: "unanchored watches", tone: "warn"});
  assert.deepEqual(
    D.sectionState(ticket({state: "open", phase: 5}), secDL, TODAY),
    {label: "current", tone: "accent"});
  assert.deepEqual(D.sectionState(ticket(), secDL, TODAY), {label: "complete", tone: "ok"});
});

// ---- ref scoping ----

test("sectionItems gives the owner sections everything, others their citations", () => {
  const t = ticket({
    sections: [
      section({key: "sec-decision-log", phase: 5, canonical: true}),
      section({key: "sec-obligation-ticket-list", phase: 9, canonical: true}),
      section({key: "sec-pr-summary", phase: 7, canonical: true}),
      section({key: "sec-decision-log-stage-2"})
    ],
    refs: {"sec-pr-summary": ["DL-002", "OT-T1-2"], "sec-decision-log-stage-2": ["DL-001"]},
    decisions: [decision(), decision({id: "DL-002"})],
    watches: [watch({wid: "OT-T1-1"}), watch({wid: "OT-T1-2"})]
  });
  assert.equal(D.sectionItems(t, "sec-decision-log").decisions.length, 2);
  assert.equal(D.sectionItems(t, "sec-obligation-ticket-list").watches.length, 2);
  const pr = D.sectionItems(t, "sec-pr-summary");
  assert.deepEqual(pr.decisions.map(d => d.id), ["DL-002"]);
  assert.deepEqual(pr.watches.map(w => w.wid), ["OT-T1-2"]);
  // A non-canonical Decision Log section is not the owner; it cites.
  assert.deepEqual(D.sectionItems(t, "sec-decision-log-stage-2").decisions.map(d => d.id), ["DL-001"]);
  assert.deepEqual(D.sectionItems(t, "missing:PR Summary").decisions, []);
});

test("citingSections lists the owner first, then citing sections in order", () => {
  const t = ticket({
    sections: [
      section({key: "sec-decision-log", phase: 5, canonical: true}),
      section({key: "sec-obligation-ticket-list", phase: 9, canonical: true})
    ],
    refs: {
      "sec-pr-summary": ["DL-001"],
      "sec-deployment-risk-statement": ["DL-001", "OT-T1-1"]
    }
  });
  assert.deepEqual(D.citingSections(t, "DL-001"),
    ["sec-decision-log", "sec-pr-summary", "sec-deployment-risk-statement"]);
  assert.deepEqual(D.citingSections(t, "OT-T1-1"),
    ["sec-obligation-ticket-list", "sec-deployment-risk-statement"]);
});

// ---- sorting ----

test("sortRows orders by accessor without mutating the input", () => {
  const rows = [{n: 2}, {n: 3}, {n: 1}];
  assert.deepEqual(D.sortRows(rows, "n", 1, {n: r => r.n}).map(r => r.n), [1, 2, 3]);
  assert.deepEqual(D.sortRows(rows, "n", -1, {n: r => r.n}).map(r => r.n), [3, 2, 1]);
  assert.deepEqual(rows.map(r => r.n), [2, 3, 1]);
  assert.deepEqual(D.sortRows(rows, "missing", 1, {}).map(r => r.n), [2, 3, 1]);
});
