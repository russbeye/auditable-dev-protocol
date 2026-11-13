/* Mission control as one React tree: the top bar, the rail, the screens,
   and the Packs drawer. */
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import * as B from "../lib/adp-index-builder-lib.ts";
import * as D from "../lib/adp-derive-lib.ts";
import * as I from "../lib/adp-index-lib.ts";
import * as S from "../lib/adp-shell-lib.ts";
import type {DueState} from "../lib/adp-derive-lib.ts";
import type {Ticket} from "../lib/adp-index-lib.ts";
import type {FetchFn, HashSelection, Pack, RailModelGroup, Screen, SortState, ThemeChoice, ViewMode} from "../lib/adp-shell-lib.ts";
import {Inspector, promptOf, resolveSection, type InspectorActions} from "./Inspector.tsx";
import {Calibration, Ledgers} from "./Ledgers.tsx";
import {useLiveCorpus, type EventFeed} from "./live.ts";
import {NewTask, useNewTask} from "./NewTask.tsx";
import {PackDrawer} from "./Pack.tsx";
import {Rail} from "./Rail.tsx";
import {Reviews, groupsOf, resolveRound, type ReviewsActions} from "./Reviews.tsx";
import {StatusPage} from "./StatusPage.tsx";
import {TopBar} from "./TopBar.tsx";
import {Watchboard} from "./Watchboard.tsx";

type AppProps = {fetchFn: FetchFn; openFeed: () => EventFeed | null};
// We hold the selected ticket by its directory, not by its token. A
// directory that arrives with the same id changes the token, and the
// selection then follows the ticket rather than stranding on the old token.
type Sel = {dir: string | null; s: string | null; item: string | null};

// Calibration and the resume pack are no longer screens. Calibration heads
// the Ledger, and the packs open as a drawer over any view.
const SHOWN: Screen[] = ["inspector", "reviews", "watchboard", "ledgers", "new task"];
const SCREEN_IDS: Record<Screen, string> = {"inspector": "scrInspector", "reviews": "scrReviews", "watchboard": "scrWatch",
  "ledgers": "scrLedgers", "calibration": "scrLedgers", "resume pack": "scrInspector", "new task": "scrNew"};
const SHORTCUTS: [string, string][] = [["[", "Show or hide tickets"], ["← →", "Previous or next phase"], ["/", "Filter tickets"],
  ["f", "Section or full log"]];
/* Below this width the stage would fall under the 560px the boards give it
   beside a 248px rail, so the rail folds to its strip and opens over the
   page, as the 720px boards draw it. */
const NARROW = "(max-width: 807px)";
function useNarrow(): boolean {
  const mq = () => window.matchMedia ? window.matchMedia(NARROW) : null;
  const [narrow, setNarrow] = useState(() => !!mq()?.matches);
  useEffect(() => {
    const m = mq();
    if (!m) return;
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}
const prefersLight = () => !!window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
// A shortcut never fires while the reader types into a field.
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName));
const NO_SEL: Sel = {dir: null, s: null, item: null};

function readHash(): HashSelection | null {
  try { return S.hashRead(location.hash); } catch { return null; }
}

function App({fetchFn, openFeed}: AppProps){
  const {corpus, stale, booting, at, absent, retry} = useLiveCorpus(fetchFn, openFeed);
  // The hash is read before the corpus exists, so the ticket it names waits
  // as pending until the first corpus lands. A screen needs no corpus.
  const [pending, setPending] = useState<HashSelection | null>(readHash);
  const [screen, setScreen] = useState<Screen>(() => S.screenFromHash(pending ? pending.v : null).screen);
  const [packsOpen, setPacksOpen] = useState(() => S.screenFromHash(pending ? pending.v : null).packs);
  const packsOpener = useRef<HTMLElement | null>(null);
  const [sel, setSel] = useState<Sel>(NO_SEL);
  const [settled, setSettled] = useState(false);
  // The closed group starts collapsed, because it is the archive and its
  // count says how much sits inside.
  const [railCollapsed, setRailCollapsed] = useState<ReadonlySet<string>>(() => new Set(["closed"]));
  // The board opens as the to-do surface, with closed watches hidden and
  // the due column in its derived order: overdue first, unanchored last.
  const [wbShow, setWbShow] = useState<ReadonlySet<DueState>>(() => new Set<DueState>(["overdue", "soon", "upcoming", "unanchored"]));
  const [wbSort, setWbSort] = useState<SortState>({k: "due", d: 1});
  const [theme, setTheme] = useState<ThemeChoice>(() => {
    try { return S.themeChoice(localStorage.getItem("adp-theme")); } catch { return "system"; }
  });
  // The inspector's view, its decisions filter, its collapsed full-log
  // sections, and the notice for a section link that found nothing. A rail
  // pick resets the last three, because each one belongs to the ticket on
  // show. The view stays, so a reader who walks the rail keeps the full log.
  const [view, setView] = useState<ViewMode>("section");
  const [dlFilter, setDlFilter] = useState("all");
  const [fullClosed, setFullClosed] = useState<ReadonlySet<string>>(() => new Set());
  const [missNotice, setMissNotice] = useState<string | null>(null);
  // The notice a dead deep link leaves, which stands in for the default
  // selection the dead link did not take.
  const [bootNotice, setBootNotice] = useState<string | null>(null);
  const [jump, setJump] = useState<{to: string | null; seq: number}>({to: null, seq: 0});
  const jumped = useRef(0);
  // The inspector and the reviews screen share the decisions sort and the
  // watches sort, so a sort on one screen reaches the other.
  const [decSort, setDecSort] = useState<SortState>({k: "id", d: 1});
  const [iwSort, setIwSort] = useState<SortState>({k: "wid", d: 1});
  // The ledger default sorts the ranked column, so the stable default pass
  // leaves the derivation's triage order standing. Its pill filters are
  // corpus-wide, so a rail pick never resets them.
  const [laSort, setLaSort] = useState<SortState>({k: "status", d: 1});
  const [lgFilter, setLgFilter] = useState("all");
  const [lgConf, setLgConf] = useState("all");
  const lgFocus = useRef(false);
  // The round the reviews screen shows is a file name, apart from the
  // inspector's section, so switching tabs never strands either one.
  const [revSel, setRevSel] = useState<string | null>(null);
  const [revNotice, setRevNotice] = useState<string | null>(null);
  const [revDlFilter, setRevDlFilter] = useState("all");
  // The packs load once, beside the corpus. They are the skill's own files,
  // so a new pack shows on the next reload and not on a corpus change.
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [selPack, setSelPack] = useState<string | null>(null);
  const [copyLabel, setCopyLabel] = useState<string | null>(null);
  // New task keeps its form here, so a tab switch never drops a draft.
  const nt = useNewTask();
  useEffect(() => {
    let alive = true;
    S.loadPacks(fetchFn).then(p => { if (alive) setPacks(p); });
    return () => { alive = false; };
  }, [fetchFn]);

  const tickets: Ticket[] = useMemo(() => corpus ? corpus.index.tickets : [], [corpus]);
  const tokenOf = useMemo(() => D.ticketTokens(tickets), [tickets]);
  // A shared id names no single ticket, so a token that carries one finds
  // nothing rather than whichever ticket sorts first.
  const byToken = useCallback((tok: string | null) => !tok ? undefined
    : tickets.find(x => x.dir === tok) || tickets.find(x => tokenOf(x) === tok), [tickets, tokenOf]);
  // Derivations date against the index's own build day, so a tab left open
  // overnight keeps reporting the day the data is from.
  const today = corpus ? corpus.index.generated : S.localDate();
  const railModel: RailModelGroup[] = useMemo(() => D.railGroups(tickets, today).map(([name, list]) =>
    [name, list.map(t => ({key: tokenOf(t), id: t.id || t.dir, date: t.date, slug: t.slug,
      ribbon: D.ribbonModel(t, today), closable: false}))]), [tickets, tokenOf, today]);
  const selTicket = sel.dir ? tickets.find(x => x.dir === sel.dir) : undefined;
  const selKey = selTicket ? tokenOf(selTicket) : null;

  /* The rail folds as a whole. On a wide window the fold is the reader's
     choice, and we keep it per repo. On a narrow window the rail starts
     folded and opens over the page, so that state is never stored. */
  const narrow = useNarrow();
  const railRepo = corpus ? corpus.index.project : null;
  const [railFoldedWide, setRailFoldedWide] = useState(false);
  const [railOver, setRailOver] = useState(false);
  const [railFilter, setRailFilter] = useState("");
  const [railFocus, setRailFocus] = useState(0);
  useEffect(() => {
    if (!railRepo) return;
    try { setRailFoldedWide(localStorage.getItem("adp-rail:" + railRepo) === "folded"); } catch {}
  }, [railRepo]);
  useEffect(() => { if (!narrow) setRailOver(false); }, [narrow]);
  const railFolded = narrow ? !railOver : railFoldedWide;
  const foldRail = useCallback((folded: boolean) => {
    if (narrow){ setRailOver(!folded); return; }
    setRailFoldedWide(folded);
    try {
      if (!railRepo) return;
      if (folded) localStorage.setItem("adp-rail:" + railRepo, "folded"); else localStorage.removeItem("adp-rail:" + railRepo);
    } catch {}
  }, [narrow, railRepo]);
  // The filter matches the id, the slug, or the token of a row, in any case.
  // A group it empties leaves the rail, except closed, which keeps its count.
  const railQuery = railFilter.trim().toLowerCase();
  const railShown: RailModelGroup[] = useMemo(() => !railQuery ? railModel : railModel
    .map(([name, list]): RailModelGroup => [name, list.filter(e => [e.id, e.slug, e.key].some(x => !!x && x.toLowerCase().includes(railQuery)))])
    .filter(([name, list]) => name === "closed" || list.length), [railModel, railQuery]);
  const attention = railModel.find(g => g[0] === "needs attention")?.[1].length || 0;
  // The lint sweeps every log a second time, so it runs once per corpus
  // that lands and never on a render.
  const advisories = useMemo(() => corpus ? B.lintCorpus(corpus.files) : [], [corpus]);

  /* The first corpus to land settles the selection. A deep link fills an
     empty selection and never replaces one the reader made meanwhile. A
     dead link leaves the selection empty, so the default does not paper
     over it. */
  useEffect(() => {
    if (settled || !corpus) return;
    setSettled(true);
    let next = sel, dead = false;
    if (pending){
      if (pending.t && !sel.dir){
        const t = byToken(pending.t);
        // A reviews link carries its round in the section token.
        if (t && pending.v === "reviews"){ next = {dir: t.dir, s: null, item: null}; setRevSel(pending.s); }
        else if (t) next = {dir: t.dir, s: pending.s, item: pending.item};
        else {
          dead = true;
          const shared = tickets.filter(x => x.id === pending.t).length;
          setBootNotice(shared > 1 ? `"${pending.t}" names ${shared} tickets in this corpus — pick one from the rail.`
            : `ticket "${pending.t}" is not in this corpus.`);
        }
      }
      setPending(null);
    }
    if (!next.dir && !dead){
      const first = railModel.find(g => g[1].length);
      const t = first && byToken(first[1][0].key);
      if (t) next = {dir: t.dir, s: null, item: null};
    }
    if (next !== sel) setSel(next);
  }, [corpus, settled, pending, sel, byToken, railModel, tickets]);

  /* The inspector's section follows the ticket it shows. An item-only link
     takes the item's owning section, an empty selection takes the default,
     and a section the log no longer holds takes the default with a notice.
     The settled section goes into the selection, so the address names it. */
  useEffect(() => {
    if (!selTicket || !corpus) return;
    const r = resolveSection(selTicket, promptOf(corpus.prompts[selTicket.dir]), sel.s, sel.item, today);
    if (r.notice) setMissNotice(r.notice);
    if (r.s !== sel.s) setSel(prev => ({...prev, s: r.s}));
  }, [selTicket, corpus, sel.s, sel.item, today]);

  /* The reviews screen settles its round when it shows: the named round, or
     the latest one, with a notice when a named round was not found. */
  useEffect(() => {
    if (screen !== "reviews" || !selTicket) return;
    const groups = groupsOf(corpus, selTicket);
    const at = resolveRound(groups, revSel);
    if (!at) return;
    if (at.notice) setRevNotice(at.notice);
    const file = groups[at.gi].rounds[at.ri].file;
    if (file !== revSel) setRevSel(file);
  }, [screen, selTicket, corpus, revSel]);

  // A calibration segment lands the ledger with focus on the status pill
  // that now reads on, so the keyboard arrives where the eye does.
  useEffect(() => {
    if (!lgFocus.current || screen !== "ledgers") return;
    lgFocus.current = false;
    const pill = [...document.querySelectorAll<HTMLElement>(".fpill")].find(p => p.getAttribute("data-lgf") === lgFilter);
    pill?.focus();
  });

  /* The URL follows the reader once the boot load is done, so a reload lands
     where the reader was. The inspector writes no view token, which keeps
     its hashes the same as every link minted before the token existed. A
     ticket link still waiting for its corpus rides along until the reader
     selects something. An empty composition clears the hash, so a reload
     never lands on a screen the reader already left. */
  useEffect(() => {
    if (booting) return;
    const waiting = !sel.dir && pending && pending.t;
    const pend = waiting ? pending : {t: selKey ?? sel.dir, s: sel.s, item: sel.item};
    // The reviews screen puts its round in the s token, and an item means
    // nothing there.
    const rev = screen === "reviews" && !waiting;
    const h = S.hashWrite({v: screen === "inspector" ? null : screen, t: pend.t, s: rev ? revSel : pend.s, item: rev ? null : pend.item});
    try { history.replaceState(null, "", h || "#"); } catch {}
  }, [booting, screen, sel, selKey, pending, revSel]);

  /* The theme follows the reader's choice. System stores nothing and tracks
     the system preference while the page is open. */
  useEffect(() => {
    const set = () => document.documentElement.setAttribute("data-theme", S.themeFor(theme, prefersLight()));
    set();
    try { if (theme === "system") localStorage.removeItem("adp-theme"); else localStorage.setItem("adp-theme", theme); } catch {}
    if (theme !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, [theme]);

  useEffect(() => { document.title = S.pageTitle(corpus ? corpus.index : null); }, [corpus]);

  const go = (s: Screen) => setScreen(s);
  // The drawer hands focus back to the control that opened it.
  const openPacks = (opener: HTMLElement | null, name?: string) => {
    packsOpener.current = opener;
    if (name) setSelPack(name);
    setCopyLabel(null);
    setPacksOpen(true);
  };
  const closePacks = useCallback(() => setPacksOpen(false), []);
  // The page behind the drawer is inert until the render after it closes,
  // so focus goes back to the opener only once that render lands.
  useEffect(() => {
    const o = packsOpener.current;
    if (packsOpen || !o) return;
    packsOpener.current = null;
    if (o.isConnected) o.focus();
  }, [packsOpen]);
  // A new ticket on show drops the state that belonged to the last one.
  const resetTicket = () => {
    setDlFilter("all"); setMissNotice(null); setFullClosed(new Set());
  };
  const pick = (key: string) => {
    const t = byToken(key);
    setSel({dir: t ? t.dir : key, s: null, item: null});
    resetTicket();
    setRevSel(null); setRevNotice(null); setRevDlFilter("all");
    if (screen !== "reviews") setScreen("inspector");
  };
  const toggleRail = (name: string) => setRailCollapsed(prev => {
    const next = new Set(prev);
    if (!next.delete(name)) next.add(name);
    return next;
  });
  const sortBoard = (k: string) => setWbSort(prev => ({k, d: prev.k === k ? -prev.d : 1}));
  const toggleState = (s: DueState) => setWbShow(prev => {
    const next = new Set(prev);
    if (!next.delete(s)) next.add(s);
    return next;
  });
  // A watch link leaves the section empty on purpose. The inspector finds
  // the section that owns the item, so a retitled section never strands a
  // board link.
  const openWatch = (tid: string, wid: string | null) => {
    const t = byToken(tid);
    setSel({dir: t ? t.dir : tid, s: null, item: wid});
    resetTicket();
    setScreen("inspector");
    paneJump();
  };

  // A link that changes what the doc pane shows scrolls the stage back up
  // to the nav and the content, so the reader is not left at the tables.
  const paneJump = () => setJump(j => ({to: null, seq: j.seq + 1}));
  // A pick in the full log opens the section it names and scrolls to it.
  const fullJump = (key: string) => {
    setFullClosed(prev => { const next = new Set(prev); next.delete(key); return next; });
    setJump(j => ({to: key, seq: j.seq + 1}));
  };
  const toSection = (key: string) => {
    setSel(prev => ({...prev, s: key, item: null}));
    setMissNotice(null);
    if (view === "full") fullJump(key);
  };
  // A row or chip in a cited panel names a log entry, and the log lives in
  // the inspector, so following one from the reviews screen moves there.
  const panelActions = {
    onSort: (t: string, k: string) => (t === "dec" ? setDecSort : setIwSort)(prev => ({k, d: prev.k === k ? -prev.d : 1})),
    onRow: (id: string) => { setScreen("inspector"); setSel(prev => ({...prev, item: id})); paneJump(); },
    onChip: (key: string) => { setScreen("inspector"); setSel(prev => ({...prev, s: key, item: null})); setMissNotice(null); paneJump(); },
    // A watch link lands in the ticket's obligation section, where the
    // watch's row sits. A decision id keeps the section it was cited from.
    onWatch: (item: string) => {
      setScreen("inspector");
      const own = I.RE_OT.test(item) && selTicket ? D.canonicalSection(selTicket, 9) : null;
      setSel(prev => ({...prev, item, s: own ? own.key : prev.s}));
      paneJump();
    }
  };
  // A round link routes in the app. A link into a ticket the corpus lacks
  // keeps the current selection and says why.
  const openRound = (tok: string, file: string) => {
    const t = byToken(tok);
    if (!t) setRevNotice(`ticket "${tok}" is not in this corpus.`);
    else {
      if (t.dir !== sel.dir){
        setSel({dir: t.dir, s: null, item: null});
        resetTicket(); setRevDlFilter("all");
      }
      setRevSel(file); setRevNotice(null);
    }
    setScreen("reviews");
  };
  const inspectorActions: InspectorActions = {...panelActions,
    onView: setView,
    onSection: toSection,
    onStep: toSection,
    onBack: () => { setSel(prev => ({...prev, item: null})); paneJump(); },
    onFilter: setDlFilter,
    onToggle: (key, open) => setFullClosed(prev => {
      const next = new Set(prev);
      if (open) next.delete(key); else next.add(key);
      return next;
    }),
    onExpand: (open, keys) => setFullClosed(open ? new Set() : new Set(keys)),
    onRound: openRound,
    // The spy names the section the reader scrolled to, and the address
    // follows it. It never scrolls, so it cannot fight the reader's wheel.
    onSpy: key => setSel(prev => prev.s === key ? prev : {...prev, s: key, item: null}),
    // A ticket's prompt is the one way a written prompt reaches the form.
    // New task comes forward with its report or its question.
    onStartFrom: (text, source) => { nt.startFrom(text, source); setScreen("new task"); },
  };
  const reviewsActions: ReviewsActions = {...panelActions,
    onRound: openRound,
    onPick: file => { setRevSel(file); setRevNotice(null); },
    // A PR switch lands on that PR's latest round.
    onPr: pr => {
      const g = groupsOf(corpus, selTicket).find(x => x.pr === pr);
      if (g){ setRevSel(g.rounds[g.rounds.length - 1].file); setRevNotice(null); }
    },
    onFilter: setRevDlFilter
  };
  const openLedgerCell = (conf: string, kind: string) => {
    setLgConf(conf); setLgFilter(kind);
    lgFocus.current = true;
    setScreen("ledgers");
  };
  // The label reports what the clipboard did, because a "copied" that
  // assumes success would hide a denied write. The outcome shows for a
  // moment and the control returns to its resting label.
  const copyPack = (text: string) => {
    let write: Promise<void>;
    try { write = navigator.clipboard.writeText(text); } catch (e) { write = Promise.reject(e); }
    Promise.resolve(write).then(() => setCopyLabel("copied"), () => setCopyLabel("copy failed — select the text"));
    setTimeout(() => setCopyLabel(null), 1200);
  };

  // IDLE is a page with no corpus yet. CACHED is a corpus whose last reload
  // failed or whose event stream broke, kept on screen until a reload
  // answers. WATCHING is a corpus the server keeps current.
  const live = !corpus ? "IDLE" : stale ? "CACHED" : "WATCHING";
  const root = corpus ? corpus.index.project : null;
  // The about lines keep what the old footer said, then name the served
  // folder and the port, which is all the page knows of where it runs.
  const about = [S.footerText(corpus ? corpus.index : null), ...(root ? [root + " · :" + location.port] : [])];
  // The Tickets view has nothing to show until a ticket exists, so it shows
  // why instead of an empty rail and stage. A repo with no .adp/ folder has
  // no logs yet, so it shows the empty page and not the failed one.
  const status = booting && !corpus ? "loading" : !corpus ? (absent ? "empty" : "failed") : !tickets.length ? "empty" : null;

  const railOn = !(screen === "inspector" && status);
  // f flips the ticket between its section and its full log, [ folds or opens
  // the rail, and / opens the rail if it is folded and moves into its filter.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || packsOpen) return;
      if (e.key === "f" && screen === "inspector" && selTicket){
        e.preventDefault();
        setView(v => v === "full" ? "section" : "full");
      } else if (e.key === "[" && railOn){
        e.preventDefault();
        foldRail(!railFolded);
      } else if (e.key === "/" && railOn){
        e.preventDefault();
        if (railFolded) foldRail(false);
        setRailFocus(n => n + 1);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [screen, selTicket, packsOpen, railOn, railFolded, foldRail]);

  return <div className="shell" style={{display: "grid", gridTemplateRows: "auto 1fr", height: "100dvh"}}>
    <TopBar repo={S.repoLabel(corpus ? corpus.index : null)} live={live} down={status === "failed"} at={at} screen={screen} theme={theme}
      about={about} shortcuts={SHORTCUTS} onView={go} onPacks={o => openPacks(o)} onNewTask={() => go("new task")} onTheme={setTheme}
      inert={packsOpen}/>
    {/* The drawer is modal, so the page behind it takes no focus or clicks while it is open. */}
    <div className="main" inert={packsOpen} style={screen === "inspector" && status ? {display: "flex", flexDirection: "column", overflowY: "auto"}
      : {position: "relative", gridTemplateColumns: (railFolded || narrow ? "var(--rail-collapsed)" : "var(--rail-width)") + " minmax(0, 1fr)"}}>
      {screen === "inspector" && status
        ? <StatusPage kind={status} root={root} host={location.host} onRetry={retry} onNewTask={() => go("new task")}
          onBootstrap={o => openPacks(o, "bootstrap-project")}/>
        : <>
      <Rail groups={railShown} total={tickets.length} selKey={selKey} collapsed={railCollapsed} filter={railFilter} folded={railFolded}
        narrow={narrow} attention={attention} selId={selTicket ? selTicket.id || selTicket.dir : null} focusFilter={railFocus}
        onPick={k => { pick(k); if (narrow) setRailOver(false); }} onToggle={toggleRail} onFilter={setRailFilter} onFold={foldRail}/>
      <main className="stage">
        {SHOWN.map(s => <section key={s} className={"screen" + (s === "new task" ? " nt-wide" : "") + (s === screen ? " is-on" : "")}
          data-s={s} id={SCREEN_IDS[s]}>
          {s !== screen ? null
            : s === "inspector" ? <Inspector corpus={corpus} today={today} t={selTicket} tokenOf={tokenOf} notice={bootNotice}
              sel={sel} view={view} dlFilter={dlFilter} missNotice={missNotice} fullClosed={fullClosed}
              decSort={decSort} iwSort={iwSort} jump={jump} jumped={jumped} arrows={!packsOpen} act={inspectorActions}/>
            : s === "reviews" ? <Reviews corpus={corpus} today={today} t={selTicket} tokenOf={tokenOf} round={revSel} notice={revNotice}
              dlFilter={revDlFilter} decSort={decSort} iwSort={iwSort} act={reviewsActions}/>
            : s === "watchboard" ? <Watchboard corpus={corpus} today={today} sort={wbSort} show={wbShow}
              onSort={sortBoard} onToggleState={toggleState} onOpen={openWatch}/>
            : s === "ledgers" ? <>
              <div id="scrCalib"><Calibration corpus={corpus} today={today} onCell={openLedgerCell}/></div>
              <Ledgers corpus={corpus} today={today} sort={laSort} status={lgFilter} conf={lgConf}
                onSort={k => setLaSort(prev => ({k, d: prev.k === k ? -prev.d : 1}))} onStatus={setLgFilter} onConf={setLgConf} onOpen={openWatch}/></>
            : s === "new task" ? <NewTask nt={nt}/>
            : null}
        </section>)}
      </main>
        </>}
    </div>
    {packsOpen ? <PackDrawer packs={packs} sel={selPack} corpus={corpus} today={today} t={selTicket}
      advisories={advisories} bootNotice={bootNotice} copyLabel={copyLabel}
      onPick={name => { setSelPack(name); setCopyLabel(null); }} onCopy={copyPack} onClose={closePacks}/> : null}
  </div>;
}

export {App};
export type {AppProps};
