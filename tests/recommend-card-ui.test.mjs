// The recommendation card is the feed's only unit, and its compactness is
// structural: a square picture, one reason line, a two-line title, one meta
// line (when · where) and a single action — a tile you scan, not a card with
// four stacked paragraphs and a description.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { createServer } from 'vite';

const server = await createServer({
  root: process.cwd(),
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true },
});

after(async () => {
  await server.close();
});

const { default: RecommendationCard } = await server.ssrLoadModule(
  '/src/components/RecommendationCard.jsx',
);
const { AuthContext } = await server.ssrLoadModule('/src/contexts/AuthContext.jsx');
const { AuthModalContext } = await server.ssrLoadModule('/src/contexts/AuthModalContext.jsx');

const noop = () => {};

const event = {
  id: 'evt-1',
  source: 'community',
  title: 'Basement vinyl swap',
  category: 'Music/Indie',
  neighborhood: 'East Austin',
  address: '1200 E 6th St',
  description: 'Bring a record, leave with two.',
  startAt: new Date('2026-11-07T20:00:00Z'),
  price: 'Free',
  image: 'https://example.com/vinyl.jpg',
  hostName: 'Nadia',
  hostPhotoURL: '',
  attendeeCount: 12,
  capacity: null,
};

function renderCard(props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      AuthContext.Provider,
      { value: { user: { uid: 'u1' }, loading: false } },
      React.createElement(
        AuthModalContext.Provider,
        { value: { openLogin: noop, openSignup: noop, close: noop } },
        React.createElement(
          StaticRouter,
          { location: '/' },
          React.createElement(RecommendationCard, { event, reason: 'Because you picked Music/Indie', ...props }),
        ),
      ),
    ),
  );
}

test('the card keeps one meta line instead of stacked date and place rows', () => {
  const html = renderCard();

  assert.match(html, /class="rec-card__meta"/);
  assert.match(html, /class="rec-card__when"/);
  assert.match(html, /class="rec-card__place">East Austin/);

  // The grid card's separate date paragraph is gone from this card.
  assert.ok(!html.includes('card__date'));
});

test('the card carries its reason, title, and RSVP action', () => {
  const html = renderCard();

  assert.match(html, /Because you picked Music\/Indie/);
  assert.match(html, /class="rec-card__title"/);
  assert.match(html, /Basement vinyl swap/);
  assert.match(html, /♡ Interested/);

  // The title link is the tile's single target; there is no second "Details"
  // button taking up a row of its own.
  assert.match(html, /<a href="\/event\/evt-1"/);
  assert.ok(!html.includes('>Details<'));

  // No description paragraph — a tile shows three lines, not a preview body.
  assert.ok(!html.includes('Bring a record'));
  assert.ok(!html.includes('rec-card__desc'));
});

test('cards without a reason (the rest of the board) do not show one', () => {
  const html = renderCard({ reason: '' });
  assert.ok(!html.includes('rec-card__reason'));
});
