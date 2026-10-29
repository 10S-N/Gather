// The clock behind the hero dates: it has to fire at midnight, every day,
// without drifting and without ever being handed a negative delay.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { msUntilMidnight } from '../src/hooks/useNow.js';

test('the timer waits until the coming local midnight', () => {
  assert.equal(msUntilMidnight(new Date(2026, 9, 29, 23, 30, 0)), 30 * 60 * 1000);
  assert.equal(msUntilMidnight(new Date(2026, 9, 29, 18, 0, 0)), 6 * 60 * 60 * 1000);
});

test('just after midnight it schedules the whole day ahead', () => {
  const ms = msUntilMidnight(new Date(2026, 9, 29, 0, 0, 30));
  assert.equal(ms, 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 30 * 1000);
});

test('a delay is never zero or negative', () => {
  // 23:59:59.999 is as close to the boundary as a real clock gets.
  assert.ok(msUntilMidnight(new Date(2026, 9, 29, 23, 59, 59, 999)) >= 1000);
});

test('the next midnight is always on the following day', () => {
  const from = new Date(2026, 9, 29, 12, 0, 0);
  const target = new Date(from.getTime() + msUntilMidnight(from));
  assert.equal(target.getDate(), 30);
  assert.equal(target.getHours(), 0);
  assert.equal(target.getMinutes(), 0);
});
