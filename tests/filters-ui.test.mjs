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
const { default: ResultsBar } = await server.ssrLoadModule('/src/components/ResultsBar.jsx');

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
      counts: {},
      total: 0,
      onReset: noop,
      hasActiveFilters: false,
      ...overrides,
    }),
  );
}

function renderResultsBar(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(ResultsBar, {
      count: 0,
      query: '',
      sort: 'soonest',
      onSortChange: noop,
      view: 'grid',
      onViewChange: noop,
      ...overrides,
    }),
  );
}

test('the toolbar keeps one compact row of narrowing controls', () => {
  const html = renderFilters();

  // Closed pickers show their "everything" state, not a stale selection.
  assert.match(html, /<button[^>]*class="select select--multi[^"]*"[^>]*>All Austin neighborhoods<\/button>/);
  assert.match(html, /<button[^>]*class="select select--multi[^"]*"[^>]*>Date range<\/button>/);
  assert.match(html, /aria-expanded="false"/);

  // The category chips stay, and a chip with no matches is disabled.
  assert.match(html, />All events</);

  // Dropping the visible labels must not drop the accessible names.
  assert.match(html, /<span class="sr-only">When<\/span>/);
  assert.match(html, /<span class="sr-only">Price<\/span>/);

  // From/To are behind the single date control rather than sitting in the row.
  assert.ok(!html.includes('type="date"'), 'date inputs should be inside the panel');

  // Sorting and the view switch moved to the results strip, so the toolbar has
  // no second <select> for sort and no duplicate of it.
  assert.ok(!html.includes('value="soonest"'));
  assert.ok(!html.includes('view-toggle'));

  // The neighborhood <select> is gone — multi-select replaced it.
  assert.ok(!html.includes('All Austin neighborhoods</option>'));
});

test('clear filters only appears once something is actually set', () => {
  assert.ok(!renderFilters().includes('Clear filters'));
  assert.match(renderFilters({ hasActiveFilters: true }), /Clear filters/);
});

test('the results strip carries the count, every sort option, and the view switch', () => {
  const html = renderResultsBar({ count: 1, query: 'vinyl' });

  assert.match(html, />1 event for “vinyl”</);
  for (const value of ['soonest', 'latest', 'cheapest', 'popular']) {
    assert.ok(html.includes(`value="${value}"`), `sort option ${value} is missing`);
  }
  assert.match(html, /<option value="soonest" selected="">Soonest first<\/option>/);
  assert.match(html, /view-toggle/);
  assert.match(html, /<span class="sr-only">Sort events<\/span>/);

  // Plural and the map state are handled without a separate summary line.
  assert.match(renderResultsBar({ count: 2, view: 'map' }), />2 events</);
  assert.match(renderResultsBar({ count: 2, view: 'map' }), /aria-pressed="true">(?:<span[^>]*>[^<]*<\/span>)?\s*Map/);
});

test('the date control summarises the range it holds', () => {
  assert.match(renderFilters({ dateFrom: '2026-11-05' }), />From Nov 5<\/button>/);
  assert.match(renderFilters({ dateTo: '2026-11-12' }), />Until Nov 12<\/button>/);
  assert.match(
    renderFilters({ dateFrom: '2026-11-05', dateTo: '2026-11-12' }),
    />Nov 5 → Nov 12<\/button>/,
  );
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
