/* One composition for the pack goldens. The fixture corpus builds at a fixed
   generated date and every shipped pack fills for one ticket; the golden is
   those bytes. pack-golden.test.js requires this file so the test and the
   regeneration cannot compose the fill two different ways. Running the file
   directly rewrites every golden:

     node scripts/tests/fixtures/packs/regen.js

   The generated date is 2026-11-20, chosen so the fixture corpus shows every
   due state at once: FX001-1 and FX004-1 overdue, FX002-1 and FX003-3 due
   within 14 days, FX003-2 upcoming, AV090's two watches unanchored, FX003-1
   and FX004-2 closed. The ticket is FX004, the only fixture with the full
   chain, an open decision under live cover, and a closed watch. */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const S = require("../../../adp-shell-lib.js");
const B = require("../../../adp-index-builder-lib.js");

const ROOT = path.join(__dirname, "..", "..", "..", "..");
const CORPUS = path.join(__dirname, "..", "corpus");
const PACKS_DIR = path.join(ROOT, "packs");
const OPTS = {project: "fixture-corpus", generated: "2026-11-20", source: "snapshot"};
const TICKET = "FX004";

// The same walk index-builder.test.js feeds its golden, so the two goldens
// build from one reading of the corpus.
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

function buildFixtureIndex(){
  return B.buildIndex(readCorpus(CORPUS), OPTS);
}

function packFiles(){
  return fs.readdirSync(PACKS_DIR).filter(f => f.endsWith(".pack.md")).sort();
}

// The golden's name pairs the pack with the ticket it filled for.
function goldenPath(file){
  return path.join(__dirname, file.replace(/\.pack\.md$/, "") + "." + TICKET + ".txt");
}

function fillFixturePack(file, index){
  const idx = index || buildFixtureIndex();
  const t = idx.tickets.find(x => x.id === TICKET);
  const tpl = fs.readFileSync(path.join(PACKS_DIR, file), "utf8");
  return S.fillPack(tpl, S.packContext(idx, t, idx.generated));
}

function regenerate(){
  const idx = buildFixtureIndex();
  for (const file of packFiles()){
    fs.writeFileSync(goldenPath(file), fillFixturePack(file, idx), "utf8");
    console.log("wrote " + path.relative(ROOT, goldenPath(file)));
  }
}

module.exports = {ROOT, CORPUS, PACKS_DIR, OPTS, TICKET, readCorpus, buildFixtureIndex,
  packFiles, goldenPath, fillFixturePack};

if (require.main === module) regenerate();
