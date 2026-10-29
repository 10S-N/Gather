// Render-level check of the auth modal's three faces: log in, sign up, and the
// password reset it can hand off to when someone has forgotten theirs.
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

const { default: AuthModal } = await server.ssrLoadModule('/src/components/AuthModal.jsx');
const { AuthContext } = await server.ssrLoadModule('/src/contexts/AuthContext.jsx');

const noop = () => {};
const resetPassword = () => Promise.resolve();

function renderModal(mode) {
  return renderToStaticMarkup(
    React.createElement(
      AuthContext.Provider,
      { value: { user: null, loading: false, signIn: noop, signUp: noop, resetPassword } },
      React.createElement(AuthModal, { open: true, mode, onClose: noop }),
    ),
  );
}

test('logging in offers a way out of a forgotten password', () => {
  const html = renderModal('login');

  assert.match(html, /Welcome back/);
  assert.match(html, /type="password"/);
  assert.match(html, />Forgot password\?</);
  assert.match(html, />Log In</);
  assert.match(html, />Sign up</);
});

test('the reset screen asks only for an email', () => {
  const html = renderModal('reset');

  assert.match(html, /Reset your password/);
  assert.match(html, /type="email"/);
  assert.ok(!html.includes('type="password"'), 'a reset form must not ask for the old password');
  assert.ok(!html.includes('Display name'));
  assert.match(html, />Send reset link</);
  assert.match(html, /Remembered it\?/);
  assert.match(html, />Log in</);
});

test('signing up keeps the name field and hides the reset link', () => {
  const html = renderModal('signup');

  assert.match(html, /Create your account/);
  assert.match(html, /Display name/);
  assert.match(html, /type="password"/);
  assert.match(html, />Create Account</);
  assert.ok(!html.includes('Forgot password?'));
});
