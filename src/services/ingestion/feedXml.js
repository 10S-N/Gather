// Deliberately tiny RSS 2.0 / Atom reader. Feeds are the lowest-friction way
// for an indie calendar to publish, but pulling in a full XML parser for four
// fields is not worth the dependency (or the bundle). This handles CDATA,
// namespaced tags, and both RSS `<item>` and Atom `<entry>` blocks.

import { decodeEntities, normalizeWhitespace } from './text.js';

function stripCdata(value = '') {
  return String(value).replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
}

function blocksOf(xml, tagName) {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}\\s*>`, 'gi');
  const blocks = [];
  let match;
  while ((match = re.exec(xml)) !== null && blocks.length < 500) {
    blocks.push(match[1]);
  }
  return blocks;
}

// Looks for `<tag>`, `<ns:tag>`, or `<tag:attr>`-style names.
function tagText(block, names) {
  for (const name of names) {
    const re = new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>`, 'i');
    const match = block.match(re);
    if (match) {
      const value = decodeEntities(stripCdata(match[1])).trim();
      if (value) return normalizeWhitespace(value);
    }
  }
  return '';
}

function atomLink(block) {
  const links = [...block.matchAll(/<(?:[\w.-]+:)?link\b([^>]*)\/?>/gi)];
  if (!links.length) return '';
  const parsed = links.map((m) => {
    const attrs = m[1] || '';
    const href = attrs.match(/href\s*=\s*"([^"]*)"/i)?.[1] || attrs.match(/href\s*=\s*'([^']*)'/i)?.[1] || '';
    const rel = attrs.match(/rel\s*=\s*"([^"]*)"/i)?.[1] || 'alternate';
    return { href: decodeEntities(href).trim(), rel };
  });
  return (parsed.find((l) => l.rel === 'alternate' && l.href) || parsed.find((l) => l.href))?.href || '';
}

function firstAttribute(block, tagName, attr) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tagName}\\b[^>]*\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i');
  return decodeEntities(block.match(re)?.[1] || '').trim();
}

// Returns [{ id, title, description, link, start, published }]. `start` is a
// best-effort parse of the many date-ish tags calendars use.
export function parseFeed(xml, { feedUrl = '' } = {}) {
  if (!xml || typeof xml !== 'string') return [];

  const feedTitle = tagText(xml.slice(0, 4000), ['title']);
  const items = [...blocksOf(xml, 'item'), ...blocksOf(xml, 'entry')];

  return items.map((block, index) => {
    const title = tagText(block, ['title']);
    const description = tagText(block, ['description', 'summary', 'content', 'content:encoded']);
    const link =
      atomLink(block) ||
      tagText(block, ['link', 'guid', 'id']) ||
      feedUrl;
    const start =
      tagText(block, ['startdate', 'start-date', 'dtstart', 'event_start', 'when']) ||
      tagText(block, ['pubdate', 'published', 'updated', 'dc:date', 'date']);
    const id =
      tagText(block, ['guid', 'id']) ||
      firstAttribute(block, 'link', 'href') ||
      link ||
      `${feedTitle}:${title}:${start}:${index}`;

    return {
      id,
      title,
      description,
      link,
      start,
      published: tagText(block, ['pubdate', 'published', 'updated', 'dc:date']),
      location: tagText(block, ['location', 'where', 'venue']),
      image:
        firstAttribute(block, 'media:content', 'url') ||
        firstAttribute(block, 'enclosure', 'url') ||
        firstAttribute(block, 'media:thumbnail', 'url'),
      feedTitle,
    };
  });
}
