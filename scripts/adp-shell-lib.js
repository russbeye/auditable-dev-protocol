/* adp-shell-lib.js — shared chrome logic for the mission-control shell.
   Screen tabs, theme, status text, and the corpus seam live here, so the page
   IIFE stays thin glue and the harness drives the same code the browser runs.
   Effects are injected: loadCorpus takes a fetch function and applyTheme takes
   the document and storage, so Node tests pass stubs instead of faking
   globals. Exposed as the browser global `ADPShellLib` via a plain <script>
   tag after adp-index-builder-lib.js, or `module.exports` under Node. */
(function(global){
  "use strict";

  const isNode = typeof module !== "undefined" && module.exports;
  const B = isNode ? require("./adp-index-builder-lib.js") : global.ADPIndexBuilder;

  /* The six screens are the accepted product enumeration from the mockup.
     The first five render as tabs. "new task" lights the accent button
     instead, so it never sits in the tab strip. */
  const SCREENS = ["inspector", "watchboard", "ledgers", "calibration", "resume pack", "new task"];
  const TAB_SCREENS = SCREENS.slice(0, 5);

  // IDX-004 wants a calendar-true YYYY-MM-DD. We compose it from local date
  // parts, because a UTC composition would date a late-evening build tomorrow.
  function localDate(now){
    const d = now || new Date();
    const pad = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function tabsHtml(selScreen){
    return TAB_SCREENS.map(s => {
      const on = s === selScreen;
      return `<button class="mtab${on ? " is-on" : ""}" role="tab" aria-selected="${on}" data-s="${s}">${s}</button>`;
    }).join("");
  }

  function footerText(index){
    if (!index) return "no corpus · serve the working tree with adp-serve.py to build the index in-memory";
    return `schema ${index.schema} · ${index.tickets.length} tickets · read-only · rebuilt in-memory from the working tree`;
  }

  // An index can build from a listing whose root never named the project. The
  // chit then shows a placeholder, so "no corpus" stays true to its words.
  function projectChitText(index){
    if (!index) return "no corpus";
    return index.project ? "project: " + index.project : "project: —";
  }

  function applyTheme(doc, storage, t){
    doc.documentElement.setAttribute("data-theme", t);
    const icon = doc.getElementById("ttIcon");
    if (icon) icon.textContent = t === "dark" ? "☾" : "☀";
    try{ storage.setItem("adp-theme", t); }catch(e){}
  }

  // The builder owns the rule for which paths carry text it reads. We ask it
  // here, so the seam fetches exactly those files and the two never drift.
  function logPaths(files){
    return (files || []).filter(p => B.isLogPath(p));
  }

  // The server decodes percent escapes, so a raw path with a hash or a
  // percent sign would come out as a different file. We encode each segment
  // and keep the slashes as route separators.
  function corpusUrl(p){
    return "corpus/" + String(p).split("/").map(encodeURIComponent).join("/");
  }

  /* The corpus seam. One probe of corpus.json decides the mode: a listing
     that parses starts the log fetches and the in-memory build, and anything
     else resolves to null, which the chrome renders as no-corpus. The load is
     all-or-null on purpose. A partial corpus would misreport a ticket whose
     log failed to fetch as prompt-only, and a wrong dashboard is worse than
     an absent one. */
  async function loadCorpus(fetchFn, opts){
    opts = opts || {};
    try{
      const probe = await fetchFn("corpus.json");
      // A missing corpus.json is the normal offline mode, so it stays quiet.
      if (!probe || !probe.ok) return null;
      const listing = await probe.json();
      if (!listing || !Array.isArray(listing.files)) throw new Error("corpus.json carries no files array");
      const logs = await Promise.all(logPaths(listing.files).map(async p => {
        const res = await fetchFn(corpusUrl(p));
        if (!res || !res.ok) throw new Error("unreadable corpus file: " + p);
        return {path: p, text: await res.text()};
      }));
      const byPath = new Map(logs.map(f => [f.path, f]));
      const files = listing.files.map(p => byPath.get(p) || {path: p});
      return B.buildIndex(files, {
        project: typeof listing.root === "string" ? listing.root : null,
        generated: localDate(opts.now),
        source: "working-tree"
      });
    }catch(e){
      // The chrome renders every failure as no-corpus, so the console keeps
      // the one trace that says which file or shape broke the load.
      console.warn("corpus load failed:", e);
      return null;
    }
  }

  const ADPShellLib = {SCREENS, TAB_SCREENS, localDate, tabsHtml, footerText,
    projectChitText, applyTheme, logPaths, corpusUrl, loadCorpus};
  if (isNode){ module.exports = ADPShellLib; }
  else { global.ADPShellLib = ADPShellLib; }
})(typeof globalThis !== "undefined" ? globalThis : this);
