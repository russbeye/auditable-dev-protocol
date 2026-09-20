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

// ---- closed watches ----

test("a closed watch classifies as closed before anything else", () => {
  const w = watch({anchored: true, due: "2026-08-01", closed: "2026-08-20", outcome: "VALIDATED"});
  assert.equal(D.dueState(w, TODAY), "closed");
  assert.equal(D.dueLabel(w, TODAY), "CLOSED");
  const un = watch({closed: "2026-08-20", outcome: "UNKNOWN"});
  assert.equal(D.dueState(un, TODAY), "closed");
});

test("a closed-overdue watch raises nothing, an open one still does", () => {
  const closed = ticket({watches: [
    watch({anchored: true, due: "2026-08-01", closed: "2026-08-20", outcome: "VALIDATED"}),
    watch({wid: "OT-T1-2", closed: "2026-08-20", outcome: "INVALIDATED"})]});
  assert.deepEqual(D.attentionReasons(closed, TODAY), []);
  assert.equal(D.needsAttention(closed, TODAY), false);
  const open = ticket({watches: [watch({anchored: true, due: "2026-08-01"})]});
  assert.equal(D.attentionReasons(open, TODAY)[0].txt, "WATCH OVERDUE 26D");
  assert.equal(D.needsAttention(open, TODAY), true);
});

test("a closed watch covers nothing, so its open decision is unwatched again", () => {
  const t = ticket({decisions: [decision()],
    watches: [watch({closed: "2026-08-20", outcome: "VALIDATED"})]});
  assert.equal(D.coveringWatch(t, "DL-001"), null);
  assert.equal(D.unwatchedOpen(t).length, 1);
  const live = ticket({decisions: [decision()], watches: [watch()]});
  assert.equal(D.coveringWatch(live, "DL-001"), live.watches[0]);
});

test("the quiet-ticket ribbon skips closed watches when naming the next date", () => {
  const t = ticket({watches: [
    watch({anchored: true, due: "2026-09-01", closed: "2026-08-20", outcome: "VALIDATED"}),
    watch({wid: "OT-T1-2", anchored: true, due: "2026-10-01"})]});
  assert.equal(D.ribbonModel(t, TODAY).reasons[0].txt, "CLOSED · WATCH 2026-10-01");
  const all = ticket({watches: [
    watch({anchored: true, due: "2026-09-01", closed: "2026-08-20", outcome: "VALIDATED"})]});
  assert.equal(D.ribbonModel(all, TODAY).reasons[0].txt, "CLOSED · LOOP CLOSED");
});

test("the obligation section reads complete once its watches close", () => {
  const en = {key: "sec-o", title: "O", phase: 9, canonical: true, missing: false};
  const t = ticket({watches: [
    watch({anchored: true, due: "2026-08-01", closed: "2026-08-20", outcome: "VALIDATED"}),
    watch({wid: "OT-T1-2", closed: "2026-08-20", outcome: "UNKNOWN"})]});
  assert.deepEqual(D.sectionState(t, en, TODAY), {label: "complete", tone: "ok"});
});

// ---- recorded rulings ----

test("a recorded ruling outranks the card's own status line", () => {
  const ruled = decision({status: "OPEN — awaiting the window", closed: "2026-08-20", outcome: "VALIDATED"});
  assert.equal(D.decisionKind(ruled), "validated");
  assert.equal(D.decisionKind(decision()), "open");
  assert.equal(D.decisionKind(decision({outcome: "INVALIDATED", closed: "2026-08-20"})), "invalidated");
});

test("a ruled decision is settled, so it never counts as unwatched", () => {
  const t = ticket({decisions: [
    decision({closed: "2026-08-20", outcome: "VALIDATED"})]});
  assert.equal(D.unwatchedOpen(t).length, 0);
  assert.deepEqual(D.attentionReasons(t, TODAY), []);
});

test("a closed watch never settles the decisions it covered", () => {
  // The ruling must be recorded on the entry itself; the watch closing
  // VALIDATED leaves its still-open decision honestly unwatched.
  const t = ticket({decisions: [decision()],
    watches: [watch({closed: "2026-08-20", outcome: "VALIDATED"})]});
  assert.equal(D.unwatchedOpen(t).length, 1);
});

test("the decision-log section reads through rulings", () => {
  const en = {key: "sec-d", title: "D", phase: 5, canonical: true, missing: false};
  const settled = ticket({decisions: [decision({closed: "2026-08-20", outcome: "VALIDATED"})]});
  assert.deepEqual(D.sectionState(settled, en, TODAY), {label: "complete", tone: "ok"});
  const struck = ticket({decisions: [decision({closed: "2026-08-20", outcome: "INVALIDATED"})]});
  assert.deepEqual(D.sectionState(struck, en, TODAY), {label: "invalidated entries", tone: "bad"});
});

test("settledWatch names the closed watch that stood over a decision", () => {
  const w = watch({closed: "2026-08-20", outcome: "VALIDATED"});
  const t = ticket({decisions: [decision()], watches: [w]});
  assert.equal(D.settledWatch(t, "DL-001"), w);
  // A live watch is coverage, never settlement.
  assert.equal(D.settledWatch(ticket({watches: [watch()]}), "DL-001"), null);
});

// ---- the watchboard (R5) ----

// The staged corpus R5's verify line orders: overdue, upcoming, and
// unanchored watches spread over two tickets, plus a closed one to exclude.
function boardTickets(){
  return [
    ticket({id: "T1", dir: "20260801-T1-alpha", watches: [
      watch({wid: "OT-T1-1", anchored: true, due: "2026-09-20", window: "until 2026-09-20"}),
      watch({wid: "OT-T1-2", window: "60 days after merge"}),
      watch({wid: "OT-T1-3", anchored: true, due: "2026-08-01",
        closed: "2026-08-10", outcome: "VALIDATED"})
    ]}),
    ticket({id: "T2", dir: "20260802-T2-beta", watches: [
      watch({wid: "OT-T2-1", anchored: true, due: "2026-08-20"}),
      watch({wid: "OT-T2-2", anchored: true, due: "2026-08-30"})
    ]})
  ];
}

test("watchboardRows rows every watch: live in due order, closed trailing with the ruling", () => {
  const {rows, counts} = D.watchboardRows(boardTickets(), TODAY);
  assert.deepEqual(rows.map(r => r.wid),
    ["OT-T2-1", "OT-T2-2", "OT-T1-1", "OT-T1-2", "OT-T1-3"]);
  assert.deepEqual(rows.map(r => r.state),
    ["overdue", "soon", "upcoming", "unanchored", "closed"]);
  assert.deepEqual(counts,
    {overdue: 1, soon: 1, upcoming: 1, unanchored: 1, closed: 1});
  // The unanchored row is flagged, never dated: no due, a sentinel order
  // above every dated row, and the window prose rides for the due cell.
  const un = rows[3];
  assert.equal(un.due, null);
  assert.equal(un.label, "UNANCHORED");
  assert.equal(un.window, "60 days after merge");
  assert.equal(rows[0].label, "OVERDUE 7D");
  // The settled row carries the closure pair and sits in its own band
  // above the sentinel, however stale its due date is.
  const done = rows[4];
  assert.equal(done.closed, "2026-08-10");
  assert.equal(done.outcome, "VALIDATED");
  assert.equal(done.label, "CLOSED");
  assert.ok(done.order > un.order);
  // One order value carries the row order, so the due and status columns
  // can both read it and stay one ordering read two ways.
  for (let i = 1; i < rows.length; i++)
    assert.ok(rows[i].order >= rows[i - 1].order);
  assert.ok(un.order > rows[2].order);
});

test("watchboardRows attaches the rail's ticket token, id or directory", () => {
  const named = D.watchboardRows(boardTickets(), TODAY).rows;
  assert.ok(named.every(r => r.tid === "T1" || r.tid === "T2"));
  const bare = D.watchboardRows([ticket({id: null, watches: [watch()]})], TODAY).rows;
  assert.equal(bare[0].tid, "20260801-T1-alpha");
});

test("watchboardRows breaks day ties by directory then watch id", () => {
  const tie = [
    ticket({id: "B", dir: "20260803-B-b", watches: [
      watch({wid: "OT-B-2", anchored: true, due: "2026-09-20"}),
      watch({wid: "OT-B-1", anchored: true, due: "2026-09-20"})
    ]}),
    ticket({id: "A", dir: "20260801-A-a", watches: [
      watch({wid: "OT-A-1", anchored: true, due: "2026-09-20"})
    ]})
  ];
  assert.deepEqual(D.watchboardRows(tie, TODAY).rows.map(r => r.wid),
    ["OT-A-1", "OT-B-1", "OT-B-2"]);
});

test("watchboardRows orders closed rows newest ruling first and zeroes an empty corpus", () => {
  const t = ticket({watches: [
    watch({wid: "OT-1", closed: "2026-08-10", outcome: "VALIDATED"}),
    watch({wid: "OT-2", closed: "2026-08-11", outcome: "UNKNOWN"})
  ]});
  const {rows, counts} = D.watchboardRows([t], TODAY);
  assert.deepEqual(rows.map(r => r.wid), ["OT-2", "OT-1"]);
  assert.equal(counts.closed, 2);
  assert.deepEqual(D.watchboardRows([], TODAY),
    {rows: [], counts: {overdue: 0, soon: 0, upcoming: 0, unanchored: 0, closed: 0}});
});

// ---- the ledgers ----

/* The staged corpus for the ledgers: every decision rank at once over two
   tickets, plus live and settled watches carrying the closure pair. */
function ledgerTickets(){
  return [
    ticket({id: "T1", dir: "20260801-T1-alpha",
      decisions: [
        // The covered entry takes the lower id on purpose: only the coverage
        // rank can put the unwatched entry first, never the id tiebreak.
        decision({id: "DL-001", title: "covered open", status: "OPEN — rides"}),
        decision({id: "DL-002", title: "unwatched open", created: "2026-08-20"}),
        decision({id: "DL-003", title: "ruled off the card",
          closed: "2026-08-20", outcome: "INVALIDATED"}),
        decision({id: "DL-004", title: "validated", status: "VALIDATED"})
      ],
      watches: [
        watch({wid: "OT-T1-1", dl: ["DL-001"], anchored: true, due: "2026-09-20"}),
        watch({wid: "OT-T1-2", dl: ["DL-004"], anchored: true, due: "2026-08-01",
          closed: "2026-08-10", outcome: "VALIDATED"})
      ]}),
    ticket({id: "T2", dir: "20260802-T2-beta",
      decisions: [
        decision({id: "DL-001", title: "mystery token", status: "PARKED"}),
        decision({id: "DL-002", title: "unjudged", status: "UNKNOWN"})
      ],
      watches: [
        watch({wid: "OT-T2-1", dl: ["DL-001"], window: "60 days after merge"}),
        watch({wid: "OT-T2-2", dl: ["DL-002"], anchored: true, due: "2026-08-05",
          closed: "2026-08-21", outcome: "UNKNOWN"})
      ]})
  ];
}

test("ledgerRows ranks decisions as triage: unwatched-open leads, settled trails", () => {
  const {decisions} = D.ledgerRows(ledgerTickets(), TODAY);
  assert.deepEqual(decisions.map(r => r.tid + "/" + r.id),
    ["T1/DL-002", "T1/DL-001", "T2/DL-002", "T2/DL-001", "T1/DL-003", "T1/DL-004"]);
  assert.deepEqual(decisions.map(r => r.kind),
    ["open", "open", "unknown", "other", "invalidated", "validated"]);
  // Coverage reads through the live-only seam: the covered entry names its
  // watch, and the entry whose watch closed shows how coverage ended.
  assert.equal(decisions[1].watch, "OT-T1-1");
  assert.equal(decisions[5].watch, null);
  assert.deepEqual(decisions[5].settled,
    {wid: "OT-T1-2", outcome: "VALIDATED", closed: "2026-08-10"});
  // A recorded ruling classifies the entry whatever its card status says.
  assert.equal(decisions[4].kind, "invalidated");
  // A dated card ages in days; an undated one stays null, never NaN.
  assert.equal(decisions[0].age, 7);
  assert.equal(decisions[1].age, null);
});

test("ledgerRows carries decisions only — the board is the one watch surface", () => {
  const lg = D.ledgerRows(ledgerTickets(), TODAY);
  assert.deepEqual(Object.keys(lg), ["decisions"]);
  assert.deepEqual(D.ledgerRows([], TODAY), {decisions: []});
});

test("ledgerRows breaks equal ranks by directory then entry id", () => {
  const tie = [
    ticket({id: "B", dir: "20260803-B-b", decisions: [
      decision({id: "DL-002"}), decision({id: "DL-001"})]}),
    ticket({id: "A", dir: "20260801-A-a", decisions: [decision({id: "DL-001"})]})
  ];
  assert.deepEqual(D.ledgerRows(tie, TODAY).decisions.map(r => r.tid + "/" + r.id),
    ["A/DL-001", "B/DL-001", "B/DL-002"]);
});

// ---- calibration ----

test("calibrationModel folds decisions by confidence and outcome through the ledger's classifications", () => {
  const m = D.calibrationModel(ledgerTickets(), TODAY);
  // Both fixture tickets are closed, and a closed log shipped first. The
  // watch tiles read the board's own counts.
  assert.deepEqual(m.tiles, {tickets: 2, shipped: 2, decisions: 6, overdue: 0, unanchored: 1});
  // The three canonical buckets always row, in order; other rows only with entries.
  assert.deepEqual(m.buckets.map(b => b.kind), ["high", "medium", "low"]);
  const high = m.buckets[0];
  // The entry ruled INVALIDATED over an OPEN card counts by its ruling.
  assert.deepEqual(high.counts, {validated: 1, invalidated: 1, open: 2, unknown: 1, other: 1});
  assert.equal(high.total, 6);
  assert.deepEqual(high.tokens, ["HIGH"]);
  // Only rulings are outcomes: the open, unknown, and PARKED entries stay out.
  assert.deepEqual(high.ruled, {validated: 1, ruled: 2});
  assert.equal(m.buckets[1].total, 0);
  assert.deepEqual(m.buckets[1].ruled, {validated: 0, ruled: 0});
});

test("calibrationModel rows an unclassified confidence under other with its tokens, and drops nothing", () => {
  const ts = [ticket({state: "shipped", decisions: [
    decision({id: "DL-001", confidence: "CERTAIN", status: "VALIDATED"}),
    decision({id: "DL-002", confidence: "", status: "OPEN"}),
    decision({id: "DL-003", confidence: "Medium — leaning", status: "RETIRED"}),
    decision({id: "DL-004", confidence: "MED", status: "OPEN"}),
    decision({id: "DL-005", confidence: "LOW", status: "UNKNOWN"})]})];
  const m = D.calibrationModel(ts, TODAY);
  assert.deepEqual(m.tiles, {tickets: 1, shipped: 1, decisions: 5, overdue: 0, unanchored: 0});
  assert.deepEqual(m.buckets.map(b => b.kind), ["high", "medium", "low", "other"]);
  const other = m.buckets[3];
  // The parser places a token by prefix, so MED and Medium are medium; the
  // other bucket takes what matched no prefix, named as written.
  assert.deepEqual(other.tokens, ["CERTAIN", "—"]);
  assert.deepEqual(other.counts, {validated: 1, invalidated: 0, open: 1, unknown: 0, other: 0});
  const medium = m.buckets[1];
  assert.deepEqual(medium.tokens, ["Medium", "MED"]);
  assert.deepEqual(medium.counts, {validated: 0, invalidated: 0, open: 1, unknown: 0, other: 1});
  assert.deepEqual(m.buckets[2].counts, {validated: 0, invalidated: 0, open: 0, unknown: 1, other: 0});
  // The invariant the tiles state: every decision lands in exactly one cell.
  const sum = m.buckets.reduce((n, b) => n + Object.values(b.counts).reduce((a, c) => a + c, 0), 0);
  assert.equal(sum, m.tiles.decisions);
});

test("calibrationModel over an empty corpus tiles zeros and rows the three canonical buckets", () => {
  const m = D.calibrationModel([], TODAY);
  assert.deepEqual(m.tiles, {tickets: 0, shipped: 0, decisions: 0, overdue: 0, unanchored: 0});
  assert.deepEqual(m.buckets.map(b => b.total), [0, 0, 0]);
});
