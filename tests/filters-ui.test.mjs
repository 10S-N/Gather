// DOM-level check of the filter controls: components are rendered through the
// project's own Vite pipeline and asserted as HTML, so a broken prop name or a
// menu that stops rendering its options fails here rather than in the browser.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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

const { default: EventFilters, NeighborhoodMenu } = await server.ssrLoadModule(
  '/src/components/EventFilters.jsx',
);

const noop = () => {};

function renderFilters(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(EventFilters, {
      category: 'All',
      onCategoryChange: noop,
      neighborhoods: [],
      neighborhoodCounts: {},
      onToggleNeighborhood: noop,
      onClearNeighborhoods: noop,
      when: 'all',
      onWhenChange: noop,
      price: 'all',
      onPriceChange: noop,
      dateFrom: '',
      dateTo: '',
      onDateChange: noop,
      sort: 'soonest',
      onSortChange: noop,
      counts: {},
      total: 0,
      view: 'grid',
      onViewChange: noop,
      onReset: noop,
      hasActiveFilters: false,
      ...overrides,
    }),
  );
}

test('the toolbar renders a neighborhood picker and every sort option', () => {
  const html = renderFilters();

  // Closed picker shows the "everything" state, not a stale neighborhood name.
  assert.match(html, /<button[^>]*class="select select--multi[^"]*"[^>]*>All Austin neighborhoods<\/button>/);
  assert.match(html, /aria-expanded="false"/);

  for (const value of ['soonest', 'latest', 'cheapest', 'popular']) {
    assert.ok(html.includes(`value="${value}"`), `sort option ${value} is missing`);
  }
  assert.match(html, /<option value="soonest" selected="">Soonest first<\/option>/);

  // The neighborhood <select> is gone — multi-select replaced it.
  assert.ok(!html.includes('All Austin neighborhoods</option>'));
});

test('the picker summarises a multi-selection', () => {
  const two = renderFilters({ neighborhoods: ['Downtown', 'Hyde Park'] });
  assert.match(two, />Downtown \+ 1<\/button>/);

  const three = renderFilters({ neighborhoods: ['Downtown', 'Hyde Park', 'Zilker'] });
  assert.match(three, />3 neighborhoods<\/button>/);

  const one = renderFilters({ neighborhoods: ['Zilker'] });
  assert.match(one, />Zilker<\/button>/);
});

test('the neighborhood menu lists options with counts and honours selection', () => {
  const html = renderToStaticMarkup(
    React.createElement(NeighborhoodMenu, {
      selected: ['Downtown'],
      counts: { Downtown: 3, Zilker: 2 },
      onToggle: noop,
      onClear: noop,
    }),
  );

  assert.match(html, /1 selected/);
  assert.match(html, />Downtown<\/span><span class="multi__count">3</);
  assert.match(html, />Zilker<\/span><span class="multi__count">2</);

  // Picked options are checked; empty ones are disabled so a click can never
  // land on a guaranteed-empty result.
  assert.match(
    html,
    /<label class="multi__option is-active"><input type="checkbox" checked=""\/><span class="multi__name">Downtown<\/span>/,
  );
  assert.match(html, /class="multi__option is-empty"><input type="checkbox" disabled=""/);
  assert.match(html, /multi__clear/);

  // A picked option is never disabled, even when it now matches nothing —
  // otherwise a selection could become impossible to undo.
  const pickedButEmpty = renderToStaticMarkup(
    React.createElement(NeighborhoodMenu, {
      selected: ['Zilker'],
      counts: { Zilker: 0 },
      onToggle: noop,
      onClear: noop,
    }),
  );
  assert.match(
    pickedButEmpty,
    /<label class="multi__option is-active"><input type="checkbox" checked=""\/><span class="multi__name">Zilker<\/span>/,
  );

  // Nothing selected: no Clear button, and the header counts the options.
  const empty = renderToStaticMarkup(
    React.createElement(NeighborhoodMenu, {
      selected: [],
      counts: {},
      onToggle: noop,
      onClear: noop,
    }),
  );
  assert.match(empty, /18 Austin neighborhoods/);
  assert.ok(!empty.includes('multi__clear'));
});
