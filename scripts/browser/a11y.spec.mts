/* R12 in a real engine: Tab walks each screen in document order with a
   visible ring on every stop, New task's spoken verdict reaches its live
   region, and nothing moves under reduced motion. */
import type {Page} from "@playwright/test";
import {everyScreen, expect, go, open, test} from "./fixture.mts";

test.use({viewport: {width: 1440, height: 900}});

/* The controls a reader can reach by Tab, in document order. We read
   visibility from the engine, so a control in a hidden screen, a folded
   menu, or a closed details body drops out. A summary is the one focusable
   part of a closed details element. */
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const reachable = (page: Page) => page.locator(TABBABLE).evaluateAll(els => els
  .filter(e => (e as HTMLElement).checkVisibility({visibilityProperty: true}) && !e.closest("details:not([open]) > :not(summary)") && !e.closest("[inert]"))
  .map((e, i) => { e.setAttribute("data-tabpos", String(i)); return i; }).length);

// A click can start a jump or a spy run that lands a frame later, so we let
// two frames pass before we read the screen.
const settle = (page: Page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

/* The ring's look comes from the stylesheet or from the engine's own focus
   style, so we compare the focused control with itself unfocused. A change
   to the outline, the box shadow, or the border counts as a ring. The theme
   eases a field's border color in over 0.12 s, so we finish every running
   transition before each read, or we could compare two midway colors. The
   header's blink never ends, so we leave animations alone. */
const RING = ["outline-style", "outline-width", "outline-color", "box-shadow", "border-top-color"];
async function ringOf(page: Page): Promise<string | null> {
  return page.evaluate(props => {
    const done = () => document.getAnimations().forEach(x => { if (x instanceof CSSTransition) x.finish(); });
    const a = document.activeElement as HTMLElement;
    done();
    const on = props.map(p => getComputedStyle(a).getPropertyValue(p));
    const ringed = getComputedStyle(a).outlineStyle !== "none" && parseFloat(getComputedStyle(a).outlineWidth) > 0;
    a.blur();
    done();
    const off = props.map(p => getComputedStyle(a).getPropertyValue(p));
    a.focus({focusVisible: true} as FocusOptions);
    return ringed || on.some((v, i) => v !== off[i]) ? null : a.outerHTML.slice(0, 120);
  }, RING);
}

test("Tab reaches every control in document order and shows a ring on each", async ({page, server}) => {
  // The walk presses Tab once per control on every screen, which runs past
  // the default 30 s in CI's WebKit.
  test.setTimeout(180_000);
  const faults: string[] = [];
  await everyScreen(page, server.url, async where => {
    await settle(page);
    const n = await reachable(page);
    expect(await page.locator("[tabindex]").evaluateAll(els => els.filter(e => (e as HTMLElement).tabIndex > 0).length)).toBe(0);
    // A click leaves the engine's Tab start point at the clicked control, so
    // we focus a mark at the top of the body that Tab itself never reaches.
    await page.evaluate(() => {
      const mark = document.createElement("span");
      mark.id = "tabStart"; mark.tabIndex = -1;
      document.body.prepend(mark); mark.focus();
      const seenOff = new MutationObserver(ms => { for (const m of ms) (m.target as Element).setAttribute("data-wasdisabled", ""); });
      seenOff.observe(document.body, {subtree: true, attributeFilter: ["disabled"]});
      (window as unknown as {seenOff: MutationObserver}).seenOff = seenOff;
    });
    const seen: number[] = [];
    // Firefox also stops on a container that scrolls, which is a real stop
    // with its own ring, so we let one through while it scrolls.
    for (let i = 0; i < n + 4 && seen.at(-1) !== n - 1; i++){
      await page.keyboard.press("Tab");
      const at = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        if (!a || a === document.body) return {pos: null, scroller: false, html: "body"};
        // Firefox stops on a box that overflows by a fraction of a pixel,
        // which the rounded scroll sizes hide, so we also read its own
        // scroll limits where the engine has them.
        const max = a as HTMLElement & {scrollTopMax?: number; scrollLeftMax?: number};
        return {pos: a.getAttribute("data-tabpos"), scroller: a.scrollHeight > a.clientHeight || a.scrollWidth > a.clientWidth
          || (max.scrollTopMax || 0) > 0 || (max.scrollLeftMax || 0) > 0, html: a.outerHTML.slice(0, 120)};
      });
      if (at.pos == null && !at.scroller){ faults.push(`${where}: Tab landed on ${at.html}`); break; }
      if (at.pos != null) seen.push(Number(at.pos));
      // Focus that drops to the body between two reads means the app
      // removed, hid, or disabled the control under it, so we name that
      // control and its state rather than a missing ring.
      const dropped = await page.evaluate(p => {
        if (document.activeElement !== document.body) return null;
        const e = p == null ? null : document.querySelector<HTMLElement>(`[data-tabpos="${p}"]`);
        return !e ? "a control no longer in the page"
          : `${e.outerHTML.slice(0, 120)}, connected ${e.isConnected}, visible ${e.checkVisibility()}, disabled ${e.matches(":disabled")}`;
      }, at.pos);
      if (dropped){ faults.push(`${where}: focus dropped to the body from ${at.html}, which is now ${dropped}`); break; }
      const bare = await ringOf(page);
      if (bare) faults.push(`${where}: no ring on ${bare}`);
    }
    // A stop may only be skipped while its control is disabled. The section
    // steppers disable at either end, and focus moving into the full log
    // can scroll the spy onto the first section for a moment.
    const skippable = await page.locator("[data-wasdisabled]").evaluateAll(els => els.map(e => Number(e.getAttribute("data-tabpos"))));
    const want = [...Array(n).keys()].filter(i => !skippable.includes(i) || seen.includes(i));
    if (seen.join() !== want.join()) faults.push(`${where}: order ${seen.join(" ")} of ${n}`);
    await page.evaluate(() => {
      (window as unknown as {seenOff: MutationObserver}).seenOff.disconnect();
      document.getElementById("tabStart")?.remove();
      document.querySelectorAll("[data-tabpos], [data-wasdisabled]").forEach(e => { e.removeAttribute("data-tabpos"); e.removeAttribute("data-wasdisabled"); });
    });
  });
  expect(faults).toEqual([]);
});

// PM5. Each overlay opens from the keyboard, Escape closes it, and focus
// returns to the control that opened it, with its ring showing. FX004's
// Decision Log draws a chip that stands for several citing sections. A
// reader moves inside the chip menu with the arrow keys, because Tab closes it.
for (const [name, opener, panel, hash, move] of [["⋯ menu", "#menuBtn", "#hdrMenu", "", "Tab"], ["Packs drawer", "#packsBtn", "#packDrawer", "", "Tab"],
  ["cited-in chip menu", "button.adp-chip[aria-haspopup]", "[role=menu]", "#t=FX004&s=sec-decision-log", "ArrowDown"]])
  test(`the ${name} closes on Escape and hands focus back to its opener`, async ({page, server}) => {
    await open(page, server.url + hash);
    await page.focus(opener);
    await page.keyboard.press("Enter");
    await expect(page.locator(panel)).toBeVisible();
    await page.keyboard.press(move);
    expect(await page.evaluate(sel => !!document.activeElement?.closest(sel), panel)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator(panel)).toHaveCount(0);
    await expect(page.locator(opener)).toBeFocused();
    expect(await ringOf(page)).toBeNull();
  });

// The chip menu sits on the body, after the whole app in tab order. Tab and
// Shift+Tab close it and move on from the chip, so a reader keeps their place.
for (const [key, step] of [["Tab", 1], ["Shift+Tab", -1]] as const)
  test(`${key} closes an open chip menu and moves focus on from its chip`, async ({page, server}) => {
    await open(page, server.url + "#t=FX004&s=sec-decision-log");
    const chip = "button.adp-chip[aria-haspopup]";
    const want = await page.evaluate(([sel, step]) => {
      const all = [...document.querySelectorAll<HTMLElement>("#root a[href], #root button:not([disabled]), #root select, #root input, #root textarea, #root [tabindex]:not([tabindex='-1'])")]
        .filter(e => e.checkVisibility());
      const i = all.indexOf(document.querySelector<HTMLElement>(sel as string)!);
      // FX004's chip is the last control in the app, so Tab from it leaves for the body.
      return all[i + (step as number)]?.outerHTML.slice(0, 80) ?? "BODY";
    }, [chip, step] as const);
    await page.focus(chip);
    await page.keyboard.press("Enter");
    await expect(page.locator("[role=menu]")).toBeVisible();
    await page.keyboard.press(key);
    await expect(page.locator("[role=menu]")).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement === document.body ? "BODY" : document.activeElement!.outerHTML.slice(0, 80))).toBe(want);
  });

// OT-MC012-19 needs a screen reader. This test proves the text reaches the
// region, which is what a reader would announce.
// A start leaves the task id blank, so typing one flips the verdict.
test("New task's live region speaks the verdict after a start and after the task id is typed", async ({page, server}) => {
  await open(page, server.url + "#t=FX091");
  await page.click('[data-op="startfrom"]');
  await expect(page.locator(".screen.is-on")).toHaveAttribute("data-s", "new task");
  const live = page.locator("#ntLive");
  await expect(live).toHaveAttribute("aria-live", "polite");
  await expect(live).not.toHaveText("");
  const first = await live.textContent();
  await page.fill('#scrNew [data-nf="task.id"]', "FX-091");
  await expect(live).not.toHaveText(first!);
  await expect(live).not.toHaveText("");
  // The region speaks but shows nothing: its box is one pixel or smaller.
  const box = await live.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(1);
  expect(box!.height).toBeLessThanOrEqual(1);
});

test.describe("under reduced motion", () => {
  test.use({reducedMotion: "reduce"});

  test("no screen runs an animation or a transition", async ({page, server}) => {
    const moving: string[] = [];
    await everyScreen(page, server.url, async where => {
      // A hover or a focus starts a transition, so we focus the ⋯ button
      // and hover a rail entry before we look. The drawer hides the rail.
      if (!await page.locator("#packDrawer").count()){ await page.hover("#rail [data-key]"); await page.focus("#menuBtn"); }
      const names = await page.evaluate(() => document.getAnimations().map(a =>
        (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? a.constructor.name));
      if (names.length) moving.push(`${where}: ${names.join(", ")}`);
    });
    await go(page, "inspector");
    await page.click("#menuBtn");
    await page.click('[data-theme-choice="light"]');
    const after = await page.evaluate(() => document.getAnimations().length);
    expect(moving).toEqual([]);
    expect(after).toBe(0);
  });
});

/* R9 in a real engine. On every screen, in both themes, we take each element
   that holds its own text, flatten every background from the page ground up
   to it, and measure its color against that ground. Text must reach 4.5:1.
   The one exception is faint, which the system keeps for non-essential text,
   and we name each faint pair the screens draw so a new one needs a look. A
   control's own pairs are tokens, so design-css.test.js checks them. */
const FAINT_PAIRS = ["dark faint on bg", "dark faint on panel", "dark faint on panel-2",
  "light faint on bg", "light faint on panel", "light faint on panel-2"];
function textPairs(){
  const root = getComputedStyle(document.documentElement);
  const NAMES = ["bg", "panel", "panel-2", "inset", "code-bg", "ink", "ink-2", "dim", "faint", "blue", "blue-bright", "warn", "ok", "bad", "unk", "code-fg"];
  // A computed color reads as rgb() or, for a mixed color, as color(srgb) with channels from 0 to 1.
  const parse = (s: string) => { const n = (s.match(/[\d.]+/g) || []).map(Number);
    return s.startsWith("color(") ? [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1] : [n[0], n[1], n[2], n[3] ?? 1]; };
  const probe = document.createElement("i");
  document.body.append(probe);
  const tok = Object.fromEntries(NAMES.map(n => { probe.style.color = `var(--${n})`; return [n, parse(getComputedStyle(probe).color)]; }));
  probe.remove();
  const name = (c: number[]) => Object.entries(tok).find(([, v]) => Math.abs(v[0] - c[0]) + Math.abs(v[1] - c[1]) + Math.abs(v[2] - c[2]) < 3)?.[0] ?? "a tint";
  const over = (top: number[], under: number[]) => [0, 1, 2].map(i => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const lum = (c: number[]) => { const f = (x: number) => { x /= 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; };
    return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const out: Record<string, {ratio: number; at: string}> = {};
  for (const el of document.querySelectorAll<HTMLElement>("body *")){
    if (!el.checkVisibility({opacityProperty: true, visibilityProperty: true})) continue;
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent!.trim())) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1 || el.closest("[disabled], [aria-disabled=true]")) continue;
    let ground = tok.bg;
    const chain: HTMLElement[] = [];
    for (let e: HTMLElement | null = el; e; e = e.parentElement) chain.unshift(e);
    for (const e of chain){ const bg = parse(getComputedStyle(e).backgroundColor); if (bg[3] > 0) ground = over(bg, ground); }
    const fg = parse(getComputedStyle(el).color), flat = over(fg, ground);
    const a = lum(flat), b = lum(ground), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    const key = `${document.documentElement.getAttribute("data-theme")} ${name(fg)} on ${name(ground)}`;
    if (!out[key] || out[key].ratio > ratio) out[key] = {ratio: +ratio.toFixed(2), at: el.outerHTML.slice(0, 80)};
  }
  return out;
}
test("every text pair on every screen reaches 4.5:1 in both themes, apart from the named faint pairs", async ({page, server}) => {
  test.setTimeout(240_000);
  // A control fades its color over 120ms when its state changes. For example,
  // the prev button fades from faint to ink as it enables. We turn motion off
  // so that we measure each color where it settles, never a blend partway.
  await page.emulateMedia({reducedMotion: "reduce"});
  const pairs: Record<string, {ratio: number; at: string}> = {};
  const take =async () => { for (const [k, v] of Object.entries(await page.evaluate(textPairs))) if (!pairs[k] || pairs[k].ratio > v.ratio) pairs[k] = v; };
  for (const theme of ["dark", "light"]){
    await page.addInitScript(t => localStorage.setItem("adp-theme", t), theme);
    await everyScreen(page, server.url, take);
    await page.click("#menuBtn");
    await take();
  }
  const low = Object.entries(pairs).filter(([k, v]) => v.ratio < 4.5 && !/ faint on /.test(k)).map(([k, v]) => `${k} ${v.ratio}:1 at ${v.at}`);
  expect(low).toEqual([]);
  expect(Object.keys(pairs).filter(k => / faint on /.test(k)).sort()).toEqual(FAINT_PAIRS);
  expect(Object.keys(pairs).length).toBeGreaterThan(40);
});
