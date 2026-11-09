import fs from "node:fs";
import {defineConfig} from "vitest/config";
import {BUILD_MARK, stamp} from "./scripts/adp-runtime.mts";

let startStamp = "";

export default defineConfig(({command}) => ({
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
  // Lib mode leaves process.env.NODE_ENV for a consumer to set, and the page
  // is that consumer, so the build sets it. Vite picks the JSX transform from
  // the NODE_ENV the build inherits, and the suite and the launcher can hand
  // it "test". React's production build has no jsxDEV, so we pin the
  // transform to match it. Both settings shape the shipped bundle, so we
  // apply them to the build alone, and the suite transforms the app the way
  // it transforms every other source.
  ...(command === "build" ? {
    define: {"process.env.NODE_ENV": JSON.stringify("production")},
    oxc: {jsx: {development: false}},
  } : {}),
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // We keep the bundle readable, so a stack trace from the page names
    // real functions.
    minify: false,
    lib: {entry: "src/app/main.tsx", formats: ["es"], fileName: () => "adp-app.js"},
  },
  test: {
    include: ["scripts/tests/*.test.{js,mts}"],
    globalSetup: ["scripts/tests/global-setup.mts"],
    // Each spy goes back to the real function when its test ends, so one
    // test's silenced console never hides another test's warnings.
    restoreMocks: true,
  },
}));
