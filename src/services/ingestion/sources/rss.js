// Generic RSS / Atom calendar adapter.
//
// A lot of neighborhood blogs, galleries, and DIY spaces still publish an RSS
// feed. This adapter reads them server-side and lets the normalizer decide
// which items are actually dated events.
//
// Config:
//   RSS_FEEDS=https://example.org/events.rss,https://another.org/feed.xml

import { parseFeed } from '../feedXml.js';
import { requestText } from '../http.js';
import { parseDateValue } from '../time.js';
import { splitList, stableHash, stripHtml } from '../text.js';

export function mapRssItem(item, { feedUrl = '', timeZone } = {}) {
  const startAt = item.start ? parseDateValue(item.start, { timeZone }) : null;
  const externalId =
    item.id || `${feedUrl}:${stableHash(`${item.title || ''}|${item.start || ''}`)}`;

  return {
    externalId,
    title: item.title || '',
    description: stripHtml(item.description || ''),
    startAt,
    endAt: null,
    url: item.link || item.url || feedUrl,
    imageUrl: item.image || '',
    venueName: '',
    address: item.location || '',
    price: '',
    externalCategory: '',
    tags: [],
  };
}

export const rssSource = {
  id: 'rss',
  label: 'RSS calendar',
  kind: 'feed',
  envVars: ['RSS_FEEDS'],
  docsUrl: '',
  isConfigured: (env = {}) => splitList(env.RSS_FEEDS).length > 0,

  async fetchEvents({ env = {}, fetchImpl, timeZone } = {}) {
    const feeds = splitList(env.RSS_FEEDS);
    if (!feeds.length) throw new Error('RSS_FEEDS is not set');

    const raw = [];
    for (const feedUrl of feeds) {
      const xml = await requestText(feedUrl, { fetchImpl, accept: 'application/rss+xml, application/atom+xml, text/xml, */*' });
      for (const item of parseFeed(xml, { feedUrl })) {
        raw.push(mapRssItem(item, { feedUrl, timeZone }));
      }
    }
    return raw;
  },
};

