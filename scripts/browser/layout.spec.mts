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

  // OT-MC012-11. The bar folds its views onto a second row here, the
  // folded bar fits the window, and so does the open ⋯ menu.
  test("the top bar folds and fits the window, and so does its menu", async ({page, server}) => {
    await open(page, server.url);
    const bar = page.locator("#topbar");
    await expect(page.locator("#topbar .adp-nav")).toHaveCSS("flex-basis", "100%");
    expect(await bar.evaluate(h => h.scrollWidth - h.clientWidth)).toBe(0);
    await page.click("#menuBtn");
    const box = await page.locator("#hdrMenu").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(720);
    expect(await bar.evaluate(h => h.scrollWidth - h.clientWidth)).toBe(0);
  });
});

test.describe("at 1920px", () => {
  test.use({viewport: {width: 1920, height: 900}});

  test("the top bar shows its full row on one line", async ({page, server}) => {
    await open(page, server.url);
    await expect(page.locator("#topbar .adp-nav")).not.toHaveCSS("flex-basis", "100%");
    const tops = await page.locator("#topbar .adp-livedot, #topbar [data-part=name], #liveTxt, .adp-topbar__product, .adp-nav a, #packsBtn, #newTaskBtn, #menuBtn").evaluateAll(els =>
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

/* PM2. An old element rule, such as one on select or on input[type=text],
   can outrank a single adp- class. Every adp- control must render square,
   in one of the system's two faces, at the height its rule fixes. */
test.describe("at 1440px", () => {
  test.use({viewport: {width: 1440, height: 900}});

  test("every adp- control renders square, in a system face, at its fixed height", async ({page, server}) => {
    const faults: string[] = [];
    await everyScreen(page, server.url, async where => {
      faults.push(...(await page.evaluate(() => {
        const HEIGHT: [string, number][] = [[".adp-btn--primary", 36], [".adp-btn--text", -1], [".adp-btn", 28], [".adp-chip--s", 20],
          [".adp-chip", 24], [".adp-filter", 24], [".adp-input--sm", 32], [".adp-input", 36], [".adp-select", 36],
          [".adp-seg--full", 32], [".adp-seg", 28]];
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>(".adp-btn, .adp-chip, .adp-filter, .adp-input, .adp-select, .adp-seg, .adp-textarea")){
          if (!el.checkVisibility()) continue;
          const cs = getComputedStyle(el), name = el.outerHTML.slice(0, 80);
          if (cs.borderTopLeftRadius !== "0px" || cs.borderBottomRightRadius !== "0px") out.push(`${name} has a rounded corner`);
          if (!/^"?(JetBrains Mono|Space Grotesk)"?/.test(cs.fontFamily)) out.push(`${name} is set in ${cs.fontFamily}`);
          const want = HEIGHT.find(([sel]) => el.matches(sel));
          if (want && want[1] > 0 && Math.abs(el.getBoundingClientRect().height - want[1]) > 0.5)
            out.push(`${name} is ${el.getBoundingClientRect().height}px, not ${want[1]}px`);
        }
        return out;
      })).map(f => `${where}: ${f}`));
    });
    expect(faults).toEqual([]);
  });
});
