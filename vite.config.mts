import fs from "node:fs";
import {defineConfig} from "vitest/config";
import {BUILD_MARK, stamp} from "./scripts/adp-runtime.mts";

let startStamp = "";

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
    writeBundle(){ fs.writeFileSync(BUILD_MARK, startStamp); },
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
