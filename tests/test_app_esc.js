// Tests for the pure helpers on static/app.js (App.esc et al). Run by
// tests/test_js.py. app.js is the app's shell and mostly touches document/
// window/localStorage — this file only exercises the pure string helpers and
// never calls App.boot() or anything else that reaches the DOM.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const App = require('../static/app.js');

test('App.esc escapes all five HTML-special characters', () => {
  assert.strictEqual(App.esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.strictEqual(App.esc('a & b'), 'a &amp; b');
  assert.strictEqual(App.esc('"quoted"'), '&quot;quoted&quot;');
  assert.strictEqual(App.esc("it's"), 'it&#39;s');
});

test('App.esc coerces a non-string safely instead of throwing', () => {
  assert.strictEqual(App.esc(42), '42');
  assert.strictEqual(App.esc(null), 'null');
  assert.strictEqual(App.esc(undefined), 'undefined');
});
