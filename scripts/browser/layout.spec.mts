/* R11 in a real layout engine: at 720px nothing scrolls sideways, and at
   1290px a watch's window prose wraps while its ids and status words hold on
   one line. jsdom has no layout, so these checks live here. */
import {everyScreen, expect, go, open, test} from "./fixture.mts";

test.describe("at 720px", () => {
  test.use({viewport: {width: 720, height: 900}});

  test("no screen scrolls the page or the stage sideways", async ({page, server}) => {
    const wide: string[] = [];
    await everyScreen(page, server.url, async where => {
      const m = await page.evaluate(() => {
        const d = document.documentElement, st = document.querySelector(".stage")!;
        return {page: d.scrollWidth - d.clientWidth, stage: st.scrollWidth - st.clientWidth};
      });
      if (m.page > 0 || m.stage > 0) wide.push(`${where}: page +${m.page}px, stage +${m.stage}px`);
    });
    expect(wide).toEqual([]);
  });

  // OT-MC012-11. The header folds into its menu here, and the folded row
  // fits the window.
  test("the header folds and fits the window", async ({page, server}) => {
    await open(page, server.url);
    const hdr = page.locator(".shell header");
    await expect(hdr).toHaveClass(/is-compact/);
    expect(await hdr.evaluate(h => h.scrollWidth - h.clientWidth)).toBe(0);
    await page.click("#menuBtn");
    expect(await hdr.evaluate(h => h.scrollWidth - h.clientWidth)).toBe(0);
  });
});

test.describe("at 1920px", () => {
  test.use({viewport: {width: 1920, height: 900}});

  test("the header shows its full row on one line", async ({page, server}) => {
    await open(page, server.url);
    const hdr = page.locator(".shell header");
    await expect(hdr).not.toHaveClass(/is-compact/);
    const tops = await page.locator(".brand, #liveChit, #themeBtn, .mtab, #newTaskBtn").evaluateAll(els =>
      els.map(e => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2)));
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
  });
});

test.describe("at 1290px", () => {
  test.use({viewport: {width: 1290, height: 900}});

  // The MC-010 wrap. A line count comes from the client rects of the cell's
  // text, so we count lines the same way in every engine.
  test("a watch's window prose wraps while its ids and status stay on one line", async ({page, server}) => {
    await open(page, server.url);
    await go(page, "watchboard");
    const row = page.locator('.wbrow[data-wid="OT-BX001-1"]');
    const lines = (sel: string) => row.locator(sel).evaluate(el => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size;
    });
    expect(await lines("td.mono")).toBeGreaterThan(1);
    expect(await lines('a.wbl[data-item="OT-BX001-1"]')).toBe(1);
    expect(await lines(".nw")).toBe(1);
    const over = await page.evaluate(() => {
      const d = document.documentElement, st = document.querySelector(".stage")!;
      return Math.max(d.scrollWidth - d.clientWidth, st.scrollWidth - st.clientWidth);
    });
    expect(over).toBe(0);
  });
});
