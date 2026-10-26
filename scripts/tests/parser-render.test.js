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
const {esc, escAttr, inline, decorate, parseSections, sectionKeys, slug, metaFor, ART, SECTION_KINDS,
       renderMarkdown, dlChipSplit, dlConfKind, dlConfPill, dlStatusPill, dlRail, renderDLCard,
       renderDecisionLog, dlStatusKind, parseDLEntries, dlEntryStatus, dlStatusCounts} = parserLib;

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
  assert.deepEqual(metaFor("Anything Else"), {icon: "§", tag: "", kind: "ad-hoc"});
});

// ---- section vocabulary ----

test("every registry row carries a kind, and only artifact rows carry a phase tag", () => {
  assert.equal(SECTION_KINDS[0], "artifact");
  assert.equal(SECTION_KINDS[SECTION_KINDS.length - 1], "ad-hoc");
  for (const row of ART){
    assert.ok(SECTION_KINDS.includes(row.kind), row.re.source);
    assert.equal(row.tag !== "", row.kind === "artifact", row.re.source);
  }
});

test("canonical headings keep their tags in every form the record writes them", () => {
  const keep = {
    "Problem Statement": "P1", "Knowledge Gap Document": "P2",
    "Open Questions (resolve before Phase 3)": "P2", "Recommendation Brief": "P3",
    "Pre-Mortem Report": "P4", "Implementation Authorization": "P4",
    "Decision Log": "P5", "Test Adversary Document": "P6", "Test Coverage Gaps": "P6",
    "PR Summary": "P7", "🚩 Mandatory Review Items (LOW-confidence decisions)": "P7",
    "Residual Risk": "P7", "Deployment Risk Statement": "P8", "Obligation Ticket List": "P9",
    "Decision Log — Stage 2": "P5", "Obligation Ticket List — amendment (2026-08-13)": "P9",
    "Knowledge Gap Document — Stage 3": "P2", "Phase 7: Synthesis": "P7", "Phase 1: Observation": "P1"
  };
  for (const [title, tag] of Object.entries(keep)){
    assert.equal(metaFor(title).tag, tag, title);
    assert.equal(metaFor(title).kind, "artifact", title);
  }
});

test("companion headings resolve to their kind with no phase tag, and near misses stay ad hoc", () => {
  const kinds = {
    "Sweep amendment — 2026-09-01": "amendment", "Post-run amendment (2026-07-31)": "amendment",
    "Review Response — PR #7 (2026-08-24)": "review", "Review finding — PR #7, in-review": "review",
    "Review findings — PR #7, seventh through ninth": "review", "Review addendum — 2026-08-18": "review",
    "Run status": "status", "Run status — round 2": "status", "Stage 2 — index builder (run start 2026-08-24)": "status",
    "Requirement coverage": "evidence", "Verification record (2026-09-01)": "evidence",
    "Differential corpus render (Phase 6 falsification run)": "evidence",
    "Browser acceptance — PR #7 (2026-09-04)": "evidence", "Files changed": "evidence",
    "Ledger — round 2 closures": "ledger", "Post-merge note — PR #7 merged (2026-09-04)": "ledger",
    "Ticket Dispositions (2026-08-20, post-review)": "ledger", "Post-run resolutions (2026-08-04)": "ledger",
    "Closure": "ledger",
    "Notes on review": "ad-hoc", "Status of the migration": "ad-hoc", "Ruling on the fifth finding": "ad-hoc",
    "Compatibility statement": "ad-hoc", "Stages of grief": "ad-hoc"
  };
  for (const [title, kind] of Object.entries(kinds)){
    assert.equal(metaFor(title).kind, kind, title);
    assert.equal(metaFor(title).tag, "", title);
  }
});

test("SKILL.md's section vocabulary names every kind the registry knows", () => {
  const skill = fs.readFileSync(path.join(__dirname, "..", "..", "SKILL.md"), "utf8");
  const at = skill.indexOf("### Section vocabulary");
  assert.ok(at > -1, "SKILL.md lacks the Section vocabulary subsection");
  const sub = skill.slice(at, skill.indexOf("**Persist everything", at));
  for (const kind of SECTION_KINDS) assert.ok(sub.includes("| `" + kind + "` |"), kind);
});

// ---- link scheme allowlist (pinned here post-extraction) ----

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

// We read the href the way a browser does. The attribute's entities decode
// once, and the URL parser drops tabs and newlines and trims leading controls.
// Percent escapes never decode inside a scheme, so we leave them alone.
function browserHref(html){
  const m = /<a href="([^"]*)"/.exec(html);
  if (!m) return null;
  return m[1]
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);?/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|quot|lt|gt|colon|Tab|NewLine);/g, (_, n) =>
      ({amp: "&", quot: '"', lt: "<", gt: ">", colon: ":", Tab: "\t", NewLine: "\n"})[n])
    .replace(/[\t\n\r]/g, "").replace(/^[\u0000-\u0020]+/, "");
}

test("percent-encoded and entity-encoded scheme spellings stay inert", () => {
  for (const url of ["javascript%3Aalert(1)", "java%73cript:alert(1)", "%6Aavascript:alert(1)",
                     "jav&#97;script:alert(1)", "&#106;avascript:alert(1)", "jav&#x61;script:alert(1)",
                     "javascript&#58;alert(1)", "javascript&#x3A;alert(1)", "javascript&colon;alert(1)",
                     "java&Tab;script:alert(1)", "data&#58;text/html,x"]) {
    const href = browserHref(inline("[x](" + url + ")"));
    if (href === null) continue;
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
    assert.ok(!scheme || ["http", "https", "mailto"].includes(scheme[1].toLowerCase()),
      url + " must not reach the browser as " + href);
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

test("UNKNOWN, UNOBSERVABLE, and PENDING pill free-standing, never inside words", () => {
  assert.equal(decorate("UNKNOWN"), '<span class="pill p-unk">UNKNOWN</span>');
  assert.equal(decorate("UNOBSERVABLE"), '<span class="pill p-unk">UNOBSERVABLE</span>');
  assert.equal(decorate("PENDING"), '<span class="pill p-open">PENDING</span>');
  // Inside a larger word nothing pills. The leading guard stops APPENDING,
  // and the trailing boundary stops UNKNOWNS and UNOBSERVABLES.
  for (const w of ["APPENDING", "UNKNOWNS", "UNOBSERVABLES"]) {
    assert.equal(decorate(w), w);
  }
});

test("MED pills like MEDIUM, and neither leaks into longer words", () => {
  assert.equal(decorate("MED"), '<span class="pill p-med">MED</span>');
  assert.equal(decorate("MEDIUM"), '<span class="pill p-med">MEDIUM</span>');
  assert.equal(decorate("MEDIC"), "MEDIC");
});

test("a slash-joined keyword pair pills both words", () => {
  assert.equal(decorate("VALIDATED/INVALIDATED"),
    '<span class="pill p-ok">VALIDATED</span>/<span class="pill p-bad">INVALIDATED</span>');
});

test("a keyword inside a link href leaves the anchor untouched", () => {
  const a = '<a href="https://example.com/HIGH" target="_blank" rel="noopener noreferrer">go</a>';
  assert.equal(decorate(inline("[go](https://example.com/HIGH)")), a);
});

test("after a tag and inside double quotes a keyword stays plain", () => {
  assert.equal(decorate("<strong>HIGH</strong>"), "<strong>HIGH</strong>");
  assert.equal(decorate('"HIGH"'), '"HIGH"');
});

test("a MED table cell gets the whole-cell pill", () => {
  const html = renderMarkdown("| P |\n|---|\n| MED |");
  assert.ok(html.includes('<td><span class="pill p-med">MED</span></td>'));
});

// ---- table cell splitting ----

test("a pipe inside a code span is cell content, not a boundary", () => {
  const html = renderMarkdown("| A | B | C |\n|---|---|---|\n| `a || b` | x | y |");
  assert.equal((html.match(/<td>/g) || []).length, 3);
  assert.ok(html.includes("<code>a || b</code>"));
});

test("the header row gets the same span-aware split as the body", () => {
  const html = renderMarkdown("| `x || y` | B |\n|---|---|\n| a | b |");
  assert.equal((html.match(/<th>/g) || []).length, 2);
  assert.ok(html.includes("<code>x || y</code>"));
});

test("a lone unpaired backtick pairs with nothing, so its pipe still splits", () => {
  const html = renderMarkdown("| H1 | H2 |\n|----|----|\n| a `b | c |");
  assert.ok(html.includes("<td>a `b</td><td>c</td>"));
});

test("adjacent double backticks hold no content, so they do not protect a pipe", () => {
  const html = renderMarkdown("| H1 | H2 |\n|----|----|\n| a `` b | c |");
  assert.ok(html.includes("<td>a `` b</td><td>c</td>"));
});

test("a knowledge-gap row with pipes in a span renders as the three authored cells", () => {
  const row = "| The noise guard (`slackCheckRequirements.ts:250-262`): a thread reply " +
    "passes when `mentioned`, or `engaged && (fromRequester || approves)`. The " +
    "`fromRequester` arm admits any text, including filler. | — | — |";
  const html = renderMarkdown(
    "| Known | Inferred (flagged) | Cannot Determine |\n" +
    "|-------|--------------------|------------------|\n" + row);
  assert.equal((html.match(/<td>/g) || []).length, 3);
  // We assert on the span's tail, past the ampersands. How inline() escapes
  // the & is its own concern, and this test only owns the cell boundaries.
  assert.ok(html.includes("(fromRequester || approves)</code>"));
  assert.equal((html.match(/<td>—<\/td>/g) || []).length, 2);
  // The old naive split severed the spans and the halves re-paired across
  // fragments, which rendered stray prose as code.
  assert.ok(!html.includes("<code>. The</code>"));
});

test("a literal NUL inside a table code span survives the split byte-for-byte", () => {
  const html = renderMarkdown("| A | B |\n|---|---|\n| `\u0000` | x |");
  assert.equal((html.match(/<td>/g) || []).length, 2);
  assert.ok(html.includes("<code>\u0000</code>"));
});

test("the control-byte fixture renders with the byte intact, and the escaped form renders as six characters", () => {
  const raw = fs.readFileSync(path.join(__dirname, "fixtures", "corpus", "misc-notes", "audit-log.md"), "utf8");
  const {secs} = parseSections(raw);
  assert.equal(secs.length, 1);
  assert.ok(renderMarkdown(secs[0].body.join("\n")).includes("<code>a\u0000b</code>"));
  assert.ok(renderMarkdown("`\\u0000`").includes("<code>\\u0000</code>"));
});

// ---- list grouping (loose lists stay one list) ----

test("a loose ordered list renders as one ol, so markers count 1..N", () => {
  const html = renderMarkdown("1. a\n\n2. b\n\n3. c");
  assert.equal((html.match(/<ol/g) || []).length, 1);
  assert.equal((html.match(/<li>/g) || []).length, 3);
});

test("an all-1 loose ordered list is one ol with no counter override", () => {
  const html = renderMarkdown("1. a\n\n1. b\n\n1. c");
  assert.equal((html.match(/<ol/g) || []).length, 1);
  assert.equal((html.match(/<li>/g) || []).length, 3);
  assert.ok(!html.includes("counter-reset"));
});

test("a loose bulleted list renders as one ul", () => {
  const html = renderMarkdown("- a\n\n- b");
  assert.equal((html.match(/<ul/g) || []).length, 1);
  assert.equal((html.match(/<li>/g) || []).length, 2);
});

test("a blank line before prose still ends the list", () => {
  const html = renderMarkdown("1. a\n\nprose");
  assert.equal((html.match(/<ol/g) || []).length, 1);
  assert.ok(html.includes("<p>prose</p>"));
});

test("a blank line before an item of the other kind starts a new list", () => {
  const html = renderMarkdown("1. a\n\n- b");
  assert.equal((html.match(/<ol/g) || []).length, 1);
  assert.equal((html.match(/<ul/g) || []).length, 1);
});

test("an ordered list opening past 1 carries its start into the counter", () => {
  const html = renderMarkdown("5. c\n6. d");
  assert.ok(html.includes('<ol class="md-list" style="counter-reset:li 4">'));
});

test("a continuation line still joins its item across the loose gap", () => {
  const html = renderMarkdown("1. a\n   more a\n\n2. b");
  assert.equal((html.match(/<ol/g) || []).length, 1);
  assert.ok(html.includes("<li>a more a</li>"));
});

test("a loose checkbox list keeps per-item task markup in one list", () => {
  const html = renderMarkdown("- [x] done\n\n- [ ] open");
  assert.equal((html.match(/<ul/g) || []).length, 1);
  assert.equal((html.match(/class="task"/g) || []).length, 2);
});

test("a tight mixed-kind run splits into two lists, as pinned", () => {
  // CommonMark starts a new list when the marker kind changes, with or
  // without a blank line between the items.
  const html = renderMarkdown("- a\n1. b");
  assert.equal((html.match(/<ul/g) || []).length, 1);
  assert.equal((html.match(/<ol/g) || []).length, 1);
  assert.equal(html, '<ul class="md-list"><li>a</li></ul><ol class="md-list"><li>b</li></ol>');
  assert.equal(renderMarkdown("1. a\n- b"), '<ol class="md-list"><li>a</li></ol><ul class="md-list"><li>b</li></ul>');
});

// ---- CommonMark adherence: the rules we adopt ----

test("a bullet-character change starts a new list, tight or loose", () => {
  assert.equal((renderMarkdown("- a\n* b").match(/<ul/g) || []).length, 2);
  assert.equal((renderMarkdown("- a\n\n+ b").match(/<ul/g) || []).length, 2);
  assert.equal((renderMarkdown("* a\n* b").match(/<ul/g) || []).length, 1);
});

test("a paren-delimited run renders as an ordered list", () => {
  assert.equal(renderMarkdown("1) a\n2) b"), '<ol class="md-list"><li>a</li><li>b</li></ol>');
  assert.equal(renderMarkdown("3) c\n\n4) d"), '<ol class="md-list" style="counter-reset:li 2"><li>c</li><li>d</li></ol>');
});

test("a delimiter change starts a new list", () => {
  assert.equal(renderMarkdown("1. a\n2) b"), '<ol class="md-list"><li>a</li></ol><ol class="md-list" style="counter-reset:li 1"><li>b</li></ol>');
});

test("a wrapped line starting with a number other than 1 stays in its paragraph", () => {
  assert.equal(renderMarkdown("The index reports\n130. Carrying more"), "<p>The index reports<br>130. Carrying more</p>");
  assert.equal(renderMarkdown("its log, line\n406) and more"), "<p>its log, line<br>406) and more</p>");
});

test("a 1. line still interrupts a paragraph", () => {
  assert.equal(renderMarkdown("Steps:\n1. a"), '<p>Steps:</p><ol class="md-list"><li>a</li></ol>');
  assert.equal(renderMarkdown("Steps:\n1) a"), '<p>Steps:</p><ol class="md-list"><li>a</li></ol>');
  assert.equal(renderMarkdown("Notes:\n- a"), '<p>Notes:</p><ul class="md-list"><li>a</li></ul>');
});

test("a backslash escape renders the punctuation and blocks emphasis", () => {
  assert.equal(inline("\\*not em\\*"), "&#42;not em&#42;");
  assert.equal(inline("x \\| y"), "x | y");
  assert.equal(inline('header \\"Ticket\\"'), 'header "Ticket"');
  assert.equal(inline("\\<b\\> and \\&"), "&lt;b&gt; and &amp;");
  assert.equal(inline("\\\\*a*"), "\\<em>a</em>");
  assert.equal(inline("\\[x](https://e.com)"), "&#91;x](https://e.com)");
  // A backslash before anything that is not ASCII punctuation is plain text.
  assert.equal(inline("C:\\Users and \\d"), "C:\\Users and \\d");
});

test("an escaped character never builds a link the allowlist refuses", () => {
  for (const src of ["[x](javascript\\:alert(1))", "[x](javascript:alert\\(1\\))",
                     "[x\\](javascript:alert(1))"]){
    assert.ok(!inline(src).includes("<a "), src);
  }
  assert.ok(inline("[x](https://e.com/a\\_b)").includes('<a href="https://e.com/a&#95;b"'));
});

test("a link URL is escaped exactly once", () => {
  assert.ok(inline("[q](https://x.y/?a=1&b=2)").includes('<a href="https://x.y/?a=1&amp;b=2"'));
});

test("code-span content is escaped exactly once", () => {
  assert.equal(inline("`a && b`"), "<code>a &amp;&amp; b</code>");
  assert.equal(inline("`<br>` and `x > y`"), "<code>&lt;br&gt;</code> and <code>x &gt; y</code>");
  assert.ok(renderMarkdown("| A |\n|---|\n| `a && b` |").includes("<td><code>a &amp;&amp; b</code></td>"));
  assert.ok(renderDLCard({head: "[DL-001] t", lines: ["- **Decision:** use `a && b`"]}).includes("<code>a &amp;&amp; b</code>"));
});

test("a double-backtick span holds a single backtick and strips its padding", () => {
  assert.equal(inline("`` a`b ``"), "<code>a`b</code>");
  assert.equal(inline("` a `"), "<code>a</code>");
  assert.equal(inline("`  `"), "<code>  </code>");
  assert.equal(inline("`a``b`"), "<code>a``b</code>");
  // Backslash escapes do nothing inside a span.
  assert.equal(inline("`\\*`"), "<code>\\*</code>");
  const html = renderMarkdown("| `` a | b `` | c |\n|---|---|\n| x | y |");
  assert.ok(html.includes("<th><code>a | b</code></th><th>c</th>"));
});

test("a code span and bold pair across a wrapped paragraph line", () => {
  assert.equal(renderMarkdown("A `span\nacross` lines"), "<p>A <code>span across</code> lines</p>");
  assert.equal(renderMarkdown("**bold\nacross**"), "<p><strong>bold<br>across</strong></p>");
  assert.equal(renderMarkdown("an *em\nacross* line"), "<p>an <em>em<br>across</em> line</p>");
  assert.equal(renderMarkdown("HIGH first\nOPEN second"),
    '<p><span class="pill p-high">HIGH</span> first<br><span class="pill p-open">OPEN</span> second</p>');
});

test("an escaped pipe in a table row stays in its cell as a pipe", () => {
  const html = renderMarkdown("| H | I |\n|---|---|\n| one of a \\| b \\| c | z |");
  assert.equal((html.match(/<td>/g) || []).length, 2);
  assert.ok(html.includes("<td>one of a | b | c</td><td>z</td>"));
});

test("an escaped backslash before a pipe leaves the pipe a cell boundary", () => {
  const html = renderMarkdown("| H | I |\n|---|---|\n| a \\\\| b |");
  assert.ok(html.includes("<td>a \\</td><td>b</td>"), html);
  assert.ok(renderMarkdown("| H | I |\n|---|---|\n| a \\\\\\| b | z |").includes("<td>a \\| b</td><td>z</td>"));
});

// ---- CommonMark adherence: the departures we keep ----

test("an escaped pipe inside a table code span stays literal", () => {
  const html = renderMarkdown("| H | I |\n|---|---|\n| GFM `\\|` backslash | z |");
  assert.ok(html.includes("<td>GFM <code>\\|</code> backslash</td><td>z</td>"));
});

test("paragraph lines keep their line breaks", () => {
  assert.equal(renderMarkdown("a\nb"), "<p>a<br>b</p>");
});

test("an unindented line after a list item starts a paragraph", () => {
  assert.equal(renderMarkdown("- [ ] trigger\n**Staged rollout:** NO"),
    '<ul class="md-list"><li class="task"><span class="cbx "></span><span>trigger</span></li></ul><p><strong>Staged rollout:</strong> NO</p>');
});

test("angle-bracket text renders as visible text", () => {
  assert.equal(renderMarkdown("Phase <name> here"), "<p>Phase &lt;name&gt; here</p>");
  assert.equal(renderMarkdown("<b>x</b>"), "<p>&lt;b&gt;x&lt;/b&gt;</p>");
});

test("an inner heading clamps to h3", () => {
  assert.equal(renderMarkdown("# Big"), '<h3 class="sub">Big</h3>');
  assert.equal(renderMarkdown("## Big"), '<h3 class="sub">Big</h3>');
});

test("an indented item renders flat in the same list", () => {
  assert.equal(renderMarkdown("- a\n  - b"), '<ul class="md-list"><li>a</li><li>b</li></ul>');
});

test("constructs the corpus never uses keep their current output", () => {
  const cases = {
    "a &amp; b": "<p>a &amp;amp; b</p>",
    "<https://x.y>": "<p>&lt;https://x.y&gt;</p>",
    "![alt](https://x.y/i.png)": '<p>!<a href="https://x.y/i.png" target="_blank" rel="noopener noreferrer">alt</a></p>',
    "[a][b]\n\n[b]: https://x.y": "<p>[a][b]</p><p>[b]: https://x.y</p>",
    "Title\n===": "<p>Title<br>===</p>",
    "~~~\ncode\n~~~": "<p>~~~<br>code<br>~~~</p>",
    "para\n\n    code": "<p>para</p><p>    code</p>",
    "_em_": "<p>_em_</p>",
    "a  \nb": "<p>a  <br>b</p>",
    "> q\nlazy": "<blockquote><p>q</p></blockquote><p>lazy</p>",
    "| A |\n|:--|\n| x |": '<div class="tbl-wrap"><table class="md-tbl"><thead><tr><th>A</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table></div>',
    "-\ta": '<ul class="md-list"><li>a</li></ul>',
    "~~x~~": "<p>~~x~~</p>",
    // An escaped backtick still opens a span, because spans lift before escapes.
    "\\`a` b": "<p>\\<code>a</code> b</p>",
    "para\n- ": '<p>para</p><ul class="md-list"><li></li></ul>',
    "a\\\nb": "<p>a\\<br>b</p>",
  };
  for (const [src, want] of Object.entries(cases)) assert.equal(renderMarkdown(src), want, JSON.stringify(src));
});

// ---- decision-log cards (the chip rule, pinned here post-extraction) ----

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

// ---- decision-log audit counts ----

test("dlStatusKind classifies by the same prefix match the rail shipped with", () => {
  assert.equal(dlStatusKind("OPEN"), "open");
  assert.equal(dlStatusKind("VALIDATED"), "validated");
  assert.equal(dlStatusKind("INVALIDATED"), "invalidated");
  assert.equal(dlStatusKind("UNKNOWN"), "unknown");
  assert.equal(dlStatusKind("DEFERRED until Q3"), "other");
  // The match accepts a tail, any letter case, and a longer word that opens
  // with a keyword. We pin the quirks as they shipped in dlRail, and UNKNOWN
  // inherits them unchanged.
  assert.equal(dlStatusKind("open — pending review"), "open");
  assert.equal(dlStatusKind("OPENED"), "open");
  assert.equal(dlStatusKind("unknown — never wired"), "unknown");
  assert.equal(dlStatusKind("UNKNOWNS"), "unknown");
  assert.equal(dlStatusKind(""), "other");
  assert.equal(dlStatusKind(undefined), "other");
});

test("dlConfKind returns the closed enum the class column interpolates", () => {
  assert.equal(dlConfKind("HIGH"), "high");
  assert.equal(dlConfKind("MEDIUM"), "medium");
  assert.equal(dlConfKind("LOW"), "low");
  // A tail after the keyword still classifies by prefix, and a value that
  // carries a quote can only ever pick one of the four class names.
  assert.equal(dlConfKind("HIGH (revised)"), "high");
  assert.equal(dlConfKind('HIGH" onmouseover="alert(1)'), "high");
  assert.equal(dlConfKind("UNSURE at best"), "other");
  assert.equal(dlConfKind(""), "other");
  assert.equal(dlConfKind(undefined), "other");
  // The pill reads through the same classifier, so pill tone and column
  // class can never disagree about what a confidence means.
  assert.ok(dlConfPill("med, pending").html.includes("p-med"));
});

test("rail and chip verdicts agree with dlStatusKind on every bucket", () => {
  const rail = {open: "rail-open", validated: "rail-ok", invalidated: "rail-bad", unknown: "rail-unk", other: ""};
  const pill = {open: "p-open", validated: "p-ok", invalidated: "p-bad", unknown: "p-unk", other: "p-low"};
  for (const v of ["OPEN", "VALIDATED", "INVALIDATED", "UNKNOWN", "DEFERRED", "OPENED", "validated: suite green", "UNKNOWN — never emitted"]) {
    const kind = dlStatusKind(v);
    assert.equal(dlRail(v), rail[kind], v);
    assert.ok(dlStatusPill(v).html.includes(pill[kind]), v);
  }
});

test("an UNKNOWN status chips violet with its own rail and demotes only the tail", () => {
  const card = renderDLCard({head: "[DL-10] t", lines: ["- **Status:** UNKNOWN — never emitted"]});
  assert.ok(card.includes("<i>status</i>UNKNOWN</span>"));
  assert.ok(card.includes("p-unk"));
  assert.ok(card.includes("rail-unk"));
  assert.ok(card.includes("never emitted"));
});

test("all four statuses render distinct rails and a nonsense status stays neutral", () => {
  const out = renderDecisionLog([
    "### [A] a", "- **Status:** OPEN",
    "### [B] b", "- **Status:** VALIDATED",
    "### [C] c", "- **Status:** INVALIDATED",
    "### [D] d", "- **Status:** UNKNOWN",
    "### [E] e", "- **Status:** WAT",
  ].join("\n"));
  for (const rail of ["rail-open", "rail-ok", "rail-bad", "rail-unk"]) {
    assert.ok(out.includes(rail), rail);
  }
  // The nonsense card is the one card left with no rail class at all.
  assert.equal((out.match(/class="dl-card "/g) || []).length, 1);
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
    "### [DL-5] e", "- **Status:** UNKNOWN — never emitted",
    "```", "### [DL-99] fenced, not an entry", "```",
  ].join("\n");
  assert.deepEqual(dlStatusCounts(body),
    {open: 1, validated: 1, invalidated: 0, unknown: 1, other: 2, total: 5});
});

test("a repeated Status field counts by the last one, as the card shows", () => {
  const entry = {head: "[DL-5] t", lines: ["- **Status:** OPEN", "- **Status:** VALIDATED"]};
  assert.equal(dlEntryStatus(entry), "VALIDATED");
  assert.ok(renderDLCard(entry).includes("rail-ok"));
});

test("a body without entries counts all zeros", () => {
  assert.deepEqual(dlStatusCounts("just prose\n"),
    {open: 0, validated: 0, invalidated: 0, unknown: 0, other: 0, total: 0});
});

test("the example's decision log counts one each of open, validated, unknown", () => {
  const example = require("./fixtures/viewer-example.js");
  const spine = parseSections(example).secs.find(s => metaFor(s.title).spine);
  assert.deepEqual(dlStatusCounts(spine.body.join("\n")),
    {open: 1, validated: 1, invalidated: 0, unknown: 1, other: 0, total: 3});
});

test("an asterisk beside a space never opens or closes emphasis", () => {
  assert.equal(renderMarkdown("the AV-* and\nPB-* run directories"), "<p>the AV-* and<br>PB-* run directories</p>");
  assert.equal(inline("a * b * c"), "a * b * c");
  assert.equal(inline("an *em* word"), "an <em>em</em> word");
});

test("a bold run needs text against both of its delimiters", () => {
  assert.equal(renderMarkdown("We compute 2 ** 8 here.\nThen 3 ** 2 there."), "<p>We compute 2 ** 8 here.<br>Then 3 ** 2 there.</p>");
  assert.equal(renderMarkdown("Call foo__bar first.\nThen baz__qux."), "<p>Call foo__bar first.<br>Then baz__qux.</p>");
  assert.equal(renderMarkdown("**bold\nacross**"), "<p><strong>bold<br>across</strong></p>");
  assert.equal(inline("__init__ and a**b**c"), "<strong>init</strong> and a<strong>b</strong>c");
});

// ---- cards outside the spine ----

const MIXED = [
  "We changed one thing this round.",
  "",
  "### [DL-007] A poll re-keys the selection",
  "- **Decision:** follow the directory",
  "- **Confidence:** HIGH",
  "- **Status:** VALIDATED",
  "",
  "The suite reads 676 pass."
].join("\n");

test("a card in a companion section renders with the card markup between its prose", () => {
  const html = parserLib.renderSectionBody(MIXED);
  assert.equal((html.match(/class="dl-card /g) || []).length, 1);
  const card = html.indexOf('class="dl-card '), before = html.indexOf("We changed one thing"),
    after = html.indexOf("The suite reads 676 pass.");
  assert.ok(before > -1 && before < card && card < after);
});

test("prose after a card stays outside the card", () => {
  const html = parserLib.renderSectionBody(MIXED);
  const cards = html.slice(html.indexOf('<div class="dl-cards">'), html.indexOf("The suite reads"));
  assert.ok(!cards.includes("676"));
  assert.match(html, /<\/div><\/div><p>The suite reads 676 pass\.<\/p>/);
});

test("HIGH confidence in a companion card shows the confidence pill, not the priority pill", () => {
  const html = parserLib.renderSectionBody(MIXED);
  assert.match(html, /class="pill dl-pill p-ok"><i>conf<\/i>HIGH</);
  assert.ok(!/p-high[^>]*>HIGH</.test(html));
});

test("a companion section with no card renders exactly as markdown", () => {
  for (const body of ["Plain prose.", "### Notes\n- **Decision:** not a card", "```\n### [DL-001] fenced\n```"]){
    assert.equal(parserLib.renderSectionBody(body), renderMarkdown(body));
  }
});

test("a blank line before a field start keeps the field in the card", () => {
  const html = parserLib.renderSectionBody("### [DL-001] t\n- **Decision:** a\n\n- **Status:** OPEN\n\nAfter.");
  assert.equal((html.match(/class="dl-row"/g) || []).length, 1);
  assert.match(html, /<i>status<\/i>OPEN</);
  assert.match(html, /<p>After\.<\/p>$/);
});

test("a bold paragraph or a ledger line after a card's blank line stays outside the card", () => {
  for (const tail of ["**Gate confirmation:** the round closes here.",
    "- **DL-115 CLOSED 2026-09-20 → INVALIDATED.** The signal fired."]){
    const html = parserLib.renderSectionBody("### [DL-001] t\n- **Decision:** a\n- **Status:** OPEN\n\n" + tail);
    const card = html.slice(0, html.indexOf("</div></div>") + 12);
    assert.equal((card.match(/class="dl-row"/g) || []).length, 1, tail);
    assert.ok(html.indexOf(tail.includes("Gate") ? "Gate confirmation" : "DL-115") > card.length, tail);
  }
});
