"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../adp-shell-lib.js");
const B = require("../adp-index-builder-lib.js");
const I = require("../adp-index-lib.js");
const {bootShell} = require("./shell-harness.js");

const HTML = fs.readFileSync(path.join(__dirname, "..", "mission-control.html"), "utf8");

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
const TEXTS = {"20260101-AA1-alpha/audit-log.md": LOG};
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

const bootCorpus = opts => bootShell(Object.assign({stored: "dark", fetch: corpusFetch(LISTING, TEXTS)}, opts));
const pick = (h, key) => h.click(h.$$(".rentry").find(r => r.getAttribute("data-key") === key));

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
  const warn = t.mock.method(console, "warn", () => {});
  assert.equal(await S.loadCorpus(() => Promise.reject(new Error("down"))), null);
  assert.equal(await S.loadCorpus(() => Promise.resolve({ok: false})), null);
  assert.equal(await S.loadCorpus(() => Promise.resolve({ok: true, json: async () => ({})})), null);
  // The not-ok probe is the quiet offline mode. The other two shapes warn.
  assert.equal(warn.mock.callCount(), 2);
});

test("loadCorpus is all-or-null when one log is unreadable, and says which", async t => {
  const warn = t.mock.method(console, "warn", () => {});
  const got = await S.loadCorpus(corpusFetch(LISTING, {}));
  assert.equal(got, null);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0].arguments.join(" ")), /unreadable corpus file/);
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

// ---- lib: the chit ----

test("projectChitText separates a missing corpus from a nameless project", () => {
  assert.equal(S.projectChitText(null), "no corpus");
  assert.equal(S.projectChitText({project: null}), "project: —");
  assert.equal(S.projectChitText({project: "demo"}), "project: demo");
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

// ---- the real markup ----

test("mission-control.html carries the frame the harness models", () => {
  assert.match(HTML, /<link rel="stylesheet" href="adp-theme\.css" \/>/);
  assert.match(HTML, /<link rel="stylesheet" href="adp-shell\.css" \/>/);
  assert.match(HTML, /<button [^>]*id="themeBtn"/);
  assert.match(HTML, /<nav [^>]*role="tablist"/);
  assert.match(HTML, /<input type="file" id="openDoc"[^>]* multiple/);
  const srcs = [...HTML.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(srcs,
    ["adp-parser-lib.js", "adp-index-lib.js", "adp-index-builder-lib.js",
     "adp-derive-lib.js", "adp-prompt-lib.js", "adp-shell-lib.js"]);
  const screens = [...HTML.matchAll(/<section class="screen[^"]*" data-s="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(screens, S.SCREENS);
  assert.match(HTML, /<span class="chit poll poll-idle" id="liveChit" role="status">/);
  for (const id of ["projChit", "liveChit", "liveTxt", "themeBtn", "ttIcon", "tabs", "newTaskBtn", "rail", "foot", "shellmask"]) {
    assert.match(HTML, new RegExp('id="' + id + '"'));
  }
});

// ---- the page: theme boot ----

test("the pre-paint ladder honors a stored preference", () => {
  const h = bootShell({stored: "light"});
  assert.equal(h.documentElement.getAttribute("data-theme"), "light");
  assert.equal(h.$("#ttIcon").textContent, "☀");
});

test("the pre-paint ladder falls back to the system preference", () => {
  const h = bootShell({matchMediaLight: true});
  assert.equal(h.documentElement.getAttribute("data-theme"), "light");
});

test("the pre-paint ladder lands on dark when storage is blocked", () => {
  const h = bootShell({storageThrows: true});
  assert.equal(h.documentElement.getAttribute("data-theme"), "dark");
});

// ---- the page: boot render ----

test("the boot paints the no-corpus chrome synchronously", () => {
  const h = bootShell({stored: "dark"});
  const tabs = h.$$(".mtab");
  assert.deepEqual(tabs.map(t => t.getAttribute("data-s")), S.TAB_SCREENS);
  assert.equal(tabs[0].classList.contains("is-on"), true);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  assert.equal(h.$("#scrInspector").classList.contains("is-on"), true);
  assert.equal(h.$("#projChit").textContent, "no corpus");
  assert.match(h.$("#foot").textContent, /^no corpus/);
});

// ---- the page: switching ----

test("a tab click lands even while the seam is still pending", async () => {
  const h = bootShell({stored: "dark", fetch: () => new Promise(() => {})});
  h.click(h.$$(".mtab")[1]);
  assert.equal(h.$("#scrWatch").classList.contains("is-on"), true);
  assert.equal(h.$("#scrInspector").classList.contains("is-on"), false);
});

test("a tab switch keeps the same buttons, so focus survives the render", () => {
  const h = bootShell({stored: "dark"});
  const before = h.$$(".mtab");
  h.click(before[1]);
  const after = h.$$(".mtab");
  assert.equal(after.length, before.length);
  before.forEach((tab, i) => assert.equal(after[i], tab));
  assert.equal(before[1].getAttribute("aria-selected"), "true");
});

test("new task lights the accent button and clears the tab strip", () => {
  const h = bootShell({stored: "dark"});
  h.click(h.$("#newTaskBtn"));
  assert.equal(h.$("#newTaskBtn").classList.contains("is-on"), true);
  assert.equal(h.$("#scrNew").classList.contains("is-on"), true);
  assert.equal(h.$$(".mtab").some(t => t.classList.contains("is-on")), false);
});

// ---- the page: theme toggle ----

test("the theme toggle flips the attribute, the icon, and the stored key", () => {
  const h = bootShell({stored: "dark"});
  h.click(h.$("#themeBtn"));
  assert.equal(h.documentElement.getAttribute("data-theme"), "light");
  assert.equal(h.storage.get("adp-theme"), "light");
});

// ---- the page: the seam ----

test("a served corpus fills the chit, the footer, and the rail", async () => {
  const h = bootCorpus();
  await h.settle();
  assert.equal(h.$("#projChit").textContent, "project: demo");
  assert.equal(h.$("#liveTxt").textContent, "WATCHING");
  assert.equal(h.$("#liveChit").className, "chit poll poll-ok");
  assert.match(h.$("#foot").textContent, /2 tickets/);
  const rail = h.$("#rail").innerHTML;
  assert.match(rail, /needs attention/);
  assert.match(rail, /in progress/);
  assert.match(rail, /WATCH UNANCHORED/);
  assert.match(rail, /AA1/);
});

test("a dead network leaves the no-corpus chrome standing, with a console trace", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  assert.equal(h.$("#projChit").textContent, "no corpus");
  assert.equal(h.warns.length, 1);
  assert.match(h.warns[0], /corpus load failed/);
  assert.match(h.$("#scrInspector").innerHTML, /open, paste, or drop audit logs/);
});

// ---- the inspector: R4 ----

test("the corpus boot selects the first rail entry; a full ticket renders its spine", async () => {
  const h = bootCorpus();
  await h.settle();
  // AA1 (shipped with missing sections) is actionable attention; AV002 is a
  // prompt-only ticket still in flight, so it sits in progress with its
  // missing-sections ribbon intact.
  const rail = h.$("#rail").innerHTML;
  assert.match(rail, /in progress[\s\S]*AV002/);
  assert.match(rail, /9 SECTIONS MISSING/);
  const scr = h.$("#scrInspector").innerHTML;
  // The section body went through adp-parser-lib's Decision Log renderer.
  assert.match(scr, /dl-card/);
  assert.match(scr, /DL-001/);
  // The nav lists 5 real sections plus 5 missing canonicals.
  assert.equal((h.$("#secSel").innerHTML.match(/<option/g) || []).length, 10);
  assert.equal(h.$("#secSel").value, "sec-decision-log");
  // The head chit reads the inferred lifecycle.
  assert.match(scr, /shipped · inferred/);
  // Decisions panel with both entries and their pills.
  assert.match(scr, /decisions cited by Decision Log/);
  assert.match(scr, /open 1/);
  assert.match(scr, /validated 1/);
  assert.equal(h.hashes[h.hashes.length - 1], "#t=AA1&s=sec-decision-log");
});

test("section navigation steps, drops, and marks section states", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  // Dropdown carries state suffixes for non-complete sections.
  const sel = h.$("#secSel");
  assert.match(sel.innerHTML, /Aside Notes — non-canonical/);
  assert.match(sel.innerHTML, /Knowledge Gap — missing/);
  assert.match(sel.innerHTML, /Obligation Ticket List — unanchored watches/);
  // next from the spine lands on the non-canonical section.
  const next = h.$$(".op").find(o => o.getAttribute("data-secstep") === "1");
  h.click(next);
  assert.equal(h.$("#secSel").value, "sec-aside-notes");
  assert.match(h.$("#scrInspector").innerHTML, /non-canonical/);
  // The dropdown reaches any section directly.
  h.change(h.$("#secSel"), "sec-pr-summary");
  assert.equal(h.hashes[h.hashes.length - 1], "#t=AA1&s=sec-pr-summary");
});

test("a phase-scoped section shows only what it cites, with backlink chips", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  h.change(h.$("#secSel"), "sec-pr-summary");
  const scr = h.$("#scrInspector").innerHTML;
  // PR Summary cites DL-001 and OT-AA1-2, nothing else.
  assert.match(scr, /decisions cited by PR Summary/);
  assert.ok(scr.includes("DL-001"));
  assert.ok(!scr.includes(`data-dl="DL-002"`));
  assert.match(scr, /watches cited by PR Summary/);
  assert.ok(scr.includes("OT-AA1-2"));
  assert.ok(!scr.includes(`data-item="OT-AA1-1"`));
  // Chips point back at the owner and the citing section.
  assert.match(scr, /class="pc"/);
});

test("a backlink chip names an ad hoc section by its kind instead of §", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  // Aside Notes cites DL-002 and matches no registry row, so its chip reads
  // the fallback kind. The canonical chips keep their phase labels.
  const scr = h.$("#scrInspector").innerHTML;
  assert.match(scr, /data-key="sec-aside-notes"[^>]*>ad-hoc</);
  assert.match(scr, /data-key="sec-obligation-ticket-list"[^>]*>P9</);
  assert.ok(!/>§</.test(scr));
});

test("a decision row opens its card and the back link returns", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  const row = h.$$(".dlrow").find(r => r.getAttribute("data-dl") === "DL-002");
  h.click(row);
  let scr = h.$("#scrInspector").innerHTML;
  assert.match(scr, /\[DL-002\]/);
  assert.match(scr, /back to Decision Log/);
  // The link scrolls the reader back to the nav and the content it changed.
  assert.equal(h.$(".secnav")._scrolled, 1);
  assert.equal(h.hashes[h.hashes.length - 1], "#t=AA1&s=sec-decision-log&item=DL-002");
  h.click(h.$(".backlink"));
  scr = h.$("#scrInspector").innerHTML;
  assert.ok(!scr.includes("backlink"));
  assert.equal(h.hashes[h.hashes.length - 1], "#t=AA1&s=sec-decision-log");
});

test("a watch link jumps to the obligation section with the row highlighted", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  const wl = h.$$(".wl").find(w => w.getAttribute("data-item") === "OT-AA1-1");
  h.click(wl);
  const scr = h.$("#scrInspector").innerHTML;
  assert.equal(h.$("#secSel").value, "sec-obligation-ticket-list");
  assert.match(scr, /is-hl/);
  assert.equal(h.$(".secnav")._scrolled, 1);
  assert.match(scr, /UNANCHORED/);
  assert.equal(h.hashes[h.hashes.length - 1], "#t=AA1&s=sec-obligation-ticket-list&item=OT-AA1-1");
});

test("the status pills filter the decisions table", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  const pill = h.$$(".fpill").find(p => p.getAttribute("data-dlf") === "open");
  h.click(pill);
  const scr = h.$("#scrInspector").innerHTML;
  assert.ok(scr.includes(`data-dl="DL-002"`));
  assert.ok(!scr.includes(`data-dl="DL-001"`));
});

// ---- focus across rebuilds ----

test("a filter pill keeps the keyboard through its own re-render", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  const pill = h.$$(".fpill").find(p => p.getAttribute("data-dlf") === "open");
  pill.focus();
  h.click(pill);
  // The click rebuilt the panel, so the focused element must be the fresh
  // twin — same mark, attached to the page — not the detached original.
  const now = h.document.activeElement;
  assert.notEqual(now, pill);
  assert.equal(now.getAttribute("data-dlf"), "open");
  assert.ok(h.$$(".fpill").includes(now));
});

test("the section dropdown keeps focus across its change re-render", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  h.$("#secSel").focus();
  h.change(h.$("#secSel"), "sec-pr-summary");
  assert.equal(h.document.activeElement, h.$("#secSel"));
});

test("a rail selection keeps the keyboard on the rebuilt entry", async () => {
  const h = bootCorpus();
  await h.settle();
  const entry = h.$$(".rentry").find(r => r.getAttribute("data-key") === "AA1");
  entry.focus();
  h.click(entry);
  const now = h.document.activeElement;
  assert.notEqual(now, entry);
  assert.equal(now.getAttribute("data-key"), "AA1");
  assert.ok(now.classList.contains("is-sel"));
});

test("a header click sorts the decisions table and flips on repeat", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  const conf = h.$$(".sth").find(t => t.getAttribute("data-k") === "conf");
  h.click(conf);
  let rows = h.$$(".dlrow").map(r => r.getAttribute("data-dl"));
  assert.deepEqual(rows, ["DL-002", "DL-001"]);
  h.click(h.$$(".sth").find(t => t.getAttribute("data-k") === "conf"));
  rows = h.$$(".dlrow").map(r => r.getAttribute("data-dl"));
  assert.deepEqual(rows, ["DL-001", "DL-002"]);
});

test("the full-log view renders every real section as a collapsible", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  const full = h.$$(".op").find(o => o.getAttribute("data-view") === "full");
  h.click(full);
  const secs = h.$$(".fsec");
  assert.equal(secs.length, 5);
  assert.ok(secs.every(s => s.open));
  const close = h.$$(".op").find(o => o.getAttribute("data-exp") === "close");
  h.click(close);
  assert.ok(h.$$(".fsec").every(s => s.open === false));
});

test("the rail collapses a group and a ticket click selects it", async () => {
  const h = bootCorpus();
  await h.settle();
  // Collapsing needs attention hides AA1; AV002 stays visible in progress.
  const sec = h.$$(".railsec").find(s => s.getAttribute("data-sec") === "needs attention");
  h.click(sec);
  assert.equal(h.$$(".rentry").length, 1);
  h.click(h.$$(".railsec").find(s => s.getAttribute("data-sec") === "needs attention"));
  assert.equal(h.$$(".rentry").length, 2);
  pick(h, "AV002");
  assert.match(h.$("#scrInspector").innerHTML, /no audit log yet/);
});

test("the permalink control copies the current address", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  h.click(h.$(".lnk"));
  assert.equal(h.clipboard.length, 1);
  assert.match(h.clipboard[0], /#t=AA1&s=sec-decision-log$/);
});

// ---- deep links: R7 ----

test("a hash set before boot lands the named view with the item highlighted", async () => {
  const h = bootCorpus({hash: "#t=AA1&s=sec-pr-summary&item=DL-001"});
  await h.settle();
  const scr = h.$("#scrInspector").innerHTML;
  assert.equal(h.$("#secSel").value, "sec-pr-summary");
  assert.match(scr, /\[DL-001\]/);
  assert.match(scr, /is-hl/);
});

test("an item-only link lands on the item's owning section", async () => {
  const h = bootCorpus({hash: "#t=AA1&item=OT-AA1-2"});
  await h.settle();
  assert.equal(h.$("#secSel").value, "sec-obligation-ticket-list");
  assert.match(h.$("#scrInspector").innerHTML, /is-hl/);
});

test("a link to a vanished section falls back with a visible notice", async () => {
  const h = bootCorpus({hash: "#t=AA1&s=sec-retitled-away"});
  await h.settle();
  const scr = h.$("#scrInspector").innerHTML;
  assert.match(scr, /was not found in this log/);
  assert.equal(h.$("#secSel").value, "sec-decision-log");
});

test("a link to an absent ticket shows a notice instead of a silent default", async () => {
  const h = bootCorpus({hash: "#t=ZZZ"});
  await h.settle();
  assert.match(h.$("#scrInspector").innerHTML, /"ZZZ" is not in this corpus/);
});

// ---- opened documents ----

test("paste opens the drawer and imports the text as an unindexed document", async () => {
  const h = bootCorpus();
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "paste"));
  const area = h.$("#pasteArea");
  assert.ok(area);
  area.value = LOG;
  h.click(h.$("#pasteImport"));
  await h.settle();
  const rail = h.$("#rail").innerHTML;
  assert.match(rail, /opened documents/);
  assert.match(rail, /OPENED · UNINDEXED/);
  const scr = h.$("#scrInspector").innerHTML;
  assert.match(scr, /unindexed/);
  assert.match(scr, /dl-card/);
});

test("a document with no sections renders raw, flagged", async () => {
  const h = bootCorpus();
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "paste"));
  h.$("#pasteArea").value = "just a note, no headings";
  h.click(h.$("#pasteImport"));
  await h.settle();
  const scr = h.$("#scrInspector").innerHTML;
  assert.match(scr, /no sections found — shown raw/);
  assert.match(scr, /just a note, no headings/);
});

test("the file input opens several documents at once", async () => {
  const h = bootCorpus();
  await h.settle();
  const input = h.$("#openDoc");
  input.files = [{name: "a.md", __text: LOG}, {name: "b.md", __text: "## Problem Statement\n\nx\n"}];
  h.change(input);
  await h.settle();
  const rail = h.$("#rail").innerHTML;
  assert.match(rail, /a\.md/);
  assert.match(rail, /b\.md/);
  assert.equal((rail.match(/OPENED · UNINDEXED/g) || []).length, 2);
});

test("a drop without filesystem handles opens one-shot documents", async () => {
  const h = bootCorpus();
  await h.settle();
  h.fireWindow("drop", {dataTransfer: {files: [{name: "dropped.md", __text: LOG}]}});
  await h.settle();
  assert.match(h.$("#rail").innerHTML, /dropped\.md/);
});

test("the drop mask follows dragenter and dragleave", async () => {
  const h = bootCorpus();
  await h.settle();
  h.fireWindow("dragenter", {});
  assert.equal(h.$("#shellmask").classList.contains("is-on"), true);
  h.fireWindow("dragleave", {});
  assert.equal(h.$("#shellmask").classList.contains("is-on"), false);
});

test("closing an opened document removes it and clears its selection", async () => {
  const h = bootCorpus();
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "paste"));
  h.$("#pasteArea").value = LOG;
  h.click(h.$("#pasteImport"));
  await h.settle();
  h.click(h.$(".rclose"));
  await h.settle();
  const rail = h.$("#rail").innerHTML;
  assert.ok(!rail.includes("opened documents"));
  assert.match(h.$("#scrInspector").innerHTML, /select a ticket/);
});

// ---- open and watch ----

function makeHandle(name, text){
  const handle = {
    kind: "file",
    _text: text,
    _perm: "granted",
    queryPermission: async () => handle._perm,
    requestPermission: async () => handle._perm,
    getFile: async () => ({name, text: async () => handle._text})
  };
  return handle;
}

test("the picker path watches files and the poll re-renders on a real change", async () => {
  const handle = makeHandle("w.md", LOG);
  const h = bootCorpus({picker: async () => [handle]});
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "openwatch"));
  await h.settle();
  assert.match(h.$("#rail").innerHTML, /WATCHING FILE · UNINDEXED/);
  assert.match(h.$("#scrInspector").innerHTML, /watching · live/);
  // A quiet poll leaves the render alone; a changed file re-harvests.
  handle._text = LOG + "\n## Amendment Notes\n\nlate news.\n";
  h.tick();
  await h.settle();
  assert.match(h.$("#secSel").innerHTML, /Amendment Notes/);
});

test("a poll re-render keeps a paste draft in composition", async () => {
  const handle = makeHandle("w.md", LOG);
  const h = bootCorpus({picker: async () => [handle]});
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "openwatch"));
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "paste"));
  h.$("#pasteArea").value = "half-typed amendment";
  h.$("#pasteArea").focus();
  // The watched file changes under the open drawer. The rebuild must land —
  // the new section proves it did — with the draft still in the textarea
  // and the keyboard still in the field.
  handle._text = LOG + "\n## Amendment Notes\n\nlate news.\n";
  h.tick();
  await h.settle();
  assert.match(h.$("#secSel").innerHTML, /Amendment Notes/);
  assert.equal(h.$("#pasteArea").value, "half-typed amendment");
  assert.equal(h.document.activeElement, h.$("#pasteArea"));
});

test("a lapsed permission flips the watch to its cached state", async () => {
  const handle = makeHandle("w.md", LOG);
  const h = bootCorpus({picker: async () => [handle]});
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "openwatch"));
  await h.settle();
  handle._perm = "denied";
  h.tick();
  await h.settle();
  assert.match(h.$("#rail").innerHTML, /OPENED · UNINDEXED/);
  assert.match(h.$("#scrInspector").innerHTML, /cached · reload to resume/);
  assert.ok(h.warns.some(w => /watch stopped/.test(w)));
  // The reload gesture re-requests permission and resumes the watch.
  handle._perm = "granted";
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "reload"));
  await h.settle();
  assert.match(h.$("#scrInspector").innerHTML, /watching · live/);
});

// ---- hostile documents ----

test("a hostile pasted log never lands markup in the page", async () => {
  const h = bootCorpus();
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "paste"));
  h.$("#pasteArea").value = [
    "## <img src=x onerror=alert(1)> Evil Section",
    "",
    "<script>alert(2)</script>",
    "",
    "## Decision Log",
    "",
    "### [DL-001] <img src=y> title",
    "- **Decision:** <script>alert(3)</script>",
    '- **Confidence:** HIGH" onmouseover="alert(1)',
    "- **Status:** OPEN",
    ""
  ].join("\n");
  h.click(h.$("#pasteImport"));
  await h.settle();
  assert.ok(!h.$("#rail").innerHTML.includes("<img"));
  assert.ok(!h.$("#scrInspector").innerHTML.includes("<img"));
  assert.ok(!h.$("#scrInspector").innerHTML.includes("<script"));
  // The quote-bearing confidence lands in the decisions panel as the cf-high
  // class and inert cell text. The payload stays visible as content — esc
  // leaves quotes alone there — so the pin is that no tag ever carries the
  // handler, in the panel or anywhere else the harvest reaches.
  h.change(h.$("#secSel"), "sec-decision-log");
  const html = h.$("#scrInspector").innerHTML;
  assert.match(html, /class="cf-high"/);
  assert.ok(!/<[^>]*onmouseover/.test(html));
  assert.ok(!/<[^>]*onmouseover/.test(h.$("#rail").innerHTML));
});

test("an entry housed outside the spine still opens as a card", async () => {
  const h = bootCorpus();
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "paste"));
  h.$("#pasteArea").value = [
    "## Decision Log",
    "",
    "(entries arrive in review responses)",
    "",
    "## Review Response — PR #1",
    "",
    "### [DL-009] Late ruling",
    "- **Decision:** re-cut",
    "- **Status:** OPEN",
    ""
  ].join("\n");
  h.click(h.$("#pasteImport"));
  await h.settle();
  const row = h.$$(".dlrow").find(r => r.getAttribute("data-dl") === "DL-009");
  h.click(row);
  const scr = h.$("#scrInspector").innerHTML;
  assert.match(scr, /\[DL-009\]/);
  assert.match(scr, /dl-card|dl-grid/);
  assert.ok(!scr.includes("not present in the loaded text"));
});

test("in the full log, the section selector jumps to the section and opens it", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  h.click(h.$$(".op").find(o => o.getAttribute("data-view") === "full"));
  h.click(h.$$(".op").find(o => o.getAttribute("data-exp") === "close"));
  assert.ok(h.$$(".fsec").every(s => s.open === false));
  h.change(h.$("#secSel"), "sec-pr-summary");
  const secs = h.$$(".fsec");
  const target = secs.find(s => s.getAttribute("data-key") === "sec-pr-summary");
  assert.equal(target.open, true);
  assert.equal(target._scrolled, 1);
  // The jump opens its target alone; the rest keep their collapsed state.
  assert.ok(secs.filter(s => s !== target).every(s => s.open === false));
  assert.equal(h.hashes[h.hashes.length - 1], "#t=AA1&s=sec-pr-summary");
});

test("prev/next in the full log jump too, and manual toggles survive renders", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  h.click(h.$$(".op").find(o => o.getAttribute("data-view") === "full"));
  // A summary click collapses just that section, page-managed.
  const ps = h.$$(".fsec").find(s => s.getAttribute("data-key") === "sec-problem-statement");
  h.click(ps.children.find(c => c.classList.contains("fsum")));
  assert.equal(ps.open, false);
  // Stepping from the spine to the next section re-renders; the bystander's
  // manual collapse holds and the step target opens and scrolls into view.
  h.click(h.$$(".op").find(o => o.getAttribute("data-secstep") === "1"));
  const after = h.$$(".fsec");
  assert.equal(h.$("#secSel").value, "sec-aside-notes");
  assert.equal(after.find(s => s.getAttribute("data-key") === "sec-problem-statement").open, false);
  const target = after.find(s => s.getAttribute("data-key") === "sec-aside-notes");
  assert.equal(target.open, true);
  assert.equal(target._scrolled, 1);
});

test("the closed group starts collapsed, and a click opens it", async () => {
  const h = bootCorpus();
  await h.settle();
  const closed = h.$$(".railsec").find(s => s.getAttribute("data-sec") === "closed");
  assert.match(closed.innerHTML, /▸/);
  h.click(closed);
  const after = h.$$(".railsec").find(s => s.getAttribute("data-sec") === "closed");
  assert.match(after.innerHTML, /▾/);
});

test("a settled decision's watch cell keeps the id and puts the ruling on hover", () => {
  const S = require("../adp-shell-lib.js");
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
  const S = require("../adp-shell-lib.js");
  const assert = require("node:assert/strict");
  const panel = S.decisionsPanelHtml({label: "x", pills: "", sort: {k: "id", d: 1},
    rows: [{id: "DL-001", title: "t", conf: "HIGH", confKind: "high", statusKind: "open",
      watch: null, settled: {wid: "OT-1", outcome: "VALIDATED", closed: "2026-09-01"},
      chips: [], hl: false}]});
  assert.ok(panel.includes(`<span class="st-unanchored">no watch</span> <a class="wl"`));
  assert.ok(panel.includes(`title="closed VALIDATED 2026-09-01"`));
});

// ---- the watchboard: R5 ----

/* A second ticket beside AA1 stages the board states the live corpus lacks:
   an overdue watch, a soon one, and a settled one whose ledger line closed
   it. With AA1's upcoming and unanchored watches the staged corpus carries
   every live due state at once. */
const LOG_B = [
  "# Audit Log — BB2 beta",
  "",
  "## Problem Statement",
  "",
  "**What the problem is:** board demo.",
  "",
  "## Decision Log",
  "",
  "### [DL-001] Board decision",
  "- **Decision:** pick c",
  "- **Confidence:** HIGH",
  "- **Status:** OPEN — rides",
  "",
  "## Obligation Ticket List",
  "",
  "| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |",
  "|---|---|---|---|---|---|",
  "| OT-BB2-1 | DL-001 | overdue thing | HIGH | done → VALIDATED | until 2020-01-01 |",
  "| OT-BB2-2 | DL-001 | soon thing | MEDIUM | done → VALIDATED | 2026-09-01 |",
  "| OT-BB2-3 | DL-001 | settled thing | LOW | done → VALIDATED | 2026-08-01 |",
  "",
  "- **OT-BB2-3 CLOSED 2026-08-10 → VALIDATED.** The window ended quiet.",
  ""
].join("\n");
const LISTING_WB = {root: "demo",
  files: ["20260101-AA1-alpha/audit-log.md", "20260102-BB2-beta/audit-log.md"]};
const TEXTS_WB = {"20260101-AA1-alpha/audit-log.md": LOG, "20260102-BB2-beta/audit-log.md": LOG_B};
const bootBoard = opts => bootShell(Object.assign(
  {stored: "dark", fetch: corpusFetch(LISTING_WB, TEXTS_WB)}, opts));

test("the board rows live watches by default, overdue first, unanchored flagged", async () => {
  const h = bootBoard();
  await h.settle();
  h.click(h.$$(".mtab")[1]);
  const scr = h.$("#scrWatch").innerHTML;
  assert.deepEqual(h.$$(".wbrow").map(r => r.getAttribute("data-wid")),
    ["OT-BB2-1", "OT-BB2-2", "OT-AA1-1", "OT-AA1-2"]);
  assert.match(scr, /4 live · 1 settled/);
  // The closed chip starts off, so the settled row waits behind it; the
  // unanchored one shows its window prose where the dated rows show a date.
  assert.ok(!scr.includes("OT-BB2-3"));
  assert.match(scr, /60 days after merge/);
  assert.match(scr, /UNANCHORED/);
  assert.match(scr, /OVERDUE \d+D/);
});

test("the status chips reveal settled rows with their ruling and hide a live state", async () => {
  const h = bootBoard();
  await h.settle();
  h.click(h.$$(".mtab")[1]);
  const chip = s => h.$$(".fpill").find(p => p.getAttribute("data-ws") === s);
  assert.match(chip("closed").innerHTML, /closed 1/);
  h.click(chip("closed"));
  assert.deepEqual(h.$$(".wbrow").map(r => r.getAttribute("data-wid")),
    ["OT-BB2-1", "OT-BB2-2", "OT-AA1-1", "OT-AA1-2", "OT-BB2-3"]);
  assert.match(h.$("#scrWatch").innerHTML, /VALIDATED 2026-08-10/);
  // The settled row's link lands the inspector like any board row's.
  h.click(h.$$(".wbl").find(a => a.getAttribute("data-item") === "OT-BB2-3"));
  assert.equal(h.$("#secSel").value, "sec-obligation-ticket-list");
  assert.match(h.$("#scrInspector").innerHTML, /is-hl/);
  // Back on the board, hiding upcoming removes its row and only its row.
  // The upcoming chip is the date-robust pick: AA1's 2099 due holds that
  // state whatever real day the corpus generates against.
  h.click(h.$$(".mtab")[1]);
  h.click(chip("upcoming"));
  assert.deepEqual(h.$$(".wbrow").map(r => r.getAttribute("data-wid")),
    ["OT-BB2-1", "OT-BB2-2", "OT-AA1-2", "OT-BB2-3"]);
});

test("a board watch link lands the inspector on the owning section, item highlighted", async () => {
  const h = bootBoard();
  await h.settle();
  h.click(h.$$(".mtab")[1]);
  h.click(h.$$(".wbl").find(a => a.getAttribute("data-item") === "OT-BB2-1"));
  assert.equal(h.$("#scrInspector").classList.contains("is-on"), true);
  assert.equal(h.$("#secSel").value, "sec-obligation-ticket-list");
  assert.match(h.$("#scrInspector").innerHTML, /is-hl/);
  assert.equal(h.hashes[h.hashes.length - 1],
    "#t=BB2&s=sec-obligation-ticket-list&item=OT-BB2-1");
});

test("a board ticket link selects the ticket's default view", async () => {
  const h = bootBoard();
  await h.settle();
  h.click(h.$$(".mtab")[1]);
  h.click(h.$$(".wbl").find(a =>
    a.getAttribute("data-t") === "BB2" && !a.getAttribute("data-item")));
  assert.equal(h.$("#scrInspector").classList.contains("is-on"), true);
  assert.equal(h.$("#secSel").value, "sec-decision-log");
  const sel = h.$$(".rentry").find(r => r.classList.contains("is-sel"));
  assert.equal(sel.getAttribute("data-key"), "BB2");
});

test("a board header sorts, flips on repeat, and keeps the keyboard", async () => {
  const h = bootBoard();
  await h.settle();
  h.click(h.$$(".mtab")[1]);
  const tidTh = () => h.$$(".sth").find(t =>
    t.getAttribute("data-t") === "wb" && t.getAttribute("data-k") === "tid");
  tidTh().focus();
  h.click(tidTh());
  assert.deepEqual(h.$$(".wbrow").map(r => r.getAttribute("data-wid")),
    ["OT-AA1-1", "OT-AA1-2", "OT-BB2-1", "OT-BB2-2"]);
  assert.equal(h.document.activeElement.getAttribute("data-k"), "tid");
  h.click(tidTh());
  assert.deepEqual(h.$$(".wbrow").map(r => r.getAttribute("data-wid")),
    ["OT-BB2-1", "OT-BB2-2", "OT-AA1-1", "OT-AA1-2"]);
});

test("with no corpus the board says so instead of rendering an empty table", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  h.click(h.$$(".mtab")[1]);
  const scr = h.$("#scrWatch").innerHTML;
  assert.match(scr, /no corpus behind this page/);
  assert.ok(!scr.includes("wbrow"));
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

test("a watchless corpus boards the no-watches state, never the filtered one", async () => {
  const LOG_C = ["# Audit Log — CC3 gamma", "", "## Problem Statement", "",
    "**What the problem is:** young corpus.", ""].join("\n");
  const h = bootShell({stored: "dark", fetch: corpusFetch(
    {root: "demo", files: ["20260103-CC3-gamma/audit-log.md"]},
    {"20260103-CC3-gamma/audit-log.md": LOG_C})});
  await h.settle();
  h.click(h.$$(".mtab")[1]);
  const scr = h.$("#scrWatch").innerHTML;
  assert.match(scr, /no watches on record yet/);
  assert.ok(!scr.includes("hidden by the status filters"));
  assert.match(scr, /0 live · 0 settled/);
});

test("an all-settled corpus says the filters hide it, and the closed chip shows it", async () => {
  const LOG_D = ["# Audit Log — DD4 delta", "", "## Decision Log", "",
    "### [DL-001] Settled decision", "- **Decision:** pick d",
    "- **Confidence:** HIGH", "- **Status:** OPEN", "",
    "## Obligation Ticket List", "",
    "| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |",
    "|---|---|---|---|---|---|",
    "| OT-DD4-1 | DL-001 | held | HIGH | done → VALIDATED | 2026-08-01 |", "",
    "- **OT-DD4-1 CLOSED 2026-08-10 → VALIDATED.** The window ended quiet.", ""].join("\n");
  const h = bootShell({stored: "dark", fetch: corpusFetch(
    {root: "demo", files: ["20260104-DD4-delta/audit-log.md"]},
    {"20260104-DD4-delta/audit-log.md": LOG_D})});
  await h.settle();
  h.click(h.$$(".mtab")[1]);
  assert.match(h.$("#scrWatch").innerHTML, /every watch here is hidden by the status filters/);
  h.click(h.$$(".fpill").find(p => p.getAttribute("data-ws") === "closed"));
  assert.deepEqual(h.$$(".wbrow").map(r => r.getAttribute("data-wid")), ["OT-DD4-1"]);
});

test("board links carry real hash hrefs, so the keyboard can reach them", async () => {
  const h = bootBoard();
  await h.settle();
  h.click(h.$$(".mtab")[1]);
  const w = h.$$(".wbl").find(a => a.getAttribute("data-item") === "OT-BB2-1");
  // The harness reads the serialized attribute, entities intact; a real
  // browser decodes &amp; back to & before the hash is followed.
  assert.equal(w.getAttribute("href"), "#t=BB2&amp;item=OT-BB2-1");
  const t = h.$$(".wbl").find(a =>
    a.getAttribute("data-t") === "BB2" && !a.getAttribute("data-item"));
  assert.equal(t.getAttribute("href"), "#t=BB2");
});

test("a view token in the hash lands the named screen on boot", async () => {
  const h = bootBoard({hash: "#v=watchboard"});
  await h.settle();
  assert.equal(h.$("#scrWatch").classList.contains("is-on"), true);
  assert.match(h.$("#scrWatch").innerHTML, /wbrow/);
});

test("a view token rides beside a selection, and both restore", async () => {
  const h = bootBoard({hash: "#v=watchboard&t=BB2&item=OT-BB2-1"});
  await h.settle();
  assert.equal(h.$("#scrWatch").classList.contains("is-on"), true);
  // The inspector behind the board holds the restored selection.
  assert.equal(h.$("#secSel").value, "sec-obligation-ticket-list");
  assert.match(h.$("#scrInspector").innerHTML, /is-hl/);
});

test("a token naming no real screen is ignored", async () => {
  const h = bootBoard({hash: "#v=bogus&t=AA1"});
  await h.settle();
  assert.equal(h.$("#scrInspector").classList.contains("is-on"), true);
});

test("a tab switch writes its view token; the inspector clears it", async () => {
  const h = bootBoard();
  await h.settle();
  h.click(h.$$(".mtab")[1]);
  assert.match(h.hashes[h.hashes.length - 1], /^#v=watchboard&t=/);
  h.click(h.$$(".mtab")[0]);
  assert.match(h.hashes[h.hashes.length - 1], /^#t=/);
});

test("leaving the board with nothing selected clears the stale view token", async () => {
  // No-corpus mode keeps sel.t null, so the inspector composes an empty
  // hash; the old defect kept the board's token standing there.
  const h = bootShell({stored: "dark"});
  await h.settle();
  h.click(h.$$(".mtab")[1]);
  assert.equal(h.hashes[h.hashes.length - 1], "#v=watchboard");
  h.click(h.$$(".mtab")[0]);
  assert.equal(h.hashes[h.hashes.length - 1], "#");
});

test("the boot passes never write over a pending deep link", async () => {
  const h = bootCorpus({hash: "#t=AA1&s=sec-pr-summary"});
  // Before the seam resolves nothing is written, so the deep link survives
  // the first render untouched.
  assert.equal(h.hashes.length, 0);
  await h.settle();
  assert.equal(h.$("#secSel").value, "sec-pr-summary");
});

test("a hidden board skips its rebuild and settles the debt on entry", async () => {
  const h = bootBoard();
  await h.settle();
  h.click(h.$$(".mtab")[1]);
  const before = h.$$(".wbrow")[0];
  h.click(h.$$(".mtab")[0]);
  // A full re-render while the board is hidden must leave its DOM untouched.
  pick(h, "BB2");
  assert.equal(h.$$(".wbrow")[0], before);
  // Entering the tab pays the owed rebuild: fresh nodes, same content.
  h.click(h.$$(".mtab")[1]);
  assert.notEqual(h.$$(".wbrow")[0], before);
  assert.equal(h.$$(".wbrow")[0].getAttribute("data-wid"), "OT-BB2-1");
});

test("a header sorts from the keyboard with Enter and Space", async () => {
  const h = bootBoard();
  await h.settle();
  h.click(h.$$(".mtab")[1]);
  const tidTh = () => h.$$(".sth").find(t =>
    t.getAttribute("data-t") === "wb" && t.getAttribute("data-k") === "tid");
  assert.equal(tidTh().getAttribute("tabindex"), "0");
  tidTh().focus();
  h.key(tidTh(), "Enter");
  assert.deepEqual(h.$$(".wbrow").map(r => r.getAttribute("data-wid")),
    ["OT-AA1-1", "OT-AA1-2", "OT-BB2-1", "OT-BB2-2"]);
  // The rebuild handed focus to the fresh twin, so Space flips the sort back.
  assert.equal(h.document.activeElement.getAttribute("data-k"), "tid");
  h.key(h.document.activeElement, " ");
  assert.deepEqual(h.$$(".wbrow").map(r => r.getAttribute("data-wid")),
    ["OT-BB2-1", "OT-BB2-2", "OT-AA1-1", "OT-AA1-2"]);
});

// ---- the ledgers ----

test("the ledger rows every decision, open debt first, settled outcomes last", async () => {
  const h = bootBoard();
  await h.settle();
  h.click(h.$$(".mtab")[2]);
  const scr = h.$("#scrLedgers").innerHTML;
  const dls = h.$$(".lgrow").filter(r => r.getAttribute("data-dl"));
  assert.deepEqual(dls.map(r => r.getAttribute("data-t") + "/" + r.getAttribute("data-dl")),
    ["AA1/DL-002", "BB2/DL-001", "AA1/DL-001"]);
  // Watches never row here — the board is the one watch surface.
  assert.equal(h.$$(".lgrow").filter(r => r.getAttribute("data-wid")).length, 0);
  // The covered entries name their live watch and the pills count the record.
  assert.match(scr, /open 2/);
  assert.match(scr, /validated 1/);
  assert.ok(!scr.includes("invalidated"));
});

test("the ledger pills filter corpus-wide and leave the inspector's filter alone", async () => {
  const h = bootBoard();
  await h.settle();
  // Narrow the inspector to AA1's validated entry first, so a trampled
  // filter state would show up as a changed table on the way back.
  pick(h, "AA1");
  h.click(h.$$(".fpill").find(p => p.getAttribute("data-dlf") === "validated"));
  assert.deepEqual(h.$$(".dlrow").map(r => r.getAttribute("data-dl")), ["DL-001"]);
  h.click(h.$$(".mtab")[2]);
  h.click(h.$$(".fpill").find(p => p.getAttribute("data-lgf") === "open"));
  assert.deepEqual(
    h.$$(".lgrow").filter(r => r.getAttribute("data-dl")).map(r => r.getAttribute("data-dl")),
    ["DL-002", "DL-001"]);
  h.click(h.$$(".mtab")[0]);
  assert.deepEqual(h.$$(".dlrow").map(r => r.getAttribute("data-dl")), ["DL-001"]);
  const on = h.$$(".fpill").find(p => p.getAttribute("data-dlf") && p.classList.contains("is-on"));
  assert.match(on.innerHTML, /validated/);
  // The ledger's own filter held through the round trip too.
  h.click(h.$$(".mtab")[2]);
  const lon = h.$$(".fpill").find(p => p.getAttribute("data-lgf") && p.classList.contains("is-on"));
  assert.match(lon.innerHTML, /open/);
});

test("a ledger entry link lands the inspector on the item in its owning section", async () => {
  const h = bootBoard();
  await h.settle();
  h.click(h.$$(".mtab")[2]);
  h.click(h.$$(".wbl").find(a => a.getAttribute("data-item") === "DL-002"));
  assert.equal(h.$("#scrInspector").classList.contains("is-on"), true);
  assert.equal(h.$("#secSel").value, "sec-decision-log");
  assert.match(h.$("#scrInspector").innerHTML, /\[DL-002\]/);
  assert.equal(h.hashes[h.hashes.length - 1], "#t=AA1&s=sec-decision-log&item=DL-002");
});

test("a ledger coverage link lands the watch, and a ticket link the default view", async () => {
  const h = bootBoard();
  await h.settle();
  h.click(h.$$(".mtab")[2]);
  h.click(h.$$(".wbl").find(a => a.getAttribute("data-item") === "OT-AA1-1"));
  assert.equal(h.$("#secSel").value, "sec-obligation-ticket-list");
  assert.match(h.$("#scrInspector").innerHTML, /is-hl/);
  h.click(h.$$(".mtab")[2]);
  h.click(h.$$(".wbl").find(a =>
    a.getAttribute("data-t") === "BB2" && !a.getAttribute("data-item")));
  assert.equal(h.$("#secSel").value, "sec-decision-log");
});

test("a ledgers deep link boots to the screen and a tab visit writes its token", async () => {
  const h = bootBoard({hash: "#v=ledgers"});
  await h.settle();
  assert.equal(h.$("#scrLedgers").classList.contains("is-on"), true);
  assert.ok(h.$$(".lgrow").length > 0);
  const h2 = bootBoard();
  await h2.settle();
  h2.click(h2.$$(".mtab")[2]);
  assert.match(h2.hashes[h2.hashes.length - 1], /^#v=ledgers/);
});

test("with no corpus the ledgers say so instead of rendering empty tables", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  h.click(h.$$(".mtab")[2]);
  const scr = h.$("#scrLedgers").innerHTML;
  assert.match(scr, /no corpus behind this page/);
  assert.ok(!scr.includes("lgrow"));
});

test("a hidden ledgers screen skips its rebuild and pays it on entry", async () => {
  const h = bootBoard();
  await h.settle();
  h.click(h.$$(".mtab")[2]);
  const before = h.$$(".lgrow")[0];
  h.click(h.$$(".mtab")[0]);
  // A full re-render while the ledgers are hidden must leave their DOM alone.
  pick(h, "BB2");
  assert.equal(h.$$(".lgrow")[0], before);
  // Entering the tab pays the owed rebuild: fresh nodes, same content.
  h.click(h.$$(".mtab")[2]);
  assert.notEqual(h.$$(".lgrow")[0], before);
  assert.equal(h.$$(".lgrow")[0].getAttribute("data-dl"), "DL-002");
});

test("the sorted header carries aria-sort and the arrow hides from the tree", async () => {
  const h = bootBoard();
  await h.settle();
  h.click(h.$$(".mtab")[2]);
  const laTh = k => h.$$(".sth").find(t =>
    t.getAttribute("data-t") === "la" && t.getAttribute("data-k") === k);
  // scope makes the columnheader role explicit; aria-sort only means
  // something on that role.
  assert.ok(h.$$(".sth").every(t => t.getAttribute("scope") === "col"));
  assert.equal(laTh("status").getAttribute("aria-sort"), "ascending");
  assert.equal(laTh("id").getAttribute("aria-sort"), null);
  h.click(laTh("id"));
  assert.equal(laTh("id").getAttribute("aria-sort"), "ascending");
  assert.equal(laTh("status").getAttribute("aria-sort"), null);
  h.click(laTh("id"));
  assert.equal(laTh("id").getAttribute("aria-sort"), "descending");
  assert.equal(h.$$(".arr")[0].getAttribute("aria-hidden"), "true");
});

test("the rail close control is a sibling button the keyboard can reach", async () => {
  const h = bootCorpus();
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "paste"));
  h.$("#pasteArea").value = LOG;
  h.click(h.$("#pasteImport"));
  await h.settle();
  const rc = h.$(".rclose");
  assert.equal(rc.tagName, "BUTTON");
  // The accessible name says which document this button closes.
  assert.equal(rc.getAttribute("aria-label"), "close pasted.md");
  // The close control must never nest inside the entry button; the shared
  // row container holds the two as siblings.
  for (let p = rc.parent; p; p = p.parent)
    assert.ok(!(p.className || "").includes("rentry"));
  assert.ok(rc.parent.className.includes("rrow"));
  rc.focus();
  h.click(rc);
  await h.settle();
  assert.ok(!h.$("#rail").innerHTML.includes("opened documents"));
});

test("closing from the keyboard hands focus to the next rail entry", async () => {
  const h = bootCorpus();
  await h.settle();
  const pasteDoc = () => {
    h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "paste"));
    h.$("#pasteArea").value = LOG;
    h.click(h.$("#pasteImport"));
  };
  pasteDoc();
  pasteDoc();
  const closeOf = key => h.$$(".rclose").find(b => b.getAttribute("data-close") === key);
  closeOf("doc-1").focus();
  h.click(closeOf("doc-1"));
  await h.settle();
  // The entry that took the closed one's place holds the keyboard now.
  assert.equal(h.document.activeElement.getAttribute("data-key"), "doc-2");
  closeOf("doc-2").focus();
  h.click(closeOf("doc-2"));
  await h.settle();
  // With no documents left, focus falls to the first rail entry the
  // corpus still shows instead of dropping to the body.
  assert.ok((h.document.activeElement.className || "").includes("rentry"));
});

test("the status header orders the default board and a flip really reverses it", async () => {
  const h = bootBoard();
  await h.settle();
  h.click(h.$$(".mtab")[1]);
  const stateTh = () => h.$$(".sth").find(t =>
    t.getAttribute("data-t") === "wb" && t.getAttribute("data-k") === "state");
  h.click(stateTh());
  assert.deepEqual(h.$$(".wbrow").map(r => r.getAttribute("data-wid")),
    ["OT-BB2-1", "OT-BB2-2", "OT-AA1-1", "OT-AA1-2"]);
  // The flip must produce a real order change on an all-live board — the
  // status key reads the shared order value, never a group flag alone.
  h.click(stateTh());
  assert.equal(stateTh().getAttribute("aria-sort"), "descending");
  assert.deepEqual(h.$$(".wbrow").map(r => r.getAttribute("data-wid")),
    ["OT-AA1-2", "OT-AA1-1", "OT-BB2-2", "OT-BB2-1"]);
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

// ---- the page: the corpus poll (MC-002) ----

/* A fetch stub whose corpus can change under the page, and which can go
   down, so a test can play the run that appends to a log while the page
   sits on screen. */
function liveCorpus(){
  const texts = Object.assign({}, TEXTS);
  const st = {texts, down: false, listings: 0};
  st.fetch = u => {
    if (st.down) return Promise.reject(new Error("server down"));
    if (u === "corpus.json") st.listings++;
    return corpusFetch(LISTING, texts)(u);
  };
  return st;
}
const LOG_GROWN = LOG.replace("## Aside Notes", "## Test Adversary Document\n\nGrown while watched.\n\n## Aside Notes");
const entry = (h, key) => h.$$(".rentry").find(r => r.getAttribute("data-key") === key);

test("a served log that grows re-renders within one tick", async () => {
  const live = liveCorpus();
  const h = bootShell({stored: "dark", fetch: live.fetch});
  await h.settle();
  assert.doesNotMatch(h.$("#scrInspector").innerHTML, /Test Adversary Document/);
  assert.match(entry(h, "AA1").innerHTML, /5 SECTIONS MISSING/);
  live.texts["20260101-AA1-alpha/audit-log.md"] = LOG_GROWN;
  h.tick();
  await h.settle();
  assert.match(h.$("#scrInspector").innerHTML, /Test Adversary Document/);
  // The rail re-rendered too: AA1's own ribbon counts one section fewer.
  assert.match(entry(h, "AA1").innerHTML, /4 SECTIONS MISSING/);
});

test("an unchanged tick renders nothing and disturbs no reader state", async () => {
  const live = liveCorpus();
  const h = bootShell({stored: "dark", fetch: live.fetch});
  await h.settle();
  pick(h, "AA1");
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "paste"));
  h.$("#pasteArea").value = "half a draft";
  const before = {rail: h.$("#rail").innerHTML, insp: h.$("#scrInspector").innerHTML,
    renders: h.hashes.length, hash: h.location.hash};
  h.tick();
  await h.settle();
  // Every renderAll writes the hash, so an unchanged count is no render.
  assert.equal(h.hashes.length, before.renders);
  assert.equal(h.$("#rail").innerHTML, before.rail);
  assert.equal(h.$("#scrInspector").innerHTML, before.insp);
  assert.equal(h.location.hash, before.hash);
  assert.equal(h.$("#pasteArea").value, "half a draft");
});

test("a failed re-fetch keeps the last good corpus and traces once", async () => {
  const live = liveCorpus();
  const h = bootShell({stored: "dark", fetch: live.fetch});
  await h.settle();
  const renders = h.hashes.length;
  live.down = true;
  h.tick();
  await h.settle();
  assert.equal(h.$("#projChit").textContent, "project: demo");
  assert.match(h.$("#rail").innerHTML, /AA1/);
  assert.equal(h.hashes.length, renders);
  assert.equal(h.warns.length, 1);
  assert.match(h.warns[0], /corpus load failed/);
  // The pill says the corpus on screen is the last good one, then recovers.
  assert.equal(h.$("#liveTxt").textContent, "CACHED");
  assert.equal(h.$("#liveChit").className, "chit poll poll-warn");
  live.down = false;
  h.tick();
  await h.settle();
  assert.equal(h.$("#liveTxt").textContent, "WATCHING");
  assert.equal(h.$("#liveChit").className, "chit poll poll-ok");
  assert.equal(h.hashes.length, renders);
});

test("a file:// open never polls for a corpus", async () => {
  const h = bootShell({stored: "dark", href: "file:///mission-control.html"});
  await h.settle();
  assert.equal(h.warns.length, 1);
  h.tick(); h.tick();
  await h.settle();
  assert.equal(h.warns.length, 1);
  assert.equal(h.$("#projChit").textContent, "no corpus");
  assert.equal(h.$("#liveTxt").textContent, "STATIC");
  assert.equal(h.$("#liveChit").className, "chit poll poll-idle");
});

test("a served page whose boot load failed catches up on a later tick", async () => {
  const live = liveCorpus();
  live.down = true;
  const h = bootShell({stored: "dark", fetch: live.fetch});
  await h.settle();
  assert.equal(h.$("#projChit").textContent, "no corpus");
  assert.equal(h.$("#liveTxt").textContent, "IDLE");
  assert.equal(h.warns.length, 1);
  live.down = false;
  h.tick();
  await h.settle();
  assert.equal(h.$("#projChit").textContent, "project: demo");
  assert.match(h.$("#rail").innerHTML, /AA1/);
  assert.equal(h.$("#liveTxt").textContent, "WATCHING");
});

test("a served page with no corpus directory probes quietly", async () => {
  const h = bootShell({stored: "dark", fetch: () => Promise.resolve({ok: false})});
  await h.settle();
  h.tick(); h.tick();
  await h.settle();
  assert.equal(h.warns.length, 0);
  assert.equal(h.$("#projChit").textContent, "no corpus");
});

test("a hidden tab skips the corpus fetch until it is shown again", async () => {
  const live = liveCorpus();
  const h = bootShell({stored: "dark", fetch: live.fetch});
  await h.settle();
  assert.equal(live.listings, 1);
  h.document.visibilityState = "hidden";
  h.tick();
  await h.settle();
  assert.equal(live.listings, 1);
  h.document.visibilityState = "visible";
  h.tick();
  await h.settle();
  assert.equal(live.listings, 2);
});

test("ticks never overlap a corpus load in flight", async () => {
  const live = liveCorpus();
  const h = bootShell({stored: "dark", fetch: live.fetch});
  await h.settle();
  assert.equal(live.listings, 1);
  h.tick(); h.tick(); h.tick();
  await h.settle();
  assert.equal(live.listings, 2);
});

test("a boot that failed honors its deep link when the corpus first answers", async () => {
  const live = liveCorpus();
  live.down = true;
  const h = bootShell({stored: "dark", fetch: live.fetch, hash: "#t=AA1&s=sec-pr-summary"});
  await h.settle();
  assert.equal(h.$("#projChit").textContent, "no corpus");
  assert.doesNotMatch(h.$("#scrInspector").innerHTML, /is not in this corpus/);
  live.down = false;
  h.tick();
  await h.settle();
  assert.ok(entry(h, "AA1").classList.contains("is-sel"));
  assert.match(h.$("#scrInspector").innerHTML, /PR Summary/);
  assert.doesNotMatch(h.$("#scrInspector").innerHTML, /is not in this corpus/);
  assert.equal(h.hashes[h.hashes.length - 1], "#t=AA1&s=sec-pr-summary");
});

test("a boot that failed takes the default selection when the corpus first answers", async () => {
  const live = liveCorpus();
  live.down = true;
  const h = bootShell({stored: "dark", fetch: live.fetch});
  await h.settle();
  live.down = false;
  h.tick();
  await h.settle();
  assert.ok(entry(h, "AA1").classList.contains("is-sel"));
  assert.equal(h.hashes[h.hashes.length - 1], "#t=AA1&s=sec-decision-log");
});

test("the live pill's status region is written only when its state changes", async () => {
  const live = liveCorpus();
  const h = bootShell({stored: "dark", fetch: live.fetch});
  await h.settle();
  assert.equal(h.$("#liveTxt").textContent, "WATCHING");
  // A live region reports every text write, so an unchanged word must not
  // be written again on ordinary navigation or a quiet tick.
  const txt = h.$("#liveTxt");
  let writes = 0, word = txt.textContent;
  Object.defineProperty(txt, "textContent", {get: () => word, set: v => { writes++; word = v; }});
  pick(h, "AA1");
  h.click(h.$$(".mtab")[1]);
  h.tick();
  await h.settle();
  assert.equal(writes, 0);
  live.down = true;
  h.tick();
  await h.settle();
  assert.equal(writes, 1);
  assert.equal(word, "CACHED");
});

test("a boot that failed honors the screen token at once and the ticket token when the corpus answers", async () => {
  const live = liveCorpus();
  live.down = true;
  const h = bootShell({stored: "dark", fetch: live.fetch, hash: "#v=watchboard&t=AA1"});
  await h.settle();
  assert.equal(h.$("#scrWatch").classList.contains("is-on"), true);
  live.down = false;
  h.tick();
  await h.settle();
  assert.equal(h.$("#scrWatch").classList.contains("is-on"), true);
  assert.ok(entry(h, "AA1").classList.contains("is-sel"));
});

test("a pending ticket link never replaces a selection the reader made first", async () => {
  const live = liveCorpus();
  live.down = true;
  const h = bootShell({stored: "dark", fetch: live.fetch, hash: "#t=AA1"});
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "paste"));
  h.$("#pasteArea").value = "# Pasted\n\n## Problem Statement\n\nmine.";
  h.click(h.$("#pasteImport"));
  await h.settle();
  assert.ok(entry(h, "doc-1").classList.contains("is-sel"));
  live.down = false;
  h.tick();
  await h.settle();
  assert.ok(entry(h, "doc-1").classList.contains("is-sel"));
  assert.ok(!entry(h, "AA1").classList.contains("is-sel"));
});

test("a file:// open with a ticket link keeps the URL following the reader", async () => {
  const h = bootShell({stored: "dark", href: "file:///mission-control.html", hash: "#t=AA1"});
  await h.settle();
  assert.match(h.$("#scrInspector").innerHTML, /"AA1" is not in this corpus/);
  h.click(h.$$(".mtab")[1]);
  assert.equal(h.location.hash, "#v=watchboard");
});

test("a served page waiting for its corpus carries the ticket link through its hash writes", async () => {
  const live = liveCorpus();
  live.down = true;
  const h = bootShell({stored: "dark", fetch: live.fetch, hash: "#t=AA1"});
  await h.settle();
  h.click(h.$$(".mtab")[1]);
  assert.equal(h.location.hash, "#v=watchboard&t=AA1");
  live.down = false;
  h.tick();
  await h.settle();
  // The link's ticket lands; the screen the reader chose in the meantime stays.
  assert.ok(entry(h, "AA1").classList.contains("is-sel"));
  assert.equal(h.$("#scrWatch").classList.contains("is-on"), true);
});

// ---- the resume pack ----

/* The pack tests serve the shipped packs from disk through the fetch stub,
   so the screen renders the real files. The corpus is the board's staged
   pair, which carries an open decision, live and settled watches, and an
   overdue one. */
const P = require("../adp-parser-lib.js");
const PACKS_ROOT = path.join(__dirname, "..", "..", "packs");
const PACK_FILES = fs.readdirSync(PACKS_ROOT).filter(f => f.endsWith(".pack.md")).sort();
const PACK_NAMES = PACK_FILES.map(f => f.replace(/\.pack\.md$/, ""));
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
const bootPacks = opts => bootShell(Object.assign(
  {stored: "dark", fetch: packsFetch(corpusFetch(LISTING_WB, TEXTS_WB))}, opts));
const packTab = h => h.click(h.$$(".mtab")[4]);
// The mini-DOM resolves one class per selector, so the marked entry and the
// marked pack are read through classList.
const selectedKey = h => h.$$(".rentry").find(r => r.classList.contains("is-sel")).getAttribute("data-key");
const selectedPacks = h => h.$$(".pk").filter(b => b.classList.contains("is-on")).map(b => b.getAttribute("data-pk"));

// What the page must show for a ticket: the same corpus built the same way
// the seam builds it, filled by the lib for that ticket on the index's day.
function expectedPack(name, key){
  const index = B.buildIndex(
    LISTING_WB.files.map(p => (p in TEXTS_WB ? {path: p, text: TEXTS_WB[p]} : {path: p})),
    {project: "demo", generated: S.localDate(), source: "working-tree"});
  const t = index.tickets.find(x => (x.id || x.dir) === key);
  return S.fillPack(packText(name + ".pack.md"), S.packContext(index, t, index.generated));
}

test("loadPacks returns every listed pack in listing order, with its name, file, and text", async () => {
  const got = await S.loadPacks(packsFetch(() => Promise.resolve({ok: false})));
  assert.deepEqual(got.map(p => [p.name, p.file]), PACK_FILES.map(f => [f.replace(/\.pack\.md$/, ""), "packs/" + f]));
  assert.equal(got[0].text, packText(PACK_FILES[0]));
});

test("loadPacks resolves null on every failure shape, all-or-null", async t => {
  const warn = t.mock.method(console, "warn", () => {});
  // A probe that never answers and a not-ok probe are both the quiet
  // no-packs mode; the corpus seam already traces a dead server.
  assert.equal(await S.loadPacks(() => Promise.reject(new Error("down"))), null);
  assert.equal(await S.loadPacks(() => Promise.resolve({ok: false})), null);
  assert.equal(warn.mock.callCount(), 0);
  assert.equal(await S.loadPacks(() => Promise.resolve({ok: true, json: async () => ({})})), null);
  // One listed pack the server cannot serve fails the whole load.
  assert.equal(await S.loadPacks(packsFetch(() => Promise.resolve({ok: false}),
    {packs: PACK_FILES.concat("ghost.pack.md")})), null);
  assert.equal(warn.mock.callCount(), 2);
  assert.match(String(warn.mock.calls[1].arguments.join(" ")), /unreadable pack: ghost/);
});

test("the pack screen rows every pack in listing order with resume-ticket selected by default", async () => {
  const h = bootPacks();
  await h.settle();
  packTab(h);
  assert.deepEqual(h.$$(".pk").map(b => b.getAttribute("data-pk")), PACK_NAMES);
  assert.deepEqual(selectedPacks(h), ["resume-ticket"]);
  assert.match(h.$(".packsrc").innerHTML, /source: packs\/resume-ticket\.pack\.md/);
  assert.match(h.$("#scrPack").innerHTML, /add your own pack/);
  assert.match(h.$(".slotlist").innerHTML, /\{\{index\.generated\}\}/);
});

test("the block carries the lib's fill for the selected ticket, and a rail pick refills it in place", async () => {
  const h = bootPacks();
  await h.settle();
  packTab(h);
  const first = selectedKey(h);
  assert.equal(h.$("#packText").innerHTML, P.esc(expectedPack("resume-ticket", first)));
  const other = first === "BB2" ? "AA1" : "BB2";
  pick(h, other);
  assert.equal(h.$("#scrPack").classList.contains("is-on"), true);
  assert.equal(h.$("#packText").innerHTML, P.esc(expectedPack("resume-ticket", other)));
  assert.notEqual(expectedPack("resume-ticket", first), expectedPack("resume-ticket", other));
});

test("a pack button switches the pack, refills the block, and keeps the keyboard", async () => {
  const h = bootPacks();
  await h.settle();
  packTab(h);
  const key = selectedKey(h);
  const btn = h.$$(".pk").find(b => b.getAttribute("data-pk") === "audit-sweep");
  btn.focus();
  h.click(btn);
  assert.deepEqual(selectedPacks(h), ["audit-sweep"]);
  assert.match(h.$(".packsrc").innerHTML, /audit-sweep\.pack\.md/);
  assert.equal(h.$("#packText").innerHTML, P.esc(expectedPack("audit-sweep", key)));
  assert.equal(h.document.activeElement.getAttribute("data-pk"), "audit-sweep");
});

test("copy writes the block's text to the clipboard and the label reports it, then rests", async () => {
  const h = bootPacks();
  await h.settle();
  packTab(h);
  const key = selectedKey(h);
  const copy = () => h.$$(".op").find(b => b.getAttribute("data-op") === "copypack");
  h.click(copy());
  await h.settle();
  assert.deepEqual(h.clipboard, [expectedPack("resume-ticket", key)]);
  assert.equal(copy().innerHTML, "copied");
  h.runTimeouts();
  assert.equal(copy().innerHTML, "⧉ copy pack");
});

test("a denied clipboard write says so and copies nothing", async () => {
  const h = bootPacks({clipboardRejects: true});
  await h.settle();
  packTab(h);
  h.click(h.$$(".op").find(b => b.getAttribute("data-op") === "copypack"));
  await h.settle();
  assert.deepEqual(h.clipboard, []);
  assert.match(h.$$(".op").find(b => b.getAttribute("data-op") === "copypack").innerHTML, /copy failed/);
});

test("a resume pack deep link boots to the screen and a tab visit writes its token", async () => {
  const h = bootPacks({hash: "#v=resume%20pack"});
  await h.settle();
  assert.equal(h.$("#scrPack").classList.contains("is-on"), true);
  assert.ok(h.$("#packText"));
  const h2 = bootPacks();
  await h2.settle();
  packTab(h2);
  assert.match(h2.hashes[h2.hashes.length - 1], /^#v=resume%20pack/);
});

test("with no packs behind the page the screen says so and rows nothing", async () => {
  const h = bootBoard();
  await h.settle();
  packTab(h);
  const scr = h.$("#scrPack").innerHTML;
  assert.match(scr, /no packs behind this page/);
  assert.equal(h.$$(".pk").length, 0);
  assert.equal(h.$("#packText"), null);
});

test("an empty packs directory is named as empty, not as absent", async () => {
  const h = bootShell({stored: "dark",
    fetch: packsFetch(corpusFetch(LISTING_WB, TEXTS_WB), {packs: []})});
  await h.settle();
  packTab(h);
  assert.match(h.$("#scrPack").innerHTML, /packs directory is empty/);
});

test("with packs but no corpus the screen rows the packs and says there is no corpus to fill from", async () => {
  const h = bootShell({stored: "dark", fetch: packsFetch(() => Promise.resolve({ok: false}))});
  await h.settle();
  packTab(h);
  assert.equal(h.$$(".pk").length, PACK_NAMES.length);
  assert.match(h.$("#scrPack").innerHTML, /no corpus behind this page/);
  assert.equal(h.$("#packText"), null);
});

test("an opened document is unindexed, so the screen says so instead of filling from it", async () => {
  const h = bootPacks();
  await h.settle();
  h.click(h.$$(".op").find(b => b.getAttribute("data-op") === "paste"));
  h.$("#pasteArea").value = LOG;
  h.click(h.$("#pasteImport"));
  packTab(h);
  assert.match(h.$("#scrPack").innerHTML, /opened documents are unindexed/);
  assert.equal(h.$("#packText"), null);
  // Picking an indexed ticket again fills the pack without leaving the screen.
  pick(h, "AA1");
  assert.equal(h.$("#scrPack").classList.contains("is-on"), true);
  assert.equal(h.$("#packText").innerHTML, P.esc(expectedPack("resume-ticket", "AA1")));
});

test("a corpus-wide pack fills with no ticket selected, and a ticket pack still asks for one", async () => {
  const h = bootPacks({hash: "#t=ZZZ"});
  await h.settle();
  packTab(h);
  assert.match(h.$("#scrPack").innerHTML, /"ZZZ" is not in this corpus/);
  assert.equal(h.$("#packText"), null);
  h.click(h.$$(".pk").find(b => b.getAttribute("data-pk") === "watch-audit"));
  assert.equal(h.$("#packText").innerHTML, P.esc(expectedPack("watch-audit", null)));
  assert.doesNotMatch(h.$("#scrPack").innerHTML, /select a ticket/);
  h.click(h.$$(".pk").find(b => b.getAttribute("data-pk") === "close-watch"));
  assert.equal(h.$("#packText"), null);
});

test("a hidden pack screen skips its rebuild and pays it on entry", async () => {
  const h = bootPacks();
  await h.settle();
  packTab(h);
  const before = h.$$(".pk")[0];
  h.click(h.$$(".mtab")[0]);
  // A full re-render while the pack screen is hidden must leave its DOM alone.
  pick(h, "BB2");
  assert.equal(h.$$(".pk")[0], before);
  packTab(h);
  assert.notEqual(h.$$(".pk")[0], before);
  assert.equal(h.$("#packText").innerHTML, P.esc(expectedPack("resume-ticket", "BB2")));
});

// ---- calibration ----

const calTab = h => h.click(h.$$(".mtab")[3]);

test("the calibration screen tiles the corpus and rows every confidence with the ledger's counts", async () => {
  const h = bootBoard();
  await h.settle();
  calTab(h);
  const scr = h.$("#scrCalib").innerHTML;
  // Two shipped tickets, three decisions, and the board's own watch counts:
  // the overdue count moves with the real date, so the board's chip states it.
  h.click(h.$$(".mtab")[1]);
  const overdue = h.$$(".fpill").find(p => p.getAttribute("data-ws") === "overdue").innerHTML.match(/overdue (\d+)/)[1];
  calTab(h);
  assert.deepEqual(h.$$(".caltile-n").map(t => t.innerHTML), ["2", "2", "3", overdue + "+1"]);
  assert.deepEqual(h.$$(".caltile").map(t => t.getAttribute("data-tile")),
    ["tickets", "shipped", "decisions", "watches"]);
  assert.deepEqual(h.$$(".calrow").map(r => r.getAttribute("data-conf")), ["high", "medium", "low"]);
  // HIGH holds one validated and one open entry; the ruled share reads the
  // one ruling. MEDIUM is empty and says so. LOW holds the one open entry.
  assert.match(scr, /1 validated/);
  assert.match(scr, /1 of 1 ruled validated/);
  assert.match(scr, /none ruled yet/);
  // The separator leads the count it belongs to, so no line can end on one.
  assert.match(scr, /<span class="calnw">· 1 open<\/span>/);
  assert.ok(!/·\s*<\/span>/.test(scr));
  // Segments carry both classes; the legend's swatches carry the kind alone.
  const segs = k => (scr.match(new RegExp(`class="calseg calseg-${k}"`, "g")) || []).length;
  assert.equal(segs("open"), 2);
  assert.equal(segs("validated"), 1);
  assert.equal(segs("invalidated"), 0);
  // The legend names every segment the model can produce.
  for (const k of ["validated", "invalidated", "open", "unknown", "other"])
    assert.match(scr, new RegExp(`<i class="calseg-${k}"></i>${k}`));
  // The open count agrees with the ledger's pill on the same corpus.
  const open = (scr.match(/(\d+) open</g) || []).reduce((n, s) => n + parseInt(s, 10), 0);
  h.click(h.$$(".mtab")[2]);
  assert.match(h.$("#scrLedgers").innerHTML, new RegExp(`open ${open}`));
});

test("the calibration screen counts a ruled entry by its ruling, never its card", async () => {
  const log = [
    "# Audit Log — CC3 gamma", "", "## Decision Log", "",
    "### [DL-001] Ruled off the card", "- **Decision:** pick d", "- **Confidence:** MEDIUM",
    "- **Status:** OPEN", "", "- **DL-001 CLOSED 2026-08-10 → VALIDATED.** The ruling.", ""
  ].join("\n");
  const h = bootShell({stored: "dark", fetch: corpusFetch(
    {root: "demo", files: ["20260103-CC3-gamma/audit-log.md"]},
    {"20260103-CC3-gamma/audit-log.md": log})});
  await h.settle();
  calTab(h);
  const scr = h.$("#scrCalib").innerHTML;
  assert.match(scr, /1 validated/);
  assert.match(scr, /1 of 1 ruled validated/);
  assert.ok(!scr.includes('class="calseg calseg-open"'));
});

test("a calibration deep link boots to the screen and a tab visit writes its token", async () => {
  const h = bootBoard({hash: "#v=calibration"});
  await h.settle();
  assert.equal(h.$("#scrCalib").classList.contains("is-on"), true);
  assert.equal(h.$$(".caltile").length, 4);
  const h2 = bootBoard();
  await h2.settle();
  calTab(h2);
  assert.match(h2.hashes[h2.hashes.length - 1], /^#v=calibration/);
});

test("with no corpus the calibration screen says so instead of tiling zeros", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  calTab(h);
  const scr = h.$("#scrCalib").innerHTML;
  assert.match(scr, /no corpus behind this page/);
  assert.equal(h.$$(".caltile").length, 0);
  assert.equal(h.$$(".calrow").length, 0);
});

test("a corpus with no decisions tiles its zeros and names the empty record", async () => {
  const log = "# Audit Log — CC3 gamma\n\n## Problem Statement\n\n**What the problem is:** empty.\n";
  const h = bootShell({stored: "dark", fetch: corpusFetch(
    {root: "demo", files: ["20260103-CC3-gamma/audit-log.md"]},
    {"20260103-CC3-gamma/audit-log.md": log})});
  await h.settle();
  calTab(h);
  const scr = h.$("#scrCalib").innerHTML;
  assert.deepEqual(h.$$(".caltile-n").map(t => t.innerHTML), ["1", "0", "0", "0+0"]);
  assert.match(scr, /no decisions on record/);
  assert.equal(h.$$(".calrow").length, 0);
});

test("a hidden calibration screen skips its rebuild and pays it on entry", async () => {
  const h = bootBoard();
  await h.settle();
  calTab(h);
  const before = h.$$(".caltile")[0];
  h.click(h.$$(".mtab")[0]);
  // A full re-render while the screen is hidden must leave its DOM alone.
  pick(h, "BB2");
  assert.equal(h.$$(".caltile")[0], before);
  calTab(h);
  assert.notEqual(h.$$(".caltile")[0], before);
  assert.equal(h.$$(".caltile-n")[0].innerHTML, "2");
});

test("a bar segment lands the ledger filtered to its cell, with focus on the status pill", async () => {
  const h = bootBoard();
  await h.settle();
  calTab(h);
  const seg = h.$$(".calseg").find(s =>
    s.getAttribute("data-calc") === "high" && s.getAttribute("data-calk") === "open");
  assert.match(seg.getAttribute("aria-label"), /^1 open at HIGH/);
  h.click(seg);
  assert.equal(h.$("#scrLedgers").classList.contains("is-on"), true);
  assert.match(h.hashes[h.hashes.length - 1], /^#v=ledgers/);
  // Only the one HIGH open entry rows; both pill groups read on.
  assert.deepEqual(
    h.$$(".lgrow").filter(r => r.getAttribute("data-dl")).map(r => r.getAttribute("data-t") + "/" + r.getAttribute("data-dl")),
    ["BB2/DL-001"]);
  const on = attr => h.$$(".fpill").find(p => p.getAttribute(attr) && p.classList.contains("is-on"));
  assert.match(on("data-lgf").innerHTML, /^open 2/);
  assert.match(on("data-lgc").innerHTML, /^high 2/);
  assert.equal(h.$("#scrLedgers").innerHTML.includes("pilllab"), true);
  assert.equal(h.document.activeElement, on("data-lgf"));
  // Widening the confidence back to all keeps the status cut.
  h.click(h.$$(".fpill").find(p => p.getAttribute("data-lgc") === "all"));
  assert.deepEqual(
    h.$$(".lgrow").filter(r => r.getAttribute("data-dl")).map(r => r.getAttribute("data-dl")),
    ["DL-002", "DL-001"]);
  // The confidence filter is ledger state: it holds across a tab round trip.
  h.click(h.$$(".fpill").find(p => p.getAttribute("data-lgc") === "low"));
  h.click(h.$$(".mtab")[0]);
  h.click(h.$$(".mtab")[2]);
  assert.match(on("data-lgc").innerHTML, /^low 1/);
  assert.deepEqual(h.$$(".lgrow").filter(r => r.getAttribute("data-dl")).map(r => r.getAttribute("data-dl")), ["DL-002"]);
});

test("the ledger pills row every kind the record holds, so no segment lands on an empty pill", async () => {
  const log = [
    "# Audit Log — CC3 gamma", "", "## Decision Log", "",
    "### [DL-001] Parked", "- **Decision:** a", "- **Confidence:** CERTAIN", "- **Status:** PARKED", "",
    "### [DL-002] Unjudged", "- **Decision:** b", "- **Confidence:** LOW", "- **Status:** UNKNOWN", ""
  ].join("\n");
  const h = bootShell({stored: "dark", fetch: corpusFetch(
    {root: "demo", files: ["20260103-CC3-gamma/audit-log.md"]},
    {"20260103-CC3-gamma/audit-log.md": log})});
  await h.settle();
  calTab(h);
  h.click(h.$$(".calseg").find(s => s.getAttribute("data-calc") === "other"));
  const pills = h.$$(".fpill").map(p => p.innerHTML);
  assert.ok(pills.includes("other 1") && pills.includes("unknown 1"));
  assert.deepEqual(h.$$(".lgrow").filter(r => r.getAttribute("data-dl")).map(r => r.getAttribute("data-dl")), ["DL-001"]);
});

test("a poll rebuild hands focus to the rebuilt segment", async () => {
  const texts = Object.assign({}, TEXTS_WB);
  const h = bootShell({stored: "dark", fetch: corpusFetch(LISTING_WB, texts)});
  await h.settle();
  calTab(h);
  const seg = () => h.$$(".calseg").find(s => s.getAttribute("data-calc") === "low");
  seg().focus();
  const before = seg();
  // A changed corpus on the poll tick rebuilds the screen under the reader.
  texts["20260102-BB2-beta/audit-log.md"] = LOG_B + "\n## Amendment Notes\n\nlate news.\n";
  h.tick();
  await h.settle();
  assert.notEqual(seg(), before);
  assert.equal(h.document.activeElement, seg());
});

// ---- the page: new task ----

const PL = require("../adp-prompt-lib.js");
const GOLDEN = fs.readFileSync(path.join(__dirname, "fixtures", "builder-example.yaml"), "utf8");
const newTab = h => h.click(h.$("#newTaskBtn"));
const ntOp = (h, op) => h.click(h.$$(".op").find(o => o.getAttribute("data-op") === op));
const field = (h, nf) => h.$$(".nt-in").find(el => el.getAttribute("data-nf") === nf);
const nfSet = (h, nf, v) => h.input(field(h, nf), v);
// A failed import leaves the drawer open, so the helper opens it only when it
// is closed; a form in progress asks before it is replaced, and the helper
// answers yes.
const pasteIn = (h, text) => {
  if (!h.$("#ntPaste")) ntOp(h, "ntpaste");
  h.$("#ntPaste").value = text; h.click(h.$("#ntImport"));
  if (h.$("#ntReplace")) h.click(h.$("#ntReplace"));
};
const preview = h => { if (!h.$("#ntYamlPre")) ntOp(h, "ntyaml"); return h.$("#ntYamlPre").textContent; };
const stamped = d => { d.schema_version = "1.0"; return d; };

test("the new task screen carries the standalone's field set and boots with today's date", async () => {
  const h = bootShell({stored: "dark", hash: "#v=new%20task"});
  await h.settle();
  assert.equal(h.$("#scrNew").classList.contains("is-on"), true);
  assert.equal(h.$("#newTaskBtn").classList.contains("is-on"), true);
  ntOp(h, "ntexample");
  const nfs = h.$$(".nt-in").map(el => el.getAttribute("data-nf")).filter(Boolean);
  for (const k of ["task.id", "task.title", "task.author", "task.date", "preamble", "role.lens",
    "role.priorities.0", "prompt", "constraints.out_of_scope.0", "constraints.must_not.0",
    "context.background", "context.references.0.path", "context.references.0.lines",
    "context.references.0.note", "context.links.0", "lessons_learned.0.context",
    "lessons_learned.0.takeaway", "output.format", "output.destination", "output.structure",
    "requirements.0.id", "requirements.0.statement", "requirements.0.verify",
    "protocol.defers.0.phase", "protocol.defers.0.reason"]) assert.ok(nfs.includes(k), k);
  const sw = h.$$("input").filter(i => /^protocol\.(apply|stake_single_recommendation|log_assumptions|flag_low_confidence)$/.test(i.getAttribute("data-nf") || ""));
  assert.equal(sw.length, 4);
  assert.deepEqual(h.$$("input").map(i => i.getAttribute("data-nart")).filter(Boolean), PL.ARTIFACTS);
  // Every path names a key the lib's document holds.
  const doc = stamped(PL.exampleDocument());
  for (const nf of nfs) {
    const v = nf.split(".").reduce((o, k) => (o == null ? undefined : o[k]), doc);
    assert.notEqual(v, undefined, nf);
  }
  // A fresh boot is blank apart from the date, and the badge counts the blank.
  const h2 = bootShell({stored: "dark"});
  await h2.settle();
  newTab(h2);
  assert.equal(field(h2, "task.date").value, S.localDate());
  assert.equal(field(h2, "task.id").value, "");
  assert.match(h2.$("#ntSide").innerHTML, /7 protocol checks unmet/);
  assert.match(h2.$("#ntSide").innerHTML, /<li>[^<]*<code>task\.id<\/code>/);
  assert.match(h2.$("#ntSide").innerHTML, /— required/);
  assert.match(h2.hashes[h2.hashes.length - 1], /^#v=new%20task/);
});

test("a prompt.yaml the standalone wrote imports and previews byte for byte", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  newTab(h);
  pasteIn(h, GOLDEN);
  assert.match(h.$("#ntOps").innerHTML, /imported the paste — all recognized fields\./);
  assert.equal(field(h, "task.id").value, "GROW-6687-email-validation");
  assert.equal(field(h, "protocol.defers.1.reason").value, "Follow-up obligations ride the GROW-6688 cleanup ticket");
  assert.equal(preview(h), GOLDEN);
  assert.equal(preview(h), PL.buildYaml(stamped(PL.normalize(PL.parseYAML(GOLDEN)))));
  assert.match(h.$("#ntSide").innerHTML, /valid · schema 1\.0/);
  // The example loads to the same bytes from the lib's own copy.
  const h2 = bootShell({stored: "dark"});
  await h2.settle();
  newTab(h2);
  ntOp(h2, "ntexample");
  assert.equal(preview(h2), GOLDEN);
});

test("an import reports the keys it could not place and a failed parse leaves the form alone", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  newTab(h);
  pasteIn(h, GOLDEN + "\nfoo: bar\n");
  assert.match(h.$("#ntOps").innerHTML, /imported the paste with 1 issue: foo/);
  assert.equal(field(h, "task.id").value, "GROW-6687-email-validation");
  // Not YAML: the form keeps the import, the report says so.
  nfSet(h, "task.title", "kept");
  pasteIn(h, ":::\n  - [");
  assert.match(h.$("#ntOps").innerHTML, /couldn&#39;t parse the paste as YAML|couldn't parse the paste as YAML/);
  assert.equal(field(h, "task.title").value, "kept");
  pasteIn(h, "   ");
  assert.match(h.$("#ntOps").innerHTML, /nothing to import/);
  // A foreign version is named before the builder stamps its own.
  pasteIn(h, GOLDEN.replace('schema_version: "1.0"', 'schema_version: "2.0"'));
  assert.match(h.$("#ntOps").innerHTML, /schema_version is "2\.0"/);
  assert.match(preview(h), /^schema_version: "1\.0"/);
});

test("a dropped or opened .yaml lands in the builder and a .md still opens as a document", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  h.fireWindow("drop", {dataTransfer: {files: [{name: "p.yaml", __text: GOLDEN}]}});
  await h.settle();
  assert.equal(h.$("#scrNew").classList.contains("is-on"), true);
  assert.match(h.$("#ntOps").innerHTML, /imported p\.yaml/);
  assert.equal(h.$$(".rentry").length, 0);
  h.fireWindow("drop", {dataTransfer: {files: [{name: "log.md", __text: LOG}]}});
  await h.settle();
  assert.equal(h.$("#scrInspector").classList.contains("is-on"), true);
  assert.equal(h.$$(".rentry").length, 1);
  // The hidden yaml input and the document input route by name too.
  const y = h.$("#openYaml");
  y.files = [{name: "q.yml", __text: GOLDEN.replace("GROW-6687", "GROW-7")}];
  h.change(y);
  await h.settle();
  // The first import left a form in progress, so this one asks first.
  h.click(h.$("#ntReplace"));
  assert.equal(field(h, "task.id").value, "GROW-7-email-validation");
  assert.equal(h.$("#scrNew").classList.contains("is-on"), true);
  assert.equal(y.value, "");
});

test("copy, download, and the directory line carry the export bytes and the convention's name", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  newTab(h);
  const today = S.localDate().replace(/-/g, "");
  assert.equal(h.$("#ntDir").innerHTML, `.adp/${today}-<TASKID>-<slug>/prompt.yaml`);
  nfSet(h, "task.title", "Shared shell chrome, extracted!");
  nfSet(h, "task.id", "AV-016");
  assert.equal(h.$("#ntSlug").value, "");
  assert.equal(h.$("#ntDir").innerHTML, `.adp/${today}-AV016-shared-shell-chrome-extracted/prompt.yaml`);
  h.input(h.$("#ntSlug"), "custom");
  assert.equal(h.$("#ntDir").innerHTML, `.adp/${today}-AV016-custom/prompt.yaml`);
  h.input(h.$("#ntSlug"), "");
  assert.equal(h.$("#ntDir").innerHTML, `.adp/${today}-AV016-shared-shell-chrome-extracted/prompt.yaml`);
  // The slug never reaches the yaml.
  assert.ok(!/slug/.test(preview(h)));
  // Copy writes the preview's bytes and reports, then rests.
  ntOp(h, "ntcopy");
  await h.settle();
  assert.equal(h.clipboard[h.clipboard.length - 1], preview(h));
  assert.match(h.$("#ntSide").innerHTML, /copied/);
  h.runTimeouts();
  assert.match(h.$("#ntSide").innerHTML, /⧉ copy yaml/);
  ntOp(h, "ntdl");
  assert.equal(h.downloads.length, 1);
  assert.equal(h.downloads[0].download, "AV-016.yaml");
  assert.equal(h.blobText(h.downloads[0].href), preview(h));
  // A denied write says so.
  const h2 = bootShell({stored: "dark", clipboardRejects: true});
  await h2.settle();
  newTab(h2);
  ntOp(h2, "ntcopy");
  await h2.settle();
  assert.match(h2.$("#ntSide").innerHTML, /copy failed — select the text/);
  assert.equal(h2.clipboard.length, 0);
});

test("rows add and remove by path, an emptied defers editor drops the key, and chips keep the lib's order", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  newTab(h);
  h.click(h.$$(".nt-add").find(b => b.getAttribute("data-nadd") === "requirements"));
  assert.equal(h.document.activeElement, field(h, "requirements.0.id"));
  nfSet(h, "requirements.0.id", "R1");
  nfSet(h, "requirements.0.statement", "it works");
  nfSet(h, "requirements.0.verify", "run it");
  h.click(h.$$(".nt-add").find(b => b.getAttribute("data-nadd") === "protocol.defers"));
  h.change(field(h, "protocol.defers.0.phase"), "analysis");
  nfSet(h, "protocol.defers.0.reason", "manual pass");
  assert.match(preview(h), /defers:\n    - phase: "analysis"\n      reason: "manual pass"/);
  h.click(h.$$(".nt-del").find(b => b.getAttribute("data-ndel") === "protocol.defers.0"));
  assert.ok(!/defers/.test(preview(h)));
  assert.match(preview(h), /- id: "R1"\n    statement: "it works"\n    verify: "run it"/);
  // Artifacts tick in any order and export in the lib's.
  const chip = a => h.$$("input").find(i => i.getAttribute("data-nart") === a);
  chip("problem_statement").checked = true; h.change(chip("problem_statement"));
  chip("decision_log").checked = false; h.change(chip("decision_log"));
  assert.match(preview(h), /artifacts:\n    - problem_statement\n    - test_adversary\n/);
  const sw = h.$$("input").find(i => i.getAttribute("data-nf") === "protocol.apply");
  sw.checked = false; h.change(sw);
  assert.match(preview(h), /apply: false/);
  h.change(field(h, "output.format"), "patch");
  assert.match(preview(h), /format: "patch"/);
});

test("a draft saves on a pause, flushes on pagehide, restores on the next boot, and clear needs a second click", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  newTab(h);
  nfSet(h, "task.id", "AV-016");
  nfSet(h, "task.title", "A title");
  h.input(h.$("#ntSlug"), "own-slug");
  assert.equal(h.storage.has("adp-mc-draft"), false);
  h.runTimeouts();
  const saved = JSON.parse(h.storage.get("adp-mc-draft"));
  assert.equal(saved.doc.task.id, "AV-016");
  assert.equal(saved.slug, "own-slug");
  nfSet(h, "task.author", "rbeye");
  h.fireWindow("pagehide");
  assert.equal(JSON.parse(h.storage.get("adp-mc-draft")).doc.task.author, "rbeye");
  const h2 = bootShell({stored: "dark", draft: h.storage.get("adp-mc-draft")});
  await h2.settle();
  newTab(h2);
  assert.equal(field(h2, "task.id").value, "AV-016");
  assert.equal(h2.$("#ntSlug").value, "own-slug");
  assert.equal(h2.$("#ntDir").innerHTML, `.adp/${S.localDate().replace(/-/g, "")}-AV016-own-slug/prompt.yaml`);
  // One click arms, the timer disarms; two clicks wipe and drop the key.
  ntOp(h2, "ntclear");
  assert.match(h2.$("#ntOps").innerHTML, /confirm clear/);
  assert.equal(field(h2, "task.id").value, "AV-016");
  h2.runTimeouts();
  assert.ok(!/confirm clear/.test(h2.$("#ntOps").innerHTML));
  ntOp(h2, "ntclear");
  ntOp(h2, "ntclear");
  assert.equal(field(h2, "task.id").value, "");
  assert.equal(field(h2, "task.date").value, S.localDate());
  assert.equal(h2.storage.has("adp-mc-draft"), false);
});

test("a blocked storage and an unreadable draft both boot the blank form", async () => {
  const h = bootShell({stored: "dark", storageThrows: true});
  await h.settle();
  newTab(h);
  assert.equal(field(h, "task.id").value, "");
  nfSet(h, "task.id", "X-1");
  h.runTimeouts();
  // The seam's own no-network trace is the only warning; storage says nothing.
  assert.deepEqual(h.warns.filter(w => !/corpus load failed/.test(w)), []);
  const h2 = bootShell({stored: "dark", draft: "{not json"});
  await h2.settle();
  newTab(h2);
  assert.equal(field(h2, "task.id").value, "");
  assert.equal(h2.storage.has("adp-mc-draft"), false);
  // A draft in an older shape adopts what normalize reads.
  const h3 = bootShell({stored: "dark", draft: JSON.stringify({doc: {task: {id: "OLD-1"}, lessons_learned: [null]}})});
  await h3.settle();
  newTab(h3);
  assert.equal(field(h3, "task.id").value, "OLD-1");
});

test("the builder renders the full form over file:// with no corpus", async () => {
  const h = bootShell({stored: "dark", href: "file:///x/mission-control.html", hash: "#v=new%20task"});
  await h.settle();
  assert.equal(h.$("#scrNew").classList.contains("is-on"), true);
  // The blank form's twelve scalar fields; the lists start empty.
  assert.equal(h.$$(".nt-in").length, 12);
  assert.match(h.$("#ntSide").innerHTML, /7 protocol checks unmet/);
  assert.equal(field(h, "task.date").value, S.localDate());
});

test("a poll re-render never rebuilds the form under a typing reader", async () => {
  const handle = makeHandle("w.md", LOG);
  const h = bootCorpus({picker: async () => [handle]});
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "openwatch"));
  await h.settle();
  newTab(h);
  const title = field(h, "task.title");
  h.input(title, "half a ti");
  title.focus();
  handle._text = LOG + "\n## Amendment Notes\n\nlate news.\n";
  h.tick();
  await h.settle();
  // The watched document did change and the inspector did rebuild.
  assert.match(h.$("#secSel").innerHTML, /Amendment Notes/);
  // The form's input is the same element, with its value and the keyboard.
  assert.equal(field(h, "task.title"), title);
  assert.equal(title.value, "half a ti");
  assert.equal(h.document.activeElement, title);
});

// ---- the page: new task, review round one ----

test("a switch or chip toggles in place and keeps the keyboard", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  newTab(h);
  const sw = h.$$("input").find(i => i.getAttribute("data-nf") === "protocol.apply");
  sw.focus();
  sw.checked = false; h.change(sw);
  assert.equal(h.document.activeElement, sw);
  assert.equal(h.$$("input").find(i => i.getAttribute("data-nf") === "protocol.apply"), sw);
  assert.equal(sw.parent.classList.contains("is-on"), false);
  assert.match(preview(h), /apply: false/);
  const chip = h.$$("input").find(i => i.getAttribute("data-nart") === "premortem");
  chip.focus();
  chip.checked = true; h.change(chip);
  assert.equal(h.document.activeElement, chip);
  assert.equal(chip.parent.classList.contains("is-on"), true);
  assert.match(preview(h), /- premortem\n/);
});

test("a select drops its placeholder color on a pick and takes it back on a clear", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  newTab(h);
  const fmt = field(h, "output.format");
  assert.equal(fmt.classList.contains("is-unset"), true);
  h.change(fmt, "patch");
  assert.equal(fmt.classList.contains("is-unset"), false);
  h.change(fmt, "");
  assert.equal(fmt.classList.contains("is-unset"), true);
});

test("an imported format or phase the form cannot show is cleared and named, so the bytes match the form", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  newTab(h);
  pasteIn(h, GOLDEN.replace('format: "patch"', 'format: "docx"').replace('phase: "communication"', 'phase: "deploy"'));
  const ops = h.$("#ntOps").innerHTML;
  assert.match(ops, /imported the paste with 2 issues/);
  assert.match(ops, /output\.format "docx" is not a format/);
  assert.match(ops, /protocol\.defers\[0\]\.phase "deploy" is not a phase/);
  assert.equal(field(h, "output.format").value, "");
  assert.equal(field(h, "protocol.defers.0.phase").value, "");
  const y = preview(h);
  assert.ok(!/format:/.test(y));
  assert.ok(!/phase: "deploy"/.test(y));
  assert.match(y, /- phase: ""\n/);
  assert.match(h.$("#ntSide").innerHTML, /<code>output\.format<\/code>/);
});

test("a drop or open onto a form in progress waits for a confirmation before it replaces the form and its draft", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  newTab(h);
  nfSet(h, "task.id", "MINE-1");
  h.runTimeouts();
  h.click(h.$$(".mtab")[0]);
  h.fireWindow("drop", {dataTransfer: {files: [{name: "p.yaml", __text: GOLDEN}]}});
  await h.settle();
  // The builder shows, the form and the draft stand, the question is asked.
  assert.equal(h.$("#scrNew").classList.contains("is-on"), true);
  assert.equal(field(h, "task.id").value, "MINE-1");
  assert.equal(JSON.parse(h.storage.get("adp-mc-draft")).doc.task.id, "MINE-1");
  assert.match(h.$("#ntOps").innerHTML, /replace it with p\.yaml/);
  h.click(h.$("#ntKeep"));
  assert.equal(field(h, "task.id").value, "MINE-1");
  assert.ok(!/replace it with/.test(h.$("#ntOps").innerHTML));
  h.fireWindow("drop", {dataTransfer: {files: [{name: "p.yaml", __text: GOLDEN}]}});
  await h.settle();
  h.click(h.$("#ntReplace"));
  assert.equal(field(h, "task.id").value, "GROW-6687-email-validation");
  assert.equal(JSON.parse(h.storage.get("adp-mc-draft")).doc.task.id, "GROW-6687-email-validation");
  // A blank form takes an import at once; so does the example over a blank form.
  const h2 = bootShell({stored: "dark"});
  await h2.settle();
  h2.fireWindow("drop", {dataTransfer: {files: [{name: "p.yaml", __text: GOLDEN}]}});
  await h2.settle();
  assert.equal(field(h2, "task.id").value, "GROW-6687-email-validation");
  // The example over a filled form asks the same question.
  ntOp(h2, "ntexample");
  assert.match(h2.$("#ntOps").innerHTML, /replace it with the example/);
});

// ---- the page: new task, review round two ----

test("the paste drawer keeps its text through a failed parse, a disarmed clear, and a kept form", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  newTab(h);
  ntOp(h, "ntpaste");
  h.input(h.$("#ntPaste"), ":::\n  - [");
  h.click(h.$("#ntImport"));
  assert.match(h.$("#ntOps").innerHTML, /couldn/);
  assert.equal(h.$("#ntPaste").value, ":::\n  - [");
  // The clear arm's timer redraws the ops row around the drawer.
  ntOp(h, "ntclear");
  h.runTimeouts();
  assert.equal(h.$("#ntPaste").value, ":::\n  - [");
  // A kept form redraws it too.
  nfSet(h, "task.id", "MINE-1");
  h.input(h.$("#ntPaste"), GOLDEN);
  h.click(h.$("#ntImport"));
  h.click(h.$("#ntKeep"));
  assert.equal(h.$("#ntPaste").value, GOLDEN);
  // A successful adoption closes the drawer and lets the text go.
  h.click(h.$("#ntImport"));
  h.click(h.$("#ntReplace"));
  assert.equal(h.$("#ntPaste"), null);
  ntOp(h, "ntpaste");
  assert.equal(h.$("#ntPaste").value, "");
});

test("a restored draft of a blank form takes an import at once", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  newTab(h);
  nfSet(h, "task.id", "x");
  nfSet(h, "task.id", "");
  h.runTimeouts();
  const h2 = bootShell({stored: "dark", draft: h.storage.get("adp-mc-draft")});
  await h2.settle();
  newTab(h2);
  ntOp(h2, "ntexample");
  assert.ok(!/replace it with/.test(h2.$("#ntOps").innerHTML));
  assert.equal(field(h2, "task.id").value, "GROW-6687-email-validation");
});

test("the yaml panel sits in the form column under the sticky card and scrolls into view on show", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  newTab(h);
  ntOp(h, "ntexample");
  ntOp(h, "ntyaml");
  // The card sticks over the whole grid. A panel in the form column keeps
  // the card beside the bytes instead of letting it slide over them.
  assert.ok(h.$("#ntYamlPre").closest(".nt-form"));
  assert.equal(h.$("#ntYaml")._scrolled, 1);
  ntOp(h, "ntyaml");
  assert.equal(h.$("#ntYamlPre"), null);
  ntOp(h, "ntyaml");
  assert.equal(h.$("#ntYaml")._scrolled, 1);
});

test("the output path prints once, in the export card, under its own heading", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  newTab(h);
  ntOp(h, "ntexample");
  const dir = h.$("#ntDir").textContent;
  assert.match(dir, /prompt\.yaml$/);
  assert.equal(h.$("#scrNew").innerHTML.split(dir).length - 1, 1);
  assert.match(h.$("#scrNew").innerHTML, /^<h2>new task<\/h2>/);
  // The card and the document block cannot share a heading, or the unmet
  // list's output.format key reads as a line about the card.
  assert.match(h.$("#ntSide").innerHTML, /^<h2>export<\/h2>/);
  nfSet(h, "task.id", "AV-099");
  assert.match(h.$("#ntDir").textContent, /AV099/);
});

// ---- the page: new task, review round four ----

test("a deferral item that is not a mapping is dropped and named on import, and a draft holding one boots the form", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  newTab(h);
  pasteIn(h, GOLDEN.replace("  defers:\n", "  defers:\n    -\n    - communication\n"));
  const ops = h.$("#ntOps").innerHTML;
  assert.match(ops, /imported the paste with 2 issues/);
  assert.match(ops, /protocol\.defers\[0\] is not a map; skipped/);
  assert.match(ops, /protocol\.defers\[1\] is not a map; skipped/);
  assert.equal(h.$("#ntPaste"), null);
  assert.equal(field(h, "protocol.defers.0.phase").value, "communication");
  assert.equal(field(h, "protocol.defers.2.phase"), undefined);
  h.runTimeouts();
  assert.deepEqual(JSON.parse(h.storage.get("adp-mc-draft")).doc.protocol.defers.map(d => d.phase), ["communication", "obligations"]);
  // A draft an earlier page saved with such items boots the form it holds;
  // the boot line sits outside ntRestore's catch, so a throw there is a
  // dead shell until the key is removed by hand.
  const h2 = bootShell({stored: "dark", draft: JSON.stringify({doc: {task: {id: "D-1"},
    protocol: {apply: true, defers: [null, "communication", {phase: "analysis", reason: "r"}]}}})});
  await h2.settle();
  newTab(h2);
  assert.equal(field(h2, "task.id").value, "D-1");
  assert.equal(field(h2, "protocol.defers.0.phase").value, "analysis");
  assert.equal(field(h2, "protocol.defers.1.phase"), undefined);
  assert.ok(h2.intervals.length >= 1);
});

test("a restored draft that differs from the blank only by its date takes an import at once", async () => {
  const h = bootShell({stored: "dark", draft: JSON.stringify({doc: {task: {date: "2020-01-01"}}})});
  await h.settle();
  newTab(h);
  assert.equal(field(h, "task.date").value, "2020-01-01");
  ntOp(h, "ntexample");
  assert.ok(!/replace it with/.test(h.$("#ntOps").innerHTML));
  assert.equal(field(h, "task.id").value, "GROW-6687-email-validation");
  // A field the reader typed beside the date still asks.
  const h2 = bootShell({stored: "dark", draft: JSON.stringify({doc: {task: {date: "2020-01-01", id: "MINE-1"}}})});
  await h2.settle();
  newTab(h2);
  ntOp(h2, "ntexample");
  assert.match(h2.$("#ntOps").innerHTML, /replace it with the example/);
});

test("the directory line collapses only the id's leading letters-digits pair, so the index reads the name back", () => {
  const B = require("../adp-index-builder-lib.js");
  const line = S.promptDir({task: {id: "GROW-6687-email-validation", date: "2026-06-18"}}, "add-server-side-validation");
  assert.equal(line, ".adp/20260618-GROW6687-email-validation-add-server-side-validation/prompt.yaml");
  assert.deepEqual(B.parseDirName(line.split("/")[1]),
    {id: "GROW6687", date: "2026-06-18", slug: "email-validation-add-server-side-validation"});
  assert.equal(S.promptDir({task: {id: "AV-016", date: "2026-09-22"}}, "s"), ".adp/20260922-AV016-s/prompt.yaml");
  assert.equal(S.promptDir({task: {id: "", date: ""}}, ""), ".adp/<yyyymmdd>-<TASKID>-<slug>/prompt.yaml");
});
