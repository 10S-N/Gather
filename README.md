# Gather — hyper-local Austin events

A community-run board for neighborhood events: house shows, art walks, pop-ups,
workshops, swaps, and cleanups. Events are posted by the people hosting them —
and a scheduled ingestion service adds a handful of curated finds from Austin's
indie calendars, clearly labelled so neighbors can tell the difference. There is
no commercial ticketing dependency in the core loop.

## Stack

- **React 19 + Vite** (client-side app, React Router)
- **Firebase** — Firestore for events + RSVPs, Auth for accounts, Storage for images
- **Leaflet + OpenStreetMap** — map view (lazy-loaded, no API key required)
- **Ingestion** — Node CLI + serverless handler (Eventbrite API, Luma iCalendar, RSS) writing through the Firebase Admin SDK
- **Styling** — inline styles plus the design tokens / responsive classes in `src/index.css`
- **Deployment** — any static host (Vercel works out of the box: build `npm run build`, output `dist`)

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production bundle in dist/
npm run lint
npm test             # node:test — parsers, normalization, dedupe, sync
npm run sync:events  # curated ingestion, see below
```

### Environment

Copy `.env.example` to `.env.local` (git-ignored) and fill in what you need. Only
`VITE_*` values reach the browser; ingestion tokens are read by the CLI and the
serverless handler and never shipped to clients.

```
VITE_ADMIN_UIDS=...            # uids allowed to open /admin/sync (npm run admin:grant)
VITE_SYNC_ENDPOINT=/api/sync   # optional: HTTP endpoint for triggerSync()
VITE_EVENTBRITE_API_KEY=...    # optional browser-run key (ships in the bundle — prefer pasting it in the form)

EVENTBRITE_API_KEY=...         # curated ingestion (server-side)
EVENTBRITE_ORGANIZERS=...      # Austin indie organizer ids, comma-separated
EVENTBRITE_MAX_EVENTS=20       # per run (default 20, max 50)
LUMA_CALENDARS=austinindie,another-calendar
RSS_FEEDS=https://example.org/events.rss
FIREBASE_SERVICE_ACCOUNT=...   # Admin SDK credentials for the sync
```

Firebase web config lives in `src/firebase.js`. It is a public client key by
design; access is controlled by the security rules below.

### Deploy the security rules (required)

The app stores events in Firestore, so the deployed rules must allow public reads
and host-only writes. Until you deploy them, the board shows
*"Missing or insufficient permissions."*

```bash
firebase deploy --only firestore:rules,storage   # or: npx firebase-tools deploy ...
```

## Data model

```
users/{uid}
  coverPhotoURL: string | null

events/{eventId}
  title, description        string
  category                  one of CATEGORIES in src/data/neighborhoods.js
  tags[]                    up to 6 short strings
  neighborhood, address     string
  startAt, endAt            Timestamp (endAt optional)
  imageUrl, rsvpUrl         string (optional)
  price                     string ("Free", "$10", "donation")
  capacity                  number | null
  attendeeCount             number      (denormalized, moves with RSVPs)
  hostUid, hostName, hostPhotoURL
  createdAt, updatedAt

  # curated rows only (written by the ingestion service)
  origin                    "curated"    (absent = "community")
  source, sourceLabel       source id + human label, e.g. "luma" / "Luma"
  externalId                 id at the source, used for idempotent sync
  sourceUrl                  link back to the original listing
  syncedAt                   Timestamp of the last sync write

syncRuns/{runId}             # audit log, written by the sync, readable by admins
  trigger, dryRun, startedAt, finishedAt, durationMs
  sources[], totals{}, skipped[], warnings[]

rsvps/{eventId}__{uid}       # composite id => idempotent joins
  eventId, uid, displayName, photoURL, createdAt
```

A flat `rsvps` collection (rather than a subcollection) keeps "events I'm going
to" to a single automatic index and avoids a collection-group index requirement.
Each RSVP write is a batch: membership doc + `attendeeCount` increment, so counts
can't drift. Rules allow non-hosts to change **only** `attendeeCount`, and only by
one step per write.

## Features

| Area | Where |
| --- | --- |
| Discovery feed, search, category / neighborhood / date filters, card + map views | `src/pages/HomePage.jsx`, `src/components/EventFilters.jsx`, `src/components/MapView.jsx` |
| Event card (tags, host, attendee count, RSVP) | `src/components/EventCard.jsx`, `src/components/RsvpButton.jsx` |
| Post / edit event with validation, image upload, capacity + RSVP link | `src/pages/PostEventPage.jsx` |
| Event detail with live attendee count, capacity bar, host tools | `src/pages/EventDetailPage.jsx` |
| Profile: going / hosting / account tabs, avatar + cover editing | `src/pages/ProfilePage.jsx`, `src/components/EditProfileModal.jsx` |
| Pure event helpers (dates, filtering, validation) | `src/utils/events.js` |
| Firestore access | `src/services/events.js`, `src/services/rsvps.js` |
| Curated ingestion (sources, normalization, dedupe, orchestration) | `src/services/ingestion/` |
| Sync CLI / serverless handler / audit stores | `scripts/sync-events.mjs`, `api/sync.js`, `server/ingestionStore.js`, `src/services/ingestion/clientStore.js` |
| Sync dashboard (`/admin/sync`) | `src/pages/AdminSyncPage.jsx`, `src/services/syncAdmin.js` |

### RSVP flow

Reading the board works signed out. Tapping RSVP while signed out opens the
shared auth modal (mounted once by `src/contexts/AuthModalProvider.jsx`); after
signing in the RSVP is written. Hosts can't RSVP their own event — they see a
"You're hosting" state plus Edit / Delete controls instead.

### Curated ingestion

A scheduled service pulls independent, neighborhood, and indie happenings into
the same `events` collection, tagged `origin: "curated"`. It deliberately avoids
mainstream ticketing APIs; the sources are Eventbrite (organizer-scoped), Luma
calendars (iCalendar), and any RSS/Atom event feed.

```
sources/*        adapter per platform: fetch + map into a canonical raw shape
  ↓
normalize.js     validate, infer category/neighborhood/tags, build the doc
  ↓
dedupe.js        match by external id, then title + date; plan create/update/skip/expire
  ↓
sync.js          orchestrate; never let one broken feed block the others
  ↓
firebase-admin   batched writes (400/batch) + syncRuns audit entry
```

Every decision lives in pure modules, so `npm test` covers parsing, timezone
handling, classification, deduplication, and a full sync against an in-memory
store — no Firestore or network required.

**Where does it run?** The pipeline is runtime-agnostic. Node (CLI, cron,
serverless) is the reliable path: Eventbrite and calendar feeds send no CORS
headers, and the Admin SDK can write without a user session. `/admin/sync` can
also execute the same `runSync` in the browser through the client SDK, writing
as a signed-in ingestion admin — that is the fastest way to populate Firestore
from a Vite app with no service account (see below).

#### Sources

| Source | Env | Notes |
| --- | --- | --- |
| Eventbrite | `EVENTBRITE_API_KEY` (`EVENTBRITE_API_TOKEN` alias), `EVENTBRITE_ORGANIZERS`, `EVENTBRITE_CATEGORIES`, `EVENTBRITE_MAX_EVENTS` | Set `EVENTBRITE_ORGANIZERS` (comma-separated ids) to follow specific indie organizers. Without it the adapter falls back to Austin-scoped event search, which Eventbrite has retired for new apps — a 404/403 there means you need organizers. Results are capped at 20 per run (within 25mi of Austin) and virtual-only webinars, cancelled listings, and out-of-town venues are dropped. |
| Luma | `LUMA_CALENDARS` | Calendar slugs (`austinindie`) or full `https://lu.ma/<slug>/ics` URLs. Cancelled events are dropped. |
| RSS / Atom | `RSS_FEEDS` | Comma-separated feed URLs. Items need a parseable start date, otherwise they are skipped. |

Enable any subset — a source with no configuration is reported as such and
skipped. Everything is Austin-scoped: floating times are read as
`America/Chicago`, out-of-town venues are dropped, and neighborhoods are
inferred from a venue list, street names, or map coordinates, falling back to
Downtown.

#### Eventbrite key & organizer ids

1. Sign in at [eventbrite.com](https://www.eventbrite.com) → **Account Settings**
   → **Developer Links** → **API Keys** → **Create API Key** → **Create Key**.
2. Copy the **Private token** (it starts with a long alphanumeric string). It is
   free and does not need an app review.
3. Put it in `.env.local` as `EVENTBRITE_API_KEY` for the CLI/serverless run,
   or paste it into **/admin/sync** for a browser run. Avoid
   `VITE_EVENTBRITE_API_KEY` unless you are comfortable with the token shipping
   in the client bundle.
4. Add the organizers you actually want to follow:

   ```
   EVENTBRITE_ORGANIZERS=123456789,987654321
   ```

   Organizer ids are the digits in `eventbrite.com/o/<name>-<id>` URLs. Their
   event pages show them under **Hosted by**. The adapter reads each
   organization's event list (`/organizations/{id}/events/`), which is the
   supported path; Eventbrite's public `/events/search/` endpoint was retired
   for new apps in 2020, so the search fallback is best-effort only.

The adapter keeps the 20 soonest usable Austin listings per run, filtering on
the venue's city and coordinates rather than the organizer's home base, and
drops virtual-only webinars (`webinar`, `virtual event`, `livestream`, ...).
Missing keys, 401/403/404, and 429 rate limits surface as readable per-source
errors without failing the other sources.

#### Running it

```bash
npm run sync:events -- --dry-run          # fetch + plan, no writes
npm run sync:events                       # write to Firestore
npm run sync:events -- --prune            # also delete curated events that ended 7+ days ago
npm run sync:events -- --source=luma --json
```

Requires `FIREBASE_SERVICE_ACCOUNT` (inline JSON) or
`GOOGLE_APPLICATION_CREDENTIALS` (file path) unless you are only doing a dry run.
The CLI loads `.env.local` / `.env`, so local runs behave like the app.

Use Node 22+ (see `engines` in `package.json` and `.nvmrc`). `firebase-admin@14`
ships Firestore as an optional dependency, so installing under an older Node
skips it without failing the install.

#### Run a live write from the browser (no service account)

**Run sync now** on `/admin/sync` executes `runSync` in the page and writes with
the client SDK. Setup is one uid and one rules deploy:

1. Open `/admin/sync`, sign in, and copy your uid from the notice (or the
   Firebase console). The notice has a copy button for the next command.
2. `npm run admin:grant -- <your-firebase-uid>` — writes the uid to
   `VITE_ADMIN_UIDS` in `.env.local` (creating the file if needed) **and** to the
   `isIngestionAdmin()` list in `firestore.rules`. Add `--dry-run` to preview.
3. `npx firebase-tools deploy --only firestore:rules` (or `firebase deploy ...`
   if the CLI is installed globally), restart `npm run dev` (Vite reads
   `.env.local` only at startup), reload `/admin/sync`, then press
   **Run sync now**.

No key yet? Tick **Include 4 demo events** — four rows labelled `Demo fixture`
are written, deduped on repeat runs, and removable with **Remove demo events**.
With a key, tick **Fetch live Eventbrite events**, paste the private token into
the form (held in memory for that run only), and the Eventbrite adapter runs
immediately. Untick it to run only Luma/RSS/demo sources; the two toggles can be
combined.

`npm run dev` serves a local `/__ingest` proxy so the browser can read feeds that
lack CORS headers. A production build has no proxy, so deploy `api/sync.js` for
hosted runs; cron should keep using the CLI.

#### Automation

- **Schedule** — `.github/workflows/sync-events.yml` runs every 6 hours (and on
  `workflow_dispatch`) with `FIREBASE_SERVICE_ACCOUNT` as a repository secret.
  Any cron runner works: it is just `node scripts/sync-events.mjs --prune`.
  The workflow installs with `npm ci --include=optional` on **Node 22** and then
  verifies that `firebase-admin`, `firebase-admin/firestore`, and
  `@google-cloud/firestore` actually load before syncing. Node 22 is required:
  `firebase-admin@14` lists Firestore as an *optional* dependency, and npm
  silently skips optional packages that do not match the runner's `engines.node`
  — on Node 20 `npm ci` succeeds but the sync dies with
  `Cannot find module '@google-cloud/firestore'`.
  To set it up, create a service-account key (Google Cloud console → IAM & Admin
  → Service Accounts → Keys → Add key → JSON, role Cloud Datastore User), then
  add its full contents as the `FIREBASE_SERVICE_ACCOUNT` repository secret
  (Settings → Secrets and variables → Actions). `EVENTBRITE_API_KEY` is a secret;
  `EVENTBRITE_ORGANIZERS`, `LUMA_CALENDARS`, and `RSS_FEEDS` can be repository
  variables.
- **From the UI** — `/admin/sync` shows the last run, per-source status, skip
  reasons, and history, plus **Run sync now** / **Preview only**. The button runs
  the sync in the browser as a signed-in ingestion admin (client SDK + rules).
  `triggerSync()` in `src/services/syncAdmin.js` does the same thing over HTTP if
  you deploy `api/sync.js`, which verifies the caller's Firebase ID token and
  checks `ADMIN_UIDS` / `ADMIN_EMAILS`; set `SYNC_SECRET` for scheduler calls.

#### Deduplication

Before writing, the planner compares incoming events against the events already
on the board:

1. **External id** (`source` + `externalId`) — re-running a sync updates in
   place. Document ids are derived from a hash of the same pair, so a create is
   idempotent too.
2. **Title + local date** — catches the same event syndicated across calendars.
3. **Never shadow a neighbor** — if a community post already matches, the
   curated copy is skipped; if two calendars carry the same event, the first
   curated copy wins.

Only fields that actually changed are written, so an unchanged feed causes zero
writes. Rejected rows (past, unparseable, out of the 120-day window, no external
id) are counted and sampled in the run report.

#### In the UI

Curated rows appear in the normal feed and map, filtered and searched like any
other event, with a subtle **Curated** badge (and the source name) versus
**Community** on neighbor posts. They are read-only on Gather: the card and the
detail page link to the original listing instead of offering an RSVP and host
tools are hidden. Firestore rules only let an ingestion admin (the uid list in
`firestore.rules`) create or update a curated row, and never let anyone
relabel a community post as curated.

### City-wide listings

"City-wide listings" on the home page is a *separate, optional* section that
pulls larger-venue events from the Ticketmaster Discovery API
(`src/services/eventSources/`). It is intentionally not part of the curated
ingestion pipeline: it only fires a network request when a visitor expands the
section, and the community board never depends on it. Add
`VITE_TICKETMASTER_KEY` to enable it; without a key the section explains what's
missing.

### Map view

The map places one pin per neighborhood at that neighborhood's approximate
center (see `NEIGHBORHOODS` in `src/data/neighborhoods.js`) — no geocoding
service or API key is needed. Pins show a count and open a popup that links to
each event; events whose neighborhood isn't in the list are reported below the
map.
