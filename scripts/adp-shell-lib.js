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
  const D = isNode ? require("./adp-derive-lib.js") : global.ADPDeriveLib;
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

  /* Deep links are #v=<screen>&t=<ticket>&s=<section key>&item=<DL/OT id>.
     The section token is the contract's section key, never a phase number — a
     phase number cannot reach most sections of a real log. The view token
     names a non-inspector screen, so a reload lands where the reader was; the
     inspector never writes one, which keeps every pre-v link and every
     inspector hash byte-identical. */
  function hashRead(h){
    const out = {v: null, t: null, s: null, item: null};
    for (const kv of String(h || "").replace(/^#/, "").split("&")){
      const eq = kv.indexOf("=");
      if (eq < 1) continue;
      const k = kv.slice(0, eq), v = decodeURIComponent(kv.slice(eq + 1));
      if (k === "v" || k === "t" || k === "s" || k === "item") out[k] = v || null;
    }
    return out;
  }
  function hashWrite(sel){
    if (!sel || (!sel.t && !sel.v)) return "";
    const p = [];
    if (sel.v) p.push("v=" + encodeURIComponent(sel.v));
    if (sel.t) p.push("t=" + encodeURIComponent(sel.t));
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

  /* One rail entry: a container holding two sibling buttons, because a close
     control inside the entry button could never take the keyboard. The entry
     button carries the selection and the close button sits over its corner,
     painted above it by document order. */
  function railEntryHtml(e, selKey){
    const rib = e.ribbon.reasons.map(r => `<span class="r-${r.tone}">${esc(r.txt)}</span>`).join(" · ")
      + (e.ribbon.more ? ` <span class="rmore">+${e.ribbon.more}</span>` : "");
    return `<div class="rrow">`
      + `<button type="button" class="rentry${e.key === selKey ? " is-sel" : ""}" data-key="${escAttr(e.key)}">`
      + `<span class="rid">${esc(e.id)}${e.date ? ` <span class="rdate">· ${esc(e.date)}</span>` : ""}</span>`
      + `<span class="rslug">${esc(e.slug)}</span>`
      + `<span class="rrib">${rib}</span></button>`
      // The accessible name carries the entry id, so a reader tabbing the
      // rail hears which document each close button closes.
      + (e.closable ? `<button type="button" class="rclose" data-close="${escAttr(e.key)}" title="close document" aria-label="close ${escAttr(e.id)}">×</button>` : "")
      + `</div>`;
  }

  function railHtml(groups, selKey, collapsed){
    return groups.map(([name, list]) => {
      const closed = collapsed.has(name);
      // tabindex -1 lets the page hand focus to a section header after a
      // close empties the list; the header never joins the tab order.
      return `<div class="railsec" data-sec="${escAttr(name)}" tabindex="-1">`
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
  // scope="col" makes the columnheader role explicit instead of leaving it
  // to browser heuristics, because aria-sort only means something on that
  // role. aria-sort names the active order on the one sorted header, which
  // is the only header the ARIA spec wants it on. The arrow repeats that
  // order visually, so we hide the glyph from the accessibility tree.
  const th = (sort, t, k, label) => {
    const on = sort.k === k;
    return `<th class="sth" scope="col" tabindex="0" data-t="${t}" data-k="${k}"`
      + (on ? ` aria-sort="${sort.d > 0 ? "ascending" : "descending"}"` : "")
      + `>${label}${on ? `<span class="arr" aria-hidden="true">${sort.d > 0 ? "▲" : "▼"}</span>` : ""}</th>`;
  };
  const chips = list => list.map(c =>
    `<a class="pc" data-key="${escAttr(c.key)}" title="${escAttr(c.title)}">${esc(c.label)}</a>`).join("");

  // attr names the data mark the pills carry, so the inspector's filter and
  // the ledger's filter route to different state through one delegated path.
  function pillsHtml(counts, active, attr){
    const a = attr || "data-dlf";
    return ["all", "open", "validated", "invalidated"]
      .filter(f => f === "all" || counts[f])
      .map(f => `<button type="button" class="fpill${active === f ? " is-on" : ""}" ${a}="${f}">${f} ${counts[f]}</button>`)
      .join(" ");
  }

  // A decision's coverage cell, shared by the inspector and the ledger. The
  // link builder is injected because the two screens route differently. An
  // open decision whose watch has closed is unwatched again, so the marker
  // leads. A settled watch keeps its cell to the id; how coverage ended
  // rides the link's hover title, because the ruled state already sits in
  // the status column beside it.
  function watchCell(d, link){
    return d.watch ? link(d.watch)
      : d.settled ? (d.statusKind === "open" ? `<span class="st-unanchored">no watch</span> ` : "")
        + link(d.settled.wid, "closed " + d.settled.outcome + " " + d.settled.closed)
      : d.statusKind === "open" ? `<span class="st-unanchored">no watch</span>` : "";
  }

  function decisionsPanelHtml(m){
    const wl = (wid, title) => `<a class="wl" data-item="${escAttr(wid)}"`
      + `${title ? ` title="${escAttr(title)}"` : ""}>${esc(wid)}</a>`;
    const rows = m.rows.map(d => `<tr class="dlrow${d.hl ? " is-hl" : ""}" data-dl="${escAttr(d.id)}">`
      + `<td class="mono">${esc(d.id)}</td><td>${esc(d.title)}</td>`
      + `<td><span class="cf-${d.confKind}">${esc(d.conf)}</span></td>`
      + `<td><span class="st-${d.statusKind}">${esc(d.statusKind)}</span></td>`
      + `<td>${watchCell(d, wl)}</td>`
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

  // The board's status filters are toggle chips, one per due state that
  // exists in the corpus, each carrying its count so a hidden state still
  // says how much it hides. Multi-select on purpose: show and hide compose.
  function statusPillsHtml(counts, visible){
    return ["overdue", "soon", "upcoming", "unanchored", "closed"]
      .filter(s => counts[s])
      .map(s => `<button type="button" class="fpill${visible.has(s) ? " is-on" : ""}" data-ws="${s}">${s} ${counts[s]}</button>`)
      .join(" ");
  }

  /* The corpus-wide watch table — the shell's one watch surface, so settled
     rows render here behind their filter chip with the outcome the closure
     ledger recorded. Both link cells are .wbl anchors: the ticket cell
     carries data-t alone and the watch cell adds data-item, so one delegated
     handler routes both into the inspector. The status column shares the
     derivation's group order, the mockup's rule — the two columns are one
     ordering read two ways. */
  function watchboardHtml(m){
    const head = `<h2>every watch, corpus-wide <span class="hsub">${m.live} live · ${m.settled} settled · ${m.pills}</span></h2>`;
    if (!m.rows.length)
      return `<div class="ipanel">${head}<p class="dnotice">${esc(m.empty)}</p></div>`;
    // The hrefs are real deep links, so the keyboard can reach and fire the
    // anchors; the page's delegated handler stops the browser's own hash jump.
    const rows = m.rows.map(w => `<tr class="wbrow" data-wid="${escAttr(w.wid)}">`
      + `<td><a class="wbl" href="${escAttr(hashWrite({t: w.tid}))}" data-t="${escAttr(w.tid)}">${esc(w.tid)}</a></td>`
      + `<td><a class="wbl" href="${escAttr(hashWrite({t: w.tid, item: w.wid}))}" data-t="${escAttr(w.tid)}" data-item="${escAttr(w.wid)}">${esc(w.wid)}</a></td>`
      + `<td>${esc(w.what)}</td>`
      + `<td class="mono">${esc(w.dueText)}</td>`
      + `<td><span class="st-${w.state}">${esc(w.stateLabel)}</span></td>`
      + `<td>${w.outcomeText ? `<span class="st-${w.outcomeKind}">${esc(w.outcomeText)}</span>` : "—"}</td></tr>`).join("");
    return `<div class="ipanel">${head}`
      + `<div class="tblwrap"><table><tr>${th(m.sort, "wb", "tid", "ticket")}${th(m.sort, "wb", "wid", "watch")}`
      + `${th(m.sort, "wb", "what", "what to check")}${th(m.sort, "wb", "due", "due")}`
      + `${th(m.sort, "wb", "state", "status")}${th(m.sort, "wb", "outcome", "outcome")}</tr>${rows}</table></div></div>`;
  }

  // ---- the ledger ----

  // Ledger rows link the way board rows do: real deep-link hrefs on .wbl
  // anchors, so the shipped delegated route and the keyboard serve them
  // unchanged. The ticket cell lands the default view and the id cell lands
  // the item in its owning section.
  const ledgerLink = (tid, item, title) =>
    `<a class="wbl" href="${escAttr(hashWrite(item ? {t: tid, item} : {t: tid}))}"`
    + ` data-t="${escAttr(tid)}"${item ? ` data-item="${escAttr(item)}"` : ""}`
    + `${title ? ` title="${escAttr(title)}"` : ""}>${esc(item || tid)}</a>`;

  /* The assumption ledger: every decision on record, corpus-wide. The status
     and coverage cells reuse the inspector's vocabulary, so a row reads the
     same on both screens. */
  function assumptionLedgerHtml(m){
    const head = `<h2>assumptions <span class="hsub">${m.pills}</span></h2>`;
    if (!m.rows.length)
      return `<div class="ipanel">${head}<p class="dnotice">${esc(m.empty)}</p></div>`;
    const rows = m.rows.map(d => `<tr class="lgrow" data-t="${escAttr(d.tid)}" data-dl="${escAttr(d.id)}">`
      + `<td>${ledgerLink(d.tid)}</td>`
      + `<td class="mono">${ledgerLink(d.tid, d.id)}</td>`
      + `<td>${esc(d.title)}</td>`
      + `<td><span class="cf-${d.confKind}">${esc(d.conf)}</span></td>`
      + `<td><span class="st-${d.statusKind}">${esc(d.statusKind)}</span></td>`
      + `<td>${watchCell(d, (wid, title) => ledgerLink(d.tid, wid, title))}</td>`
      + `<td class="mono">${esc(d.ageText)}</td></tr>`).join("");
    return `<div class="ipanel">${head}`
      + `<div class="tblwrap"><table><tr>${th(m.sort, "la", "tid", "ticket")}${th(m.sort, "la", "id", "entry")}`
      + `${th(m.sort, "la", "title", "decision")}${th(m.sort, "la", "conf", "conf")}`
      + `${th(m.sort, "la", "status", "status")}${th(m.sort, "la", "watch", "watch")}`
      + `${th(m.sort, "la", "age", "age")}</tr>${rows}</table></div></div>`;
  }

  function fullLogHtml(list){
    return `<div class="mops"><button type="button" class="op" data-exp="open">expand all</button>`
      + `<button type="button" class="op" data-exp="close">collapse all</button></div>`
      + list.map(s => `<details class="fsec" data-key="${escAttr(s.key)}"${s.open ? " open" : ""}>`
        + `<summary class="fsum">${esc(s.heading)}${s.badge ? ` <span class="ncbadge">${esc(s.badge)}</span>` : ""}</summary>`
        + `<div class="fbody">${s.bodyHtml}</div></details>`).join("");
  }

  // ---- resume packs ----

  /* A pack is plain text plus three constructs and nothing else. {{path}}
     inserts one value. {{#name}}…{{/name}} repeats its body per item of a
     list, with the item's keys laid over the context, or renders it once
     when name holds a present value. {{^name}}…{{/name}} renders its body
     only when the list is empty or the value is missing. Sections resolve
     first, then inverse sections, then values, so an inverse block that
     follows its section never sees the section's own closing tag. A path
     that resolves to nothing renders empty, and any other brace text stays
     verbatim: the fill never invents a value and never interprets a
     construct it does not know. */
  function packGet(ctx, path){
    return path.split(".").reduce((o, k) => o == null ? o : o[k], ctx);
  }
  function fillPack(tpl, ctx){
    tpl = String(tpl).replace(/\{\{#([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, p, body) => {
      const v = packGet(ctx, p);
      if (Array.isArray(v)) return v.map(item => fillPack(body, Object.assign({}, ctx, item))).join("");
      return v ? fillPack(body, ctx) : "";
    });
    tpl = tpl.replace(/\{\{\^([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, p, body) => {
      const v = packGet(ctx, p);
      return (Array.isArray(v) ? !v.length : !v) ? fillPack(body, ctx) : "";
    });
    return tpl.replace(/\{\{([\w.]+)\}\}/g, (_, p) => {
      const v = packGet(ctx, p);
      return v == null ? "" : String(v);
    });
  }

  // The constructs a pack uses, each once, in first-use order. The screen
  // lists them so an author can see what a pack reads.
  function packSlots(tpl){
    return [...new Set(String(tpl).match(/\{\{[#^]?[\w.]+\}\}/g) || [])];
  }

  /* The one context every pack fills from. Every classified value comes
     through the derive lib, so a pack can only say what the board and the
     ledger say: an entry is open by decisionKind, which prefers a recorded
     ruling to the card; a watch is live when no closure record ended it;
     the corpus-wide lists are the board's rows and the ledger's unwatched
     rank. Dates come from due and anchored alone. A watch with no date
     shows its UNANCHORED label and never its window prose, so a pack never
     reads a date out of a sentence. The ticket may be null, in which case
     every ticket slot renders empty. */
  // A confidence basis is classified by its leading phrase, because the
  // field is one line that names its kind first and its evidence after a
  // dash. A mixed basis ("DIRECT EVIDENCE for X; inference for Y") takes
  // the kind it leads with. No basis at all is its own kind, since the
  // field postdates many entries on record.
  function packBasisKind(basis){
    const s = String(basis || "").trim().toUpperCase();
    if (!s) return "none";
    if (s.startsWith("DIRECT EVIDENCE")) return "direct";
    if (s.startsWith("INFERENCE")) return "inference";
    if (s.startsWith("DEVELOPER ASSERTION")) return "assertion";
    return "other";
  }

  function packContext(index, t, today){
    const word = c => P.dlChipSplit(c).word;
    const watchRow = w => ({tid: w.tid, wid: w.wid, what: w.what,
      due: w.anchored ? w.due : "", state: w.label});
    const wb = D.watchboardRows(index.tickets, today);
    const board = wb.rows;
    const live = board.filter(w => w.state !== "closed");
    const ledger = D.ledgerRows(index.tickets, today).decisions;
    const open = ledger.filter(r => r.kind === "open");
    const entryRow = r => ({tid: r.tid, id: r.id, title: r.title, confidence: word(r.confidence)});
    // Oldest first, so the entries with the most drift lead; an undated
    // card has no age and sits last, named as undated rather than as zero.
    const byAge = open.slice().sort((a, b) =>
      (b.age == null ? -1 : b.age) - (a.age == null ? -1 : a.age));
    // Ledger rows carry no basis, so the card is read back through its
    // ticket for the one field the evidence mix classifies.
    const basisOf = r => {
      const own = index.tickets.find(x => x.dir === r.dir);
      const card = own && own.decisions.find(d => d.id === r.id);
      return card ? card.basis : null;
    };
    const basis = {};
    for (const k of ["direct", "inference", "assertion", "other", "none"]) basis[k] = [];
    for (const r of open) basis[packBasisKind(basisOf(r))].push(entryRow(r));
    const counts = {};
    for (const k in basis) counts[k] = basis[k].length;
    return {
      index: {generated: index.generated, project: index.project},
      ticket: t ? {id: t.id, dir: t.dir, slug: t.slug, date: t.date, title: t.title,
        state: t.state, state_source: t.state_source, pr: t.pr, merged: t.merged,
        phase: t.phase} : null,
      ticket_count: index.tickets.length,
      missing: t ? (t.missing.join(", ") || "none") : "",
      open_decisions: t ? t.decisions.filter(d => D.decisionKind(d) === "open").map(d => {
        const cover = D.coveringWatch(t, d.id);
        return {id: d.id, title: d.title, confidence: word(d.confidence),
          created: d.created || "", watch: cover ? cover.wid : "no watch"};
      }) : [],
      watches: t ? t.watches.filter(w => !w.closed).map(w => ({
        wid: w.wid, what: w.what, dl: (w.dl || []).join(", "),
        due: w.anchored ? w.due : "", state: D.dueLabel(w, today)})) : [],
      overdue: board.filter(w => w.state === "overdue").map(watchRow),
      soon: board.filter(w => w.state === "soon").map(watchRow),
      unanchored: board.filter(w => w.state === "unanchored").map(watchRow),
      unwatched: ledger.filter(r => r.rank === 0).map(entryRow),
      // The board's whole live set in its order, its dated members alone as
      // a calendar, and the state counts the board's chips carry.
      live_watches: live.map(watchRow),
      calendar: live.filter(w => w.anchored).map(watchRow),
      watch_counts: Object.assign({live: live.length}, wb.counts),
      open_by_age: byAge.map(r => Object.assign(entryRow(r), {
        age: r.age == null ? "undated" : r.age + "d",
        watch: r.watch || "no watch"})),
      in_review: index.tickets.filter(x => x.state === "in-review").map(x => ({
        id: x.id || x.dir, dir: x.dir, pr: x.pr,
        open_count: x.decisions.filter(d => D.decisionKind(d) === "open").length,
        live_count: x.watches.filter(w => !w.closed).length})),
      basis_direct: basis.direct, basis_inference: basis.inference,
      basis_assertion: basis.assertion, basis_other: basis.other, basis_none: basis.none,
      basis_counts: counts
    };
  }

  /* The packs seam, in the corpus seam's shape: one probe of packs.json,
     then every listed file, all-or-null. A pack the server lists but cannot
     serve would leave a button that fills nothing, so the whole load fails
     instead. The listing's order is the screen's order. A probe that never
     answers is quiet: a dead server is the corpus seam's trace to make, and
     a server without the packs routes answers not-ok, so both read as the
     no-packs mode. Only a listing the server did answer can fail loudly. */
  async function loadPacks(fetchFn){
    let probe = null;
    try{ probe = await fetchFn("packs.json"); }catch(e){}
    if (!probe || !probe.ok) return null;
    try{
      const listing = await probe.json();
      if (!listing || !Array.isArray(listing.packs)) throw new Error("packs.json carries no packs array");
      return await Promise.all(listing.packs.map(async file => {
        const res = await fetchFn("packs/" + encodeURIComponent(file));
        if (!res || !res.ok) throw new Error("unreadable pack: " + file);
        return {name: String(file).replace(/\.pack\.md$/, ""), file: "packs/" + file, text: await res.text()};
      }));
    }catch(e){
      console.warn("packs load failed:", e);
      return null;
    }
  }

  const PACK_DOCS = `<div class="packdocs"><h3>add your own pack</h3>`
    + `<p>Drop a <code>.pack.md</code> file into the skill's <code>packs/</code> directory and reload: `
    + `it appears here. A pack is plain text plus three constructs, filled from the ticket index: `
    + `<code>{{path}}</code> inserts one value, <code>{{#name}}…{{/name}}</code> repeats its body for `
    + `each item of a list, or once when name holds a present value, and <code>{{^name}}…{{/name}}</code> `
    + `renders its body only when the list is empty or the value is missing. Nothing else is `
    + `interpreted: a missing value renders empty, and the same index fills the same bytes.</p>`;

  /* The pack screen. m.packs null means nothing loaded, and only the notice
     renders. Otherwise the row, the source line, and either the filled
     block with its copy control or the notice that explains why there is no
     fill. m.text is the pack's bytes and lands escaped. */
  function packScreenHtml(m){
    const head = `<h2>resume pack <span class="isub">deterministic · copy into your next interactive session</span></h2>`;
    if (!m.packs)
      return head + `<div class="ipanel"><p class="dnotice">${esc(m.notice)}</p></div>`;
    const row = `<div class="packrow">` + m.packs.map(p =>
      `<button type="button" class="pk${p.name === m.sel ? " is-on" : ""}" data-pk="${escAttr(p.name)}">${esc(p.name)}</button>`).join("")
      + `</div>`;
    const body = m.notice
      ? `<div class="ipanel"><p class="dnotice">${esc(m.notice)}</p></div>`
      : `<pre class="packpre" id="packText">${esc(m.text)}</pre>`
        + `<div class="mops"><button type="button" class="op op-acc" data-op="copypack">${esc(m.copyLabel || "⧉ copy pack")}</button></div>`;
    return head + row + `<div class="packsrc">source: ${esc(m.file)}</div>` + body
      + PACK_DOCS + `<h3>slots used by this pack</h3>`
      + `<div class="slotlist">${m.slots.map(esc).join("  ")}</div></div>`;
  }

  const ADPShellLib = {SCREENS, TAB_SCREENS, localDate, tabsHtml, footerText,
    projectChitText, applyTheme, hashRead, hashWrite, logPaths, corpusUrl,
    loadCorpus, railEntryHtml, railHtml, tickheadHtml, opsRowHtml, secNavHtml,
    docPaneHtml, rawPaneHtml, pillsHtml, decisionsPanelHtml, watchesPanelHtml,
    statusPillsHtml, watchboardHtml, assumptionLedgerHtml, fullLogHtml,
    fillPack, packSlots, packBasisKind, packContext, loadPacks, packScreenHtml};
  if (isNode){ module.exports = ADPShellLib; }
  else { global.ADPShellLib = ADPShellLib; }
})(typeof globalThis !== "undefined" ? globalThis : this);
