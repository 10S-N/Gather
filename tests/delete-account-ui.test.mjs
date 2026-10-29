// Render-level check of the profile danger zone: what it warns about, and that
// it only asks for a password when the account actually has one.
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

const { default: DeleteAccountPanel } = await server.ssrLoadModule(
  '/src/components/DeleteAccountPanel.jsx',
);
const { AuthContext } = await server.ssrLoadModule('/src/contexts/AuthContext.jsx');

const baseUser = {
  uid: 'uid-1',
  email: 'neighbor@example.com',
  displayName: 'Neighbor',
};

function render(user) {
  return renderToStaticMarkup(
    React.createElement(
      AuthContext.Provider,
      { value: { user, loading: false } },
      React.createElement(
        StaticRouter,
        { location: '/profile' },
        React.createElement(DeleteAccountPanel),
      ),
    ),
  );
}

const passwordUser = { ...baseUser, providerData: [{ providerId: 'password' }] };
const googleUser = { ...baseUser, providerData: [{ providerId: 'google.com' }] };

test('the danger zone says what it will destroy before asking for anything', () => {
  const html = render(passwordUser);

  assert.match(html, /<summary>Delete my account<\/summary>/);
  assert.match(html, /RSVP/);
  assert.match(html, /stay on the board/);
  assert.match(html, /be undone/);
  assert.match(html, />Delete permanently</);
  assert.match(html, />Cancel</);
});

test('a password account has to confirm with that password', () => {
  const html = render(passwordUser);

  assert.match(html, /Confirm with your password/);
  assert.match(html, /type="password"/);
  // Nothing typed yet, so the destructive button can't be pressed.
  assert.match(html, /<button type="button" class="btn btn--danger btn--sm" disabled="">/);
});

test('a provider account is not asked for a password it does not have', () => {
  const html = render(googleUser);

  assert.ok(!html.includes('type="password"'));
  assert.match(html, /google\.com/);
  // Nothing to fill in, so the button starts enabled.
  assert.match(html, /<button type="button" class="btn btn--danger btn--sm">Delete permanently</);
});

test('a signed-out visitor sees no danger zone', () => {
  assert.equal(render(null), '');
});
