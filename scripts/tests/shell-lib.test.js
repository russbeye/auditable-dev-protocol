"use strict";

import {test, vi} from "vitest";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../../src/lib/adp-shell-lib.ts");
const B = require("../../src/lib/adp-index-builder-lib.ts");
const I = require("../../src/lib/adp-index-lib.ts");
/* One full ticket and one prompt-only ticket. The full ticket carries every
   inspector surface: a spine with two statuses, a non-canonical section, a
   citing PR Summary, and watches both anchored and unanchored. */
const LOG = [
  "# Audit Log — AA1 alpha",
  "",
  "## Problem Statement",
  "",
  "**What the problem is:** demo.",
  "",
  "## Decision Log",
  "",
  "### [DL-001] First decision",
  "- **Decision:** pick a",
  "- **Confidence:** HIGH",
  "- **Status:** VALIDATED",
  "",
  "### [DL-002] Second decision",
  "- **Decision:** pick b",
  "- **Confidence:** LOW",
  "- **Status:** OPEN — rides",
  "",
  "## Aside Notes",
  "",
  "Some **prose** citing DL-002.",
  "",
  "## PR Summary",
  "",
  "Cites DL-001 and OT-AA1-2.",
  "",
  "## Obligation Ticket List",
  "",
  "| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |",
  "|---|---|---|---|---|---|",
  "| OT-AA1-1 | DL-002 | it holds | HIGH | done → VALIDATED | until 2099-01-01 |",
  "| OT-AA1-2 | DL-001 | other | LOW | done → VALIDATED | 60 days after merge |",
  ""
].join("\n");
const LISTING = {
  root: "demo",
  files: ["20260101-AA1-alpha/audit-log.md", "20260101-AA1-alpha/prompt.yaml", "AV-002-beta/prompt.yaml"]
};
// Both prompts parse cleanly, so the shared fixture exercises the formatted
// view. The failure shapes get corpora of their own.
const PROMPT_AA1 = [
  'schema_version: "1.0"',
  "task:",
  '  id: "20260101-AA1-alpha"',
  '  title: "AA1 alpha"',
  '  author: "rbeye"',
  '  date: "2026-01-01"',
  "prompt: |",
  "  Make the **alpha** path work.",
  "  Keep it small.",
  ""
].join("\n");
const PROMPT_AV2 = PROMPT_AA1.replace('"20260101-AA1-alpha"', '"AV-002-beta"').replace("AA1 alpha", "beta brief");
const TEXTS = {"20260101-AA1-alpha/audit-log.md": LOG,
  "20260101-AA1-alpha/prompt.yaml": PROMPT_AA1, "AV-002-beta/prompt.yaml": PROMPT_AV2};
const NOW = new Date(2026, 7, 25, 12, 0, 0);

// The stub decodes each segment the way the server unquotes its route, so an
// unencoded fetch of a path with reserved characters misses here too.
function corpusFetch(listing, texts){
  return u => {
    if (u === "corpus.json") return Promise.resolve({ok: true, json: async () => listing});
    if (u.startsWith("corpus/")) {
      const p = u.slice("corpus/".length).split("/").map(decodeURIComponent).join("/");
      if (p in texts) return Promise.resolve({ok: true, text: async () => texts[p]});
      return Promise.resolve({ok: false});
    }
    return Promise.resolve({ok: false});
  };
}

// ---- lib: localDate ----

test("localDate composes the local calendar day and satisfies IDX-004", () => {
  assert.equal(S.localDate(new Date(2026, 7, 25, 23, 30)), "2026-08-25");
  assert.equal(S.localDate(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(I.isDate(S.localDate(new Date(2026, 7, 25))), true);
});

// ---- lib: logPaths ----

test("logPaths keeps exactly the paths the builder reads text from", () => {
  const files = ["A-1-x/audit-log.md", "A-1-x/prompt.yaml", "A-1-x/references/audit-log.md",
                 "audit-log.md", "./C-3-z/audit-log.md", "B-2-y/audit-log.md"];
  assert.deepEqual(S.logPaths(files),
    ["A-1-x/audit-log.md", "./C-3-z/audit-log.md", "B-2-y/audit-log.md"]);
  assert.deepEqual(S.logPaths(files), files.filter(p => B.isLogPath(p)));
});

// ---- lib: the seam ----

test("loadCorpus builds the same bytes as a direct Node build and rides the texts along", async () => {
  const got = await S.loadCorpus(corpusFetch(LISTING, TEXTS), {now: NOW});
  const want = B.buildIndex(
    LISTING.files.map(p => (p in TEXTS ? {path: p, text: TEXTS[p]} : {path: p})),
    {project: "demo", generated: "2026-08-25", source: "working-tree"}
  );
  assert.equal(I.serializeIndex(got.index), I.serializeIndex(want));
  assert.deepEqual(I.validateIndex(got.index), []);
  assert.equal(got.index.source, "working-tree");
  assert.deepEqual(got.texts, {"20260101-AA1-alpha": LOG});
});

test("loadCorpus resolves null on every failure shape", async t => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  assert.equal(await S.loadCorpus(() => Promise.reject(new Error("down"))), null);
  assert.equal(await S.loadCorpus(() => Promise.resolve({ok: false})), null);
  assert.equal(await S.loadCorpus(() => Promise.resolve({ok: true, json: async () => ({})})), null);
  // The not-ok probe is the quiet offline mode. The other two shapes warn.
  assert.equal(warn.mock.calls.length, 2);
});

test("loadCorpus is all-or-null when one log is unreadable, and says which", async t => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const got = await S.loadCorpus(corpusFetch(LISTING, {}));
  assert.equal(got, null);
  assert.equal(warn.mock.calls.length, 1);
  assert.match(String(warn.mock.calls[0].join(" ")), /unreadable corpus file/);
});

test("loadCorpus percent-encodes each path segment of a fetch", async () => {
  const listing = {root: "demo", files: ["T-1-a b#c/audit-log.md"]};
  const texts = {"T-1-a b#c/audit-log.md": LOG};
  const urls = [];
  const fetchFn = u => { urls.push(u); return corpusFetch(listing, texts)(u); };
  const got = await S.loadCorpus(fetchFn, {now: NOW});
  assert.ok(urls.includes("corpus/T-1-a%20b%23c/audit-log.md"));
  assert.equal(got.index.tickets.length, 1);
});

// ---- lib: the top bar ----

test("the repo label separates a missing corpus from a nameless project", () => {
  assert.equal(S.repoLabel(null), "");
  assert.equal(S.repoLabel({project: null}), "—");
  assert.equal(S.repoLabel({project: "demo"}), "demo");
});

test("the page title leads with the repo when the index names one", () => {
  assert.equal(S.pageTitle(null), "ADP · Mission Control");
  assert.equal(S.pageTitle({project: null}), "ADP · Mission Control");
  assert.equal(S.pageTitle({project: "demo"}), "demo · ADP · Mission Control");
});

// DL-007: every view token a link has carried lands on its screen's new home.
test("every old view token lands on the new home of its screen", () => {
  const got = Object.fromEntries([null, "inspector", "reviews", "watchboard", "ledgers", "calibration", "resume pack", "new task", "nonsense"]
    .map(v => [String(v), S.screenFromHash(v)]));
  assert.deepEqual(got, {
    "null": {screen: "inspector", packs: false}, "inspector": {screen: "inspector", packs: false},
    "reviews": {screen: "reviews", packs: false}, "watchboard": {screen: "watchboard", packs: false},
    "ledgers": {screen: "ledgers", packs: false}, "calibration": {screen: "ledgers", packs: false},
    "resume pack": {screen: "inspector", packs: true}, "new task": {screen: "new task", packs: false},
    "nonsense": {screen: "inspector", packs: false}});
});

test("the views are Tickets, Watches, and Ledger, and a review round counts as Tickets", () => {
  assert.deepEqual(S.VIEWS.map(v => v.label), ["Tickets", "Watches", "Ledger"]);
  assert.equal(S.viewOf("reviews"), "inspector");
  assert.equal(S.viewOf("new task"), null);
});

test("a stored theme reads as its choice, anything else as System, and System follows the preference", () => {
  assert.deepEqual(["dark", "light", null, "sepia"].map(S.themeChoice), ["dark", "light", "system", "system"]);
  assert.equal(S.themeFor("system", true), "light");
  assert.equal(S.themeFor("system", false), "dark");
  assert.equal(S.themeFor("dark", true), "dark");
});

// ---- lib: the hash grammar ----

test("hashRead and hashWrite round-trip the v/t/s/item selection", () => {
  const sel = {v: null, t: "AA1", s: "sec-decision-log", item: "DL-002"};
  // The inspector writes no view token, so its hashes stay byte-identical
  // with every link minted before the token existed.
  assert.equal(S.hashWrite(sel), "#t=AA1&s=sec-decision-log&item=DL-002");
  assert.deepEqual(S.hashRead(S.hashWrite(sel)), sel);
  assert.deepEqual(S.hashRead("#t=AA1"), {v: null, t: "AA1", s: null, item: null});
  assert.deepEqual(S.hashRead(""), {v: null, t: null, s: null, item: null});
  assert.equal(S.hashWrite({t: null}), "");
  const board = {v: "watchboard", t: "AA1", s: null, item: null};
  assert.equal(S.hashWrite(board), "#v=watchboard&t=AA1");
  assert.deepEqual(S.hashRead(S.hashWrite(board)), board);
  assert.equal(S.hashWrite({v: "new task", t: null, s: null, item: null}), "#v=new%20task");
  // Reserved characters survive the trip encoded.
  const odd = {v: null, t: "a&b", s: "sec-x=y", item: null};
  assert.deepEqual(S.hashRead(S.hashWrite(odd)), odd);
});

// ---- lib: builders escape what they interpolate ----

test("rail and panel builders escape hostile harvested fields", () => {
  const hostile = `<img src=x onerror=alert(1)>`;
  const rail = S.railHtml([["needs attention", [{key: hostile, id: hostile, date: hostile,
    slug: hostile, closable: true, ribbon: {reasons: [{txt: hostile, tone: "warn"}], more: 0}}]]],
    null, new Set());
  assert.ok(!rail.includes("<img"));
  const panel = S.decisionsPanelHtml({label: hostile, pills: "", sort: {k: "id", d: 1},
    rows: [{id: hostile, title: hostile, conf: hostile, confKind: "other",
      statusKind: "open", watch: hostile, chips: [{key: hostile, label: hostile, title: hostile}], hl: false}]});
  assert.ok(!panel.includes("<img"));
  const nav = S.secNavHtml([{key: "k", title: hostile, phase: null, canonical: false, missing: false}],
    {k: {label: "non-canonical", tone: "warn"}}, "k");
  assert.ok(!nav.includes("<img"));
});

test("a settled decision's watch cell keeps the id and puts the ruling on hover", () => {
  const S = require("../../src/lib/adp-shell-lib.ts");
  const assert = require("node:assert/strict");
  const panel = S.decisionsPanelHtml({label: "x", pills: "", sort: {k: "id", d: 1},
    rows: [{id: "DL-001", title: "t", conf: "HIGH", confKind: "high", statusKind: "validated",
      watch: null, settled: {wid: "OT-1", outcome: "VALIDATED", closed: "2026-09-01"},
      chips: [], hl: false}]});
  assert.ok(panel.includes(`title="closed VALIDATED 2026-09-01">OT-1</a>`));
  // The ruled state lives in the status column; the cell never repeats it.
  assert.ok(!panel.includes(`st-closed`));
});

test("an open decision with only a settled watch leads with the marker", () => {
  const S = require("../../src/lib/adp-shell-lib.ts");
  const assert = require("node:assert/strict");
  const panel = S.decisionsPanelHtml({label: "x", pills: "", sort: {k: "id", d: 1},
    rows: [{id: "DL-001", title: "t", conf: "HIGH", confKind: "high", statusKind: "open",
      watch: null, settled: {wid: "OT-1", outcome: "VALIDATED", closed: "2026-09-01"},
      chips: [], hl: false}]});
  assert.ok(panel.includes(`<span class="st-unanchored nw">no watch</span> <a class="wl"`));
  assert.ok(panel.includes(`title="closed VALIDATED 2026-09-01"`));
});

test("watchboardHtml escapes hostile fields and passes the empty text through", () => {
  const hostile = `<img src=x onerror=alert(1)>`;
  const html = S.watchboardHtml({sort: {k: "due", d: 1}, live: 1, settled: 2, pills: "",
    rows: [{tid: hostile, wid: hostile, what: hostile, dueText: hostile,
      state: "upcoming", stateLabel: hostile, outcomeText: hostile, outcomeKind: "validated"}]});
  assert.ok(!html.includes("<img"));
  const empty = S.watchboardHtml({sort: {k: "due", d: 1}, live: 0, settled: 3, pills: "",
    rows: [], empty: hostile});
  assert.ok(!empty.includes("<img"));
  // The chips carry their counts, and only states that exist get one.
  const pills = S.statusPillsHtml({overdue: 2, soon: 0, upcoming: 1, unanchored: 0, closed: 3},
    new Set(["overdue"]));
  assert.match(pills, /is-on" data-ws="overdue">overdue 2/);
  assert.match(pills, /data-ws="closed">closed 3/);
  assert.ok(!pills.includes("soon"));
});

test("the ledger builder escapes hostile harvested fields", () => {
  const hostile = `<img src=x onerror=alert(1)>`;
  const a = S.assumptionLedgerHtml({sort: {k: "status", d: 1}, pills: "", empty: "",
    rows: [{tid: hostile, id: hostile, title: hostile, conf: hostile, confKind: "high",
      statusKind: "open", watch: hostile, settled: null, ageText: hostile}]});
  assert.ok(!a.includes("<img"));
  // The pill builder stamps the mark it was asked for.
  assert.match(S.pillsHtml({all: 1, open: 1}, "all", "data-lgf"), /data-lgf="open"/);
});

// ---- lib: packs ----

// The pack tests serve the shipped packs from disk through the fetch stub, so
// the loader reads the real files.
const PACKS_ROOT = path.join(__dirname, "..", "..", "packs");
const PACK_FILES = fs.readdirSync(PACKS_ROOT).filter(f => f.endsWith(".pack.md")).sort();
const packText = f => fs.readFileSync(path.join(PACKS_ROOT, f), "utf8");
function packsFetch(inner, listing){
  return u => {
    if (u === "packs.json") return Promise.resolve({ok: true, json: async () => listing || {packs: PACK_FILES}});
    if (u.startsWith("packs/")){
      const f = decodeURIComponent(u.slice("packs/".length));
      if (PACK_FILES.includes(f)) return Promise.resolve({ok: true, text: async () => packText(f)});
      return Promise.resolve({ok: false});
    }
    return inner(u);
  };
}

test("loadPacks returns every listed pack in listing order, with its name, file, and text", async () => {
  const got = await S.loadPacks(packsFetch(() => Promise.resolve({ok: false})));
  assert.deepEqual(got.map(p => [p.name, p.file]), PACK_FILES.map(f => [f.replace(/\.pack\.md$/, ""), "packs/" + f]));
  assert.equal(got[0].text, packText(PACK_FILES[0]));
});

test("loadPacks resolves null on every failure shape, all-or-null", async t => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  // A probe that never answers and a not-ok probe are both the quiet
  // no-packs mode; the corpus seam already traces a dead server.
  assert.equal(await S.loadPacks(() => Promise.reject(new Error("down"))), null);
  assert.equal(await S.loadPacks(() => Promise.resolve({ok: false})), null);
  assert.equal(warn.mock.calls.length, 0);
  assert.equal(await S.loadPacks(() => Promise.resolve({ok: true, json: async () => ({})})), null);
  // One listed pack the server cannot serve fails the whole load.
  assert.equal(await S.loadPacks(packsFetch(() => Promise.resolve({ok: false}),
    {packs: PACK_FILES.concat("ghost.pack.md")})), null);
  assert.equal(warn.mock.calls.length, 2);
  assert.match(String(warn.mock.calls[1].join(" ")), /unreadable pack: ghost/);
});

// ---- lib: new task ----

const PL = require("../../src/lib/adp-prompt-lib.ts");

test("the directory line collapses only the id's leading letters-digits pair, so the index reads the name back", () => {
  const B = require("../../src/lib/adp-index-builder-lib.ts");
  const line = S.promptDir({task: {id: "GROW-6687-email-validation", date: "2026-06-18"}}, "add-server-side-validation");
  assert.equal(line, ".adp/20260618-GROW6687-email-validation-add-server-side-validation/prompt.yaml");
  assert.deepEqual(B.parseDirName(line.split("/")[1]),
    {id: "GROW6687", date: "2026-06-18", slug: "email-validation-add-server-side-validation"});
  assert.equal(S.promptDir({task: {id: "AV-016", date: "2026-09-22"}}, "s"), ".adp/20260922-AV016-s/prompt.yaml");
  assert.equal(S.promptDir({task: {id: "", date: ""}}, ""), ".adp/<yyyymmdd>-<TASKID>-<slug>/prompt.yaml");
});

test("placeable drops a block of the wrong shape, names it, and leaves its input as it was", () => {
  const raw = {task: "x", prompt: {a: 1}, preamble: null, role: {priorities: ["a", 5, true, null]},
    protocol: {apply: true, defers: "later"}};
  const before = JSON.stringify(raw);
  const {doc, issues} = S.placeable(raw);
  assert.deepEqual(issues, ["prompt is not text; skipped", "task is not a map; skipped",
    "role.priorities[3] is not a plain value; skipped", "protocol.defers is not a list; skipped"]);
  // A list item reads as the text an input would show, the way setLine does.
  assert.deepEqual(doc, {preamble: null, role: {priorities: ["a", "5", "true"]}, protocol: {apply: true}});
  assert.equal(JSON.stringify(raw), before);
  // A null key is nothing to place and nothing to drop, and an absent
  // document places nothing.
  assert.deepEqual(S.placeable({task: null, lessons_learned: null}).issues, []);
  assert.deepEqual(S.placeable(null), {doc: {}, issues: []});
  assert.deepEqual(S.unknownValues(PL.exampleDocument()), []);
});

test("placeable copies a list item before it drops a field, and an empty field takes the blank the input shows", () => {
  const raw = {context: {references: [{path: {deep: 1}, lines: "1-2"}]}, requirements: [{id: ["a"]}]};
  const before = JSON.stringify(raw);
  const {doc, issues} = S.placeable(raw);
  assert.deepEqual(issues, ["context.references[0].path is not a plain value; skipped",
    "requirements[0].id is not a plain value; skipped"]);
  assert.deepEqual(doc.context.references, [{lines: "1-2"}]);
  assert.deepEqual(doc.requirements, [{}]);
  assert.equal(JSON.stringify(raw), before);
  // The export writes every field of a row it keeps, so an empty one is the
  // blank string, not a null that reads back as the text null.
  assert.deepEqual(S.placeable({requirements: [{id: null}]}), {doc: {requirements: [{id: ""}]}, issues: []});
  // A stranger key on the row rides along unnamed, the way both builders
  // leave it, and the export drops it.
  assert.deepEqual(S.placeable({requirements: [{id: "R1", bogus: "x"}]}),
    {doc: {requirements: [{id: "R1", bogus: "x"}]}, issues: []});
});

// ---- the prompt view ----

// Every key the builder writes, in a scrambled order, plus one top-level key
// the builder does not know.
const FULL_PROMPT = [
  "protocol:",
  "  apply: true",
  "  artifacts:",
  "    - problem_statement",
  "    - pr_summary",
  'schema_version: "1.0"',
  "task:",
  '  id: "T-9-full"',
  '  title: "Full prompt"',
  '  author: "rbeye"',
  '  date: "2026-10-18"',
  "preamble: |",
  "  Hold the old decisions.",
  "  Do not reopen them.",
  "role:",
  '  lens: "Front-end engineer"',
  "  priorities:",
  '    - "Keep `hashWrite` stable"',
  "prompt: |",
  "  Add the **view**.",
  "  Keep it read-only.",
  "constraints:",
  "  out_of_scope:",
  '    - "Editing"',
  "  must_not:",
  '    - "Change the index"',
  "context:",
  "  background: |",
  "    The developer reads prompts in a terminal.",
  "    See [the docs](https://example.com/docs).",
  "  references:",
  '    - path: "scripts/adp-serve.py"',
  '      lines: "84-114"',
  '      note: "serves the corpus"',
  "  links:",
  '    - "https://example.com/ticket"',
  "lessons_learned:",
  '  - context: "loads are all-or-null"',
  '    takeaway: "display data fails alone"',
  "output:",
  '  format: "code"',
  '  destination: "Edit in place"',
  "requirements:",
  '  - id: "R1"',
  '    statement: "The view shows"',
  '    verify: "A test asserts it"',
  "reviewer_notes: |",
  "  A key the builder never writes.",
  "  It still shows.",
  ""
].join("\n");

test("promptPaths keeps a ticket's own prompt.yaml and nothing deeper", () => {
  const files = ["A-1-x/prompt.yaml", "A-1-x/audit-log.md", "A-1-x/refs/prompt.yaml",
                 "prompt.yaml", "./C-3-z/prompt.yaml", "B-2-y/prompt.yml"];
  assert.deepEqual(S.promptPaths(files), ["A-1-x/prompt.yaml", "./C-3-z/prompt.yaml"]);
});

test("loadCorpus rides the prompts along without touching the index", async () => {
  const got = await S.loadCorpus(corpusFetch(LISTING, TEXTS), {now: NOW});
  assert.deepEqual(got.prompts, {"20260101-AA1-alpha": {text: PROMPT_AA1}, "AV-002-beta": {text: PROMPT_AV2}});
  const bare = await S.loadCorpus(corpusFetch(LISTING, {"20260101-AA1-alpha/audit-log.md": LOG}), {now: NOW});
  assert.equal(I.serializeIndex(got.index), I.serializeIndex(bare.index));
});

// R4 at the seam: a failed prompt fetch and a thrown one each cost only their
// own ticket, and the load still resolves.
test("loadCorpus keeps loading when a prompt fetch fails or throws", async t => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const base = corpusFetch(LISTING, {"20260101-AA1-alpha/audit-log.md": LOG});
  const fetchFn = u => u === "corpus/AV-002-beta/prompt.yaml" ? Promise.reject(new Error("reset")) : base(u);
  const got = await S.loadCorpus(fetchFn, {now: NOW});
  assert.ok(got);
  assert.equal(got.index.tickets.length, 2);
  assert.deepEqual(got.prompts, {"20260101-AA1-alpha": {error: "unreadable"}, "AV-002-beta": {error: "unreadable"}});
  assert.equal(warn.mock.calls.length, 0);
});

// R2: every builder field shows under its key, in the builder's order, and
// the unknown key follows them.
test("the prompt view renders every top-level key, the unknown one included", () => {
  const issues = [];
  const obj = PL.parseYAML(FULL_PROMPT, issues);
  assert.deepEqual(issues, []);
  const html = S.promptViewHtml(obj);
  const heads = [...html.matchAll(/<span class="pcard-title">([^<]+)<\/span>/g)].map(m => m[1]);
  assert.deepEqual(heads, ["Schema Version", "Task", "Preamble", "Role", "Prompt", "Constraints",
    "Context", "Lessons Learned", "Output", "Requirements", "Protocol", "Reviewer Notes"]);
  // Each card names its raw key, so a reader can find the field in the file.
  assert.match(html, /<span class="pcard-key">lessons_learned<\/span>/);
  // A one-line top-level value sits in its card's head.
  assert.match(html, /<span class="pcard-title">Schema Version<\/span><span class="pcard-val">1\.0<\/span>/);
  // A map's fields read as label and value rows, and flat records as a table.
  assert.match(html, /<div class="pcard-k">title<\/div><div class="pcard-v">Full prompt<\/div>/);
  assert.match(html, /<th>path<\/th><th>lines<\/th><th>note<\/th>/);
  assert.match(html, /<th>id<\/th><th>statement<\/th><th>verify<\/th>/);
  // Block text renders as markdown. One-line text stays exact, backticks and all.
  assert.match(html, /Add the <strong>view<\/strong>/);
  assert.match(html, /Keep `hashWrite` stable/);
  assert.match(html, /<a href="https:\/\/example\.com\/docs"[^>]*>the docs<\/a>/);
  assert.match(html, /<a href="https:\/\/example\.com\/ticket"[^>]*>https:\/\/example\.com\/ticket<\/a>/);
  for (const v of ["T-9-full", "Front-end engineer", "Editing", "Change the index", "scripts/adp-serve.py",
                   "84-114", "display data fails alone", "Edit in place", "The view shows", "A test asserts it",
                   "problem_statement", "true", "A key the builder never writes."])
    assert.ok(html.includes(v), v);
});

// A table cell is a value like any other, so block text in a record still
// reads as markdown while a one-line cell stays exact.
test("block text inside a table cell renders as markdown", () => {
  const html = S.promptViewHtml(PL.parseYAML([
    "requirements:",
    "  - id: \"R1\"",
    "    statement: \"Keep **this** exact\"",
    "    verify: |",
    "      First paragraph with **bold**.",
    "",
    "      Second paragraph.",
  ].join("\n") + "\n"));
  const cell = html.match(/<td>((?:(?!<\/td>)[\s\S])*Second paragraph[\s\S]*?)<\/td>/)[1];
  assert.match(cell, /<p>First paragraph with <strong>bold<\/strong>\.<\/p>/);
  assert.match(cell, /<p>Second paragraph\.<\/p>/);
  assert.match(html, /<td>Keep \*\*this\*\* exact<\/td>/);
});

// R3: every tag the view emits is one we built. Escaped author markup shows as
// text, and no event attribute or off-list href survives.
test("prompt text renders inert", () => {
  const hostile = [
    "prompt: |",
    "  <script>alert(1)</script>",
    '  <img src=x onerror="alert(2)">',
    "  [click](javascript:alert(3))",
    "context:",
    "  background: |",
    "    [go](javascript:alert(4)) and <b onmouseover=x>hi</b>",
    "    [rel](data:text/html,x)",
    "  links:",
    '    - "javascript:alert(5)"',
    '    - "JaVaScRiPt:alert(6)"',
    '    - "relative/path"',
    '    - "mailto:a@b.c"',
    'task:',
    '  title: "<svg onload=alert(7)>"',
    '  id: "[go](https://example.com/x)"',
    ""
  ].join("\n");
  const html = S.promptViewHtml(PL.parseYAML(hostile));
  const tags = [...html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/g)];
  assert.ok(tags.length);
  for (const [, name, attrs] of tags){
    assert.ok(!["script", "img", "svg", "iframe", "object"].includes(name), name);
    assert.doesNotMatch(attrs, /\son[a-z]+\s*=/i);
    const href = attrs.match(/href="([^"]*)"/);
    if (href) assert.match(href[1], /^(https?|mailto):/i);
  }
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<a href="mailto:a@b\.c"/);
  assert.match(html, /<li>relative\/path<\/li>/);
  assert.match(html, /<li>javascript:alert\(5\)<\/li>/);
  // A one-line value that quotes markdown keeps its literal text.
  assert.match(html, /<div class="pcard-v">\[go\]\(https:\/\/example\.com\/x\)<\/div>/);
});
// ---- lib: reviews ----

/* Two tickets with prreview rounds and one without. RV1 holds two PRs, and
   PR #7's rounds are r1, r2, and r10, so a string sort would misorder them.
   RV2 holds one PR: a round whose text tries to run script, a round with no
   verdict yet, and a round whose fetch fails. AV-002 holds no rounds. */
const review = o => [
  `# PR Review — PR #${o.pr} round ${o.k} · ${o.dir}`, "",
  "## Review Target", `- **Round:** ${o.k}`, "",
  "## Inspected", "| Item | Value |", "|------|-------|", `| Prior review files | ${o.prior || "—"} |`, "",
  "## Findings", "", o.findings || `Round ${o.k} of PR #${o.pr} found nothing.`, "",
  ...(o.noVerdict ? [] : ["## Review Verdict", `- **Verdict:** ${o.verdict || "APPROVE"}`,
    "- **Confidence:** HIGH", "- **Counts:** must 0 / should 1 / question 0 / nit 0",
    "- **Opened:** PR-ADP-001", "- **Closed:** —", "- **Carried open:** —", "- **Summary:** done."]), ""
].join("\n");
const RV1 = "20260101-RV1-rounds", RV2 = "20260101-RV2-other";
const LOG_RV1 = ["# Audit Log — RV1 rounds", "", "## Problem Statement", "", "**What the problem is:** demo.", "",
  "## Review findings — PR #5, in-review (2026-01-02, first)", "", "An older pointer that names no file.", "",
  "## Review findings — PR #7 round 2 (2026-01-03)", "",
  `- **Review file:** \`.adp/${RV1}/pr-review-PR7-20260103-r2.md\``, ""].join("\n");
const LOG_RV2 = LOG_RV1.replace(/RV1/g, "RV2").split("\n## Review findings")[0];
const XSS = "<script>alert(1)</script> <img src=x onerror=alert(1)> [bad](javascript:alert(1))";
function reviewCorpus(){
  const st = {texts: {
    [`${RV1}/audit-log.md`]: LOG_RV1,
    [`${RV1}/pr-review-PR7-20260102-r1.md`]: review({pr: 7, k: 1, dir: RV1}),
    [`${RV1}/pr-review-PR7-20260103-r2.md`]: review({pr: 7, k: 2, dir: RV1, prior: "pr-review-PR7-20260102-r1.md"}),
    [`${RV1}/pr-review-PR8-20260104-r3.md`]: review({pr: 8, k: 3, dir: RV1}),
    [`${RV1}/pr-review-PR7-20260105-r10.md`]: review({pr: 7, k: 10, dir: RV1}),
    [`${RV1}/notes.md`]: "not a round",
    [`${RV1}/refs/pr-review-PR7-20260105-r11.md`]: "a deeper file",
    [`${RV2}/audit-log.md`]: LOG_RV2,
    [`${RV2}/pr-review-PR9-20260106-r1.md`]: review({pr: 9, k: 1, dir: RV2, verdict: "APPROVE <b onmouseover=x>",
      findings: XSS, prior: `\`.adp/${RV1}/pr-review-PR7-20260103-r2.md\`, \`.adp/NOPE-gone/pr-review-PR9-20260101-r1.md\``}),
    [`${RV2}/pr-review-PR9-20260107-r2.md`]: review({pr: 9, k: 2, dir: RV2, noVerdict: true}),
    "AV-002-beta/prompt.yaml": PROMPT_AV2
  }};
  // RV2's third round is listed but never answers.
  st.listing = {root: "demo", files: Object.keys(st.texts).concat([`${RV2}/pr-review-PR9-20260108-r3.md`]).sort()};
  st.fetch = u => corpusFetch(st.listing, st.texts)(u);
  return st;
}

test("reviewPaths keeps both review name forms in a ticket directory and nothing else", () => {
  const files = ["A-1-x/pr-review-PR12-20261014-r3.md", "A-1-x/pr-review-local-20261014-r4.md",
    "A-1-x/notes.md", "A-1-x/pr-review-notes.md", "A-1-x/pr-review-PR12-20261014-r3.md.bak",
    "A-1-x/refs/pr-review-PR12-20261014-r5.md", "pr-review-PR12-20261014-r1.md", "./B-2-y/pr-review-PR1-20260101-r1.md"];
  assert.deepEqual(S.reviewPaths(files),
    ["A-1-x/pr-review-PR12-20261014-r3.md", "A-1-x/pr-review-local-20261014-r4.md", "./B-2-y/pr-review-PR1-20260101-r1.md"]);
});

test("reviewRounds groups rounds by PR and orders each group by the number k", () => {
  const g = S.reviewRounds(["pr-review-PR7-20260105-r10.md", "pr-review-PR8-20260104-r3.md",
    "pr-review-local-20260109-r12.md", "pr-review-PR7-20260103-r2.md", "pr-review-PR7-20260102-r1.md"]
    .map(file => ({file, text: ""})));
  assert.deepEqual(g.map(x => [x.label, x.rounds.map(r => r.k)]),
    [["PR #7", [1, 2, 10]], ["PR #8", [3]], ["local", [12]]]);
  assert.equal(g[0].rounds[2].date, "2026-01-05");
});

test("reviewHead reads the verdict fields, and names a missing section or field", () => {
  const h = S.reviewHead(review({pr: 7, k: 1, dir: RV1}));
  assert.deepEqual(h, {fields: {verdict: "APPROVE", confidence: "HIGH", counts: "must 0 / should 1 / question 0 / nit 0",
    opened: "PR-ADP-001", closed: "—", carried: "—"}, missing: []});
  assert.equal(S.reviewHead(review({pr: 7, k: 1, dir: RV1, noVerdict: true})).fields, null);
  const gap = S.reviewHead(review({pr: 7, k: 1, dir: RV1}).replace("- **Confidence:** HIGH\n", ""));
  assert.deepEqual(gap.missing, ["Confidence"]);
});

test("priorReviews resolves bare names to the same ticket and paths to theirs", () => {
  const text = "| Prior review files | pr-review-PR41-20261013-r1.md, `.adp/OTHER-x/pr-review-PR41-20261014-r3.md`, notes.md |";
  assert.deepEqual(S.priorReviews(text, "HERE-y"), [
    {dir: "HERE-y", file: "pr-review-PR41-20261013-r1.md"},
    {dir: "OTHER-x", file: "pr-review-PR41-20261014-r3.md"}]);
  assert.deepEqual(S.priorReviews("| Prior review files | — |", "HERE-y"), []);
  assert.deepEqual(S.priorReviews("no table", "HERE-y"), []);
});

test("reviewFileRef reads a pointer's Review file field and ignores everything else", () => {
  assert.deepEqual(S.reviewFileRef(`- **Review file:** \`.adp/${RV1}/pr-review-PR7-20260103-r2.md\``),
    {dir: RV1, file: "pr-review-PR7-20260103-r2.md"});
  assert.equal(S.reviewFileRef("An older pointer that names no file."), null);
  assert.equal(S.reviewFileRef("- **Review file:** `.adp/x/notes.md`"), null);
});

test("loadCorpus loads review rounds beside the index, and one failed round costs only itself", async () => {
  const c = reviewCorpus();
  const got = await S.loadCorpus(c.fetch, {now: NOW});
  assert.deepEqual(got.reviews[RV1].map(r => r.file), ["pr-review-PR7-20260102-r1.md",
    "pr-review-PR7-20260103-r2.md", "pr-review-PR7-20260105-r10.md", "pr-review-PR8-20260104-r3.md"]);
  assert.deepEqual(got.reviews[RV2].map(r => r.error || "ok"), ["ok", "ok", "unreadable"]);
  // The index never sees a review text: it builds the same bytes as a build
  // from the logs alone.
  const want = B.buildIndex(c.listing.files.map(p => (B.isLogPath(p) ? {path: p, text: c.texts[p]} : {path: p})),
    {project: "demo", generated: "2026-08-25", source: "working-tree"});
  assert.equal(I.serializeIndex(got.index), I.serializeIndex(want));
  assert.equal(got.files.filter(f => /pr-review-/.test(f.path) && "text" in f).length, 0);
});

test("loadCorpus fills the review map in listing order, whatever order the fetches finish in", async () => {
  const c = reviewCorpus();
  const order = [];
  const slow = rev => u => {
    if (!/pr-review-/.test(u)) return c.fetch(u);
    const i = c.listing.files.findIndex(p => u.endsWith(p.split("/").pop()));
    const late = rev ? 40 - i : i;
    return new Promise(r => setTimeout(r, late)).then(() => { order.push(i); return c.fetch(u); });
  };
  const a = await S.loadCorpus(slow(false), {now: NOW});
  const fwd = order.splice(0);
  const b = await S.loadCorpus(slow(true), {now: NOW});
  assert.notDeepEqual(order, fwd);
  assert.equal(JSON.stringify(a.reviews), JSON.stringify(b.reviews));
});

test("the reviews tab sits right after the inspector tab", () => {
  assert.deepEqual(S.TAB_SCREENS, ["inspector", "reviews", "watchboard", "ledgers", "calibration", "resume pack"]);
  assert.equal(S.SCREENS[S.SCREENS.length - 1], "new task");
});

const card = (id, o = {}) => [`### [${id}] ${o.title || "A finding title"}`,
  `- **Severity:** ${o.severity || "should"}`, "- **Category:** COR — Correctness",
  `- **Claim:** ${o.claim || "The code does the wrong thing."}`, "- **Confidence:** HIGH",
  "- **Confidence basis:** DIRECT EVIDENCE — a repro.", `- **Status:** ${o.status || "OPEN"}`].join("\n");
const ledger = (id, outcome, note) => `- **${id} CLOSED 2026-01-03 → ${outcome}.** ${note}`;
const withLedger = (text, lines) => text.replace("## Review Verdict", "## Prior Findings\n" + lines.join("\n") + "\n\n## Review Verdict");

test("reviewLedger reads every closure in a PR group, and a later round's line wins", () => {
  const r2 = withLedger(review({pr: 7, k: 2, dir: RV1}), [ledger("PR-COR-001", "ACCEPTED", "first."), ledger("PR-COR-002", "REFUTED", "no defect.")]);
  const r3 = withLedger(review({pr: 7, k: 3, dir: RV1}), [ledger("PR-COR-001", "RESOLVED", "fixed.")]);
  const l = S.reviewLedger([{file: "a-r1.md", k: 1, text: review({pr: 7, k: 1, dir: RV1})},
    {file: "a-r2.md", k: 2, text: r2}, {file: "a-r3.md", k: 3, text: r3}, {file: "a-r4.md", k: 4, error: "unreadable"}]);
  assert.deepEqual(Object.keys(l).sort(), ["PR-COR-001", "PR-COR-002"]);
  assert.deepEqual(l["PR-COR-001"], {file: "a-r3.md", k: 3, id: "PR-COR-001", date: "2026-01-03", outcome: "RESOLVED", note: "fixed."});
  assert.equal(l["PR-COR-002"].outcome, "REFUTED");
});

test("a finding renders as a card, and its status pill reads the ledger, not the stale card", () => {
  const text = review({pr: 7, k: 1, dir: RV1, findings: card("PR-COR-001") + "\n\n" + card("PR-TST-002", {severity: "nit"})});
  const led = {"PR-COR-001": {id: "PR-COR-001", file: "pr-review-PR7-20260103-r2.md", k: 2, date: "2026-01-03", outcome: "RESOLVED", note: "fixed **now**."}};
  const html = S.reviewBodyHtml(text, {ledger: led, tok: "RV1"});
  const cards = html.split('<div class="dl-cards">')[1].split("Review Verdict")[0].split('<div class="dl-card ').slice(1);
  assert.equal(cards.length, 2);
  assert.match(cards[0], /^rail-ok"/);
  assert.match(cards[0], /<i>severity<\/i>should/);
  assert.match(cards[0], /<i>conf<\/i>HIGH/);
  assert.match(cards[0], /<i>status<\/i>RESOLVED/);
  assert.doesNotMatch(cards[0], /<i>status<\/i>OPEN/);
  assert.match(cards[0], /2026-01-03 in <a class="rvl"[^>]*data-rf="pr-review-PR7-20260103-r2\.md">round 2<\/a> · fixed <strong>now<\/strong>\./);
  assert.match(cards[0], /<span class="dl-k revk">Confidence basis<\/span>/);
  assert.doesNotMatch(cards[0], /dl-k revk">(Severity|Confidence|Status)</);
  assert.match(cards[1], /^rail-open"/);
  assert.match(cards[1], /<i>severity<\/i>nit/);
  assert.match(cards[1], /<i>status<\/i>OPEN/);
  assert.match(html, /<h4>Findings<\/h4><div class="md"><div class="dl-cards">/);
});

test("Review Target, Review Verdict, and Prior Findings render as grids, and a stray line keeps markdown", () => {
  const text = withLedger(review({pr: 7, k: 2, dir: RV1}), [ledger("PR-COR-001", "RESOLVED", "fixed.")]);
  const html = S.reviewBodyHtml(text, {ledger: {}, tok: "RV1"});
  assert.equal(html.split("dl-card revcard").length - 1, 3);
  assert.match(html, /<span class="dl-k revk">Round<\/span><span class="dl-v revv">2<\/span>/);
  assert.match(html, /<span class="dl-k revk">PR-COR-001<\/span><span class="dl-v revv"><span class="pill dl-pill p-ok"><i>closed<\/i>RESOLVED<\/span> 2026-01-03 · fixed\.<\/span>/);
  // The Inspected table and an empty Findings section stay as the file reads.
  assert.match(html, /<table/);
  assert.match(html, /Round 2 of PR #7 found nothing\./);
  // Each section is its own doc panel under an h4, as in the inspector, and
  // the file's H1 gives way to the round head.
  assert.deepEqual([...html.matchAll(/<div class="doc"><h4>([^<]*)<\/h4>/g)].map(x => x[1]),
    ["Review Target", "Inspected", "Findings", "Prior Findings", "Review Verdict"]);
  assert.doesNotMatch(html, /PR Review — PR #7/);
  // Every panel body sits in the md block, so the theme's code, link, and
  // emphasis styles reach the grids and cards as they reach prose.
  assert.equal(html.split('<div class="doc"><h4>').length - 1, html.split('</h4><div class="md">').length - 1);
  const stray = S.reviewBodyHtml(text.replace("## Prior Findings\n", "## Prior Findings\nA note that is not a ledger line.\n"), {ledger: {}});
  assert.equal(stray.split("dl-card revcard").length - 1, 2);
  assert.match(stray, /A note that is not a ledger line\./);
  assert.match(stray, /PR-COR-001 CLOSED 2026-01-03/);
});

test("a finding card renders its text inert, and an unknown outcome word picks no class", () => {
  const text = review({pr: 9, k: 1, dir: RV2, findings: card("PR-SEC-001", {title: XSS, claim: XSS, severity: "<b>x</b> later"})});
  const html = S.reviewBodyHtml(text, {ledger: {"PR-SEC-001": {id: "PR-SEC-001", file: "f.md", k: 2, date: "2026-01-03",
    outcome: "WEIRD", note: XSS}}, tok: "RV2"});
  assert.doesNotMatch(html, /<script|<img|<b>|href="javascript:/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<span class="pill dl-pill p-low"><i>status<\/i>WEIRD<\/span>/);
  assert.match(html, /<div class="dl-card ">/);
  assert.match(html, /dl-k revk">severity note</);
});
/* AA1's log defines DL-001, DL-002, OT-AA1-1, and OT-AA1-2. Its round cites
   DL-002 and OT-AA1-1 in prose, DL-001 only inside a code fence, and DL-099,
   which the log never defines. */
const AA1 = "20260101-AA1-alpha";
const AA1_ROUND = review({pr: 3, k: 1, dir: AA1, findings: card("PR-COR-001")
  + "\n- **Refs:** DL-002, OT-AA1-1, DL-099\n\n```\nDL-001\n```"});

test("reviewItems keeps the ticket's own ids that a round cites outside code fences", () => {
  const t = {decisions: [{id: "DL-001"}, {id: "DL-002"}], watches: [{wid: "OT-AA1-1"}, {wid: "OT-AA1-2"}]};
  const items = S.reviewItems(t, AA1_ROUND);
  assert.deepEqual(items.decisions.map(d => d.id), ["DL-002"]);
  assert.deepEqual(items.watches.map(w => w.wid), ["OT-AA1-1"]);
  assert.deepEqual(S.reviewItems(t, review({pr: 3, k: 2, dir: AA1})), {decisions: [], watches: []});
});

test("a severity word that names an Object member takes the fallback class", () => {
  const text = review({pr: 9, k: 1, dir: RV2, findings: card("PR-COR-001", {severity: "constructor"})});
  const html = S.reviewBodyHtml(text, {ledger: {}, tok: "RV2"});
  assert.match(html, /<span class="pill dl-pill p-low"><i>severity<\/i>constructor<\/span>/);
  assert.doesNotMatch(html, /function/);
});

// ---- tickets that share an id ----

test("this repository's corpus keeps every ticket token it had", t => {
  const root = path.join(__dirname, "..", "..", ".adp");
  if (!fs.existsSync(root)) return t.skip(".adp is not present in this checkout");
  const D = require("../../src/lib/adp-derive-lib.ts");
  const files = [];
  for (const dir of fs.readdirSync(root)){
    const p = path.join(root, dir, "audit-log.md");
    if (fs.existsSync(p)) files.push({path: dir + "/audit-log.md", text: fs.readFileSync(p, "utf8")});
  }
  const index = B.buildIndex(files, {});
  const tokenOf = D.ticketTokens(index.tickets);
  for (const t of index.tickets) assert.equal(tokenOf(t), t.id || t.dir, t.dir);
});

// ---- table wrap rule ----

test("a due cell holds a date on one line and lets window prose wrap", () => {
  const prose = "until the developer's next live session with the testbed, no later than the start of ZUP-B3";
  const row = o => Object.assign({wid: "OT-A1-1", what: "w", dls: [], state: "upcoming", stateLabel: "upcoming 30d", chips: []}, o);
  const panel = S.watchesPanelHtml({label: "x", sort: {k: "wid", d: 1},
    rows: [row({dueText: "2026-12-24", dueDated: true}), row({dueText: prose, dueDated: false})]});
  assert.ok(panel.includes('<td class="mono nw">2026-12-24</td>'));
  assert.ok(panel.includes('<td class="mono">until the developer'));
  assert.ok(panel.includes('<td class="mono nw">OT-A1-1</td>'));
  assert.ok(panel.includes('<span class="st-upcoming nw">upcoming 30d</span>'));
  const board = S.watchboardHtml({sort: {k: "due", d: 1}, live: 2, settled: 0, pills: "",
    rows: [Object.assign(row({dueText: prose, dueDated: false}), {tid: "A1"}),
      Object.assign(row({dueText: "2026-12-24", dueDated: true}), {tid: "A1", outcomeText: "VALIDATED 2026-10-25", outcomeKind: "validated"})]});
  assert.ok(board.includes('<td class="mono">until the developer'));
  assert.ok(board.includes('<td class="mono nw">2026-12-24</td>'));
  assert.ok(board.includes('<span class="st-validated nw">VALIDATED 2026-10-25</span>'));
  assert.ok(board.includes('<span class="st-upcoming nw">upcoming 30d</span>'));
});

test("the decisions panel and the ledger hold every id, label, and age on one line", () => {
  const d = {tid: "A1", id: "DL-104", title: "t", confKind: "medium", conf: "MEDIUM",
    statusKind: "open", watch: null, settled: null, chips: [], ageText: "12d"};
  const panel = S.decisionsPanelHtml({label: "x", sort: {k: "id", d: 1}, pills: "", rows: [d]});
  assert.ok(panel.includes('<td class="mono nw">DL-104</td>'));
  assert.ok(panel.includes('<span class="cf-medium nw">MEDIUM</span>'));
  assert.ok(panel.includes('<span class="st-open nw">open</span>'));
  assert.ok(panel.includes('<td><span class="st-unanchored nw">no watch</span></td>'));
  const ledger = S.assumptionLedgerHtml({sort: {k: "age", d: 1}, pills: "", rows: [d]});
  assert.match(ledger, /<td class="mono nw"><a class="wbl"[^>]*data-item="DL-104">DL-104<\/a><\/td>/);
  assert.ok(ledger.includes('<span class="cf-medium nw">MEDIUM</span>'));
  assert.ok(ledger.includes('<span class="st-open nw">open</span>'));
  assert.ok(ledger.includes('<td class="mono nw">12d</td>'));
});
