// Tests for the palette helpers on static/app.js. Run by tests/test_js.py.
// app.js is the shell and mostly touches document/window — these helpers are
// the pure part, so this file never calls App.boot().
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const App = require('../static/app.js');
const Wr = require('../static/wrapped.js');

test('slotColor maps slot 0..11 onto --p1..--p12', () => {
  assert.strictEqual(App.slotColor(0), 'var(--p1)');
  assert.strictEqual(App.slotColor(11), 'var(--p12)');
});

test('slotColor wraps out-of-range slots into the palette', () => {
  assert.strictEqual(App.slotColor(12), 'var(--p1)');
  assert.strictEqual(App.slotColor(-1), 'var(--p12)');
});

test('color() reads the projected chat\'s colour slots', () => {
  App.state.chat = { colors: [4, 0, 9] };
  assert.strictEqual(App.color(0), 'var(--p5)');
  assert.strictEqual(App.color(1), 'var(--p1)');
  assert.strictEqual(App.color(2), 'var(--p10)');
  App.state.chat = null;
});

test('color() falls back to cycling when there are no slots', () => {
  App.state.chat = null;
  assert.strictEqual(App.color(0), 'var(--p1)');
  assert.strictEqual(App.color(13), 'var(--p2)');
  App.state.chat = { people: ['a'] };
  assert.strictEqual(App.color(0), 'var(--p1)');
  App.state.chat = null;
});

test('color() still resolves the Others bucket to muted', () => {
  App.state.chat = { colors: [0, 1] };
  assert.strictEqual(App.color(-1), 'var(--muted)');
  App.state.chat = null;
});

test('the Wrapped canvas palette has one hex per slot', () => {
  assert.strictEqual(Wr.PALETTE.people.length, 12);
  assert.ok(Wr.PALETTE.people.every(c => /^#[0-9A-Fa-f]{6}$/.test(c)));
  assert.strictEqual(new Set(Wr.PALETTE.people).size, 12);
});
