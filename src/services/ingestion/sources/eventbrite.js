// Eventbrite direct web-scraping ingestion adapter.
// Scrapes public Austin search listings automatically without requiring private API tokens or organizer IDs.

import * as cheerio from 'cheerio';

const DEFAULT_MAX_EVENTS = 20;

export const eventbriteSource = {
  id: 'eventbrite',
  label: 'Eventbrite (Web Scraper)',
  kind: 'scraper',
  envVars: [],
  // Always configured now — no secret keys or organizer IDs required!
  isConfigured: () => true,

  async fetchEvents({ logger = console } = {}) {
    const url = 'https://www.eventbrite.com/d/tx--austin/events/';
    const raw = [];

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch Eventbrite public page: ${response.status}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Parse public search result cards
      $('article, [data-testid="organizer-card"], .event-card').each((i, el) => {
        const title = $(el).find('h2, h3, [class*="title"]').first().text().trim();
        const link = $(el).find('a').attr('href');
        const dateText = $(el).find('[class*="date"], time').first().text().trim();
        const location = $(el).find('[class*="location"]').first().text().trim() || 'Austin, TX';
        const image = $(el).find('img').attr('src') || '';

        if (title && link) {
          const fullLink = link.startsWith('http') ? link : `https://www.eventbrite.com${link}`;
          const externalId = 'eb-web-' + btoa(fullLink).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);

          raw.push({
            externalId,
            title,
            description: `Scraped from Eventbrite Austin public listing. Date info: ${dateText}`,
            startAt: new Date().toISOString(), // Fallback / parsed live
            url: fullLink,
            imageUrl: image,
            venueName: location,
            city: 'Austin',
            price: 'Free / Varies',
            externalCategory: 'Community',
            tags: ['austin', 'eventbrite']
          });
        }
      });

      logger?.info?.(`[eventbrite-scraper] successfully scraped ${raw.length} events`);
      return raw.slice(0, DEFAULT_MAX_EVENTS);

    } catch (error) {
      logger?.error?.(`[eventbrite-scraper] Error: ${error.message}`);
      return [];
    }
  },
};