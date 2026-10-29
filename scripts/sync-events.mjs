#!/usr/bin/env node
// Gather curated-event sync.
//
//   npm run sync:events              # write to Firestore
//   npm run sync:events -- --dry-run # fetch + normalize + plan, no writes
//
// Credentials (one of):
//   FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'   # inline JSON
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
//   (or ambient workload identity, e.g. on Cloud Run / GitHub OIDC)
//
// Sources are configured through the environment; see README "Curated ingestion".

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createFirestoreStore, initAdminApp } from '../server/ingestionStore.js';
import { describeSources, getSources, runSync } from '../src/services/ingestion/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Tiny .env loader so `npm run sync:events` behaves like `npm run dev`.
// Vite only exposes VITE_* to the browser, so server tokens in .env.local stay
// server-side.
function loadEnvFiles(files = ['.env.local', '.env']) {
  for (const file of files) {
    const full = path.join(ROOT, file);
    if (!existsSync(full)) continue;
    for (const line of readFileSync(full, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

// Determines whether the Admin SDK has anything to authenticate with. This is
// deliberately explicit: applicationDefault() resolves lazily, so without a
// check a dry run would only fail later, inside the first Firestore query.
function hasAdminCredentials(env) {
  return Boolean(
    env.FIREBASE_SERVICE_ACCOUNT ||
      env.GOOGLE_APPLICATION_CREDENTIALS ||
      env.GOOGLE_CLOUD_PROJECT ||
      env.GCLOUD_PROJECT ||
      env.FIREBASE_CONFIG,
  );
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    prune: false,
    json: false,
    sources: [],
    limit: null,
    expireAfter: 7,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--prune') options.prune = true;
    else if (arg === '--json') options.json = true;
    else if (arg.startsWith('--source=')) {
      options.sources = arg.slice('--source='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith('--limit=')) options.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--expire-after=')) options.expireAfter = Number(arg.slice('--expire-after='.length));
    else if (arg === '--help' || arg === '-h') options.help = true;
    else {
      console.error(`Unknown option: ${arg}`);
      options.help = true;
    }
  }

  if (options.limit != null && (!Number.isFinite(options.limit) || options.limit <= 0)) {
    options.limit = null;
  }
  if (!Number.isFinite(options.expireAfter) || options.expireAfter < 0) options.expireAfter = 7;
  return options;
}

const HELP = `
Gather curated-event sync

Usage
  node scripts/sync-events.mjs [options]

Options
  --dry-run            Fetch and normalize, print the plan, write nothing
  --prune              Delete curated events that ended > --expire-after days ago
  --expire-after=N     Days after an event's start before pruning (default 7)
  --source=a,b         Only run the given sources (do512, calendars, eventbrite, luma, rss, fixture)
  --limit=N            Max events per source (default 200)
  --json               Print the full run report as JSON

Sources are enabled by environment variables:
  DO512_DAYS                      Day pages to read, 1-21 (default 7) — needs no key
  CALENDAR_URLS                   Extra community calendar pages (JSON-LD or iCal)
  CALENDAR_DEFAULTS=off           Run only CALENDAR_URLS, skip the built-in Austin calendars
  EVENTBRITE_API_KEY              Eventbrite private token (EVENTBRITE_API_TOKEN also works)
  EVENTBRITE_PLACES               Discovery locality ids (default: Austin, 101724577)
  EVENTBRITE_ORGANIZERS           Read these organizer ids instead of discovery
  LUMA_CALENDARS                  Full iCalendar URLs (a lu.ma/<slug>/ics link is not a feed)
  RSS_FEEDS                       Comma-separated RSS/Atom feed URLs
  SYNC_FIXTURES=1                 Add four labelled demo events
`;

function printReport(run) {
  const { bold, dim, green, yellow, red } = color();
  console.log('');
  for (const source of run.sources) {
    const status = source.ok ? green('ok') : dim('skipped');
    const detail = source.ok
      ? `${source.fetched} fetched · ${source.imported} imported · ${source.invalid} rejected`
      : source.error;
    console.log(`  ${status.padEnd(10)} ${bold(source.label.padEnd(14))} ${detail}`);
  }

  const { totals, planned } = run;
  console.log('');
  if (run.dryRun) {
    console.log(
      `  ${yellow('dry run')} — plan: ${planned.creates} create, ${planned.updates} update, ` +
        `${planned.unchanged} unchanged, ${planned.skipped} skipped, ${planned.expired} expire`,
    );
  } else {
    console.log(
      `  ${green('synced')} — ${totals.created} created, ${totals.updated} updated, ` +
        `${totals.unchanged} unchanged, ${totals.skipped} skipped, ${totals.expired} expired` +
        ` (${run.durationMs}ms)`,
    );
  }

  if (run.warnings?.length) {
    console.log('');
    for (const warning of run.warnings) console.log(`  ${yellow('!')} ${warning}`);
  }

  if (run.skipped?.length) {
    console.log('');
    console.log(`  ${dim('First skipped items:')}`);
    for (const item of run.skipped.slice(0, 8)) {
      console.log(`  ${dim('·')} ${item.title} — ${red(item.reason)}`);
    }
  }

  if (run.sampleCreates?.length) {
    console.log('');
    console.log(`  ${dim('New on the board:')}`);
    for (const item of run.sampleCreates) {
      console.log(`  ${green('+')} ${item.title} ${dim(`(${item.neighborhood} · ${item.category})`)}`);
    }
  }
  console.log('');
}

function color() {
  const enabled = process.stdout.isTTY;
  const wrap = (code) => (text) => (enabled ? `\u001b[${code}m${text}\u001b[0m` : String(text));
  return {
    bold: wrap('1'),
    dim: wrap('2'),
    green: wrap('32'),
    yellow: wrap('33'),
    red: wrap('31'),
  };
}

async function main() {
  loadEnvFiles();
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(HELP);
    return 0;
  }

  const allSources = describeSources(process.env);
  const configured = allSources.filter((source) => source.configured);
  if (!configured.length) {
    console.error(
      'No ingestion sources are configured. Set EVENTBRITE_API_KEY, LUMA_CALENDARS, or RSS_FEEDS — or just run the Do512 source, which is always on (see .env.example).',
    );
    return 1;
  }

  const sources = getSources(process.env, { only: options.sources });
  if (!sources.length) {
    console.error(
      `None of the requested sources are configured (${options.sources.join(', ') || 'any'}).`,
    );
    return 1;
  }

  let store;
  if (hasAdminCredentials(process.env)) {
    try {
      initAdminApp(process.env);
      store = createFirestoreStore();
    } catch (err) {
      console.error(`Could not initialize the Firebase Admin SDK: ${err.message}`);
      console.error('Check FIREBASE_SERVICE_ACCOUNT / GOOGLE_APPLICATION_CREDENTIALS.');
      return 1;
    }
  } else if (options.dryRun) {
    // A dry run is useful without credentials; dedupe against existing rows is
    // simply skipped in that case.
    console.warn('No Firebase credentials — planning without existing rows.');
    store = {
      loadExisting: async () => [],
      commit: async () => ({ created: 0, updated: 0, expired: 0, batches: 0 }),
    };
  } else {
    console.error('Firestore credentials are required to write a sync.');
    console.error('Set FIREBASE_SERVICE_ACCOUNT (inline JSON) or GOOGLE_APPLICATION_CREDENTIALS (file path),');
    console.error('or pass --dry-run to preview without writing.');
    return 1;
  }

  const run = await runSync({
    sources,
    store,
    env: process.env,
    dryRun: options.dryRun,
    pruneExpired: options.prune,
    expireAfterDays: options.expireAfter,
    maxPerSource: options.limit || 200,
    trigger: 'cli',
  });

  if (options.json) {
    console.log(JSON.stringify(run, null, 2));
  } else {
    printReport(run);
  }

  const anySourceSucceeded = run.sources.some((source) => source.ok);
  return anySourceSucceeded ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err?.stack || err?.message || err);
    process.exitCode = 1;
  });
