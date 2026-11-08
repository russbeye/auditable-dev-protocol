/* Mission control as one React tree: the header, the rail, the screens, and
   the footer. The screens other than the watchboard render empty until
   their components exist. */
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import * as D from "../lib/adp-derive-lib.ts";
import * as S from "../lib/adp-shell-lib.ts";
import type {DueState} from "../lib/adp-derive-lib.ts";
import type {Ticket} from "../lib/adp-index-lib.ts";
import type {FetchFn, HashSelection, RailModelGroup, Screen, SortState} from "../lib/adp-shell-lib.ts";
import {useLiveCorpus, type EventFeed} from "./live.ts";
import {Rail} from "./Rail.tsx";
import {Watchboard} from "./Watchboard.tsx";

type AppProps = {fetchFn: FetchFn; openFeed: () => EventFeed | null};
// We hold the selected ticket by its directory, not by its token. A
// directory that arrives with the same id changes the token, and the
// selection then follows the ticket rather than stranding on the old token.
type Sel = {dir: string | null; s: string | null; item: string | null};

const SCREEN_IDS: Record<Screen, string> = {"inspector": "scrInspector", "reviews": "scrReviews", "watchboard": "scrWatch",
  "ledgers": "scrLedgers", "calibration": "scrCalib", "resume pack": "scrPack", "new task": "scrNew"};
const NO_SEL: Sel = {dir: null, s: null, item: null};

function readHash(): HashSelection | null {
  try { return S.hashRead(location.hash); } catch { return null; }
}

function App({fetchFn, openFeed}: AppProps){
  const {corpus, stale, booting} = useLiveCorpus(fetchFn, openFeed);
  // The hash is read before the corpus exists, so the ticket it names waits
  // as pending until the first corpus lands. A screen needs no corpus.
  const [pending, setPending] = useState<HashSelection | null>(readHash);
  const [screen, setScreen] = useState<Screen>(() =>
    pending && pending.v && (S.SCREENS as string[]).includes(pending.v) ? pending.v as Screen : "inspector");
  const [sel, setSel] = useState<Sel>(NO_SEL);
  const [settled, setSettled] = useState(false);
  // The closed group starts collapsed, because it is the archive and its
  // count says how much sits inside.
  const [railCollapsed, setRailCollapsed] = useState<ReadonlySet<string>>(() => new Set(["closed"]));
  // The board opens as the to-do surface, with closed watches hidden and
  // the due column in its derived order: overdue first, unanchored last.
  const [wbShow, setWbShow] = useState<ReadonlySet<DueState>>(() => new Set<DueState>(["overdue", "soon", "upcoming", "unanchored"]));
  const [wbSort, setWbSort] = useState<SortState>({k: "due", d: 1});
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme"));
  const [menuOpen, setMenuOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const hdrRef = useRef<HTMLElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

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
        if (t) next = {dir: t.dir, s: pending.s, item: pending.item};
        else dead = true;
      }
      setPending(null);
    }
    if (!next.dir && !dead){
      const first = railModel.find(g => g[1].length);
      const t = first && byToken(first[1][0].key);
      if (t) next = {dir: t.dir, s: null, item: null};
    }
    if (next !== sel) setSel(next);
  }, [corpus, settled, pending, sel, byToken, railModel]);

  /* The URL follows the reader once the boot load is done, so a reload lands
     where the reader was. The inspector writes no view token, which keeps
     its hashes the same as every link minted before the token existed. A
     ticket link still waiting for its corpus rides along until the reader
     selects something. An empty composition clears the hash, so a reload
     never lands on a screen the reader already left. */
  useEffect(() => {
    if (booting) return;
    const pend = !sel.dir && pending && pending.t ? pending : {t: selKey ?? sel.dir, s: sel.s, item: sel.item};
    const h = S.hashWrite({v: screen === "inspector" ? null : screen, t: pend.t, s: pend.s, item: pend.item});
    try { history.replaceState(null, "", h || "#"); } catch {}
  }, [booting, screen, sel, selKey, pending]);

  // The header folds into its menu when the full row cannot fit on one line.
  // We measure the full form with every label held to one line, never the
  // compact form, so one window width gives one answer and the two forms
  // cannot flip back and forth.
  const measure = useCallback(() => {
    const hdr = hdrRef.current;
    if (!hdr) return;
    const had = hdr.classList.contains("is-compact");
    hdr.classList.remove("is-compact");
    hdr.classList.add("is-measuring");
    const over = hdr.scrollWidth > hdr.clientWidth;
    hdr.classList.remove("is-measuring");
    hdr.classList.toggle("is-compact", had);
    setCompact(over);
  }, []);
  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // A pick from the open menu hides the control that holds focus. We hand
  // focus back to the menu button, so the next Tab goes on from the header
  // and does not restart at the top of the page.
  const closeMenu = useCallback(() => {
    const a = document.activeElement;
    if (a && a.closest(".hdrmenu")) menuBtnRef.current?.focus();
    setMenuOpen(false);
  }, []);
  useEffect(() => { if (!compact && menuOpen) closeMenu(); }, [compact, menuOpen, closeMenu]);
  useEffect(() => {
    if (!menuOpen) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(); };
    const click = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || !t.closest || (!t.closest(".hdrmenu") && !t.closest(".menubtn"))) closeMenu();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("click", click);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("click", click); };
  }, [menuOpen, closeMenu]);

  // A pick from the full header keeps focus on the control it pressed. Only
  // a pick from the open menu hands focus to the menu button.
  const go = (s: Screen) => { setScreen(s); if (menuOpen) closeMenu(); };
  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    // The library writes the theme and its stored choice. We draw the icon,
    // so the library finds no icon element to write.
    S.applyTheme({documentElement: document.documentElement, getElementById: () => null}, localStorage, next);
    setTheme(next);
  };
  const pick = (key: string) => {
    const t = byToken(key);
    setSel({dir: t ? t.dir : key, s: null, item: null});
    if (screen !== "resume pack" && screen !== "reviews") setScreen("inspector");
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
    setScreen("inspector");
  };

  // IDLE is a page with no corpus yet. CACHED is a corpus whose last reload
  // failed or whose event stream broke, kept on screen until a reload
  // answers. WATCHING is a corpus the server keeps current.
  const live = !corpus ? "IDLE" : stale ? "CACHED" : "WATCHING";
  const hdrClass = [compact ? "is-compact" : "", menuOpen ? "menu-open" : ""].filter(Boolean).join(" ");
  return <div className="shell">
    <header ref={hdrRef} className={hdrClass || undefined}>
      <span className="brand">ADP · <b>MISSION CONTROL</b></span>
      <span className={"chit poll poll-" + (live === "WATCHING" ? "ok" : live === "CACHED" ? "warn" : "idle")} id="liveChit" role="status"><i aria-hidden="true"></i><span id="liveTxt">{live}</span></span>
      <button type="button" className="chit click" id="themeBtn" title="Toggle light / dark" onClick={toggleTheme}><span id="ttIcon" aria-hidden="true">{theme === "dark" ? "☾" : "☀"}</span> theme</button>
      <button type="button" className="menubtn" id="menuBtn" ref={menuBtnRef} aria-expanded={menuOpen} aria-controls="hdrMenu"
        onClick={() => menuOpen ? closeMenu() : setMenuOpen(true)}><span aria-hidden="true">≡</span> <span id="menuTxt">{screen}</span></button>
      <div className="hdrmenu" id="hdrMenu">
        <span className="chit" id="projChit">{S.projectChitText(corpus ? corpus.index : null)}</span>
        <nav className="tabs" id="tabs" role="tablist">
          {S.TAB_SCREENS.map(s => <button key={s} className={"mtab" + (s === screen ? " is-on" : "")} role="tab"
            aria-selected={s === screen} data-s={s} onClick={() => go(s)}>{s}</button>)}
        </nav>
        <button className={"newtask" + (screen === "new task" ? " is-on" : "")} id="newTaskBtn" onClick={() => go("new task")}>+ new task</button>
      </div>
    </header>
    <div className="main">
      <Rail groups={railModel} selKey={selKey} collapsed={railCollapsed} onPick={pick} onToggle={toggleRail}/>
      <main className="stage">
        {S.SCREENS.map(s => <section key={s} className={"screen" + (s === "new task" ? " nt-wide" : "") + (s === screen ? " is-on" : "")}
          data-s={s} id={SCREEN_IDS[s]}>
          {s === "watchboard" && screen === "watchboard"
            ? <Watchboard corpus={corpus} today={today} sort={wbSort} show={wbShow}
              onSort={sortBoard} onToggleState={toggleState} onOpen={openWatch}/>
            : null}
        </section>)}
      </main>
    </div>
    <footer id="foot">{S.footerText(corpus ? corpus.index : null)}</footer>
  </div>;
}

export {App};
export type {AppProps};
