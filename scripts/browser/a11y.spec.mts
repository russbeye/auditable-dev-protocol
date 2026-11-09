/* R12 in a real engine: Tab walks each screen in document order with a
   visible ring on every stop, New task's spoken verdict reaches its live
   region, and nothing moves under reduced motion. */
import {everyScreen, expect, go, test, type Page} from "./fixture.mts";

test.use({viewport: {width: 1440, height: 900}});

/* The controls a reader can reach by Tab, in document order. We read
   visibility from the engine, so a control in a hidden screen, a folded
   menu, or a closed details body drops out. A summary is the one focusable
   part of a closed details element. */
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const reachable = (page: Page) => page.locator(TABBABLE).evaluateAll(els => els
  .filter(e => (e as HTMLElement).checkVisibility({visibilityProperty: true}) && !e.closest("details:not([open]) > :not(summary)"))
  .map((e, i) => { e.setAttribute("data-tabpos", String(i)); return i; }).length);

// A click can start a jump or a spy run that lands a frame later, so we let
// two frames pass before we read the screen.
const settle = (page: Page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

/* The ring's look comes from the stylesheet or from the engine's own focus
   style, so we compare the focused control with itself unfocused. A change
   to the outline, the box shadow, or the border counts as a ring. */
const RING = ["outline-style", "outline-width", "outline-color", "box-shadow", "border-top-color"];
async function ringOf(page: Page): Promise<string | null> {
  return page.evaluate(props => {
    const a = document.activeElement as HTMLElement;
    const on = props.map(p => getComputedStyle(a).getPropertyValue(p));
    const ringed = getComputedStyle(a).outlineStyle !== "none" && parseFloat(getComputedStyle(a).outlineWidth) > 0;
    a.blur();
    const off = props.map(p => getComputedStyle(a).getPropertyValue(p));
    a.focus({focusVisible: true} as FocusOptions);
    return ringed || on.some((v, i) => v !== off[i]) ? null : a.outerHTML.slice(0, 120);
  }, RING);
}

test("Tab reaches every control in document order and shows a ring on each", async ({page, server}) => {
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
        return {pos: a.getAttribute("data-tabpos"), scroller: a.scrollHeight > a.clientHeight || a.scrollWidth > a.clientWidth,
          html: a.outerHTML.slice(0, 120)};
      });
      if (at.pos == null && !at.scroller){ faults.push(`${where}: Tab landed on ${at.html}`); break; }
      if (at.pos != null) seen.push(Number(at.pos));
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

// OT-MC012-19 needs a screen reader. This test proves the text reaches the
// region, which is what a reader would announce.
test("New task's live region speaks the verdict after a start and after the task id is blanked", async ({page, server}) => {
  await page.goto(server.url + "#t=FX091");
  await page.click('[data-op="startfrom"]');
  await expect(page.locator(".screen.is-on")).toHaveAttribute("data-s", "new task");
  const live = page.locator("#ntLive");
  await expect(live).toHaveAttribute("aria-live", "polite");
  await expect(live).not.toHaveText("");
  const first = await live.textContent();
  await page.fill('#scrNew .nt-in[data-nf="task.id"]', "");
  await expect(live).not.toHaveText(first!);
  await expect(live).not.toHaveText("");
});

test.describe("under reduced motion", () => {
  test.use({reducedMotion: "reduce"});

  test("no screen runs an animation or a transition", async ({page, server}) => {
    const moving: string[] = [];
    await everyScreen(page, server.url, async where => {
      // A hover or a focus starts a transition, so we press on the theme
      // toggle and hover a rail entry before we look.
      await page.hover(".rentry");
      await page.focus("#themeBtn");
      const names = await page.evaluate(() => document.getAnimations().map(a =>
        (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? a.constructor.name));
      if (names.length) moving.push(`${where}: ${names.join(", ")}`);
    });
    await go(page, "inspector");
    await page.click("#themeBtn");
    const after = await page.evaluate(() => document.getAnimations().length);
    expect(moving).toEqual([]);
    expect(after).toBe(0);
  });
});
