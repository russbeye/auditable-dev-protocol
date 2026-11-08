/* The page tests import the app's sources, so they never run the bundle the
   browser loads. These tests run that bundle. The suite's global setup
   builds it with NODE_ENV=test, and the launcher hands its own environment
   to the build too, so the bundle must not depend on that variable. */
import {test} from "vitest";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import path from "node:path";
import {SKILL_DIR} from "../adp-runtime.mts";

const require = createRequire(import.meta.url);
const {diskFetch} = require("./screen-text.js") as {diskFetch(): (u: string) => Promise<unknown>};
type Win = Record<string, unknown> & {document: Document; eval(s: string): void; close(): void};
const {JSDOM, VirtualConsole} = require("jsdom") as {
  JSDOM: new (html: string, o: object) => {window: Win};
  VirtualConsole: new () => {on(ev: string, f: (...a: unknown[]) => void): void};
};
const BUNDLE = path.join(SKILL_DIR, "dist", "adp-app.js");

test("the app bundle calls the production JSX runtime when the build inherits NODE_ENV=test", () => {
  assert.equal(process.env.NODE_ENV, "test");
  const bundle = fs.readFileSync(BUNDLE, "utf8");
  assert.ok(!bundle.includes("jsxDEV"), "the bundle calls jsxDEV, which React's production build does not export");
  assert.ok(bundle.includes("import_jsx_runtime.jsx"), "the bundle calls no production JSX runtime");
});

/* We load app.html with its scripts off and run the bundle in the page
   ourselves, because jsdom does not load module scripts. The bundle has no
   import or export, so it runs as a plain script. The page fetches the
   fixture corpus from disk, and a fake EventSource stands in for /events. */
test("the built bundle boots app.html and renders the header, the rail, and the live chit", async () => {
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", e => errors.push(String((e as Error).stack || e)));
  virtualConsole.on("error", (...a: unknown[]) => errors.push(a.map(String).join(" ")));
  const html = fs.readFileSync(path.join(SKILL_DIR, "scripts", "app.html"), "utf8");
  const dom = new JSDOM(html, {url: "http://127.0.0.1/app.html", runScripts: "outside-only", virtualConsole});
  const w = dom.window;
  const feeds: {url: string}[] = [];
  w.fetch = diskFetch();
  w.EventSource = class {
    onopen = null; onmessage = null; onerror = null;
    url: string;
    constructor(url: string){ this.url = url; feeds.push(this); }
    close(){}
  };
  try {
    w.eval(fs.readFileSync(BUNDLE, "utf8"));
    const doc = dom.window.document;
    const deadline = Date.now() + 5000;
    while (!errors.length && !doc.querySelector(".rentry") && Date.now() < deadline)
      await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(errors, [], "the page reported an error");
    assert.ok(doc.querySelector(".rentry"), "the rail rendered no entry within 5 s");
    assert.match(doc.querySelector(".brand")?.textContent ?? "", /MISSION CONTROL/);
    assert.equal(doc.getElementById("liveTxt")?.textContent, "WATCHING");
    assert.deepEqual(feeds.map(f => f.url), ["events"]);
  } finally {
    w.close();
  }
});
