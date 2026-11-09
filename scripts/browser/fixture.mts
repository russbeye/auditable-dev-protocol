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
  const end = Date.now() + 10_000;
  while (!fs.existsSync(state)){
    if (Date.now() > end || child.exitCode !== null) throw new Error("the server wrote no state file");
    await new Promise(r => setTimeout(r, 50));
  }
  const bound = (JSON.parse(fs.readFileSync(state, "utf8")) as {port: number}).port;
  const stop = async () => {
    if (child.exitCode === null){
      const gone = new Promise(r => child.once("exit", r));
      child.kill("SIGTERM");
      await gone;
    }
    fs.rmSync(dir, {recursive: true, force: true});
  };
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

/* A folded header keeps the tabs in its menu, so we open the menu first
   whenever the menu button shows. */
export async function go(page: Page, screen: string){
  if (await page.locator("#menuBtn").isVisible()) await page.click("#menuBtn");
  await page.click(screen === "new task" ? "#newTaskBtn" : `.mtab[data-s="${screen}"]`);
  await expect(page.locator(".screen.is-on")).toHaveAttribute("data-s", screen);
}

export const TAB_SCREENS = ["inspector", "reviews", "watchboard", "ledgers", "calibration", "resume pack"];

/* We visit what the jsdom walk in app-page.test.mts visits: the boot, each
   tab, each ticket's section view and full log, and New task. The rail's
   closed group starts collapsed, so its tickets stay out of the walk unless
   the caller asks us to open every group first. */
export async function everyScreen(page: Page, url: string, look: (where: string) => Promise<void>, openGroups = false){
  await page.goto(url);
  await expect(page.locator("#liveTxt")).toHaveText("WATCHING");
  await look("boot");
  for (const s of TAB_SCREENS){ await go(page, s); await look(s); }
  if (openGroups) for (const g of await page.locator(".railsec", {has: page.locator(".rcv", {hasText: "▸"})}).all()) await g.click();
  const keys = await page.locator(".rentry").evaluateAll(r => r.map(x => x.getAttribute("data-key")!));
  for (const k of keys){
    await go(page, "inspector");
    await page.click(`.rentry[data-key="${k}"]`);
    await look(k + " section");
    await page.click('[data-view="full"]');
    await look(k + " full log");
  }
  await go(page, "new task");
  await look("new task");
}
