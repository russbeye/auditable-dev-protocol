/* The browser tests load the built app, so we build it once before any test
   runs. They also need a repo root whose .adp holds a known corpus. We copy
   the suite's fixture corpus and the browser tests' own tickets into a fresh
   temp root, so no test ever reads or writes the developer's corpus. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {build} from "vite";
import {SCRIPTS_DIR} from "../adp-runtime.mts";

export default async function setup(){
  await build({logLevel: "warn"});
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adp-browser-"));
  const corpus = path.join(root, ".adp");
  fs.cpSync(path.join(SCRIPTS_DIR, "tests", "fixtures", "corpus"), corpus, {recursive: true});
  fs.cpSync(path.join(SCRIPTS_DIR, "browser", "corpus"), corpus, {recursive: true});
  // Playwright hands the main process's environment to every worker.
  process.env.ADP_BROWSER_ROOT = root;
  return () => fs.rmSync(root, {recursive: true, force: true});
}
