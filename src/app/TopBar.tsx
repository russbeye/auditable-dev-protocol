/* The top bar and its ⋯ menu, drawn with the design system's TopBar,
   Segmented, and Menu classes. The bar leads with the live dot and the repo
   name, then the product label, the three views, and the actions. */
import {useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties} from "react";
import * as S from "../lib/adp-shell-lib.ts";
import type {Screen, ThemeChoice} from "../lib/adp-shell-lib.ts";

type Live = "IDLE" | "WATCHING" | "CACHED";
type TopBarProps = {
  repo: string;
  live: Live;
  // True once a first load failed and nothing is cached. The word stays
  // IDLE, and the dot, the word's color, and a note say the load failed.
  down: boolean;
  // The time of the last good load, which the bar shows once updates stop.
  at: number | null;
  screen: Screen;
  theme: ThemeChoice;
  about: string[];
  shortcuts: [string, string][];
  onView(s: Screen): void;
  onPacks(opener: HTMLElement): void;
  onNewTask(): void;
  onTheme(t: ThemeChoice): void;
  inert: boolean;
};

const THEMES: [ThemeChoice, string][] = [["system", "System"], ["dark", "Dark"], ["light", "Light"]];
const clock = (t: number) => {
  const d = new Date(t), pad = (n: number) => String(n).padStart(2, "0");
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
};

/* The bar folds when its full row cannot fit. The folded bar keeps the
   repo and the actions on the first row and moves the views to a second
   row, as the 720px boards draw it. We add up the widths the full row
   needs, measured the same way in both forms, so one window width always
   gives one answer and the two forms cannot flip back and forth. */
function fullWidth(bar: HTMLElement): number{
  const w = (sel: string) => (bar.querySelector(sel) as HTMLElement | null)?.scrollWidth || 0;
  const links = [...bar.querySelectorAll<HTMLElement>(".adp-nav a")];
  const nav = links.reduce((sum, a) => sum + a.scrollWidth, 0) + 4 * Math.max(0, links.length - 1);
  // Side padding is 24 on each side, the gap between the three blocks is 32,
  // and the repo block holds the dot, the name, the word, and the product
  // label with 12 between each.
  const repo = 8 + 12 + w("[data-part=name]") + 12 + w("#liveTxt") + 12 + w(".adp-topbar__product")
    + (bar.querySelector(".adp-topbar__since") ? 12 + w(".adp-topbar__since") : 0);
  return 48 + repo + 32 + nav + 32 + w(".adp-topbar__actions");
}

function TopBar(p: TopBarProps){
  const barRef = useRef<HTMLElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const measure = useCallback(() => {
    const bar = barRef.current;
    // jsdom lays nothing out, so a bar with no width keeps its full form.
    if (!bar || !bar.clientWidth) return;
    setCompact(fullWidth(bar) > bar.clientWidth);
  }, []);
  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);
  // The web fonts load with swap, so the first measure can run on the
  // fallback face. A swap changes the widths without a render, so we measure
  // again when the fonts are ready and after each later font load.
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    let alive = true;
    fonts.ready.then(() => { if (alive) measure(); });
    fonts.addEventListener("loadingdone", measure);
    return () => { alive = false; fonts.removeEventListener("loadingdone", measure); };
  }, [measure]);

  // Escape or a click outside closes the menu. Escape hands focus back to
  // the ⋯ button, so the keyboard user lands where the menu opened.
  const closeMenu = useCallback((refocus: boolean) => {
    setMenuOpen(false);
    if (refocus) menuBtn.current?.focus();
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(true); };
    const click = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && !menuRef.current?.contains(t) && !menuBtn.current?.contains(t)) closeMenu(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("click", click);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("click", click); };
  }, [menuOpen, closeMenu]);

  const view = S.viewOf(p.screen);
  const cached = p.live === "CACHED";
  // The folded bar draws its rule under the views row, so the inner row
  // drops its own border and its fixed height.
  const bar: CSSProperties = compact ? {height: "auto", flexWrap: "wrap", rowGap: 0, borderBottom: 0, paddingBottom: 0} : {};
  const nav: CSSProperties = compact ? {order: 1, flexBasis: "100%", height: 40, marginLeft: -12} : {};
  const product: CSSProperties = compact ? {position: "absolute", visibility: "hidden"} : {};
  // The zero floor keeps the bar at the window's width, so a row too wide
  // overflows the bar and never the page. The bar is positioned only while
  // its menu is open, because a positioned bar paints over the film grain.
  return <header ref={barRef} className="adp-topbar" id="topbar" inert={p.inert}
    style={{minWidth: 0, ...(menuOpen ? {position: "relative", zIndex: 2} : {}), ...(compact ? {boxShadow: "inset 0 -1px 0 var(--line)"} : {}), ...bar}}>
    <div className="adp-topbar__repo" style={compact ? {height: 52} : undefined}>
      <span className={"adp-livedot" + (p.live === "WATCHING" ? "" : " adp-livedot--cached")} aria-hidden="true"
        style={p.live === "IDLE" ? {boxShadow: "inset 0 0 0 2px var(" + (p.down ? "--bad" : "--faint") + ")"} : undefined}></span>
      <span data-part="name" style={{overflow: "hidden", textOverflow: "ellipsis"}}>{p.repo}</span>
      <span id="liveTxt" role="status" className="adp-topbar__state"
        style={p.live === "IDLE" && p.down ? {color: "var(--bad)"} : p.live === "WATCHING" || p.live === "IDLE" ? {color: "var(--dim)"} : undefined}>{p.live}</span>
      {cached && p.at != null ? <span className="adp-topbar__since">last update {clock(p.at)} · reconnecting</span> : null}
      {p.live === "IDLE" && p.down ? <span className="adp-topbar__since">no index yet · retrying</span> : null}
      <span className="adp-topbar__product" style={product}>ADP · Mission Control</span>
    </div>
    <nav className="adp-nav" aria-label="Views" style={nav}>
      {S.VIEWS.map(v => <a key={v.screen} href={"#" + (v.screen === "inspector" ? "" : "v=" + v.screen)} data-s={v.screen}
        aria-current={view === v.screen ? "page" : undefined}
        onClick={e => { e.preventDefault(); p.onView(v.screen); }}>{v.label}</a>)}
    </nav>
    <div className="adp-topbar__actions" style={compact ? {height: 52} : undefined}>
      <button type="button" className="adp-btn adp-btn--quiet" id="packsBtn" onClick={e => p.onPacks(e.currentTarget)}>Packs</button>
      <button type="button" className="adp-btn" id="newTaskBtn" aria-pressed={p.screen === "new task"} onClick={p.onNewTask}>+ New task</button>
      <button type="button" className="adp-btn adp-btn--icon" id="menuBtn" ref={menuBtn} aria-label="Settings and theme"
        aria-expanded={menuOpen} aria-controls="hdrMenu"
        style={menuOpen ? {borderColor: "var(--line-bright)", background: "var(--panel-2)", color: "var(--ink)"} : undefined} onClick={() => menuOpen ? closeMenu(false) : setMenuOpen(true)}>⋯</button>
    </div>
    {menuOpen ? <div className="adp-menu" id="hdrMenu" ref={menuRef} role="dialog" aria-label="Settings and theme"
      style={{position: "absolute", top: "100%", right: 24, zIndex: 10, maxWidth: "calc(100vw - 48px)"}}>
      <div className="adp-menu__section">
        <p className="adp-label" id="themeLbl">Theme</p>
        <div className="adp-seg adp-seg--full" role="radiogroup" aria-labelledby="themeLbl" style={{marginTop: 8}}>
          {THEMES.map(([t, label]) => <button key={t} type="button" role="radio" aria-checked={p.theme === t} data-theme-choice={t}
            onClick={() => p.onTheme(t)}>{label}</button>)}
        </div>
      </div>
      <div className="adp-menu__section">
        <p className="adp-label">Keyboard</p>
        <dl className="adp-keys">
          {p.shortcuts.map(([k, what]) => <div key={k} style={{display: "contents"}}>
            <dt><kbd className="adp-kbd">{k}</kbd></dt><dd>{what}</dd></div>)}
        </dl>
      </div>
      <div className="adp-menu__section">
        <p className="adp-label">About</p>
        {/* The first line is the index's own summary in prose. The lines after
            it name a folder and a port, so they take the mono face. */}
        {p.about.map((line, i) => <p key={i} className="adp-meta" style={i ? {margin: 0, fontFamily: "var(--font-mono)", fontSize: 12} : {margin: 0}}>{line}</p>)}
      </div>
    </div> : null}
  </header>;
}

export {TopBar};
export type {Live};
