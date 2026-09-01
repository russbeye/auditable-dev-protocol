"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const builder = require(path.join(__dirname, "..", "adp-index-builder-lib.js"));
const indexLib = require(path.join(__dirname, "..", "adp-index-lib.js"));

const CORPUS = path.join(__dirname, "fixtures", "corpus");
const GOLDEN = path.join(__dirname, "fixtures", "corpus-expected-index.json");
const OPTS = {project: "fixture-corpus", generated: "2026-08-20", source: "snapshot"};

// The filesystem walk lives here on the caller side, because the builder core
// only ever sees (path, text) pairs.
function readCorpus(root){
  const files = [];
  (function walk(dir){
    const entries = fs.readdirSync(dir, {withFileTypes: true})
      .sort((a, b) => a.name < b.name ? -1 : 1);
    for (const e of entries){
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push({path: path.relative(root, p).split(path.sep).join("/"), text: fs.readFileSync(p, "utf8")});
    }
  })(root);
  return files;
}

function fixtureDoc(){
  return builder.buildIndex(readCorpus(CORPUS), OPTS);
}
function ticket(doc, id){
  return doc.tickets.find(t => t.id === id || t.dir === id);
}

test("golden: the fixture corpus serializes to the reviewed bytes", () => {
  assert.equal(indexLib.serializeIndex(fixtureDoc()), fs.readFileSync(GOLDEN, "utf8"));
});

test("the built fixture index passes the contract suite", () => {
  assert.deepEqual(indexLib.validateIndex(fixtureDoc()), []);
});

test("input order never reaches the output", () => {
  const files = readCorpus(CORPUS);
  const a = indexLib.serializeIndex(builder.buildIndex(files, OPTS));
  const b = indexLib.serializeIndex(builder.buildIndex(files.slice().reverse(), OPTS));
  assert.equal(a, b);
});

test("directory names split into date, id, and slug", () => {
  assert.deepEqual(builder.parseDirName("20260820-MC001-mission-control-shell"),
    {id: "MC001", date: "2026-08-20", slug: "mission-control-shell"});
  assert.deepEqual(builder.parseDirName("AV-001-toolbar-parity"),
    {id: "AV001", date: null, slug: "toolbar-parity"});
  assert.deepEqual(builder.parseDirName("misc-notes"),
    {id: null, date: null, slug: "misc-notes"});
  // A rollover date fails the calendar check, so the whole name is the slug.
  assert.deepEqual(builder.parseDirName("20260230-XX01-rollover"),
    {id: null, date: null, slug: "20260230-XX01-rollover"});
});

test("a declared block without a valid state falls back to inference", () => {
  const doc = builder.buildIndex([{
    path: "T-1-x/audit-log.md",
    text: "---\nstate: finished\npr: \"#9\"\n---\n# T\n\n## PR Summary\nprose\n"
  }], OPTS);
  const t = doc.tickets[0];
  assert.equal(t.state_source, "inferred");
  assert.equal(t.state, "in-review");
  assert.equal(t.pr, null);
});

test("declared front matter wins the lifecycle and fills pr and merged", () => {
  const t = ticket(fixtureDoc(), "FX001");
  assert.equal(t.state, "shipped");
  assert.equal(t.state_source, "declared");
  assert.equal(t.pr, "#42");
  assert.equal(t.merged, "2026-08-20");
  assert.equal(t.title, "Audit Log — FX-001 declared lifecycle");
});

test("the ladder infers closed, shipped, and open", () => {
  const doc = fixtureDoc();
  assert.equal(ticket(doc, "AV090").state, "closed");
  assert.equal(ticket(doc, "FX002").state, "shipped");
  assert.equal(ticket(doc, "FX002").state_source, "inferred");
  assert.equal(ticket(doc, "FX091").state, "open");
});

test("a duplicate canonical heading demotes with a suffixed key", () => {
  const secs = ticket(fixtureDoc(), "AV090").sections;
  const dup = secs.find(s => s.key === "sec-decision-log-1");
  assert.deepEqual(dup, {key: "sec-decision-log-1", title: "Decision Log", phase: null, canonical: false});
});

test("a companion attributes to its phase but never clears missing", () => {
  const t = ticket(fixtureDoc(), "FX002");
  const oq = t.sections.find(s => s.title === "Open Questions");
  assert.equal(oq.phase, 2);
  assert.ok(t.missing.includes("Knowledge Gap"));
});

test("fenced text neither cites nor cards", () => {
  const t = ticket(fixtureDoc(), "AV090");
  assert.equal(t.decisions.length, 1);
  assert.deepEqual(t.refs["sec-decision-log"], ["DL-001"]);
});

test("placeholders never reach refs or dl lists", () => {
  const doc = fixtureDoc();
  const t = ticket(doc, "AV090");
  assert.deepEqual(t.watches[1].dl, []);
  assert.equal(indexLib.serializeIndex(doc).includes("DL-XXX"), false);
});

test("a dash-only obligation row is an empty row, not a watch", () => {
  const t = ticket(fixtureDoc(), "AV090");
  assert.equal(t.watches.length, 2);
  assert.equal(t.watches.some(w => w.wid === "—"), false);
});

test("a watch anchors exactly when its window holds a date", () => {
  const doc = fixtureDoc();
  const legacy = ticket(doc, "AV090").watches[0];
  assert.equal(legacy.due, null);
  assert.equal(legacy.anchored, false);
  assert.equal(legacy.window, "60 days after merge");
  assert.equal(ticket(doc, "FX001").watches[0].due, "2026-10-15");
  assert.equal(ticket(doc, "FX002").watches[0].due, "2026-12-01");
});

test("a closure record lands on its row, and the first ruling wins", () => {
  // The fixture carries a second, contradictory CLOSED line for this wid;
  // pinning the first ruling's date and outcome proves it lost.
  const w = ticket(fixtureDoc(), "FX003").watches[0];
  assert.equal(w.closed, "2026-09-10");
  assert.equal(w.outcome, "VALIDATED");
});

test("a re-anchor fills only a null anchor", () => {
  const ws = ticket(fixtureDoc(), "FX003").watches;
  assert.equal(ws[1].due, "2026-12-24");
  assert.equal(ws[1].anchored, true);
  assert.equal(ws[1].window, "45 days after merge");
  // The row's own window date is the anchor of record, so the re-anchor
  // line aimed at this watch lands nowhere.
  assert.equal(ws[2].due, "2026-12-01");
  // Both re-anchor lines aimed at the first watch carry a bad date in one
  // slot or the other, and the one calendar gate rejects each.
  assert.equal(ws[0].due, null);
});

test("phantom, dateless, badly dated, and fenced ledger lines harvest nothing", () => {
  const t = ticket(fixtureDoc(), "FX003");
  assert.equal(t.watches.some(w => w.wid === "OT-FX003-9"), false);
  assert.equal("closed" in t.watches[2], false);
  assert.equal("outcome" in t.watches[2], false);
});

test("a record above the ticket list is prose", () => {
  // The fixture closes its third watch with a well-formed, well-dated line
  // sitting in the Decision Log section, before any watch table exists.
  const t = ticket(fixtureDoc(), "FX003");
  assert.equal("closed" in t.watches[2], false);
  assert.deepEqual(t.refs["sec-decision-log"], ["DL-001", "OT-FX003-3"]);
});

test("a ruling lands on its card and the status stays verbatim", () => {
  const d = ticket(fixtureDoc(), "FX003").decisions[0];
  assert.equal(d.closed, "2026-09-12");
  assert.equal(d.outcome, "VALIDATED");
  assert.equal(d.status, "OPEN");
});

test("lintCorpus reports the ledger's silent failures by kind", () => {
  const d = "20260827-FX003-closed-watches";
  assert.deepEqual(builder.lintCorpus(readCorpus(CORPUS)), [
    {dir: d, id: "OT-FX003-9", finding: "phantom"},
    {dir: d, id: "DL-009", finding: "phantom"},
    {dir: d, id: "OT-FX003-1", finding: "contradiction"},
    // The fixture's valid re-anchor aims at a row-anchored watch, so the
    // silent refusal now speaks.
    {dir: d, id: "OT-FX003-3", finding: "dead-anchor"},
    // The early in-Decision-Log record and the dark-guard lines are closure
    // intent that never landed, one finding per id.
    {dir: d, id: "OT-FX003-3", finding: "near-miss"},
    {dir: d, id: "OT-FX003-1", finding: "near-miss"}
  ]);
});

// A one-ticket corpus for lint cases the fixture corpus does not carry. The
// table holds live unanchored watches beside whatever lines the case needs.
function lintLog(lines, extraRows){
  return [{path: "T-1-x/audit-log.md", text: [
    "# T", "",
    "## Obligation Ticket List", "",
    "| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |",
    "|---|---|---|---|---|---|",
    "| OT-1 | DL-001 | w | LOW | x | 60 days after merge |"
  ].concat(extraRows || [], "", lines, "").join("\n")}];
}

test("prose that merely ends in an id shape raises nothing", () => {
  assert.deepEqual(builder.lintCorpus(lintLog([
    "The PILOT-1 CLOSED the loop last week."
  ])), []);
  // The control: the same id standing free is real intent.
  assert.deepEqual(builder.lintCorpus(lintLog([
    "OT-1 CLOSED without ever writing the date."
  ])), [{dir: "T-1-x", id: "OT-1", finding: "near-miss"}]);
});

test("every intent on a line is seen, not just the first", () => {
  const files = lintLog(["OT-1 CLOSED and OT-9 CLOSED at the same review."],
    ["| OT-9 | DL-001 | w | LOW | x | — |"]);
  assert.deepEqual(builder.lintCorpus(files), [
    {dir: "T-1-x", id: "OT-1", finding: "near-miss"},
    {dir: "T-1-x", id: "OT-9", finding: "near-miss"}
  ]);
});

test("an anchor landing on a closed watch is a dead anchor", () => {
  assert.deepEqual(builder.lintCorpus(lintLog([
    "- **OT-1 CLOSED 2026-09-01 → VALIDATED.** Done.",
    "- **OT-1 RE-ANCHORED 2026-09-02 → 2026-12-01.** The closure already ended this watch."
  ])), [{dir: "T-1-x", id: "OT-1", finding: "dead-anchor"}]);
});

test("lintCorpus enumerates watch ids the ledger grammar cannot address", () => {
  const files = [{path: "T-1-x/audit-log.md", text: [
    "# T", "",
    "## Obligation Ticket List", "",
    "| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |",
    "|---|---|---|---|---|---|",
    "| PB011-OT1 | DL-001 | w | LOW | x | — |", ""
  ].join("\n")}];
  assert.deepEqual(builder.lintCorpus(files),
    [{dir: "T-1-x", id: "PB011-OT1", finding: "wid-shape"}]);
});

test("legacy logs carry no closure keys at all", () => {
  const doc = fixtureDoc();
  for (const id of ["FX001", "FX002", "AV090"]){
    for (const w of ticket(doc, id).watches){
      assert.equal("closed" in w, false, id + " should stay ledger-free");
    }
  }
});

test("a supersedes field harvests as a backlink, and a placeholder drops the key", () => {
  const doc = fixtureDoc();
  const fx = ticket(doc, "FX001");
  assert.equal("supersedes" in fx.decisions[0], false);
  assert.deepEqual(fx.decisions[1].supersedes, ["DL-001"]);
  assert.equal("supersedes" in ticket(doc, "AV090").decisions[0], false);
});

test("block material after a card's fields never rides into a field value", () => {
  const doc = fixtureDoc();
  assert.equal(ticket(doc, "FX001").decisions[0].status, "VALIDATED");
  assert.equal(ticket(doc, "AV090").decisions[0].status, "OPEN");
  // The fenced token stays out of fields and refs alike, so it appears
  // nowhere in the serialized index.
  assert.equal(indexLib.serializeIndex(doc).includes("DL-777"), false);
});

test("created keeps the leading date and drops the phase suffix", () => {
  const dls = ticket(fixtureDoc(), "FX001").decisions;
  assert.equal(dls[0].created, "2026-08-15");
  assert.equal(dls[1].created, null);
});

test("a corpus-root file is not a ticket", () => {
  const doc = fixtureDoc();
  assert.equal(doc.tickets.length, 6);
  assert.equal(doc.tickets.some(t => t.dir === "README.md"), false);
});

test("prompt-only and unmatched directories are real tickets", () => {
  const doc = fixtureDoc();
  const po = ticket(doc, "FX091");
  assert.equal(po.phase, 0);
  assert.equal(po.missing.length, 9);
  const misc = ticket(doc, "misc-notes");
  assert.equal(misc.id, null);
  assert.equal(misc.slug, "misc-notes");
  assert.equal(misc.title, null);
});

test("the browser build matches the Node build byte for byte", () => {
  const context = vm.createContext({});
  for (const f of ["adp-parser-lib.js", "adp-index-lib.js", "adp-index-builder-lib.js"]){
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), context, {filename: f});
  }
  const files = readCorpus(CORPUS);
  context.__files = JSON.parse(JSON.stringify(files));
  const browserBytes = vm.runInContext(
    "ADPIndexLib.serializeIndex(ADPIndexBuilder.buildIndex(__files, " +
    "{project: 'fixture-corpus', generated: '2026-08-20', source: 'snapshot'}))", context);
  assert.equal(browserBytes, indexLib.serializeIndex(builder.buildIndex(files, OPTS)));
});

/* The live corpus is gitignored, so a fresh clone skips this and the fixture
   corpus stays the byte pin. Where the corpus exists, we hold it to the
   invariants that are true of any corpus: contract validity, determinism, and
   collision-free collapsed ids. The phantom sweep only reports, because a
   cross-ticket citation of a real id is legal data, not a defect. */
test("own corpus: the live .adp builds a valid, deterministic index", t => {
  const root = path.join(__dirname, "..", "..", ".adp");
  if (!fs.existsSync(root)) return t.skip(".adp is not present in this checkout");
  const files = readCorpus(root);
  const opts = {project: "auditable-dev-protocol", generated: "2026-08-24", source: "working-tree"};
  const doc = builder.buildIndex(files, opts);
  assert.deepEqual(indexLib.validateIndex(doc), []);
  assert.equal(indexLib.serializeIndex(doc),
    indexLib.serializeIndex(builder.buildIndex(files.slice().reverse(), opts)));
  const seen = new Set();
  for (const tk of doc.tickets){
    if (tk.id === null) continue;
    assert.equal(seen.has(tk.id), false, "collapsed id collision: " + tk.id);
    seen.add(tk.id);
  }
  let phantoms = 0;
  for (const tk of doc.tickets){
    const ids = new Set(tk.decisions.map(d => d.id));
    for (const toks of Object.values(tk.refs)){
      for (const tok of toks) if (tok.slice(0, 3) === "DL-" && !ids.has(tok)) phantoms++;
    }
  }
  t.diagnostic("phantom DL refs (cross-ticket or quoted ids): " + phantoms);
  // The watchboard's blind spot is an obligation-titled section whose table
  // does not open with Ticket ID, so we surface any such section here.
  const parser = require(path.join(__dirname, "..", "adp-parser-lib.js"));
  const blind = [];
  for (const f of files){
    if (!f.path.endsWith("/audit-log.md")) continue;
    for (const sec of parser.parseSections(f.text).secs){
      if (!/obligation/i.test(sec.title)) continue;
      for (let i = 0; i < sec.body.length; i++){
        if (!parser.isTableStart(sec.body, i)) continue;
        const head = parser.splitRow(sec.body[i]);
        if (!head.some(h => /^ticket id$/i.test(h))) blind.push(f.path + " :: " + sec.title);
        break;
      }
    }
  }
  t.diagnostic("obligation sections with variant table headers: " + blind.length +
    (blind.length ? " (" + blind.join("; ") + ")" : ""));
});
