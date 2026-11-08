import {createRoot} from "react-dom/client";
import type {FetchFn} from "../lib/adp-shell-lib.ts";
import {App} from "./App.tsx";

// The app's effects key on these two functions, so they live at module level
// and keep one identity for the life of the page.
const fetchFn: FetchFn = u => fetch(u);
const openFeed = () => new EventSource("events");

createRoot(document.getElementById("root")!).render(<App fetchFn={fetchFn} openFeed={openFeed}/>);
