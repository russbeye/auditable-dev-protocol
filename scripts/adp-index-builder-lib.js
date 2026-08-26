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
     guessed date on a watchboard is worse than a flagged one. */
  function harvestWatches(secs){
    const watches = [];
    const wids = new Set();
    for (const sec of secs){
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
    }
    return watches;
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
      watches = harvestWatches(parsed.secs);

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

  /* files is an array of {path, text} with /-separated paths relative to the
     corpus root. Ticket order and every derived fact come from content, never
     from array position, so any enumeration order of the same corpus yields
     identical bytes. generated and source pass through untouched, because the
     builder never reads a clock and never knows its seam. */
  function buildIndex(files, opts){
    opts = opts || {};
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
    const tickets = Array.from(byDir.keys()).sort().map(dir => buildTicket(dir, byDir.get(dir)));
    return {
      schema: I.SCHEMA,
      project: opts.project === undefined ? null : opts.project,
      generated: opts.generated === undefined ? null : opts.generated,
      source: opts.source === undefined ? null : opts.source,
      tickets: tickets
    };
  }

  const ADPIndexBuilder = {buildIndex, parseDirName, isLogPath};
  if (isNode){ module.exports = ADPIndexBuilder; }
  else { global.ADPIndexBuilder = ADPIndexBuilder; }
})(typeof globalThis !== "undefined" ? globalThis : this);
