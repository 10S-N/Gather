import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchLiveEvents,
  readCache,
  clearCache,
} from '../services/eventSources';

const REQUEST_TIMEOUT_MS = 10_000;

// Minimum gap between background refreshes. Keeps us polite to the
// Ticketmaster 5,000/day free tier; without this, focus churn could blow
// the budget in a single session.
const MIN_REFETCH_GAP_MS = 2 * 60 * 1000; // 2 minutes

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
//
// Strategy: stale-while-revalidate. Cache state is shown immediately on
// mount, then we *always* kick off a background fetch and silently update
// the UI when it lands. A minimum-gap guard prevents churn (focus spam,
// double-mount in StrictMode, etc.) from hammering the API.
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
  const lastFetchStartedAt = useRef(initialCache?.fetchedAt ?? 0);

  const runFetch = useCallback(async ({ isManual, silent } = {}) => {
    // Skip if a fetch is already in flight (e.g. focus + manual click racing).
    if (inFlight.current) return;

    // Minimum-gap guard for non-manual (background) refreshes so tab focus
    // churn doesn't burn the daily quota.
    if (!isManual && Date.now() - lastFetchStartedAt.current < MIN_REFETCH_GAP_MS) {
      return;
    }
    lastFetchStartedAt.current = Date.now();

    const controller = new AbortController();
    inFlight.current = controller;

    // Hard timeout: every source adapter aborts together if a feed hangs.
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    if (isManual) setRefreshing(true);
    else if (!silent) setLoading(true);
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
      // Silent background failures don't surface an error banner; they'd
      // flash red on every accidental network blip.
      if (!silent) setError(e?.message || 'Failed to fetch events.');
    } finally {
      clearTimeout(timeoutId);
      // Always release the in-flight slot. A timed-out controller leaves
      // its signal aborted; if we left its reference in `inFlight.current`
      // the next manual/focus refresh would short-circuit and silently no-op.
      inFlight.current = null;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    // Always try to refresh on mount: even if we have a cached payload, we
    // want to silently swap in fresher events. The minimum-gap guard inside
    // `runFetch` prevents redundant calls when re-mounting within 2 min.
    const handle = setTimeout(() => runFetch({ isManual: false, silent: true }), 0);

    // Re-validate when the tab returns to focus, so users who re-open the
    // page after a while get up-to-date events without hitting Refresh.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        runFetch({ isManual: false, silent: true });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearTimeout(handle);
      document.removeEventListener('visibilitychange', handleVisibility);
      inFlight.current?.abort();
    };
  }, [enabled, runFetch]);

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
