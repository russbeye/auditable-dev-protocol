/* adp-shell-lib.js — shared chrome and screen builders for the mission-control
   shell. Screen tabs, theme, status text, the corpus seam, the hash grammar,
   and the rail/inspector HTML builders live here, so the page IIFE stays thin
   glue and the harness drives the same code the browser runs. Builders are
   pure string functions over prepared models, and every interpolated field is
   escaped — the page renders documents people paste in. Effects are injected:
   loadCorpus takes a fetch function and applyTheme takes the document and
   storage, so Node tests pass stubs instead of faking globals. Exposed as the
   browser global `ADPShellLib` via a plain <script> tag after
   adp-index-builder-lib.js, or `module.exports` under Node. */
(function(global){
  "use strict";

  const isNode = typeof module !== "undefined" && module.exports;
  const B = isNode ? require("./adp-index-builder-lib.js") : global.ADPIndexBuilder;
  const P = isNode ? require("./adp-parser-lib.js") : global.ADPParserLib;
  const esc = P.esc, escAttr = P.escAttr;

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

  // ---- the hash grammar ----

  /* Deep links are #t=<ticket>&s=<section key>&item=<DL/OT id>. The section
     token is the contract's section key, never a phase number — a phase
     number cannot reach most sections of a real log. */
  function hashRead(h){
    const out = {t: null, s: null, item: null};
    for (const kv of String(h || "").replace(/^#/, "").split("&")){
      const eq = kv.indexOf("=");
      if (eq < 1) continue;
      const k = kv.slice(0, eq), v = decodeURIComponent(kv.slice(eq + 1));
      if (k === "t" || k === "s" || k === "item") out[k] = v || null;
    }
    return out;
  }
  function hashWrite(sel){
    if (!sel || !sel.t) return "";
    const p = ["t=" + encodeURIComponent(sel.t)];
    if (sel.s) p.push("s=" + encodeURIComponent(sel.s));
    if (sel.item) p.push("item=" + encodeURIComponent(sel.item));
    return "#" + p.join("&");
  }

  // ---- the corpus seam ----

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
     an absent one. The index is metadata-only, so the raw texts ride along
     keyed by ticket dir — the inspector renders section bodies from them
     without a second trip to the network. */
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
      const index = B.buildIndex(files, {
        project: typeof listing.root === "string" ? listing.root : null,
        generated: localDate(opts.now),
        source: "working-tree"
      });
      const texts = {};
      for (const f of logs) texts[f.path.replace(/^\.\//, "").split("/")[0]] = f.text;
      return {index, texts};
    }catch(e){
      // The chrome renders every failure as no-corpus, so the console keeps
      // the one trace that says which file or shape broke the load.
      console.warn("corpus load failed:", e);
      return null;
    }
  }

  // ---- the rail ----

  /* One rail entry. The whole card is a real button, so the keyboard reaches
     it; the close control is a span inside it, because a button cannot nest
     a button. */
  function railEntryHtml(e, selKey){
    const rib = e.ribbon.reasons.map(r => `<span class="r-${r.tone}">${esc(r.txt)}</span>`).join(" · ")
      + (e.ribbon.more ? ` <span class="rmore">+${e.ribbon.more}</span>` : "");
    return `<button type="button" class="rentry${e.key === selKey ? " is-sel" : ""}" data-key="${escAttr(e.key)}">`
      + (e.closable ? `<span class="rclose" data-close="${escAttr(e.key)}" title="close document">×</span>` : "")
      + `<span class="rid">${esc(e.id)}${e.date ? ` <span class="rdate">· ${esc(e.date)}</span>` : ""}</span>`
      + `<span class="rslug">${esc(e.slug)}</span>`
      + `<span class="rrib">${rib}</span></button>`;
  }

  function railHtml(groups, selKey, collapsed){
    return groups.map(([name, list]) => {
      const closed = collapsed.has(name);
      return `<div class="railsec" data-sec="${escAttr(name)}">`
        + `<span><span class="rcv">${closed ? "▸" : "▾"}</span><span class="rname">${esc(name)}</span></span>`
        + `<b class="rcount">${list.length}</b></div>`
        + (closed ? "" : list.map(e => railEntryHtml(e, selKey)).join(""));
    }).join("");
  }

  // ---- the inspector ----

  function tickheadHtml(m){
    return `<div class="tickhead"><span class="tbig">${esc(m.title)}</span>`
      + m.chits.map(c =>
        `<span class="chit"${c.title ? ` title="${escAttr(c.title)}"` : ""}>${esc(c.txt)}</span>`).join("")
      + `</div>`;
  }

  function opsRowHtml(m){
    return `<div class="mops">`
      + `<button type="button" class="op op-acc" data-op="openwatch" title="pick audit logs to open${m.fsa ? " and watch" : ""}">⌖ open${m.fsa ? " &amp; watch" : ""}</button>`
      + `<button type="button" class="op" data-op="reload"${m.canReload ? "" : " disabled"}>↻ reload</button>`
      + `<button type="button" class="op" data-op="paste">⌨ paste</button>`
      + `<span class="mgap"></span>`
      + `<button type="button" class="op tgl${m.viewMode === "section" ? " is-on" : ""}" data-view="section">section</button>`
      + `<button type="button" class="op tgl${m.viewMode === "full" ? " is-on" : ""}" data-view="full">full log</button>`
      + `<span class="chit drophint">drag &amp; drop .md anywhere</span></div>`
      + (m.pasteOpen ? `<div class="drawer"><label for="pasteArea">paste an audit log</label>`
        + `<textarea id="pasteArea" placeholder="paste protocol output…"></textarea>`
        + `<button type="button" class="op" id="pasteImport">open as document</button></div>` : "");
  }

  function secNavHtml(entries, states, selKey){
    const i = entries.findIndex(en => en.key === selKey);
    const opts = entries.map(en => {
      const st = states[en.key];
      const base = en.phase != null ? `phase ${en.phase} · ${en.title}` : en.title;
      const label = st.label === "complete" ? base : `${base} — ${st.label}`;
      return `<option value="${escAttr(en.key)}"${en.key === selKey ? " selected" : ""}>${esc(label)}</option>`;
    }).join("");
    const cur = i >= 0 ? states[entries[i].key] : {label: "—", tone: "mute"};
    return `<div class="secnav">`
      + `<button type="button" class="op" data-secstep="-1"${i <= 0 ? " disabled" : ""}>‹ prev</button>`
      + `<select id="secSel" class="secsel" aria-label="section">${opts}</select>`
      + `<button type="button" class="op" data-secstep="1"${i < 0 || i >= entries.length - 1 ? " disabled" : ""}>next ›</button>`
      + `<span class="secchit t-${cur.tone}">${esc(cur.label)}</span></div>`;
  }

  const permalink = `<button type="button" class="lnk" data-permalink="1" title="copy link to this view">⧉ link</button>`;

  // m.bodyHtml is parser-lib output and lands unescaped by design; every
  // other field is text.
  function docPaneHtml(m){
    return `<div class="doc">`
      + (m.back ? `<div class="backrow"><a class="backlink">← back to ${esc(m.back)}</a></div>` : "")
      + `<h4>${esc(m.heading)}${m.badge ? ` <span class="ncbadge">${esc(m.badge)}</span>` : ""} ${permalink}</h4>`
      + (m.notice ? `<p class="dnotice">${esc(m.notice)}</p>` : "")
      + (m.bodyHtml || "")
      + `</div>`;
  }

  function rawPaneHtml(m){
    return `<div class="doc"><h4>${esc(m.heading)} ${permalink}</h4>`
      + `<p class="dnotice">no sections found — shown raw. An audit log with ## headings renders like any ticket.</p>`
      + `<pre class="rawpre">${esc(m.raw)}</pre></div>`;
  }

  // The tabindex puts every sort header in the tab order, because a bare th
  // never takes keyboard focus; the page's keydown path fires the sort.
  const th = (sort, t, k, label) =>
    `<th class="sth" tabindex="0" data-t="${t}" data-k="${k}">${label}${sort.k === k ? `<span class="arr">${sort.d > 0 ? "▲" : "▼"}</span>` : ""}</th>`;
  const chips = list => list.map(c =>
    `<a class="pc" data-key="${escAttr(c.key)}" title="${escAttr(c.title)}">${esc(c.label)}</a>`).join("");

  function pillsHtml(counts, active){
    return ["all", "open", "validated", "invalidated"]
      .filter(f => f === "all" || counts[f])
      .map(f => `<button type="button" class="fpill${active === f ? " is-on" : ""}" data-dlf="${f}">${f} ${counts[f]}</button>`)
      .join(" ");
  }

  function decisionsPanelHtml(m){
    const rows = m.rows.map(d => `<tr class="dlrow${d.hl ? " is-hl" : ""}" data-dl="${escAttr(d.id)}">`
      + `<td class="mono">${esc(d.id)}</td><td>${esc(d.title)}</td>`
      + `<td><span class="cf-${d.confKind}">${esc(d.conf)}</span></td>`
      + `<td><span class="st-${d.statusKind}">${esc(d.statusKind)}</span></td>`
      + `<td>${d.watch ? `<a class="wl" data-item="${escAttr(d.watch)}">${esc(d.watch)}</a>`
        // An open decision whose watch has closed is unwatched again, so the
        // marker leads and the settled chip only explains how coverage ended.
        : d.settled ? (d.statusKind === "open" ? `<span class="st-unanchored">no watch</span> ` : "")
          + `<a class="wl" data-item="${escAttr(d.settled.wid)}">${esc(d.settled.wid)}</a>`
          + ` <span class="st-closed">${esc(d.settled.outcome + " " + d.settled.closed)}</span>`
        : d.statusKind === "open" ? `<span class="st-unanchored">no watch</span>` : ""}</td>`
      + `<td>${chips(d.chips)}</td></tr>`).join("");
    return `<div class="ipanel"><h2>decisions cited by ${esc(m.label)} <span class="hsub">${m.pills}</span></h2>`
      + `<div class="tblwrap"><table><tr>${th(m.sort, "dec", "id", "entry")}${th(m.sort, "dec", "title", "decision")}`
      + `${th(m.sort, "dec", "conf", "conf")}${th(m.sort, "dec", "status", "status")}`
      + `${th(m.sort, "dec", "watch", "watch")}${th(m.sort, "dec", "cited", "cited in")}</tr>${rows}</table></div></div>`;
  }

  function watchesPanelHtml(m){
    const rows = m.rows.map(w => `<tr class="wrow${w.hl ? " is-hl" : ""}" data-item="${escAttr(w.wid)}">`
      + `<td class="mono">${esc(w.wid)}</td><td>${esc(w.what)}</td>`
      + `<td>${w.dls.map(d => `<a class="wl" data-item="${escAttr(d)}">${esc(d)}</a>`).join(" ")}</td>`
      + `<td class="mono">${esc(w.dueText)}</td>`
      + `<td><span class="st-${w.state}">${esc(w.stateLabel)}</span></td>`
      + `<td>${chips(w.chips)}</td></tr>`).join("");
    return `<div class="ipanel"><h2>watches cited by ${esc(m.label)}</h2>`
      + `<div class="tblwrap"><table><tr>${th(m.sort, "iw", "wid", "id")}${th(m.sort, "iw", "what", "what to check")}`
      + `${th(m.sort, "iw", "dl", "decisions")}${th(m.sort, "iw", "due", "due")}`
      + `${th(m.sort, "iw", "state", "status")}${th(m.sort, "iw", "cited", "cited in")}</tr>${rows}</table></div></div>`;
  }

  // ---- the watchboard ----

  /* The corpus-wide watch table. Both link cells are .wbl anchors: the ticket
     cell carries data-t alone and the watch cell adds data-item, so one
     delegated handler routes both into the inspector. The status column
     shares the due sort key, the mockup's rule — the two columns are one
     ordering read two ways. */
  function watchboardHtml(m){
    const head = `<h2>every live watch, corpus-wide <span class="hsub">${m.live} live · ${m.settled} settled</span></h2>`;
    // An empty board has two truths: a corpus whose watches all settled, and
    // a corpus that never opened one. The settled sentence must never claim
    // ledgers a young corpus does not have.
    if (!m.rows.length)
      return `<div class="ipanel">${head}<p class="dnotice">${m.settled
        ? `every watch on record is settled — ${m.settled} closed ${m.settled === 1 ? "watch sits" : "watches sit"} in the tickets' ledgers.`
        : `no watches on record yet — no ticket in this corpus has opened an obligation table.`}</p></div>`;
    // The hrefs are real deep links, so the keyboard can reach and fire the
    // anchors; the page's delegated handler stops the browser's own hash jump.
    const rows = m.rows.map(w => `<tr class="wbrow" data-wid="${escAttr(w.wid)}">`
      + `<td><a class="wbl" href="${escAttr(hashWrite({t: w.tid}))}" data-t="${escAttr(w.tid)}">${esc(w.tid)}</a></td>`
      + `<td><a class="wbl" href="${escAttr(hashWrite({t: w.tid, item: w.wid}))}" data-t="${escAttr(w.tid)}" data-item="${escAttr(w.wid)}">${esc(w.wid)}</a></td>`
      + `<td>${esc(w.what)}</td>`
      + `<td class="mono">${esc(w.dueText)}</td>`
      + `<td><span class="st-${w.state}">${esc(w.stateLabel)}</span></td></tr>`).join("");
    return `<div class="ipanel">${head}`
      + `<div class="tblwrap"><table><tr>${th(m.sort, "wb", "tid", "ticket")}${th(m.sort, "wb", "wid", "watch")}`
      + `${th(m.sort, "wb", "what", "what to check")}${th(m.sort, "wb", "due", "due")}`
      + `${th(m.sort, "wb", "state", "status")}</tr>${rows}</table></div></div>`;
  }

  function fullLogHtml(list){
    return `<div class="mops"><button type="button" class="op" data-exp="open">expand all</button>`
      + `<button type="button" class="op" data-exp="close">collapse all</button></div>`
      + list.map(s => `<details class="fsec" data-key="${escAttr(s.key)}"${s.open ? " open" : ""}>`
        + `<summary class="fsum">${esc(s.heading)}${s.badge ? ` <span class="ncbadge">${esc(s.badge)}</span>` : ""}</summary>`
        + `<div class="fbody">${s.bodyHtml}</div></details>`).join("");
  }

  const ADPShellLib = {SCREENS, TAB_SCREENS, localDate, tabsHtml, footerText,
    projectChitText, applyTheme, hashRead, hashWrite, logPaths, corpusUrl,
    loadCorpus, railEntryHtml, railHtml, tickheadHtml, opsRowHtml, secNavHtml,
    docPaneHtml, rawPaneHtml, pillsHtml, decisionsPanelHtml, watchesPanelHtml,
    watchboardHtml, fullLogHtml};
  if (isNode){ module.exports = ADPShellLib; }
  else { global.ADPShellLib = ADPShellLib; }
})(typeof globalThis !== "undefined" ? globalThis : this);
