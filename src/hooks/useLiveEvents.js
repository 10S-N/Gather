import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchLiveEvents,
  readCache,
  clearCache,
} from '../services/eventSources';

const REQUEST_TIMEOUT_MS = 10_000;

// `enabled` lets callers (e.g. tests) opt out of the on-mount fetch.
// Returns:
//   events:        merged/sealed list ready for rendering
//   loading:       true while the first background fetch is in flight
//   refreshing:    true while a manual refresh is in flight
//   report:        per-source fetch status (for UI diagnostics)
//   sourcesActive: labels of sources that returned successfully
//   fetchedAt:     timestamp of the most recent successful fetch
//   hasCache:      true once we've hydrated from cache OR written fresh data
//   refresh():     re-run all enabled sources
//   clearCache():  nuke localStorage and force a re-fetch
export function useLiveEvents({ enabled = true } = {}) {
  const initialCache = readCache();
  const [events, setEvents] = useState(initialCache?.events || []);
  const [report, setReport] = useState([]);
  const [sourcesActive, setSourcesActive] = useState(
    initialCache?.sourcesActive || [],
  );
  const [fetchedAt, setFetchedAt] = useState(initialCache?.fetchedAt || null);
  const [hasCache, setHasCache] = useState(Boolean(initialCache));
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const inFlight = useRef(null);
  const didFetchOnMount = useRef(false);

  const runFetch = useCallback(async ({ isManual } = {}) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    // Hard timeout: every source adapter aborts together if a feed hangs.
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    if (isManual) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetchLiveEvents({ signal: controller.signal });
      setEvents(res.events);
      setReport(res.report);
      setSourcesActive(res.sourcesActive);
      setFetchedAt(Date.now());
      setHasCache(true);
    } catch (e) {
      if (controller.signal.aborted) {
        if (isManual) {
          setError('Request timed out after 10s. Please try again.');
        }
        return;
      }
      setError(e?.message || 'Failed to fetch events.');
    } finally {
      clearTimeout(timeoutId);
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    if (didFetchOnMount.current) return undefined;
    if (initialCache) {
      // Already have data — don't re-fetch on mount; the user can hit Refresh.
      didFetchOnMount.current = true;
      return undefined;
    }
    didFetchOnMount.current = true;
    // Defer with setTimeout(0) so the synchronous setState calls inside
    // runFetch don't cascade from inside the effect body.
    const handle = setTimeout(() => runFetch({ isManual: false }), 0);
    return () => {
      clearTimeout(handle);
      inFlight.current?.abort();
    };
  }, [enabled, runFetch, initialCache]);

  const refresh = useCallback(() => runFetch({ isManual: true }), [runFetch]);

  const clearAll = useCallback(() => {
    clearCache();
    setEvents([]);
    setReport([]);
    setSourcesActive([]);
    setFetchedAt(null);
    setHasCache(false);
    runFetch({ isManual: true });
  }, [runFetch]);

  return {
    events,
    loading,
    refreshing,
    error,
    report,
    sourcesActive,
    fetchedAt,
    hasCache,
    refresh,
    clearCache: clearAll,
  };
}
