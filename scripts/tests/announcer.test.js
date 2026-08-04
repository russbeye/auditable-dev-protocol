/* Announcer suite (PB-007-a11y-live-status). The live region must speak state
   transitions after input settles and stay silent otherwise. We drive the
   factory with a hand-rolled scheduler, so the tests never touch the global
   timers and run on stock Node.

   Runs with the rest of the suite:  node --test scripts/tests/*.test.js */
"use strict";

const {test} = require("node:test");
const assert = require("node:assert");
const {lib} = require("./helpers.js");

// A minimal fake clock. setTimeout stores the callback and settle() runs
// whatever is pending. We ignore the delay because the announcer only needs
// scheduling order, not real time.
function makeClock(){
  const pending = new Map();
  let nextId = 1;
  return {
    setTimeout(fn){ const id = nextId++; pending.set(id, fn); return id; },
    clearTimeout(id){ pending.delete(id); },
    settle(){ const fns = [...pending.values()]; pending.clear(); fns.forEach(fn => fn()); },
    pendingCount(){ return pending.size; }
  };
}

function makeAnnouncer(extra){
  const clock = makeClock();
  const spoken = [];
  const report = lib.createStatusAnnouncer(Object.assign({
    say: t => spoken.push(t),
    debounceMs: 800,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  }, extra));
  return {clock, spoken, report};
}

test("the first report seeds the baseline without scheduling or speaking", () => {
  const {clock, spoken, report} = makeAnnouncer();
  report(3);
  assert.strictEqual(clock.pendingCount(), 0);
  clock.settle();
  assert.deepStrictEqual(spoken, []);
});

test("a transition announces once after the input settles", () => {
  const {clock, spoken, report} = makeAnnouncer();
  report(0);
  report(1);
  assert.deepStrictEqual(spoken, [], "nothing speaks before the settle window");
  clock.settle();
  assert.deepStrictEqual(spoken, ["1 issue"]);
});

test("a burst of renders yields one announcement for the latest count", () => {
  const {clock, spoken, report} = makeAnnouncer();
  report(3);
  report(2);
  report(1);
  report(0);
  clock.settle();
  assert.deepStrictEqual(spoken, ["Valid"]);
});

test("a round trip back to the spoken state stays silent", () => {
  const {clock, spoken, report} = makeAnnouncer();
  report(0);
  report(2);
  report(0);
  clock.settle();
  assert.deepStrictEqual(spoken, []);
});

test("repeat reports of the spoken count stay silent", () => {
  const {clock, spoken, report} = makeAnnouncer();
  report(2);
  report(2);
  report(2);
  clock.settle();
  assert.deepStrictEqual(spoken, []);
});

test("zero reads as Valid and counts pluralize", () => {
  const {clock, spoken, report} = makeAnnouncer();
  report(1);
  report(2); clock.settle();
  report(0); clock.settle();
  report(1); clock.settle();
  assert.deepStrictEqual(spoken, ["2 issues", "Valid", "1 issue"]);
});

test("each transition after a settle announces again", () => {
  const {clock, spoken, report} = makeAnnouncer();
  report(0);
  report(3); clock.settle();
  report(3); clock.settle();
  report(0); clock.settle();
  assert.deepStrictEqual(spoken, ["3 issues", "Valid"]);
});

/* AV-006 generalizes the factory. A format option lets the viewer speak its
   source states through the same settle-then-compare rule. The tests above
   pin the default wording, and these pin the hook. */

test("a format option controls the wording without touching the discipline", () => {
  const {clock, spoken, report} = makeAnnouncer({format: s => "now " + s});
  report("IDLE");
  report("WATCHING");
  assert.deepStrictEqual(spoken, [], "nothing speaks before the settle window");
  clock.settle();
  assert.deepStrictEqual(spoken, ["now WATCHING"]);
});

test("string states repeat silently and speak once per transition", () => {
  const {clock, spoken, report} = makeAnnouncer({format: s => s});
  report("IDLE");
  report("WATCHING"); clock.settle();
  // Every content change of a watched file re-reports WATCHING. None of
  // these are transitions, so none of them speak.
  for (let i = 0; i < 60; i++){ report("WATCHING"); clock.settle(); }
  report("PASTED"); clock.settle();
  assert.deepStrictEqual(spoken, ["WATCHING", "PASTED"]);
});
