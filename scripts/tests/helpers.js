/* Shared plumbing for the test suite. Run everything from the repo
   root with one command on stock Node 20 or later:

     node --test scripts/tests/*.test.js

   Note: pass the files, not the directory. Newer Node treats a directory
   argument as a literal module path and fails. We resolve every path from
   this file's own directory, so the tests themselves do not care which
   directory they are launched from. */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const lib = require(path.join(__dirname, "..", "adp-prompt-lib.js"));
const parserLib = require(path.join(__dirname, "..", "adp-parser-lib.js"));

function readFixture(name){
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

// The annotated template lives in references/ and is git-tracked. We read it
// in place instead of keeping a copy, so the suite always tests the file that
// developers actually copy from.
function readReference(name){
  return fs.readFileSync(path.join(__dirname, "..", "..", "references", name), "utf8");
}

// The lib owns the blank document shape and the fill toward it. We re-export
// normalize so the suites keep one import site for it.
const normalize = lib.normalize;

/* We compose the viewer golden the same way render() in ADP-Parser.html
   routes sections, minus the DOM. Each section becomes a marker comment with
   its deduped key, registry tag, and title, followed by the rendered body
   HTML. The golden test and the regeneration one-liner in
   fixtures/viewer-example.js both call this, so the fixture cannot be
   composed two different ways. */
function renderViewerGolden(md){
  const {parseSections, sectionKeys, metaFor, renderMarkdown, renderDecisionLog} = parserLib;
  const {secs} = parseSections(md);
  const keys = sectionKeys(secs);
  return secs.map((sec, i) => {
    const meta = metaFor(sec.title);
    const body = sec.body.join("\n");
    const html = meta.spine ? renderDecisionLog(body) : renderMarkdown(body);
    return "<!-- " + keys[i] + " | " + (meta.tag || "-") + " | " + sec.title + " -->\n" + html;
  }).join("\n\n") + "\n";
}

module.exports = {lib, parserLib, readFixture, readReference, normalize, renderViewerGolden};
