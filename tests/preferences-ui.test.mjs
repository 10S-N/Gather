// Render-level check of the picks picker: every taxonomy option is offered,
// saved picks come back selected, and the save button refuses an empty form.
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

const { default: PreferencesPicker } = await server.ssrLoadModule(
  '/src/components/PreferencesPicker.jsx',
);
const { CATEGORIES, NEIGHBORHOODS } = await server.ssrLoadModule('/src/data/neighborhoods.js');

const noop = () => {};

// React escapes `&` in text nodes, so compare against the rendered form.
const text = (value) => value.replace(/&/g, '&amp;');

function renderPicker(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(PreferencesPicker, {
      initial: null,
      mode: 'onboarding',
      onSave: noop,
      onClose: noop,
      ...overrides,
    }),
  );
}

test('onboarding offers every category and neighborhood', () => {
  const html = renderPicker();

  assert.match(html, />What are you into\?</);
  for (const name of CATEGORIES) {
    assert.ok(html.includes(`>${text(name)}</button>`), `category ${name} is missing`);
  }
  for (const { name } of NEIGHBORHOODS) {
    assert.ok(html.includes(`>${text(name)}</button>`), `neighborhood ${name} is missing`);
  }

  assert.match(html, />Skip for now</);
  assert.match(html, />Save picks</);
});

test('saved picks come back selected and the heading counts them', () => {
  const html = renderPicker({
    initial: { categories: ['Art', 'Music/Indie'], neighborhoods: ['Zilker'] },
  });

  assert.match(html, />2 picked</);
  assert.match(html, />1 picked</);
  assert.match(html, /class="chip is-active" aria-pressed="true">Art<\/button>/);
  assert.match(html, /class="chip is-active" aria-pressed="true">Music\/Indie<\/button>/);
  assert.match(html, /class="chip is-active" aria-pressed="true">Zilker<\/button>/);
  assert.match(html, /class="chip" aria-pressed="false">Downtown<\/button>/);
});

test('an empty form cannot be saved', () => {
  const html = renderPicker();
  assert.match(html, /<button type="submit" class="btn btn--primary btn--sm" disabled="">Save picks/);
});

test('edit mode offers Cancel instead of Skip', () => {
  const html = renderPicker({ mode: 'edit', initial: { categories: ['Art'], neighborhoods: [] } });
  assert.match(html, />Your picks</);
  assert.match(html, />Cancel</);
  assert.ok(!html.includes('Skip for now'));
});
