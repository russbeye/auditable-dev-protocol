/* adp-index-lib.js — the adp-index/1 contract as code. validateIndex checks an
   index document against the numbered rules in references/adp-index-1.md and
   returns findings that name the violated rule. The vocabularies and key
   orders live here as data so the stage-2 builder and the shell consume one
   source. Exposed as the browser global `ADPIndexLib` via a plain <script>
   tag, or `module.exports` under Node. No dependencies, no build step. */
(function(global){
  "use strict";

  const SCHEMA = "adp-index/1";
  const SOURCES = ["working-tree", "snapshot", "picked"];
  const STATES = ["open", "in-review", "shipped", "closed"];
  const STATE_SOURCES = ["declared", "inferred"];
  const CANONICAL_ARTIFACTS = [
    "Problem Statement",
    "Knowledge Gap",
    "Recommendation Brief",
    "Pre-Mortem Report",
    "Decision Log",
    "Test Adversary",
    "PR Summary",
    "Deployment Risk",
    "Obligation Tickets"
  ];
  /* Known tokens exist for chit rendering only, one form per meaning; MED in
     a legacy log is an unknown token, rendered marked, never normalized.
     IDX-023: an unknown token is data, never a validity error, so
     validateIndex must not consult these. */
  const CONFIDENCE_TOKENS = ["HIGH", "MEDIUM", "LOW"];
  const STATUS_TOKENS = ["OPEN", "VALIDATED", "INVALIDATED", "UNKNOWN"];
  // A closing watch has no OPEN: the ticket either validated, invalidated, or
  // ended with its signal never wired. Same rendering-only role as the two
  // vocabularies above, and IDX-035 keeps it out of validity.
  const OUTCOME_TOKENS = ["VALIDATED", "INVALIDATED", "UNKNOWN"];
  /* One token charset serves the whole closure ledger: the outcome slot and
     both date slots share it, and isDate alone decides which tokens are
     dates. IDX-036 holds harvested outcomes to it, and the builder composes
     its line grammar from it, so the grammar keeps a single owner. */
  const LEDGER_TOKEN = "[A-Za-z0-9-]+";
  const RE_OUTCOME = new RegExp("^" + LEDGER_TOKEN + "$");

  /* The normative key order per object type (IDX-002). Additive fields from
     later revisions join these lists at their specced slot; until specced,
     unknown keys must trail the known ones in ascending order. */
  const KEY_ORDER = {
    top: ["schema", "project", "generated", "source", "tickets"],
    ticket: ["id", "dir", "slug", "date", "title", "state", "state_source", "pr", "merged", "phase", "sections", "refs", "decisions", "watches", "missing"],
    section: ["key", "title", "phase", "canonical"],
    decision: ["id", "title", "confidence", "basis", "status", "created"],
    watch: ["wid", "dl", "what", "due", "anchored", "window"]
  };

  const RE_DL = /^DL-\d+$/;
  const RE_OT = /^OT-[A-Za-z0-9-]+$/;
  const RE_TASK_ID = /^[A-Za-z]+\d+$/;

  function isObj(v){ return v !== null && typeof v === "object" && !Array.isArray(v); }
  function ne(v){ return typeof v === "string" && v.length > 0; }

  /* IDX-004 wants calendar truth without a date library. We rebuild the date
     through Date.UTC and check the components survive the round trip, which
     rejects rollovers like 2026-02-30 and handles leap years for free. */
  function isDate(v){
    if (typeof v !== "string") return false;
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
    const d = new Date(Date.UTC(y, mo - 1, da));
    return d.getUTCFullYear() === y && d.getUTCMonth() === mo - 1 && d.getUTCDate() === da;
  }

  /* A DL-prefixed token with anything but digits in its tail is template
     text (DL-XXX and kin), and IDX-020 owns that finding. We separate the
     placeholder question from the plain grammar question so each bad token
     gets exactly one rule. */
  function isPlaceholder(tok){
    return typeof tok === "string" && /^DL-/.test(tok) && !RE_DL.test(tok);
  }

  function checkKeys(obj, known, path, flag){
    const keys = Object.keys(obj);
    for (const k of known){
      if (!keys.includes(k)) flag("IDX-002", path, "missing key \"" + k + "\"");
    }
    const present = keys.filter(k => known.includes(k));
    const expected = known.filter(k => present.includes(k));
    if (present.join(" ") !== expected.join(" ")){
      flag("IDX-002", path, "known keys out of normative order");
    }
    const unknown = keys.filter(k => !known.includes(k));
    if (unknown.length){
      const firstUnknown = keys.findIndex(k => !known.includes(k));
      const lastKnown = present.length ? keys.lastIndexOf(present[present.length - 1]) : -1;
      if (firstUnknown < lastKnown){
        flag("IDX-002", path, "unknown key \"" + keys[firstUnknown] + "\" before known keys");
      }
      const sorted = unknown.slice().sort();
      if (unknown.join(" ") !== sorted.join(" ")){
        flag("IDX-002", path, "unknown keys not in ascending order");
      }
    }
  }

  function checkToken(tok, path, flag){
    if (isPlaceholder(tok)){
      flag("IDX-020", path, "placeholder token \"" + tok + "\"");
    } else if (!(typeof tok === "string" && (RE_DL.test(tok) || RE_OT.test(tok)))){
      flag("IDX-019", path, "malformed id token " + JSON.stringify(tok));
    }
  }

  function validateSection(s, i, path, seenKeys, flag){
    const p = path + ".sections[" + i + "]";
    if (!isObj(s)){ flag("IDX-014", p, "section is not an object"); return; }
    checkKeys(s, KEY_ORDER.section, p, flag);
    if (!ne(s.key) || /^\d+$/.test(s.key)){
      flag("IDX-015", p + ".key", "section key must be nonempty and not wholly numeric");
    } else if (seenKeys.has(s.key)){
      flag("IDX-015", p + ".key", "duplicate section key \"" + s.key + "\"");
    } else {
      seenKeys.add(s.key);
    }
    if (!ne(s.title)) flag("IDX-016", p + ".title", "section title must be a nonempty string");
    const phaseOk = s.phase === null || (Number.isInteger(s.phase) && s.phase >= 1 && s.phase <= 9);
    if (!phaseOk || typeof s.canonical !== "boolean" || s.canonical !== (s.phase !== null)){
      flag("IDX-017", p, "canonical must be true exactly when phase is 1-9, false when null");
    }
  }

  function validateDecision(d, i, path, seenIds, flag){
    const p = path + ".decisions[" + i + "]";
    if (!isObj(d)){ flag("IDX-021", p, "decision is not an object"); return; }
    checkKeys(d, KEY_ORDER.decision, p, flag);
    if (isPlaceholder(d.id)){
      flag("IDX-020", p + ".id", "placeholder token \"" + d.id + "\"");
    } else if (!(typeof d.id === "string" && RE_DL.test(d.id))){
      flag("IDX-021", p + ".id", "decision id must be DL- followed by digits");
    } else if (seenIds.has(d.id)){
      flag("IDX-021", p + ".id", "duplicate decision id \"" + d.id + "\"");
    } else {
      seenIds.add(d.id);
    }
    if (!ne(d.title) || !ne(d.confidence) || !ne(d.status) ||
        !(d.basis === null || ne(d.basis)) || !(d.created === null || isDate(d.created))){
      flag("IDX-022", p, "decision fields must be nonempty, with basis null-or-nonempty and created null-or-date");
    }
    /* A recorded ruling mirrors a watch closure exactly: the same paired
       additive keys, the same absence-is-fine rule (IDX-037), the same token
       grammar on the outcome (IDX-036). */
    if ("closed" in d || "outcome" in d){
      if (!("closed" in d && "outcome" in d) || !isDate(d.closed) || !ne(d.outcome)){
        flag("IDX-037", p, "closed and outcome appear together, with closed a date and outcome nonempty");
      } else if (!RE_OUTCOME.test(d.outcome)){
        flag("IDX-036", p + ".outcome", "outcome must match the ledger token grammar");
      }
    }
    /* supersedes is additive-optional, so absence is never a finding; when
       the key exists it must carry at least one real decision id. */
    if ("supersedes" in d){
      const ps = p + ".supersedes";
      if (!Array.isArray(d.supersedes) || d.supersedes.length === 0){
        flag("IDX-033", ps, "supersedes must be a nonempty array when present");
      } else {
        d.supersedes.forEach((tok, j) => {
          if (isPlaceholder(tok)){
            flag("IDX-020", ps + "[" + j + "]", "placeholder token \"" + tok + "\"");
          } else if (!(typeof tok === "string" && RE_DL.test(tok))){
            flag("IDX-033", ps + "[" + j + "]", "supersedes entries must be DL- followed by digits");
          }
        });
      }
    }
  }

  function validateWatch(w, i, path, seenWids, flag){
    const p = path + ".watches[" + i + "]";
    if (!isObj(w)){ flag("IDX-024", p, "watch is not an object"); return; }
    checkKeys(w, KEY_ORDER.watch, p, flag);
    if (!ne(w.wid)){
      flag("IDX-024", p + ".wid", "watch id must be nonempty");
    } else if (seenWids.has(w.wid)){
      flag("IDX-024", p + ".wid", "duplicate watch id \"" + w.wid + "\"");
    } else {
      seenWids.add(w.wid);
    }
    if (!ne(w.what)) flag("IDX-024", p + ".what", "watch subject must be nonempty");
    if (!Array.isArray(w.dl)){
      flag("IDX-025", p + ".dl", "dl must be an array");
    } else {
      w.dl.forEach((tok, j) => {
        if (isPlaceholder(tok)){
          flag("IDX-020", p + ".dl[" + j + "]", "placeholder token \"" + tok + "\"");
        } else if (!(typeof tok === "string" && RE_DL.test(tok))){
          flag("IDX-025", p + ".dl[" + j + "]", "dl entries must be DL- followed by digits");
        }
      });
    }
    const dueOk = w.due === null || isDate(w.due);
    if (!dueOk || typeof w.anchored !== "boolean" || w.anchored !== (w.due !== null) ||
        !(w.window === null || ne(w.window))){
      flag("IDX-026", p, "anchored must be true exactly when due holds a date; window is null or nonempty");
    }
    /* closed and outcome are additive-optional and paired, so absence is
       never a finding; a closure record always carries both facts. */
    if ("closed" in w || "outcome" in w){
      if (!("closed" in w && "outcome" in w) || !isDate(w.closed) || !ne(w.outcome)){
        flag("IDX-034", p, "closed and outcome appear together, with closed a date and outcome nonempty");
      } else if (!RE_OUTCOME.test(w.outcome)){
        flag("IDX-036", p + ".outcome", "outcome must match the ledger token grammar");
      }
    }
  }

  function validateRefs(refs, path, sectionKeys, flag){
    if (!isObj(refs)){ flag("IDX-018", path + ".refs", "refs must be an object"); return; }
    for (const key of Object.keys(refs)){
      const p = path + ".refs[" + JSON.stringify(key) + "]";
      if (!sectionKeys.has(key)) flag("IDX-018", p, "refs key names no section of this ticket");
      const val = refs[key];
      if (!Array.isArray(val)){ flag("IDX-019", p, "refs value must be an array"); continue; }
      const seen = new Set();
      val.forEach((tok, j) => {
        checkToken(tok, p + "[" + j + "]", flag);
        if (typeof tok === "string"){
          if (seen.has(tok)) flag("IDX-019", p + "[" + j + "]", "duplicate token \"" + tok + "\"");
          seen.add(tok);
        }
      });
    }
  }

  function validateMissing(missing, path, flag){
    const p = path + ".missing";
    if (!Array.isArray(missing)){ flag("IDX-027", p, "missing must be an array"); return; }
    let last = -1;
    const seen = new Set();
    missing.forEach((name, i) => {
      const idx = CANONICAL_ARTIFACTS.indexOf(name);
      if (idx === -1){
        flag("IDX-027", p + "[" + i + "]", "not a canonical artifact name: " + JSON.stringify(name));
        return;
      }
      if (seen.has(name)) flag("IDX-027", p + "[" + i + "]", "duplicate entry \"" + name + "\"");
      seen.add(name);
      if (idx < last) flag("IDX-027", p + "[" + i + "]", "entries out of canonical order");
      last = idx;
    });
  }

  function validateTicket(t, i, flag){
    const path = "tickets[" + i + "]";
    if (!isObj(t)){ flag("IDX-006", path, "ticket is not an object"); return; }
    checkKeys(t, KEY_ORDER.ticket, path, flag);
    if (!ne(t.dir)) flag("IDX-007", path + ".dir", "dir must be a nonempty string");
    if (!(t.id === null || (typeof t.id === "string" && RE_TASK_ID.test(t.id)))){
      flag("IDX-008", path + ".id", "id must be null or letters followed by digits");
    }
    for (const k of ["slug", "title", "pr"]){
      if (!(t[k] === null || ne(t[k]))) flag("IDX-009", path + "." + k, k + " must be null or a nonempty string");
    }
    for (const k of ["date", "merged"]){
      if (!(t[k] === null || isDate(t[k]))) flag("IDX-010", path + "." + k, k + " must be null or a YYYY-MM-DD date");
    }
    if (!STATES.includes(t.state)) flag("IDX-011", path + ".state", "state must be one of " + STATES.join(", "));
    if (!STATE_SOURCES.includes(t.state_source)) flag("IDX-012", path + ".state_source", "state_source must be declared or inferred");
    if (!(Number.isInteger(t.phase) && t.phase >= 0 && t.phase <= 9)){
      flag("IDX-013", path + ".phase", "phase must be an integer 0-9");
    }
    const sectionKeys = new Set();
    if (!Array.isArray(t.sections)){
      flag("IDX-014", path + ".sections", "sections must be an array");
    } else {
      t.sections.forEach((s, j) => validateSection(s, j, path, sectionKeys, flag));
    }
    validateRefs(t.refs, path, sectionKeys, flag);
    if (!Array.isArray(t.decisions)){
      flag("IDX-021", path + ".decisions", "decisions must be an array");
    } else {
      const ids = new Set();
      t.decisions.forEach((d, j) => validateDecision(d, j, path, ids, flag));
    }
    if (!Array.isArray(t.watches)){
      flag("IDX-024", path + ".watches", "watches must be an array");
    } else {
      const wids = new Set();
      t.watches.forEach((w, j) => validateWatch(w, j, path, wids, flag));
    }
    validateMissing(t.missing, path, flag);
  }

  /* We never throw on bad shapes; every defect becomes a finding. PB-011
     taught us that a validator that crashes on under-shaped input pushes the
     totality problem onto every caller. */
  function validateIndex(doc){
    const out = [];
    const flag = (rule, path, msg) => out.push({rule: rule, path: path, msg: msg});
    if (!isObj(doc)){
      flag("IDX-001", "", "document must be an object");
      return out;
    }
    if (doc.schema !== SCHEMA) flag("IDX-001", "schema", "schema must be exactly \"" + SCHEMA + "\"");
    checkKeys(doc, KEY_ORDER.top, "", flag);
    if (!ne(doc.project)) flag("IDX-003", "project", "project must be a nonempty string");
    if (!isDate(doc.generated)) flag("IDX-004", "generated", "generated must be a YYYY-MM-DD date");
    if (!SOURCES.includes(doc.source)) flag("IDX-005", "source", "source must be one of " + SOURCES.join(", "));
    if (!Array.isArray(doc.tickets)){
      flag("IDX-006", "tickets", "tickets must be an array");
      return out;
    }
    const dirs = new Set();
    let prevDir = null;
    doc.tickets.forEach((t, i) => {
      validateTicket(t, i, flag);
      if (isObj(t) && ne(t.dir)){
        if (dirs.has(t.dir)) flag("IDX-006", "tickets[" + i + "].dir", "duplicate dir \"" + t.dir + "\"");
        dirs.add(t.dir);
        if (prevDir !== null && t.dir < prevDir){
          flag("IDX-006", "tickets[" + i + "]", "tickets not sorted ascending by dir");
        }
        prevDir = t.dir;
      }
    });
    return out;
  }

  /* IDX-028 in one place, so every producer emits identical bytes. */
  function serializeIndex(doc){
    return JSON.stringify(doc, null, 2) + "\n";
  }

  /* The builder shares the date and token grammars through these exports, so
     the contract keeps one owner for what counts as a date, an id, and a
     placeholder. */
  const ADPIndexLib = {SCHEMA, SOURCES, STATES, STATE_SOURCES, CANONICAL_ARTIFACTS, CONFIDENCE_TOKENS, STATUS_TOKENS, OUTCOME_TOKENS, LEDGER_TOKEN, RE_OUTCOME, KEY_ORDER, RE_DL, RE_OT, isDate, isPlaceholder, validateIndex, serializeIndex};
  if (typeof module !== "undefined" && module.exports){ module.exports = ADPIndexLib; }
  else { global.ADPIndexLib = ADPIndexLib; }
})(typeof globalThis !== "undefined" ? globalThis : this);
