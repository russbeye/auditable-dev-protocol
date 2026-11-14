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
