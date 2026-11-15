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

  /* A cell of chips or ids wraps at 176px, and a settled watch stacks its
     parts, so these columns grow a row taller, never wider, and leave the
     room to the text columns. A table at full width hands spare room to every
     column, so we measure each cell's content, not its column. */
  test("the Watch, Cited in, and Entry cells of every section's panels hold their content within 176px", async ({page, server}) => {
    test.setTimeout(240_000);
    await open(page, server.url);
    for (const g of await page.locator("#rail [data-sec][aria-expanded=false]").all()) await g.click();
    const keys = await page.locator("#rail [data-key]").evaluateAll(r => r.map(x => x.getAttribute("data-key")!));
    const wide: string[] = [];
    let seen = 0;
    for (const k of keys){
      await page.click(`#rail [data-key="${k}"]`);
      await page.click('[data-view="section"]');
      for (const v of await page.locator("#secSel option").evaluateAll(o => o.map(x => (x as HTMLOptionElement).value))){
        await page.selectOption("#secSel", v);
        for (const [h, w] of await page.evaluate(() => [...document.querySelectorAll("#scrInspector section[aria-label] table")].flatMap(t => {
          const heads = [...t.querySelectorAll("thead th")].map(th => th.textContent!.replace(/[↑↓]/g, "").trim());
          return [...t.querySelectorAll("tbody tr")].flatMap(tr => [...tr.children].map((td, i) => {
            const r = document.createRange();
            r.selectNodeContents(td);
            return [heads[i], r.getBoundingClientRect().width] as [string, number];
          }));
        }).filter(([h]) => h === "Watch" || h === "Cited in" || h === "Entry"))){
          seen++;
          if (w > 176.5) wide.push(`${k} ${v}: a ${h} cell is ${Math.round(w)}px`);
        }
      }
    }
    expect(seen).toBeGreaterThan(20);
    expect(wide).toEqual([]);
  });

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
    // The fourth column is Due, where an unanchored watch shows its window prose.
    expect(await lines("td:nth-child(4)")).toBeGreaterThan(1);
    expect(await lines('a.wbl[data-item="OT-BX001-1"]')).toBe(1);
    expect(await lines(".adp-chip")).toBe(1);
    const over = await page.evaluate(() => {
      const d = document.documentElement, st = document.querySelector(".stage")!;
      return Math.max(d.scrollWidth - d.clientWidth, st.scrollWidth - st.clientWidth);
    });
    expect(over).toBe(0);
  });
});

/* A chip menu opens inside a table whose box scrolls sideways, and that box
   would clip anything that hangs below its last row. Each menu item must be
   the element a reader hits at its center, and the table's box must not
   grow a vertical scroll. FX004's Decision Log has one row with a merged chip. */
for (const width of [1440, 720]) test.describe(`at ${width}px`, () => {
  test.use({viewport: {width, height: 900}});

  test("a cited-in chip menu shows every item, unclipped by the table's scroll box", async ({page, server}) => {
    await open(page, server.url + "#t=FX004&s=sec-decision-log");
    const chips = page.locator("button.adp-chip[aria-haspopup]");
    // The live word can read WATCHING before the section draws its chip, so we wait for the chip.
    await expect(chips.first()).toBeVisible();
    for (const chip of await chips.all()){
      await chip.click();
      await expect(page.locator("[role=menu]")).toBeVisible();
      const got = await page.evaluate(() => {
        const items = [...document.querySelectorAll<HTMLElement>("[role=menu] [role=menuitem]")];
        const hidden = items.filter(b => { const r = b.getBoundingClientRect();
          return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest("[role=menuitem]") !== b; }).map(b => b.textContent);
        const box = document.querySelector("[role=menu]")!.closest("tr")?.closest("div");
        return {items: items.length, hidden, scrollY: box ? box.scrollHeight - box.clientHeight : 0};
      });
      expect(got.items).toBeGreaterThan(1);
      expect(got).toEqual({items: got.items, hidden: [], scrollY: 0});
      await page.keyboard.press("Escape");
      await expect(page.locator("[role=menu]")).toHaveCount(0);
    }
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
        // The prev and next buttons stand as tall as the select between them.
        const HEIGHT: [string, number][] = [[".adp-btn[data-secstep], .adp-btn[data-revstep]", 36], [".adp-btn--primary", 36], [".adp-btn--text", -1], [".adp-btn", 28], [".adp-chip--s", 20],
          [".adp-chip", 24], [".adp-filter", 24], [".adp-input--sm", 32], [".adp-input", 36], [".adp-select", 36],
          [".adp-seg--full", 32], [".adp-seg", 28]];
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>(".adp-btn, .adp-chip, .adp-filter, .adp-input, .adp-select, .adp-seg, .adp-textarea")){
          if (!el.checkVisibility()) continue;
          const cs = getComputedStyle(el), name = el.outerHTML.slice(0, 80);
          if (cs.borderTopLeftRadius !== "0px" || cs.borderBottomRightRadius !== "0px") out.push(`${name} has a rounded corner`);
          if (!/^"?(JetBrains Mono|Space Grotesk)"?/.test(cs.fontFamily)) out.push(`${name} is set in ${cs.fontFamily}`);
          // R3 sets every chip in the machine face.
          if (el.matches(".adp-chip, .adp-filter") && !/^"?JetBrains Mono"?/.test(cs.fontFamily)) out.push(`${name} is a chip set in ${cs.fontFamily}`);
          // A select with the browser's arrow turned off must draw its own, so it reads as a dropdown.
          if (el.matches(".adp-select") && cs.appearance === "none" && cs.backgroundImage === "none") out.push(`${name} shows no dropdown arrow`);
          const want = HEIGHT.find(([sel]) => el.matches(sel));
          if (want && want[1] > 0 && Math.abs(el.getBoundingClientRect().height - want[1]) > 0.5)
            out.push(`${name} is ${el.getBoundingClientRect().height}px, not ${want[1]}px`);
        }
        return out;
      })).map(f => `${where}: ${f}`));
    });
    expect(faults).toEqual([]);
  });

  // Every screen takes the Watches page's margins, so a ticket's text starts
  // where a watch table starts.
  test("the ticket view and reviews sit in the stage at the same offset as Watches and the Ledger", async ({page, server}) => {
    await open(page, server.url + "#t=BX001");
    const at = (id: string) => page.evaluate(id => {
      const s = document.querySelector(".stage")!.getBoundingClientRect(), r = document.getElementById(id)!.getBoundingClientRect();
      return [Math.round(r.left - s.left), Math.round(r.top - s.top), Math.round(s.right - r.right)];
    }, id);
    const ticket = await at("scrInspector");
    await go(page, "reviews");
    const reviews = await at("scrReviews");
    await go(page, "watchboard");
    const watches = await at("scrWatch");
    await go(page, "ledgers");
    expect([ticket, reviews, await at("scrLedgers")]).toEqual([watches, watches, watches]);
    expect(watches.slice(0, 2)).toEqual([48, 40]);
  });

  /* R15. A hairline is an inset shadow, so it adds no height, and every box
     the reader scans stays on the 4px grid. We render a five-row table on
     the live page to pin the Table's rhythm, then measure every notice,
     phase strip, full-log section, and three-line textarea on every screen,
     and the open ⋯ menu. A height may carry a subpixel rounding remainder,
     so we round it first. */
  test("a table runs a 32px head over 48px rows, and every strip, notice, section, textarea, and the menu sit on the 4px grid", async ({page, server}) => {
    await open(page, server.url);
    const table = await page.evaluate(() => {
      const box = document.createElement("div");
      box.innerHTML = '<table class="adp-table"><thead><tr><th>Watch</th><th>Due</th></tr></thead><tbody>'
        + [1, 2, 3, 4, 5].map(n => `<tr><td>OT-X-${n}</td><td>2026-12-0${n}</td></tr>`).join("") + "</tbody></table>";
      document.querySelector(".stage")!.prepend(box);
      const h = (el: Element) => el.getBoundingClientRect().height;
      const out = {head: h(box.querySelector("thead tr")!), rows: [...box.querySelectorAll("tbody tr")].map(h)};
      box.remove();
      return out;
    });
    expect(table).toEqual({head: 32, rows: [48, 48, 48, 48, 48]});
    const off: string[] = [];
    let seen = 0;
    const measure = async (where: string) => {
      const got = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.adp-notice, #phaseStrip, .fsec, textarea.adp-textarea[rows="3"], #hdrMenu')]
        .filter(el => el.checkVisibility()).map(el => [el.outerHTML.slice(0, 60), el.getBoundingClientRect().height] as [string, number]));
      for (const [name, h] of got){
        seen++;
        if (Math.round(h) % 4 !== 0 || Math.abs(h - Math.round(h)) >= 0.5) off.push(`${where}: ${name} is ${h}px`);
      }
    };
    await everyScreen(page, server.url, measure);
    await page.click("#menuBtn");
    await expect(page.locator("#hdrMenu")).toBeVisible();
    await measure("menu");
    expect(seen).toBeGreaterThan(20);
    expect(off).toEqual([]);
  });
});
