import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useAuthModal } from '../contexts/useAuthModal';
import { useSyncRuns } from '../hooks/useSyncRuns';
import {
  INGEST_PROXY,
  browserSyncEnv,
  deleteDemoEvents,
  describeBrowserSources,
  isSyncAdmin,
  runBrowserSync,
} from '../services/syncAdmin';
import { formatRelative, toDate } from '../utils/events';

const CLI_COMMAND = 'npm run sync:events -- --prune';

function whenLabel(value) {
  const date = toDate(value);
  return date ? formatRelative(Date.now(), date.getTime()) : 'unknown';
}

function SourceStatus({ source, status, configured }) {
  let label = configured ? 'Ready' : 'Not configured';
  let tone = configured ? 'is-warn' : 'is-off';

  if (status) {
    if (status.ok) {
      label = `${status.imported} imported`;
      tone = 'is-ok';
    } else if (status.configured === false) {
      label = 'Not configured';
      tone = 'is-off';
    } else {
      label = 'Failed';
      tone = 'is-bad';
    }
  }

  return (
    <li className="sync-source">
      <div className="sync-source__main">
        <div className="sync-source__name">
          {source.label}
          <span className="sync-kind">{source.kind}</span>
        </div>
        <code className="sync-source__env">{source.envVars.join(' · ')}</code>
        {status?.error && <p className="sync-source__error">{status.error}</p>}
      </div>
      <span className={`sync-pill ${tone}`}>{label}</span>
    </li>
  );
}

function RunTotals({ totals }) {
  return (
    <dl className="sync-totals">
      <div>
        <dt>Created</dt>
        <dd>{totals?.created ?? 0}</dd>
      </div>
      <div>
        <dt>Updated</dt>
        <dd>{totals?.updated ?? 0}</dd>
      </div>
      <div>
        <dt>Unchanged</dt>
        <dd>{totals?.unchanged ?? 0}</dd>
      </div>
      <div>
        <dt>Skipped</dt>
        <dd>{totals?.skipped ?? 0}</dd>
      </div>
      <div>
        <dt>Expired</dt>
        <dd>{totals?.expired ?? 0}</dd>
      </div>
    </dl>
  );
}

function AdminSyncPage() {
  const { user } = useAuth();
  const { openLogin } = useAuthModal();
  const { runs, loading, error } = useSyncRuns(user);

  const [busy, setBusy] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [runError, setRunError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState('');
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [purgeNote, setPurgeNote] = useState('');

  // Per-run source settings. Seeded from VITE_* so a saved setup needs no
  // typing; the Eventbrite token is intentionally not bundled — paste it here
  // and it lives only in this component's memory.
  const [token, setToken] = useState('');
  const [organizers, setOrganizers] = useState(() => browserSyncEnv().EVENTBRITE_ORGANIZERS);
  const [calendars, setCalendars] = useState(() => browserSyncEnv().LUMA_CALENDARS);
  const [feeds, setFeeds] = useState(() => browserSyncEnv().RSS_FEEDS);
  const [demo, setDemo] = useState(() => Boolean(browserSyncEnv().SYNC_FIXTURES));

  const allowed = isSyncAdmin(user);
  const lastRun = runs[0] || null;

  const configEnv = useMemo(
    () => ({
      EVENTBRITE_API_TOKEN: token.trim(),
      EVENTBRITE_ORGANIZERS: organizers.trim(),
      LUMA_CALENDARS: calendars.trim(),
      RSS_FEEDS: feeds.trim(),
      SYNC_FIXTURES: demo ? '1' : '',
    }),
    [token, organizers, calendars, feeds, demo],
  );

  const sources = useMemo(() => describeBrowserSources(configEnv), [configEnv]);
  const readySources = sources.filter((source) => source.configured);

  const sourceStatuses = useMemo(() => {
    const byId = new Map((lastRun?.sources || []).map((source) => [source.id, source]));
    return sources.map((source) => ({
      source,
      status: byId.get(source.id) || null,
      configured: source.configured,
    }));
  }, [lastRun, sources]);

  const handleRun = async () => {
    setBusy(true);
    setRunError('');
    setResult(null);
    setPurgeNote('');
    try {
      const run = await runBrowserSync({ dryRun, env: configEnv });
      setResult(run);
    } catch (err) {
      setRunError(err?.message || 'Sync failed.');
    } finally {
      setBusy(false);
    }
  };

  const handlePurge = async () => {
    const confirmed = window.confirm(
      'Delete the demo fixture events? Real curated imports and neighbor posts are not touched.',
    );
    if (!confirmed) return;

    setPurgeBusy(true);
    setRunError('');
    setPurgeNote('');
    try {
      const removed = await deleteDemoEvents();
      setPurgeNote(
        removed ? `Removed ${removed} demo event${removed === 1 ? '' : 's'}.` : 'No demo events found.',
      );
    } catch (err) {
      setRunError(err?.message || 'Could not remove the demo events.');
    } finally {
      setPurgeBusy(false);
    }
  };

  const copyText = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1600);
    } catch {
      setCopied('');
    }
  };

  const copyCommand = () => copyText(CLI_COMMAND, 'cli');
  const grantCommand = user ? `npm run admin:grant -- ${user.uid}` : '';
  const copyGrantCommand = () => copyText(grantCommand, 'grant');

  return (
    <section className="feed sync-page">
      <div className="shell">
        <div className="sync-head">
          <div>
            <span className="sync-eyebrow">Admin · ingestion</span>
            <h1 className="sync-title">Curated event sync</h1>
            <p className="sync-lede">
              Automated finds from Austin indie calendars land on the same board as neighbor
              posts, marked <strong>Curated</strong>. Use this page to inspect the schedule or
              run a sync right here in your browser — it writes through the client SDK, so no
              service account is needed.
            </p>
          </div>

          <div className="sync-head__actions">
            {allowed && (
              <label className="sync-check">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(event) => setDryRun(event.target.checked)}
                />
                Preview only
              </label>
            )}
            {allowed && (
              <button type="button" className="btn btn--primary" onClick={handleRun} disabled={busy}>
                {busy ? 'Syncing…' : dryRun ? 'Preview sync' : 'Run sync now'}
              </button>
            )}
          </div>
        </div>

        {!user && (
          <div className="alert alert--info">
            <span>Sign in with an admin account to trigger a sync. Run history is admin-only.</span>
            <button type="button" className="chip" onClick={openLogin}>
              Log in
            </button>
          </div>
        )}

        {user && !allowed && (
          <div className="alert alert--info">
            <span>
              {user.email || user.displayName} ({user.uid}) is not an ingestion admin yet. Run{' '}
              <code>{grantCommand}</code> in the project root (it updates{' '}
              <code>VITE_ADMIN_UIDS</code> and <code>isIngestionAdmin()</code>), deploy with{' '}
              <code>npx firebase-tools deploy --only firestore:rules</code>, then restart{' '}
              <code>npm run dev</code>.
            </span>
            <button type="button" className="chip" onClick={copyGrantCommand}>
              {copied === 'grant' ? 'Copied' : 'Copy command'}
            </button>
          </div>
        )}

        {allowed && (
          <section className="panel sync-config">
            <div className="panel__head">
              <h2>Sources for this run</h2>
              <span className="sync-meta">
                {readySources.length} of {sources.length} ready
              </span>
            </div>
            <p className="sync-config__lede">
              Fetches with the adapters below, dedupes against the live <code>events</code>
              collection, then batch-writes in this browser. Leave a field empty to skip that
              source.
            </p>

            <div className="sync-config__grid">
              <div className="field">
                <label className="field__label" htmlFor="sync-eventbrite-token">
                  Eventbrite token
                </label>
                <input
                  id="sync-eventbrite-token"
                  className="input"
                  type="password"
                  autoComplete="off"
                  placeholder="EVENTBRITE_API_TOKEN"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
                <span className="field__hint">Kept in memory for this run only.</span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="sync-eventbrite-organizers">
                  Eventbrite organizers
                </label>
                <input
                  id="sync-eventbrite-organizers"
                  className="input"
                  autoComplete="off"
                  placeholder="123456789, 987654321"
                  value={organizers}
                  onChange={(event) => setOrganizers(event.target.value)}
                />
                <span className="field__hint">Comma-separated ids — the reliable Eventbrite path.</span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="sync-luma-calendars">
                  Luma calendars
                </label>
                <input
                  id="sync-luma-calendars"
                  className="input"
                  autoComplete="off"
                  placeholder="austinindie, https://lu.ma/foo/ics"
                  value={calendars}
                  onChange={(event) => setCalendars(event.target.value)}
                />
                <span className="field__hint">Calendar slugs or full .ics URLs.</span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="sync-rss-feeds">
                  RSS / Atom feeds
                </label>
                <input
                  id="sync-rss-feeds"
                  className="input"
                  autoComplete="off"
                  placeholder="https://example.org/events.rss"
                  value={feeds}
                  onChange={(event) => setFeeds(event.target.value)}
                />
                <span className="field__hint">Neighborhood blogs, galleries, DIY spaces.</span>
              </div>
            </div>

            <div className="sync-config__actions">
              <label className="sync-check">
                <input
                  type="checkbox"
                  checked={demo}
                  onChange={(event) => setDemo(event.target.checked)}
                />
                Include 4 demo events (no token needed)
              </label>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={handlePurge}
                disabled={purgeBusy || busy}
              >
                {purgeBusy ? 'Removing…' : 'Remove demo events'}
              </button>
              {purgeNote && <span className="sync-meta">{purgeNote}</span>}
            </div>

            {!INGEST_PROXY && (
              <p className="field__hint">
                Eventbrite and Luma block cross-origin browser reads outside{' '}
                <code>npm run dev</code>. Deploy <code>api/sync.js</code> for a hosted run; the
                demo source works anywhere.
              </p>
            )}
          </section>
        )}

        {runError && (
          <div className="alert alert--error" role="alert">
            <span>{runError}</span>
          </div>
        )}

        {result && (
          <div className="alert alert--info" role="status">
            <div>
              <span>
                {result.dryRun ? 'Preview finished:' : 'Sync finished:'}{' '}
                {result.totals?.created ?? 0} created, {result.totals?.updated ?? 0} updated,{' '}
                {result.totals?.unchanged ?? 0} unchanged, {result.totals?.skipped ?? 0} skipped in{' '}
                {Math.round((result.durationMs || 0) / 100) / 10}s.
              </span>
              {result.sources?.some((source) => source.error) && (
                <ul className="sync-skip-list">
                  {result.sources
                    .filter((source) => source.error)
                    .map((source) => (
                      <li key={source.id}>
                        <strong>{source.label}</strong> — {source.error}
                      </li>
                    ))}
                </ul>
              )}
              {result.warnings?.length > 0 && (
                <ul className="sync-skip-list">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="alert alert--error" role="alert">
            {error}
          </div>
        )}

        <div className="sync-grid">
          <section className="panel">
            <div className="panel__head">
              <h2>Last run</h2>
              {lastRun && <span className="sync-meta">{whenLabel(lastRun.startedAt)}</span>}
            </div>

            {loading && <p className="map-note">Loading run history…</p>}

            {!loading && !lastRun && !error && (
              <p className="map-note">
                No sync has been recorded yet. Run{' '}
                <code>{CLI_COMMAND}</code> or use the button above.
              </p>
            )}

            {lastRun && (
              <>
                <p className="sync-meta">
                  {lastRun.dryRun ? 'Preview' : 'Write run'} · triggered by {lastRun.trigger || 'manual'}
                  {lastRun.durationMs ? ` · ${Math.round(lastRun.durationMs / 100) / 10}s` : ''}
                </p>
                <RunTotals totals={lastRun.totals} />

                {lastRun.skipped?.length > 0 && (
                  <details className="sync-details">
                    <summary>Why {lastRun.skipped.length} item(s) were skipped</summary>
                    <ul className="sync-skip-list">
                      {lastRun.skipped.slice(0, 10).map((item) => (
                        <li key={`${item.sourceId}-${item.title}-${item.reason}`}>
                          <strong>{item.title}</strong> — {item.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {lastRun.warnings?.length > 0 && (
                  <ul className="sync-skip-list">
                    {lastRun.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          <section className="panel">
            <div className="panel__head">
              <h2>Sources</h2>
              <span className="sync-meta">This browser · last run</span>
            </div>
            <ul className="sync-sources">
              {sourceStatuses.map(({ source, status, configured }) => (
                <SourceStatus
                  key={source.id}
                  source={source}
                  status={status}
                  configured={configured}
                />
              ))}
            </ul>
          </section>
        </div>

        <section className="panel sync-runbook">
          <div className="panel__head">
            <h2>Run it yourself</h2>
            <span className="sync-meta">Same orchestrator as the button</span>
          </div>
          <p>
            The button above runs in this browser with your signed-in session, so no service
            account is needed. The CLI does the same work through the Admin SDK and needs{' '}
            <code>FIREBASE_SERVICE_ACCOUNT</code> or{' '}
            <code>GOOGLE_APPLICATION_CREDENTIALS</code>.
          </p>
          <div className="code-block">
            <code>{CLI_COMMAND}</code>
            <button type="button" className="btn btn--ghost btn--sm" onClick={copyCommand}>
              {copied === 'cli' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <ul className="sync-steps">
            <li>
              Browser run: sign in as an admin, paste a token (or tick “Include 4 demo events”),
              then press <strong>Run sync now</strong>. Writes land in <code>events</code> and are
              logged to <code>syncRuns</code>.
            </li>
            <li>
              <code>npm run sync:events -- --dry-run</code> previews the plan without writing.
            </li>
            <li>
              <code>--source=luma</code> limits the run to one source;{' '}
              <code>--prune</code> removes curated events that ended more than 7 days ago.
            </li>
            <li>
              Automated: <code>.github/workflows/sync-events.yml</code> runs every 6 hours, and{' '}
              <code>api/sync.js</code> exposes the same run on a deployed host.
            </li>
          </ul>
        </section>

        {runs.length > 1 && (
          <section className="panel">
            <div className="panel__head">
              <h2>History</h2>
              <span className="sync-meta">Newest first</span>
            </div>
            <table className="sync-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Trigger</th>
                  <th scope="col">Created</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Skipped</th>
                  <th scope="col">Expired</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{whenLabel(run.startedAt)}</td>
                    <td>{run.trigger || 'manual'}</td>
                    <td>{run.totals?.created ?? 0}</td>
                    <td>{run.totals?.updated ?? 0}</td>
                    <td>{run.totals?.skipped ?? 0}</td>
                    <td>{run.totals?.expired ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <p className="sync-footer">
          Curated rows carry <code>origin: "curated"</code> and never overwrite a neighbor's post.{' '}
          <Link to="/">Back to the board</Link>
        </p>
      </div>
    </section>
  );
}

export default AdminSyncPage;
