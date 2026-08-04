/* Trap pins for adp-parser-lib.js. The lib was extracted from ADP-Parser.html
   under the rule that behavior moves before it improves, so every test here
   pins what the page already did. If one of these fails after an edit, the
   renderer's observable output changed and the change needs its own fixture. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const {parserLib} = require("./helpers.js");
const {esc, escAttr, inline, decorate, parseSections, sectionKeys, slug, metaFor,
       dlChipSplit, dlConfPill, dlStatusPill, dlRail, renderDLCard, renderDecisionLog,
       dlStatusKind, parseDLEntries, dlEntryStatus, dlStatusCounts} = parserLib;

// ---- dual export (R2) ----

test("the browser leg exposes the same API as require()", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "adp-parser-lib.js"), "utf8");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  assert.deepEqual(Object.keys(sandbox.ADPParserLib).sort(), Object.keys(parserLib).sort());
  assert.equal(sandbox.ADPParserLib.renderMarkdown("**hi**"), parserLib.renderMarkdown("**hi**"));
});

// ---- section splitter ----

test("a fenced ## line does not split sections", () => {
  const {secs} = parseSections("## Real\nbefore\n```\n## Not A Section\n```\nafter\n");
  assert.equal(secs.length, 1);
  assert.ok(secs[0].body.includes("## Not A Section"));
});

test("an unclosed fence swallows every later heading", () => {
  const {secs} = parseSections("## A\n```\n## B\n## C\n");
  assert.equal(secs.length, 1);
});

test("text above the first section becomes the intro", () => {
  const r = parseSections("preface line\n\n## First\nbody\n");
  assert.equal(r.intro, "preface line");
  assert.equal(r.secs.length, 1);
});

test("duplicate titles dedupe with numeric suffixes in document order", () => {
  const secs = [{title: "Foo"}, {title: "Foo"}, {title: "Foo"}];
  assert.deepEqual(sectionKeys(secs), ["sec-foo", "sec-foo-1", "sec-foo-2"]);
});

test("the dedupe counter only tracks base slugs", () => {
  // A title whose own slug matches an already deduped key produces a
  // duplicate id. We pin the quirk as it shipped. Fixing it is a behavior
  // change and needs its own ticket.
  assert.deepEqual(sectionKeys([{title: "Foo"}, {title: "Foo"}, {title: "Foo 1"}]),
    ["sec-foo", "sec-foo-1", "sec-foo-1"]);
});

test("slug lowercases, collapses punctuation, and caps at 42 chars", () => {
  assert.equal(slug("Pre-Mortem Report"), "sec-pre-mortem-report");
  assert.equal(slug("  ///  "), "sec-x");
  assert.equal(slug("A".repeat(60)).length, "sec-".length + 42);
});

test("metaFor routes titles to the registry and defaults unknown ones", () => {
  assert.equal(metaFor("Decision Log").spine, true);
  assert.equal(metaFor("Pre-Mortem Report").tag, "P4");
  assert.deepEqual(metaFor("Anything Else"), {icon: "§", tag: ""});
});

// ---- link scheme allowlist (AV-005's rule, pinned here post-extraction) ----

test("http, https, mailto, relative, and fragment urls stay clickable", () => {
  for (const url of ["https://x.y", "http://x.y", "mailto:a@b.c", "/relative/path", "#sec-decision-log"]) {
    assert.ok(inline("[a](" + url + ")").includes("<a href="), url + " should anchor");
  }
});

test("a disallowed scheme degrades to visible text, any letter case", () => {
  for (const url of ["javascript:alert(1)", "JAVAscript:alert(1)", "vbscript:x", "data:text/html,x"]) {
    const out = inline("[click](" + url + ")");
    assert.ok(!out.includes("<a "), url + " must not anchor");
    assert.ok(out.includes("[click]("), url + " must stay visible");
  }
});

test("control characters and double quotes in a url degrade to text", () => {
  assert.ok(!inline("[x](javascript:alert(1))").includes("<a "));
  assert.ok(!inline('[x](https://x.y/"onmouseover=1)').includes("<a "));
});

// ---- inline formatting and pills ----

test("escAttr escapes double quotes and esc leaves them alone", () => {
  assert.equal(esc('a "b" <c>'), 'a "b" &lt;c&gt;');
  assert.equal(escAttr('a "b"'), "a &quot;b&quot;");
});

test("decorate wraps free-standing status keywords and skips longer words", () => {
  assert.equal(decorate("HIGH"), '<span class="pill p-high">HIGH</span>');
  assert.equal(decorate("HIGHLY"), "HIGHLY");
});

// ---- decision-log cards (AV-003's chip rule, pinned here post-extraction) ----

test("dlChipSplit takes the first word and returns the rest as the tail", () => {
  assert.deepEqual(dlChipSplit("HIGH - because the suite pins it"),
    {word: "HIGH", tail: "because the suite pins it"});
  assert.deepEqual(dlChipSplit("OPEN"), {word: "OPEN", tail: ""});
});

test("confidence chips split the keyword from the prose tail", () => {
  const conf = dlConfPill("MEDIUM: pending a live check");
  assert.equal(conf.html, '<span class="pill dl-pill p-med"><i>conf</i>MEDIUM</span>');
  assert.equal(conf.note, "pending a live check");
  assert.equal(dlConfPill("HIGH").note, "");
});

test("an unknown confidence keyword demotes the whole value", () => {
  const conf = dlConfPill("UNSURE at best");
  assert.ok(conf.html.includes("p-low"));
  assert.equal(conf.note, "UNSURE at best");
});

test("a known status keyword chips as one word and demotes only the tail", () => {
  const card = renderDLCard({head: "[DL-8] t", lines: ["- **Status:** VALIDATED — suite green"]});
  assert.ok(card.includes("<i>status</i>VALIDATED</span>"));
  assert.ok(card.includes("rail-ok"));
  assert.ok(card.includes("suite green"));
});

test("an unknown status keyword renders a neutral pill, no rail, whole value demoted", () => {
  const card = renderDLCard({head: "[DL-9] t", lines: ["- **Status:** DEFERRED until Q3"]});
  assert.ok(card.includes('<span class="pill dl-pill p-low"><i>status</i>DEFERRED</span>'));
  assert.ok(card.includes("DEFERRED until Q3"));
  assert.ok(!card.includes("rail-"));
  assert.equal(dlRail("DEFERRED until Q3"), "");
});

test("a fenced ### line does not open a new decision-log entry", () => {
  const out = renderDecisionLog("### [DL-001] real\n- **Decision:** d\n```\n### [DL-999] not an entry\n```\n");
  assert.ok(out.includes('<span class="dl-id">DL-001</span>'));
  assert.ok(!out.includes('<span class="dl-id">DL-999</span>'));
});

test("a decision log without entries falls back to the generic renderer", () => {
  const out = renderDecisionLog("just prose\n");
  assert.ok(out.startsWith("<p>"));
  assert.ok(!out.includes("dl-cards"));
});

// ---- decision-log audit counts (AV-008) ----

test("dlStatusKind classifies by the same prefix match the rail shipped with", () => {
  assert.equal(dlStatusKind("OPEN"), "open");
  assert.equal(dlStatusKind("VALIDATED"), "validated");
  assert.equal(dlStatusKind("INVALIDATED"), "invalidated");
  assert.equal(dlStatusKind("DEFERRED until Q3"), "other");
  // The match accepts a tail, any letter case, and a longer word that opens
  // with a keyword. We pin the quirks as they shipped in dlRail.
  assert.equal(dlStatusKind("open — pending review"), "open");
  assert.equal(dlStatusKind("OPENED"), "open");
  assert.equal(dlStatusKind(""), "other");
  assert.equal(dlStatusKind(undefined), "other");
});

test("rail and chip verdicts agree with dlStatusKind on every bucket", () => {
  const rail = {open: "rail-open", validated: "rail-ok", invalidated: "rail-bad", other: ""};
  const pill = {open: "p-open", validated: "p-ok", invalidated: "p-bad", other: "p-low"};
  for (const v of ["OPEN", "VALIDATED", "INVALIDATED", "DEFERRED", "OPENED", "validated: suite green"]) {
    const kind = dlStatusKind(v);
    assert.equal(dlRail(v), rail[kind], v);
    assert.ok(dlStatusPill(v).html.includes(pill[kind]), v);
  }
});

test("parseDLEntries returns pre-entry prose separately from the entries", () => {
  const r = parseDLEntries("intro line\n\n### [DL-1] a\n- **Status:** OPEN\n");
  assert.equal(r.pre, "intro line");
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].head, "[DL-1] a");
});

test("dlStatusCounts counts the same entries the cards render", () => {
  const body = [
    "### [DL-1] a", "- **Status:** OPEN",
    "### [DL-2] b", "- **Status:** VALIDATED — suite green",
    "### [DL-3] c", "- **Status:** DEFERRED",
    "### [DL-4] d", "- **Decision:** no status field at all",
    "```", "### [DL-99] fenced, not an entry", "```",
  ].join("\n");
  assert.deepEqual(dlStatusCounts(body),
    {open: 1, validated: 1, invalidated: 0, other: 2, total: 4});
});

test("a repeated Status field counts by the last one, as the card shows", () => {
  const entry = {head: "[DL-5] t", lines: ["- **Status:** OPEN", "- **Status:** VALIDATED"]};
  assert.equal(dlEntryStatus(entry), "VALIDATED");
  assert.ok(renderDLCard(entry).includes("rail-ok"));
});

test("a body without entries counts all zeros", () => {
  assert.deepEqual(dlStatusCounts("just prose\n"),
    {open: 0, validated: 0, invalidated: 0, other: 0, total: 0});
});

test("the example's decision log counts 1 open and 1 validated", () => {
  const example = require("./fixtures/viewer-example.js");
  const spine = parseSections(example).secs.find(s => metaFor(s.title).spine);
  assert.deepEqual(dlStatusCounts(spine.body.join("\n")),
    {open: 1, validated: 1, invalidated: 0, other: 0, total: 2});
});
