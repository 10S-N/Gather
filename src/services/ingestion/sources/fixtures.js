// Demo fixture source.
//
// The ingestion pipeline is normally driven from Node (CLI or cron) because the
// public calendars are not CORS-friendly. This adapter exists so a *browser*
// write run can still be exercised end to end — auth, dedupe, batched writes,
// the curated UI — with no third-party token at all.
//
// It is off unless `SYNC_FIXTURES=1` is passed explicitly, and every row it
// produces is labelled "Demo fixture" so demo data is never mistaken for a real
// listing. Dates are generated relative to the run, so the rows are always
// upcoming. `deleteDemoEvents()` in src/services/syncAdmin.js removes them.
//
// Config:
//   SYNC_FIXTURES=1

import { AUSTIN_TIME_ZONE, isoDay, zonedTimeToUtc } from '../time.js';

// Note: `externalId` is stable across runs, which is what makes repeat runs
// idempotent instead of duplicating four more rows.
const DEMOS = [
  {
    externalId: 'fixture-porchlight-sessions',
    title: 'Porchlight Sessions: an evening of slow indie',
    description:
      'Four Austin indie bands play two short sets each on the back patio. Doors at 7:30pm, music at 8. All ages, cash bar, no cover for the first fifty people.',
    daysAhead: 2,
    hour: 20,
    minute: 0,
    durationHours: 3,
    venueName: 'Mohawk',
    address: '912 Red River St, Austin, TX 78701',
    price: '$12',
    externalCategory: 'Music',
    tags: ['indie', 'livemusic'],
  },
  {
    externalId: 'fixture-eastside-art-walk',
    title: 'Eastside Art Walk: studios open late',
    description:
      'Twelve studios between Springdale and Airport open their doors for the evening. Pick up a map at the first stop, meet the artists, and catch a short print demo every half hour.',
    daysAhead: 5,
    hour: 18,
    minute: 0,
    durationHours: 4,
    venueName: 'Big Medium',
    address: '916 Springdale Rd, Austin, TX 78702',
    price: 'Free',
    externalCategory: 'Performing & Visual Arts',
    tags: ['art', 'gallery'],
  },
  {
    externalId: 'fixture-zine-swap',
    title: 'Zine swap & risograph demo',
    description:
      'Bring zines, comics, or prints to trade and leave with someone else’s. A working risograph will be set up for one-color prints; bring a black-and-white file on a USB stick.',
    daysAhead: 9,
    hour: 14,
    minute: 0,
    durationHours: 3,
    venueName: 'Batch Craft Beer & Kolaches',
    address: '3220 Manor Rd, Austin, TX 78723',
    price: 'Free',
    externalCategory: 'Community',
    tags: ['zines', 'makers'],
  },
  {
    externalId: 'fixture-fixit-clinic',
    title: 'Fix-It Clinic: bring one broken thing',
    description:
      'Volunteer fixers help you repair lamps, small appliances, bikes, and torn clothing. One item per household, first come first served. Tools and most spare parts are provided.',
    daysAhead: 13,
    hour: 11,
    minute: 0,
    durationHours: 4,
    venueName: 'Austin Central Library',
    address: '710 W César Chávez St, Austin, TX 78701',
    price: 'Free',
    externalCategory: 'Family & Education',
    tags: ['repair', 'workshop'],
  },
];

// Austin wall-clock date `days` from now. isoDay() gives the local calendar day
// so a fixture doesn't drift to the previous evening across a DST boundary.
function austinDayAfter(now, days) {
  const [year, month, day] = isoDay(new Date(now.getTime() + days * 86_400_000), AUSTIN_TIME_ZONE)
    .split('-')
    .map(Number);
  return { year, month, day };
}

export function buildFixtureEvents(now = new Date()) {
  return DEMOS.map((demo) => {
    const day = austinDayAfter(now, demo.daysAhead);
    const startAt = zonedTimeToUtc({ ...day, hour: demo.hour, minute: demo.minute }, AUSTIN_TIME_ZONE);
    const endAt = new Date(startAt.getTime() + demo.durationHours * 3_600_000);

    return {
      externalId: demo.externalId,
      title: demo.title,
      description: demo.description,
      startAt,
      endAt,
      url: '',
      imageUrl: '',
      venueName: demo.venueName,
      address: demo.address,
      city: 'Austin',
      lat: null,
      lng: null,
      price: demo.price,
      externalCategory: demo.externalCategory,
      tags: demo.tags,
    };
  });
}

export const fixtureSource = {
  id: 'fixture',
  label: 'Demo fixture',
  kind: 'fixture',
  envVars: ['SYNC_FIXTURES'],
  docsUrl: '',
  isConfigured: (env = {}) =>
    env.SYNC_FIXTURES === true || /^(1|true|yes)$/i.test(String(env.SYNC_FIXTURES || '')),

  async fetchEvents({ now = new Date() } = {}) {
    return buildFixtureEvents(now);
  },
};
