/* Each test that needs mission control gets a server of its own on the
   fixture root, so no test sees another test's restart or state file. */
import {spawn, type ChildProcess} from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {expect, test as base, type Page} from "@playwright/test";
import {SCRIPTS_DIR} from "../adp-runtime.mts";

type Server = {url: string; port: number; stop: () => Promise<void>};

/* We ask the operating system for a free port and close it again. The
   restart test needs the number before the first server starts, so it can
   start the second server on the same one. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer().once("error", reject).listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

export async function startServer(root: string, port = 0): Promise<Server> {
  const dir = fs.mkdtempSync(path.join(path.dirname(root), "adp-browser-state-"));
  const state = path.join(dir, "state.json");
  const child: ChildProcess = spawn(process.execPath, [path.join(SCRIPTS_DIR, "adp-server.mts"), root, state, String(port)],
    {stdio: ["ignore", "ignore", "inherit"]});
  const stop = async () => {
    if (child.exitCode === null){
      const gone = new Promise(r => child.once("exit", r));
      child.kill("SIGTERM");
      await gone;
    }
    fs.rmSync(dir, {recursive: true, force: true});
  };
  const end = Date.now() + 10_000;
  while (!fs.existsSync(state)){
    // A server that starts too slowly would outlive the failed test, so we
    // stop it and remove its state directory before we fail.
    if (Date.now() > end || child.exitCode !== null){
      await stop();
      throw new Error("the server wrote no state file");
    }
    await new Promise(r => setTimeout(r, 50));
  }
  const bound = (JSON.parse(fs.readFileSync(state, "utf8")) as {port: number}).port;
  return {url: `http://127.0.0.1:${bound}/app.html`, port: bound, stop};
}

export const fixtureRoot = () => process.env.ADP_BROWSER_ROOT!;

export const test = base.extend<{server: Server}>({
  server: async ({}, use) => {
    const s = await startServer(fixtureRoot());
    await use(s);
    await s.stop();
  },
});
export {expect};

/* The control that opens each screen. The top bar's views open Tickets,
   Watches, and Ledger, calibration heads the Ledger, and reviews open from
   the latest round box on the phase strip. The folded bar keeps its views on a second row, so every
   view stays one click away at any width. */
const OPENER: Record<string, string> = {"inspector": '.adp-nav a[data-s="inspector"]', "watchboard": '.adp-nav a[data-s="watchboard"]',
  "ledgers": '.adp-nav a[data-s="ledgers"]', "calibration": '.adp-nav a[data-s="ledgers"]', "reviews": "#phaseStrip [data-round] >> nth=-1", "new task": "#newTaskBtn"};
export async function go(page: Page, screen: string){
  await page.click(OPENER[screen]);
  await expect(page.locator(".screen.is-on")).toHaveAttribute("data-s", screen === "calibration" ? "ledgers" : screen);
}

/* We load a page and wait until its first corpus lands. The header measures
   itself once the corpus fills it, so a click before then can hit a tab that
   the fold hides a moment later. The app reads the hash only at boot, and a
   goto that changes only the hash never reloads, so we leave the page first. */
export async function open(page: Page, url: string){
  await page.goto("about:blank");
  await page.goto(url);
  await expect(page.locator("#liveTxt")).toHaveText("WATCHING");
}

export const VIEW_SCREENS = ["inspector", "watchboard", "ledgers"];

/* We visit what the jsdom walk in app-page.test.mts visits: the boot, each
   view, the Packs drawer, each ticket's section view and full log, the
   reviews of each ticket that has rounds, and New task. The rail's closed
   group starts collapsed, so its tickets stay out of the walk unless the
   caller asks us to open every group first. We return how many tickets
   offered reviews, so a caller can count the stops. */
export async function everyScreen(page: Page, url: string, look: (where: string) => Promise<void>, openGroups = false): Promise<number>{
  await open(page, url);
  await look("boot");
  for (const s of VIEW_SCREENS){ await go(page, s); await look(s); }
  await page.click("#packsBtn");
  await expect(page.locator("#packDrawer")).toBeVisible();
  await look("packs drawer");
  await page.keyboard.press("Escape");
  await expect(page.locator("#packDrawer")).toHaveCount(0);
  let reviewed = 0;
  if (openGroups) for (const g of await page.locator("#rail [data-sec][aria-expanded=false]").all()) await g.click();
  const keys = await page.locator("#rail [data-key]").evaluateAll(r => r.map(x => x.getAttribute("data-key")!));
  for (const k of keys){
    await go(page, "inspector");
    // A rail pick keeps the view the last ticket used, so we choose the
    // section view ourselves.
    await page.click(`#rail [data-key="${k}"]`);
    await page.click('[data-view="section"]');
    await look(k + " section");
    await page.click('[data-view="full"]');
    await look(k + " full log");
    if (await page.locator("#phaseStrip [data-round]").count()){ await go(page, "reviews"); await look(k + " reviews"); reviewed++; }
  }
  await go(page, "new task");
  await look("new task");
  return reviewed;
}
