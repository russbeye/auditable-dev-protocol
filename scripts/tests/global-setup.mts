/* The harnesses, the baseline, and the byte-identity test load the browser
   bundle from dist/, so we build it once before any test file runs. A test
   then never reads a bundle older than the sources beside it. */
import {build} from "vite";

export default async function setup(){
  await build({logLevel: "warn"});
}
