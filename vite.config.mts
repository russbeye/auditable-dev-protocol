import fs from "node:fs";
import {build, type InlineConfig} from "vite";
import {defineConfig} from "vitest/config";
import {BUILD_MARK, SKILL_DIR, stamp} from "./scripts/adp-runtime.mts";

let startStamp = "";

/* The React app is an ES module, and rolldown builds an IIFE from one entry
   only, so the app needs a build of its own. We run it from inside the
   libraries build, so the launcher and the suite still run one command and
   the stamp covers both bundles. Lib mode leaves process.env.NODE_ENV for a
   consumer to set, and the page is that consumer, so we set it here. */
const APP_BUILD: InlineConfig = {
  configFile: false,
  root: SKILL_DIR,
  logLevel: "warn",
  define: {"process.env.NODE_ENV": JSON.stringify("production")},
  // Vite picks the JSX transform from the NODE_ENV the build inherits, and
  // the suite and the launcher can hand it "test". The define above loads
  // React's production build, which has no jsxDEV, so we pin the transform
  // to match it.
  oxc: {jsx: {development: false}},
  build: {
    outDir: "dist",
    emptyOutDir: false,
    minify: false,
    lib: {entry: "src/app/main.tsx", formats: ["es"], fileName: () => "adp-app.js"},
  },
};

export default defineConfig({
  plugins: [{
    // The launcher compares this stamp with the sources to decide whether
    // the bundle is current. We take the stamp before the build reads any
    // source, so an edit during the build leaves a stale stamp, not a
    // stale bundle under a fresh one. A failed build writes no files and
    // so no stamp.
    name: "adp-build-stamp",
    apply: "build",
    buildStart(){ startStamp = stamp(); },
    async writeBundle(){
      await build(APP_BUILD);
      fs.writeFileSync(BUILD_MARK, startStamp);
    },
  }],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The vanilla pages and the test harnesses read this file, so we keep
    // it readable. A stack trace from the page then names real functions.
    minify: false,
    lib: {entry: "src/globals.ts", formats: ["iife"], name: "ADPLibs", fileName: () => "adp-libs.js"},
    // The modules are strict by being modules. The bundle is a plain
    // script, so it needs the directive to keep them strict.
    rolldownOptions: {output: {strict: true}},
  },
  test: {
    include: ["scripts/tests/*.test.{js,mts}"],
    globalSetup: ["scripts/tests/global-setup.mts"],
    // Each spy goes back to the real function when its test ends, so one
    // test's silenced console never hides another test's warnings.
    restoreMocks: true,
  },
});
