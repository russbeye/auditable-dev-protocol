/* The open MC-012 watches that need a real engine. Each test names the
   ticket whose exit condition its result decides. */
import fs from "node:fs";
import path from "node:path";
import {everyScreen, expect, fixtureRoot, freePort, open, startServer, test, VIEW_SCREENS} from "./fixture.mts";
import {SCRIPTS_DIR} from "../adp-runtime.mts";

test.use({viewport: {width: 1440, height: 900}});

// A decision card folds in a real engine. The card body sets its own
// display, so jsdom, which applies no stylesheet, cannot see a fold that
// the cascade undoes. The first card of a section starts open and the rest
// start folded.
test("a decision card's head folds and unfolds its fields in the browser", async ({page, server}) => {
  await open(page, server.url + "#t=FX001&s=sec-decision-log");
  const cards = page.locator("#scrInspector .adp-dl");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).locator(".adp-dl__body")).toBeVisible();
  await expect(cards.nth(1).locator(".adp-dl__body")).toBeHidden();
  await cards.nth(1).locator(".adp-dl__head").click();
  await expect(cards.nth(1).locator(".adp-dl__body")).toBeVisible();
  await expect(cards.nth(1).locator(".adp-dl__head")).toHaveAttribute("aria-expanded", "true");
  await cards.nth(0).locator(".adp-dl__head").click();
  await expect(cards.nth(0).locator(".adp-dl__body")).toBeHidden();
});

// A section's cards and prose fill the pane inside its padding, because the
// Prose column cap left a long card in a narrow band (DL-056).
test("a section's decision cards span the pane's content width", async ({page, server}) => {
  await open(page, server.url + "#t=FX001&s=sec-decision-log");
  const widths = await page.evaluate(() => {
    const card = document.querySelector("#scrInspector .adp-dl") as HTMLElement;
    const pane = card.closest(".doc") as HTMLElement;
    const cs = getComputedStyle(pane);
    return {card: card.getBoundingClientRect().width,
      inner: pane.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)};
  });
  expect(Math.abs(widths.card - widths.inner)).toBeLessThan(1);
});

// OT-MC012-10. The launcher's server always binds a free port, so only a
// test can bring one back on the port an open page still watches.
test("the live word returns from CACHED to WATCHING when the server restarts on its port", async ({page}) => {
  const port = await freePort();
  let s = await startServer(fixtureRoot(), port);
  try {
    await open(page, s.url);
    const chit = page.locator("#liveTxt");
    await s.stop();
    await expect(chit).toHaveText("CACHED");
    s = await startServer(fixtureRoot(), port);
    await expect(chit).toHaveText("WATCHING", {timeout: 5000});
  } finally { await s.stop(); }
});

// OT-MC012-14. The fixture ticket BX-001 carries script in a tag, an event
// handler, a javascript: link, an svg, and an iframe. None may run, and
// none may reach the page as live markup.
test("a hostile log runs no script and leaves no live markup on any screen", async ({page, server}) => {
  const dialogs: string[] = [];
  page.on("dialog", d => { dialogs.push(d.message()); d.dismiss(); });
  const live: string[] = [];
  const look = async (where: string) => {
    const found = await page.evaluate(() => [...document.querySelectorAll(
      "script:not([src]), .stage script, .stage img, .stage iframe, .stage svg, [onerror], [onload], a[href^='javascript:' i]")]
      .filter(e => e.closest("head") === null || e.closest(".stage")).map(e => e.outerHTML.slice(0, 80)));
    if (found.length) live.push(`${where}: ${found.join(" | ")}`);
  };
  await everyScreen(page, server.url, look);
  await open(page, server.url + "#v=reviews&t=BX001&s=pr-review-PR1-20261109-r1.md");
  await expect(page.locator("#scrReviews .dl-card").first()).toBeVisible();
  await look("BX001 round 1");
  await open(page, server.url + "#t=BX001&s=sec-decision-log");
  await expect(page.locator(".stage .md").first()).toBeVisible();
  for (const a of await page.locator(".stage .md a").all()) await a.click({modifiers: ["Alt"], noWaitAfter: true}).catch(() => {});
  await look("BX001 after link clicks");
  expect(await page.evaluate(() => (window as unknown as {__adpHostile?: string}).__adpHostile)).toBeUndefined();
  expect(dialogs).toEqual([]);
  expect(live).toEqual([]);
});

// OT-MC012-16, first half. A finding card's pills and a closure note sit in
// contents spans, which must stay inline in every engine.
test("a finding card's pills and its closure note stay on their lines", async ({page, server}) => {
  await open(page, server.url + "#v=reviews&t=BX001&s=pr-review-PR1-20261109-r1.md");
  const card = page.locator("#scrReviews .dl-card", {has: page.locator(".dl-pills")}).first();
  await expect(card.locator(".dl-pills .pill")).toHaveCount(3);
  const tops = await card.locator(".dl-pills .pill").evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
  expect(tops.length).toBe(3);
  expect(new Set(tops).size).toBe(1);
  // The closed row holds its date, the round link, " · ", and the note. The
  // note's first line must share the line of the separator.
  const lines = await card.locator(".revv", {hasText: "in round 2"}).evaluate(el => {
    const sep = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent!.includes("·"))!;
    const note = sep.nextSibling!;
    const top = (n: Node) => { const r = document.createRange(); r.selectNodeContents(n); return Math.round(r.getClientRects()[0].top); };
    return [top(sep), top(note)];
  });
  expect(lines[1]).toBe(lines[0]);
});

// OT-MC012-16, second half. The spy names the section whose top sits at the
// stage's top, read from the selector the reader sees.
test("the scroll spy names the full-log section at the stage's top", async ({page, server}) => {
  await open(page, server.url + "#t=BX001");
  await page.click('[data-view="full"]');
  await expect(page.locator(".fsec").first()).toBeVisible();
  const keys = await page.locator(".fsec").evaluateAll(els => els.map(e => e.getAttribute("data-key")!));
  // The last sections cannot reach the stage's top, because the stage stops
  // scrolling at its end, so we check every section that can.
  const reach = await page.evaluate(() => {
    const st = document.querySelector(".stage")!, top = st.getBoundingClientRect().top;
    return [...document.querySelectorAll(".fsec")].filter(e =>
      e.getBoundingClientRect().top - top + st.scrollTop <= st.scrollHeight - st.clientHeight).length;
  });
  expect(reach).toBeGreaterThan(3);
  for (const k of keys.slice(1, reach)){
    await page.evaluate(key => {
      const st = document.querySelector(".stage")!, sec = document.querySelector(`.fsec[data-key="${key}"]`)!;
      st.scrollTop += sec.getBoundingClientRect().top - st.getBoundingClientRect().top;
    }, k);
    await expect(page.locator("#secSel")).toHaveValue(k);
  }
});

/* OT-MC012-22. The jsdom walk reads the fixture corpus. This walk reads
   the corpus at ADP_LIVE_ROOT when it is set, so a developer can run it on
   a real repo. CI has no live corpus, so there it walks the fixture. */
const THEME_CLASSES = new Set(["md", "sr-live"]);
const HOOK_CLASSES = new Set(["shell", "sth", "wbrow", "wrow", "lgrow"]);
test("every class painted outside a rendered document comes from adp-bundle.css or adp-shell.css", async ({page}) => {
  test.setTimeout(300_000);
  const shell = new Set<string>();
  for (const sheet of ["adp-bundle.css", "adp-shell.css"]){
    const css = fs.readFileSync(path.join(SCRIPTS_DIR, sheet), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const seg of css.split(/\{[^{}]*\}/)) for (const m of seg.matchAll(/\.([A-Za-z_-][A-Za-z0-9_-]*)/g)) shell.add(m[1]);
  }
  const s = await startServer(process.env.ADP_LIVE_ROOT || fixtureRoot());
  const used = new Set<string>();
  let walked = 0, reviewed = 0;
  try {
    reviewed = await everyScreen(page, s.url, async () => {
      for (const c of await page.evaluate(() => [...document.querySelectorAll("[class]")]
        .filter(el => !el.parentElement?.closest(".md")).flatMap(el => el.getAttribute("class")!.split(/\s+/)).filter(Boolean))) used.add(c);
      walked++;
    }, true);
    // The boot, each view, the drawer, two views of each ticket, each
    // ticket's reviews, and New task. Every directory in the corpus is one
    // ticket.
    const files = (await (await fetch(s.url.replace("app.html", "corpus.json"))).json() as {files: string[]}).files;
    const tickets = new Set(files.filter(f => f.includes("/")).map(f => f.split("/")[0])).size;
    expect(walked).toBe(1 + VIEW_SCREENS.length + 1 + 2 * tickets + reviewed + 1);
  } finally { await s.stop(); }
  const orphans = [...used].filter(c => !shell.has(c) && !THEME_CLASSES.has(c) && !HOOK_CLASSES.has(c)).sort();
  expect(orphans).toEqual([]);
});
