/* The served corpus, kept current by the server's change events. */
import {useCallback, useEffect, useRef, useState} from "react";
import * as S from "../lib/adp-shell-lib.ts";
import type {Corpus, FetchFn} from "../lib/adp-shell-lib.ts";

type EventFeed = Pick<EventSource, "onopen" | "onmessage" | "onerror" | "close">;
// at is the time of the last good load, which the top bar shows once updates stop.
type LiveCorpus = {corpus: Corpus | null; stale: boolean; booting: boolean; at: number | null; retry(): void};
type LiveState = Omit<LiveCorpus, "retry">;

// The signature is the whole load, so an unchanged reload never re-renders
// and a page left open past midnight still rolls its day-based ages.
const sigOf = (c: Corpus) => JSON.stringify([c.index.generated, c.index.tickets, c.texts, c.prompts, c.reviews]);

/* We reload the corpus on boot, on every change event, and on every open of
   the event stream. A reopen can follow changes the page missed while the
   stream was down, so it reloads like an event does. One load runs at a
   time. An event that lands during a load queues one more load, because a
   dropped event would leave a stale screen until the next change. A failed
   load or a broken stream keeps the last good corpus on screen and marks it
   stale. The stream can break before the first corpus lands, so we keep
   that break until the stream opens again, and the corpus it delivers
   arrives already stale. */
function useLiveCorpus(fetchFn: FetchFn, openFeed: () => EventFeed | null): LiveCorpus {
  const [live, setLive] = useState<LiveState>({corpus: null, stale: false, booting: true, at: null});
  const loadRef = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true, loading = false, again = false, broken = false, sig = "";
    const load = async () => {
      if (loading){ again = true; return; }
      loading = true;
      do {
        again = false;
        const c = await S.loadCorpus(fetchFn);
        if (!alive) return;
        const s = c ? sigOf(c) : null;
        if (c && s !== sig){
          sig = s!;
          setLive({corpus: c, stale: broken, booting: false, at: Date.now()});
        } else setLive(prev => {
          const stale = c ? broken : !!prev.corpus;
          return prev.stale === stale && !prev.booting ? prev : {...prev, stale, booting: false};
        });
      } while (again);
      loading = false;
    };
    loadRef.current = load;
    load();
    const feed = openFeed();
    if (feed){
      feed.onopen = () => { broken = false; load(); };
      feed.onmessage = () => { load(); };
      feed.onerror = () => { broken = true; if (alive) setLive(prev => prev.corpus && !prev.stale ? {...prev, stale: true} : prev); };
    }
    return () => { alive = false; feed?.close(); };
  }, [fetchFn, openFeed]);
  // A retry is one more load through the same queue, so it never races a load already running.
  const retry = useCallback(() => loadRef.current(), []);
  return {...live, retry};
}

export {useLiveCorpus};
export type {EventFeed, LiveCorpus};
