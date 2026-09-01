/* adp-index-builder-lib.js — the adp-index/1 producer. buildIndex derives an
   index document from (path, text) pairs and nothing else: no filesystem, no
   clock, no git state. Splitting and title matching come from adp-parser-lib,
   grammars and vocabularies from adp-index-lib, so the contract keeps one
   owner per rule. Exposed as the browser global `ADPIndexBuilder` via a plain
   <script> tag after its two dependencies, or `module.exports` under Node.
   No dependencies beyond the two sibling libs, no build step. */
(function(global){
  "use strict";

  const isNode = typeof module !== "undefined" && module.exports;
  const P = isNode ? require("./adp-parser-lib.js") : global.ADPParserLib;
  const I = isNode ? require("./adp-index-lib.js") : global.ADPIndexLib;

  /* Ticket identity comes from the directory name. The new convention splits
     on "-" into date, id, slug. A legacy name gives up its date and collapses
     the id pair, so AV-001 becomes AV001. A name matching neither form keeps
     everything in the slug, and deep links fall back to the dir. */
  function parseDirName(dir){
    let m = dir.match(/^(\d{4})(\d{2})(\d{2})-([A-Za-z]+\d+)-(.+)$/);
    if (m){
      const date = m[1] + "-" + m[2] + "-" + m[3];
      if (I.isDate(date)) return {id: m[4], date: date, slug: m[5]};
    }
    m = dir.match(/^([A-Za-z]+)-(\d+)-(.+)$/);
    if (m) return {id: m[1] + m[2], date: null, slug: m[3]};
    return {id: null, date: null, slug: dir};
  }

  // Citations live in prose and code spans. A fenced block is quoted material,
  // so the harvest scans never see it.
  function withoutFences(text){
    const out = [];
    let fence = false;
    for (const line of String(text).split("\n")){
      if (/^\s*```/.test(line)){ fence = !fence; continue; }
      if (!fence) out.push(line);
    }
    return out.join("\n");
  }

  function firstDate(text){
    const re = /\d{4}-\d{2}-\d{2}/g;
    let m;
    while ((m = re.exec(String(text)))){
      if (I.isDate(m[0])) return m[0];
    }
    return null;
  }

  /* One candidate scan feeds both refs and dl lists. The DL grammar throws
     away placeholder tails like DL-XXX, so template text never becomes a
     citation. First appearance fixes the order. */
  function harvestTokens(text, dlOnly){
    const re = /\b(?:DL|OT)-[A-Za-z0-9-]+/g;
    const out = [];
    const seen = new Set();
    let m;
    while ((m = re.exec(text))){
      const tok = m[0];
      const isDL = tok.slice(0, 3) === "DL-";
      if (isDL ? !I.RE_DL.test(tok) : (dlOnly || !I.RE_OT.test(tok))) continue;
      if (seen.has(tok)) continue;
      seen.add(tok);
      out.push(tok);
    }
    return out;
  }

  // The declared block holds three scalars. A strict line grammar reads them,
  // because a YAML parser would accept shapes the contract never defined.
  function parseFrontScalars(front){
    const out = {};
    for (const line of String(front).split("\n")){
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      const q = v.match(/^"(.*)"$/) || v.match(/^'(.*)'$/);
      if (q) v = q[1];
      out[m[1]] = v;
    }
    return out;
  }

  /* Decisions harvest from every section of the log in document order. The
     first card wins a repeated id, so an amendment that restates a card never
     forks the ledger. A head whose bracket is not a real DL id is template
     text and harvests nothing. */
  function harvestDecisions(secs){
    const decisions = [];
    const ids = new Set();
    for (const sec of secs){
      const body = sec.body.join("\n");
      for (const entry of P.parseDLEntries(body).entries){
        const hm = entry.head.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
        if (!hm) continue;
        const id = hm[1].trim();
        if (!I.RE_DL.test(id) || ids.has(id)) continue;
        ids.add(id);
        let confidence = "", basis = "", status = "", created = "", supersedes = "";
        for (const f of P.parseDLFields(P.dlSplitBody(entry.lines).fieldLines)){
          const k = f.label.toLowerCase();
          if (k === "confidence") confidence = f.value;
          else if (k === "confidence basis") basis = f.value;
          else if (k === "status") status = f.value;
          else if (k === "created") created = f.value;
          else if (k === "supersedes") supersedes = f.value;
        }
        const dec = {
          id: id,
          // A headless card still needs an address in the ledger, so the id
          // stands in when the title text is empty.
          title: hm[2].trim() || id,
          confidence: confidence,
          basis: basis.trim() ? basis.trim() : null,
          status: status,
          created: firstDate(created)
        };
        // supersedes is an additive optional key, so it appears only when the
        // card's field names at least one real decision id.
        const sup = harvestTokens(supersedes, true);
        if (sup.length) dec.supersedes = sup;
        decisions.push(dec);
      }
    }
    return decisions;
  }

  /* Watches harvest from every table whose header opens with "Ticket ID",
     wherever the table sits. Columns resolve by header name, so a foreign
     corpus can reorder them. The due date is the first real calendar date in
     the window text. A window with no date stays unanchored, because a
     guessed date on a watchboard is worse than a flagged one. Alongside the
     rows we report which section holds the first watch table, because that
     section opens the ledger zone. */
  function harvestWatches(secs){
    const watches = [];
    const wids = new Set();
    let from = secs.length;
    secs.forEach((sec, si) => {
      const lines = sec.body;
      let i = 0;
      let fence = false;
      while (i < lines.length){
        if (/^\s*```/.test(lines[i])){ fence = !fence; i++; continue; }
        if (fence || !P.isTableStart(lines, i)){ i++; continue; }
        const rows = [];
        while (i < lines.length && lines[i].indexOf("|") > -1 && !/^\s*$/.test(lines[i])){
          rows.push(lines[i]);
          i++;
        }
        const header = P.splitRow(rows[0]);
        const widCol = header.findIndex(h => /^ticket id$/i.test(h));
        if (widCol === -1) continue;
        if (si < from) from = si;
        const dlCol = header.findIndex(h => /decision log/i.test(h));
        const whatCol = header.findIndex(h => /assumption/i.test(h));
        const winCol = header.findIndex(h => /window/i.test(h));
        for (const r of rows.slice(2)){
          const cells = P.splitRow(r);
          let wid = (cells[widCol] || "").trim();
          const bt = wid.match(/^`(.+)`$/);
          if (bt) wid = bt[1].trim();
          // The templates write — for "no value", so a dash-only id cell is
          // an empty row, not a watch.
          if (!wid || wid === "—" || wids.has(wid)) continue;
          wids.add(wid);
          const rawWin = winCol === -1 ? "" : (cells[winCol] || "").trim();
          const win = rawWin && rawWin !== "—" ? rawWin : null;
          const due = win ? firstDate(win) : null;
          watches.push({
            wid: wid,
            dl: harvestTokens(dlCol === -1 ? "" : (cells[dlCol] || ""), true),
            what: whatCol === -1 ? "" : (cells[whatCol] || "").trim(),
            due: due,
            anchored: due !== null,
            window: win
          });
        }
      }
    });
    return {watches: watches, from: from};
  }

  /* The closure ledger: one line closes or re-anchors an obligation ticket,
     or rules a Decision Log entry. Both value slots share the contract's one
     token charset, and isDate alone decides which tokens are dates, so no
     date can pass in one slot and fail in another. The date after the verb
     is the one thing the corpus's legacy closure prose never wrote, so old
     logs harvest nothing and stay byte-identical. A line missing any part of
     the form is prose. */
  const RE_LEDGER = new RegExp(
    "^\\s*(?:[-*]\\s+)?(?:\\*\\*)?((?:OT|DL)-" + I.LEDGER_TOKEN + ")" +
    "\\s+(CLOSED|RE-ANCHORED)\\s+(" + I.LEDGER_TOKEN + ")\\s+→\\s+(" + I.LEDGER_TOKEN + ")");

  /* First occurrence wins for every record kind, the same resolution every
     repeated id in the contract gets. A wrong ruling is corrected by fixing
     its line in place, never by appending a contradiction. The contract's id
     grammars route each record, so a malformed id harvests nothing. Losing
     second records are collected rather than dropped, so the lint can report
     each contradiction the harvest refuses. Each record kind has its own
     zone start: watch records from the first watch table, rulings from the
     first phase-5 section, because cards exist before any ticket list does. */
  function harvestLedger(secs, watchFrom, rulingFrom){
    const closures = new Map();
    const anchors = new Map();
    const rulings = new Map();
    const contradictions = [];
    secs.forEach((sec, si) => {
      if (si < watchFrom && si < rulingFrom) return;
      for (const line of withoutFences(sec.body.join("\n")).split("\n")){
        const m = line.match(RE_LEDGER);
        if (!m || !I.isDate(m[3])) continue;
        const id = m[1];
        if (I.RE_DL.test(id)){
          if (si < rulingFrom) continue;
          // A decision only closes; a re-anchor has no meaning for a card.
          if (m[2] === "CLOSED"){
            if (!rulings.has(id)) rulings.set(id, {closed: m[3], outcome: m[4]});
            else contradictions.push(id);
          }
        } else if (I.RE_OT.test(id)){
          if (si < watchFrom) continue;
          if (m[2] === "CLOSED"){
            if (!closures.has(id)) closures.set(id, {closed: m[3], outcome: m[4]});
            else contradictions.push(id);
          } else if (I.isDate(m[4])){
            if (!anchors.has(id)) anchors.set(id, m[4]);
            else contradictions.push(id);
          }
        }
      }
    });
    return {closures: closures, anchors: anchors, rulings: rulings, contradictions: contradictions};
  }

  // The section-attribution rule already owns what counts as phase 5, so the
  // ruling zone asks it rather than growing a second matcher.
  function dlSectionIndex(secs){
    return secs.findIndex(sec => P.metaFor(sec.title).tag === "P5");
  }

  // The one place both the build and the lint compute a ticket's ledger, so
  // they can never disagree about what landed.
  function ledgerOf(secs, watchFrom){
    const dl = dlSectionIndex(secs);
    return harvestLedger(secs, watchFrom, dl === -1 ? watchFrom : Math.min(dl, watchFrom));
  }

  /* The nine artifacts map one to one onto phases 1 through 9. A phase counts
     as present only through its artifact row or its "Phase N:" row, so a
     companion heading alone never clears its phase from missing. */
  const ARTIFACT_ROW = I.CANONICAL_ARTIFACTS.map(name => P.metaFor(name));
  const PHASE_ROW = I.CANONICAL_ARTIFACTS.map((name, i) => P.metaFor("Phase " + (i + 1) + ":"));

  function inferState(scanText, present){
    if (/\*\*Decision Log status:\*\*\s*CLOSED/.test(scanText) ||
        /^Decision Log status:\s*CLOSED/m.test(scanText)) return "closed";
    if (present[9]) return "shipped";
    if (present[7]) return "in-review";
    return "open";
  }

  function buildTicket(dir, logText){
    const name = parseDirName(dir);
    let title = null, state = "open", stateSource = "inferred", pr = null, merged = null;
    let phase = 0;
    const sections = [], refs = {}, missing = [];
    let decisions = [], watches = [];
    const present = {};

    if (typeof logText === "string"){
      const fm = P.splitFrontMatter(logText);
      const parsed = P.parseSections(logText);
      const keys = P.sectionKeys(parsed.secs);
      const seenRows = new Set();
      parsed.secs.forEach((sec, i) => {
        const row = P.metaFor(sec.title);
        let secPhase = null;
        // The first section matching a registry row owns it. A repeat of the
        // same row demotes to non-canonical instead of overwriting the first.
        if (row.tag && !seenRows.has(row)){
          seenRows.add(row);
          secPhase = Number(row.tag.slice(1));
          if (row === ARTIFACT_ROW[secPhase - 1] || row === PHASE_ROW[secPhase - 1]){
            present[secPhase] = true;
          }
          if (secPhase > phase) phase = secPhase;
        }
        sections.push({key: keys[i], title: sec.title, phase: secPhase, canonical: secPhase !== null});
        const toks = harvestTokens(withoutFences(sec.body.join("\n")), false);
        if (toks.length) refs[keys[i]] = toks;
      });
      decisions = harvestDecisions(parsed.secs);
      const hw = harvestWatches(parsed.secs);
      watches = hw.watches;
      /* Watch records harvest from the section holding the first watch table
         onward, rulings from the first phase-5 section onward; a record
         above its zone is prose. Records land on their table row or card; a
         record naming an id with no row harvests nothing. The row's own
         window date is the anchor of record, so a re-anchor fills only a
         null due, and a closure record freezes the row, so no anchor applies
         to a closed watch. */
      const ledger = ledgerOf(parsed.secs, hw.from);
      for (const w of watches){
        const c = ledger.closures.get(w.wid);
        const a = ledger.anchors.get(w.wid);
        if (a && !w.anchored && !c){ w.due = a; w.anchored = true; }
        if (c){ w.closed = c.closed; w.outcome = c.outcome; }
      }
      for (const d of decisions){
        const r = ledger.rulings.get(d.id);
        if (r){
          // Unknown keys must serialize in ascending order, so the ruling
          // pair slots in ahead of a supersedes key when the card has one.
          const sup = d.supersedes;
          if (sup !== undefined) delete d.supersedes;
          d.closed = r.closed;
          d.outcome = r.outcome;
          if (sup !== undefined) d.supersedes = sup;
        }
      }

      const scanText = withoutFences(fm.rest);
      const h1 = scanText.match(/^#\s+(.+)$/m);
      if (h1 && h1[1].trim()) title = h1[1].trim();

      if (fm.front !== null){
        const declared = parseFrontScalars(fm.front);
        // A block whose state token is not in the vocabulary falls back to
        // inference, so a typo degrades to a labeled guess instead of an
        // invalid index.
        if (I.STATES.includes(declared.state)){
          state = declared.state;
          stateSource = "declared";
          pr = declared.pr && declared.pr.trim() ? declared.pr.trim() : null;
          merged = declared.merged && I.isDate(declared.merged.trim()) ? declared.merged.trim() : null;
        }
      }
      if (stateSource === "inferred") state = inferState(scanText, present);
    }

    for (let p = 1; p <= 9; p++){
      if (!present[p]) missing.push(I.CANONICAL_ARTIFACTS[p - 1]);
    }

    return {
      id: name.id, dir: dir, slug: name.slug, date: name.date, title: title,
      state: state, state_source: stateSource, pr: pr, merged: merged, phase: phase,
      sections: sections, refs: refs, decisions: decisions, watches: watches, missing: missing
    };
  }

  /* A ticket's text lives in its top-level audit-log.md alone. Every other
     path contributes only its directory name. We export this rule, so a seam
     that fetches text on demand asks us which paths need it instead of
     keeping a copy of the rule that could drift. */
  function isLogPath(p){
    const path = String(p).replace(/^\.\//, "");
    const cut = path.indexOf("/");
    return cut > 0 && path.slice(cut + 1) === "audit-log.md";
  }

  function groupByDir(files){
    const byDir = new Map();
    for (const f of (files || [])){
      if (!f || typeof f.path !== "string") continue;
      const path = f.path.replace(/^\.\//, "");
      const cut = path.indexOf("/");
      // A path with no directory segment is a corpus-root file, not a ticket.
      if (cut <= 0) continue;
      const dir = path.slice(0, cut);
      if (!byDir.has(dir)) byDir.set(dir, null);
      if (isLogPath(path) && typeof f.text === "string"){
        byDir.set(dir, f.text);
      }
    }
    return byDir;
  }

  /* files is an array of {path, text} with /-separated paths relative to the
     corpus root. Ticket order and every derived fact come from content, never
     from array position, so any enumeration order of the same corpus yields
     identical bytes. generated and source pass through untouched, because the
     builder never reads a clock and never knows its seam. */
  function buildIndex(files, opts){
    opts = opts || {};
    const byDir = groupByDir(files);
    const tickets = Array.from(byDir.keys()).sort().map(dir => buildTicket(dir, byDir.get(dir)));
    return {
      schema: I.SCHEMA,
      project: opts.project === undefined ? null : opts.project,
      generated: opts.generated === undefined ? null : opts.generated,
      source: opts.source === undefined ? null : opts.source,
      tickets: tickets
    };
  }

  // The near-miss detector is looser than the record grammar on purpose: a
  // known id followed by a ledger verb, anywhere in a line, reads as closure
  // intent even when the rest of the form is wrong or the line sits outside
  // the ledger zone. The leading group rejects a word character or hyphen
  // before the id, so a prose token like PILOT-1 never reads as OT-1.
  const RE_NEAR = new RegExp("(^|[^A-Za-z0-9-])((?:OT|DL)-" + I.LEDGER_TOKEN + ")\\s+(CLOSED|RE-ANCHORED)\\b", "g");

  /* The advisory channel, separate from buildIndex so the index stays a pure
     contract artifact. Advisories are the silent failures the harvest hides
     by design: a landed record naming no row or card (phantom), a losing
     second record (contradiction), a landed anchor record that cannot
     honestly move its watch (dead-anchor), closure intent that never landed
     (near-miss), and a watch id the ledger grammar can never address
     (wid-shape). Findings are {dir, id, finding}, kinds in that order per
     sorted ticket, one near-miss per id. */
  function lintCorpus(files){
    const findings = [];
    const byDir = groupByDir(files);
    for (const dir of Array.from(byDir.keys()).sort()){
      const text = byDir.get(dir);
      if (typeof text !== "string") continue;
      const secs = P.parseSections(text).secs;
      const hw = harvestWatches(secs);
      const wids = new Set(hw.watches.map(w => w.wid));
      const ids = new Set(harvestDecisions(secs).map(d => d.id));
      const led = ledgerOf(secs, hw.from);
      const add = (id, finding) => findings.push({dir: dir, id: id, finding: finding});
      for (const id of new Set([...led.closures.keys(), ...led.anchors.keys()])){
        if (!wids.has(id)) add(id, "phantom");
      }
      for (const id of led.rulings.keys()){
        if (!ids.has(id)) add(id, "phantom");
      }
      for (const id of new Set(led.contradictions)) add(id, "contradiction");
      const anchored = new Set(hw.watches.filter(w => w.anchored).map(w => w.wid));
      /* An anchor record aimed at a watch the row already anchors, or that
         also holds a closure record, cannot honestly move anything. The
         author sees that here instead of silence. */
      for (const id of led.anchors.keys()){
        if (wids.has(id) && (anchored.has(id) || led.closures.has(id))) add(id, "dead-anchor");
      }
      /* A landed record makes its id's near-misses moot, so a swept corpus
         lints clean while the old prose stays in place, append-only. */
      const near = new Set();
      for (const sec of secs){
        for (const line of withoutFences(sec.body.join("\n")).split("\n")){
          for (const m of line.matchAll(RE_NEAR)){
            const id = m[2];
            if (near.has(id)) continue;
            let miss = false;
            if (wids.has(id)){
              miss = m[3] === "CLOSED" ? !led.closures.has(id)
                : !(anchored.has(id) || led.anchors.has(id));
            } else if (ids.has(id)){
              miss = m[3] !== "CLOSED" || !led.rulings.has(id);
            }
            if (miss){ near.add(id); add(id, "near-miss"); }
          }
        }
      }
      for (const w of hw.watches){
        if (!I.RE_OT.test(w.wid)) add(w.wid, "wid-shape");
      }
    }
    return findings;
  }

  const ADPIndexBuilder = {buildIndex, lintCorpus, parseDirName, isLogPath};
  if (isNode){ module.exports = ADPIndexBuilder; }
  else { global.ADPIndexBuilder = ADPIndexBuilder; }
})(typeof globalThis !== "undefined" ? globalThis : this);
