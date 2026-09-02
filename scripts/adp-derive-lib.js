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

  /* A closed watch classifies as closed before anything else, so it can
     never read as overdue or unanchored however stale its due date is. The
     due math below applies to live watches only. */
  function dueState(w, today){
    if (w.closed) return "closed";
    if (!w.anchored) return "unanchored";
    const n = daysUntil(w.due, today);
    return n < 0 ? "overdue" : n <= 14 ? "soon" : "upcoming";
  }
  function dueLabel(w, today){
    if (w.closed) return "CLOSED";
    if (!w.anchored) return "UNANCHORED";
    const n = daysUntil(w.due, today);
    return n < 0 ? "OVERDUE " + (-n) + "D" : n + "D LEFT";
  }

  // The index keeps a decision's whole status line verbatim, so the leading
  // token is the classification and parser-lib already owns that rule.
  function statusKind(status){
    return P.dlStatusKind(status);
  }

  // A recorded ledger ruling outranks the card's own status line, because
  // the append-only closure flow settles an entry without editing the card.
  // Every consumer classifies a decision through this one lookup.
  function decisionKind(d){
    return P.dlStatusKind(d.outcome || d.status);
  }

  // The one covering-watch lookup. The watch column, the unwatched-open
  // filter, and any future board read a decision's coverage through it, so
  // they can never disagree about what "covered" means. Coverage means live
  // coverage: a closed watch protects nothing now, so an OPEN decision whose
  // only watch has closed counts as unwatched again.
  function coveringWatch(t, dlId){
    return t.watches.find(w => !w.closed && (w.dl || []).includes(dlId)) || null;
  }

  // The display companion to coveringWatch: the closed watch that stood over
  // a decision, so a settled row can show how its watch ended. This lookup
  // never counts as protection; coverage stays live-only.
  function settledWatch(t, dlId){
    return t.watches.find(w => w.closed && (w.dl || []).includes(dlId)) || null;
  }

  // The canonical section for a phase, or null. Ownership, the default
  // landing key, and watch-link routing all resolve a phase through this one
  // lookup, and first-wins is its single rule.
  function canonicalSection(t, phase){
    return t.sections.find(s => s.canonical && s.phase === phase) || null;
  }

  function unwatchedOpen(t){
    return t.decisions.filter(d => decisionKind(d) === "open" &&
      !coveringWatch(t, d.id));
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
    const un = t.watches.filter(w => !w.anchored && !w.closed).length;
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
    const up = t.watches.filter(w => !w.closed && w.anchored && daysUntil(w.due, today) >= 0)
      .sort((a, b) => daysUntil(a.due, today) - daysUntil(b.due, today));
    const st = t.state.toUpperCase();
    return {reasons: [{txt: up.length ? st + " · WATCH " + up[0].due : st + " · LOOP CLOSED", tone: "ok"}], more: 0};
  }

  /* Which reasons pull a ticket into the needs-attention group. The ribbon
     reports every reason in every state; the group takes only what someone
     can act on now: an overdue watch, an open decision with no covering
     watch, or canonical sections missing from a log that claims to be done.
     Unanchored watches stay ribbon-only — they are the legacy debt the sweep
     tickets pay down, not today's action — and missing sections on a ticket
     still in flight just mean the work is not there yet. */
  function needsAttention(t, today){
    if (t.watches.some(w => dueState(w, today) === "overdue")) return true;
    if (unwatchedOpen(t).length) return true;
    if ((t.state === "shipped" || t.state === "closed") && (t.missing || []).length) return true;
    return false;
  }

  // Needs-attention first, then the live states, then the settled ones.
  // Within a group the newest directory sorts first, because dir names lead
  // with the date under the naming convention.
  const GROUPS = ["needs attention", "in progress", "shipped", "closed"];
  function railGroups(tickets, today){
    const g = {"needs attention": [], "in progress": [], "shipped": [], "closed": []};
    for (const t of tickets){
      if (needsAttention(t, today)) g["needs attention"].push(t);
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
      if (t.decisions.some(d => decisionKind(d) === "invalidated"))
        return {label: "invalidated entries", tone: "bad"};
      if (t.decisions.some(d => decisionKind(d) === "open"))
        return {label: "open items", tone: "warn"};
    }
    if (en.phase === 9){
      if (t.watches.some(w => dueState(w, today) === "overdue"))
        return {label: "overdue watches", tone: "bad"};
      if (t.watches.some(w => !w.anchored && !w.closed))
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
    const owns = ph => !!sec && canonicalSection(t, ph) === sec;
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
    const own = canonicalSection(t, ownerPhase);
    if (own) out.push(own.key);
    for (const key of Object.keys(t.refs || {}))
      if ((t.refs[key] || []).includes(id) && !out.includes(key)) out.push(key);
    return out;
  }

  /* The watchboard: every live watch across every ticket, one row per watch.
     Closed watches never row here — the board is a to-do surface and settled
     debt lives in the ledgers — but we count them, so the board says what it
     left out. The days field carries the default order and the due column's
     sort key in one value: overdue days are negative and sort first, and an
     unanchored watch maps to Infinity, which sinks it below every dated row
     while its label stays UNANCHORED. Ties break by directory then watch id,
     so the order is total and replays the same on every build. */
  function watchboardRows(tickets, today){
    const rows = [];
    let settled = 0;
    for (const t of tickets){
      for (const w of t.watches){
        const state = dueState(w, today);
        if (state === "closed"){ settled++; continue; }
        rows.push({
          tid: t.id || t.dir, dir: t.dir, wid: w.wid, what: w.what,
          due: w.due, anchored: w.anchored, window: w.window,
          state: state, label: dueLabel(w, today),
          days: w.anchored ? daysUntil(w.due, today) : Infinity
        });
      }
    }
    rows.sort((a, b) => a.days - b.days
      || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0)
      || (a.wid < b.wid ? -1 : a.wid > b.wid ? 1 : 0));
    return {rows, settled};
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
    decisionKind, coveringWatch, settledWatch, canonicalSection,
    unwatchedOpen, attentionReasons, needsAttention, ribbonModel, railGroups,
    sectionEntries, sectionState, sectionItems, citingSections,
    watchboardRows, sortRows};
  if (isNode){ module.exports = ADPDeriveLib; }
  else { global.ADPDeriveLib = ADPDeriveLib; }
})(typeof globalThis !== "undefined" ? globalThis : this);
