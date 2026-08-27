/* adp-derive-lib.js — pure derivations over an adp-index/1 ticket.
   The rail's attention reasons, the ribbon, the rail groups, the section-nav
   model, and the ref scoping all live here as plain functions over (ticket,
   today), with no DOM and no HTML, so Node tests exercise them directly and
   the later screens (watchboard, ledgers, calibration) consume the same
   vocabulary. Every date comparison takes today as an argument, because a
   derivation that reads a clock cannot be replayed. Exposed as the browser
   global `ADPDeriveLib` via a plain <script> tag after adp-index-lib.js, or
   `module.exports` under Node. */
(function(global){
  "use strict";

  const isNode = typeof module !== "undefined" && module.exports;
  const P = isNode ? require("./adp-parser-lib.js") : global.ADPParserLib;
  const I = isNode ? require("./adp-index-lib.js") : global.ADPIndexLib;

  // Date.UTC keeps the day arithmetic calendar-true across DST boundaries,
  // where local-midnight subtraction can land a half-day off.
  function utcOf(iso){
    const p = String(iso).split("-").map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]);
  }
  function daysUntil(due, today){
    return Math.round((utcOf(due) - utcOf(today)) / 86400000);
  }

  function dueState(w, today){
    if (!w.anchored) return "unanchored";
    const n = daysUntil(w.due, today);
    return n < 0 ? "overdue" : n <= 14 ? "soon" : "upcoming";
  }
  function dueLabel(w, today){
    if (!w.anchored) return "UNANCHORED";
    const n = daysUntil(w.due, today);
    return n < 0 ? "OVERDUE " + (-n) + "D" : n + "D LEFT";
  }

  // The index keeps a decision's whole status line verbatim, so the leading
  // token is the classification and parser-lib already owns that rule.
  function statusKind(status){
    return P.dlStatusKind(status);
  }

  function unwatchedOpen(t){
    return t.decisions.filter(d => statusKind(d.status) === "open" &&
      !t.watches.some(w => (w.dl || []).includes(d.id)));
  }

  /* Attention reasons in fixed priority: overdue watches, unanchored watches,
     missing sections, open decisions without a covering watch. One entry per
     kind with a count, so a ticket with many unanchored watches reads as one
     line, not a stack of duplicates. Every lifecycle state raises reasons —
     the rail reports what the corpus records. */
  function attentionReasons(t, today){
    const r = [];
    const overdue = t.watches.filter(w => dueState(w, today) === "overdue");
    if (overdue.length === 1)
      r.push({txt: "WATCH OVERDUE " + (-daysUntil(overdue[0].due, today)) + "D", tone: "bad"});
    else if (overdue.length)
      r.push({txt: overdue.length + " WATCHES OVERDUE", tone: "bad"});
    const un = t.watches.filter(w => !w.anchored).length;
    if (un) r.push({txt: un === 1 ? "WATCH UNANCHORED" : un + " WATCHES UNANCHORED", tone: "warn"});
    const miss = (t.missing || []).length;
    if (miss) r.push({txt: miss + " SECTION" + (miss > 1 ? "S" : "") + " MISSING", tone: "warn"});
    const uw = unwatchedOpen(t).length;
    if (uw) r.push({txt: uw + " DECISION" + (uw > 1 ? "S" : "") + " UNWATCHED", tone: "warn"});
    return r;
  }

  // The ribbon shows the top two reasons plus an overflow count. A quiet
  // ticket gets one state line instead: where it stands and, when shipped or
  // closed, the next watch date the loop is waiting on.
  function ribbonModel(t, today){
    const reasons = attentionReasons(t, today);
    if (reasons.length)
      return {reasons: reasons.slice(0, 2), more: Math.max(0, reasons.length - 2)};
    if (t.state === "open" || t.state === "in-review")
      return {reasons: [{txt: "PHASE " + t.phase + " · " + t.state.toUpperCase(), tone: "warn"}], more: 0};
    const up = t.watches.filter(w => w.anchored && daysUntil(w.due, today) >= 0)
      .sort((a, b) => daysUntil(a.due, today) - daysUntil(b.due, today));
    const st = t.state.toUpperCase();
    return {reasons: [{txt: up.length ? st + " · WATCH " + up[0].due : st + " · LOOP CLOSED", tone: "ok"}], more: 0};
  }

  // Needs-attention first, then the live states, then the settled ones.
  // Within a group the newest directory sorts first, because dir names lead
  // with the date under the naming convention.
  const GROUPS = ["needs attention", "in progress", "shipped", "closed"];
  function railGroups(tickets, today){
    const g = {"needs attention": [], "in progress": [], "shipped": [], "closed": []};
    for (const t of tickets){
      if (attentionReasons(t, today).length) g["needs attention"].push(t);
      else if (t.state === "shipped") g["shipped"].push(t);
      else if (t.state === "closed") g["closed"].push(t);
      else g["in progress"].push(t);
    }
    const byDir = (a, b) => b.dir.localeCompare(a.dir);
    return GROUPS.map(name => [name, g[name].sort(byDir)]);
  }

  /* The nav walks the real sections in audit-log order, then the missing
     canonical artifacts trail the list in phase order. A missing section has
     no position in the document, so it never claims one; real logs interleave
     companion sections too freely for the mockup's slot weave to hold. */
  function sectionEntries(t){
    const entries = t.sections.map(s =>
      ({key: s.key, title: s.title, phase: s.phase, canonical: s.canonical, missing: false}));
    const missing = (t.missing || []).map(label => ({
      key: "missing:" + label, title: label,
      phase: I.CANONICAL_ARTIFACTS.indexOf(label) + 1 || null,
      canonical: true, missing: true
    })).sort((a, b) => (a.phase || 0) - (b.phase || 0));
    return entries.concat(missing);
  }

  function sectionState(t, en, today){
    if (en.missing) return {label: "missing", tone: "mute"};
    if (!en.canonical) return {label: "non-canonical", tone: "warn"};
    if (en.phase === 5){
      if (t.decisions.some(d => statusKind(d.status) === "invalidated"))
        return {label: "invalidated entries", tone: "bad"};
      if (t.decisions.some(d => statusKind(d.status) === "open"))
        return {label: "open items", tone: "warn"};
    }
    if (en.phase === 9){
      if (t.watches.some(w => dueState(w, today) === "overdue"))
        return {label: "overdue watches", tone: "bad"};
      if (t.watches.some(w => !w.anchored))
        return {label: "unanchored watches", tone: "warn"};
    }
    if ((t.state === "open" || t.state === "in-review") && en.phase === t.phase)
      return {label: "current", tone: "accent"};
    return {label: "complete", tone: "ok"};
  }

  /* What a section cites. The canonical Decision Log section implicitly owns
     every decision and the canonical Obligation section every watch; any
     other section shows exactly what its body cites by id token. */
  function sectionItems(t, key){
    const sec = t.sections.find(s => s.key === key);
    const owns = ph => !!sec && sec.canonical && sec.phase === ph;
    const ref = (t.refs || {})[key] || [];
    return {
      decisions: owns(5) ? t.decisions : t.decisions.filter(d => ref.includes(d.id)),
      watches: owns(9) ? t.watches : t.watches.filter(w => ref.includes(w.wid))
    };
  }

  // Every section whose body cites the id, owner section first. The backlink
  // chips on a table row come straight from this list.
  function citingSections(t, id){
    const ownerPhase = I.RE_DL.test(id) ? 5 : 9;
    const out = [];
    const own = t.sections.find(s => s.canonical && s.phase === ownerPhase);
    if (own) out.push(own.key);
    for (const key of Object.keys(t.refs || {}))
      if ((t.refs[key] || []).includes(id) && !out.includes(key)) out.push(key);
    return out;
  }

  // One sorter serves every table: accessors map a column key to a value and
  // d flips the direction. Rows never mutate; presentation order is ours.
  function sortRows(rows, k, d, acc){
    const f = acc[k];
    if (!f) return rows.slice();
    return rows.slice().sort((a, b) => {
      const x = f(a), y = f(b);
      return (x < y ? -1 : x > y ? 1 : 0) * d;
    });
  }

  const ADPDeriveLib = {GROUPS, daysUntil, dueState, dueLabel, statusKind,
    unwatchedOpen, attentionReasons, ribbonModel, railGroups, sectionEntries,
    sectionState, sectionItems, citingSections, sortRows};
  if (isNode){ module.exports = ADPDeriveLib; }
  else { global.ADPDeriveLib = ADPDeriveLib; }
})(typeof globalThis !== "undefined" ? globalThis : this);
