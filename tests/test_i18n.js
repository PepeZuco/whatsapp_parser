// Tests for static/i18n.js. Run by tests/test_js.py.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../static/i18n.js');

const ROOT = path.join(__dirname, '..');

// Keys built at runtime as prefix + value, with every value they can take.
const DYNAMIC = {
  err_: ['no_file', 'bad_type', 'too_large', 'empty_zip', 'unparseable', 'no_messages', 'internal', 'network'],
  type_: ['t', 'a', 'p', 's', 'v', 'g', 'd', 'm', 'x', 'l'],
  preset_: ['all', '12mo', '30d'],
  lang_: ['en', 'pt'],
  role_: ['starter', 'fastest', 'night_owl', 'good_night', 'good_morning'],
  sort_: ['messages', 'fastest', 'longest', 'night'],
  reason_: ['no_replies', 'phone_number', 'similar_name', 'span_disjoint'],
};

function usedKeys() {
  const keys = new Set();
  const js = fs.readdirSync(path.join(ROOT, 'static')).filter(f => f.endsWith('.js') && f !== 'i18n.js')
    .map(f => fs.readFileSync(path.join(ROOT, 'static', f), 'utf8')).join('\n');
  const html = fs.readFileSync(path.join(ROOT, 'templates', 'index.html'), 'utf8');
  for (const m of js.matchAll(/\bt\('([a-z0-9_]+)'/g)) keys.add(m[1]);
  // keys passed around as bare strings: t(c.platform === 'ios' ? 'iphone_export' : …), emptyState(root, key = '…'), col_* lists
  for (const m of js.matchAll(/'((?:iphone|android)_export|no_messages_range|col_[a-z]+)'/g)) keys.add(m[1]);
  for (const m of html.matchAll(/data-i18n(?:-html|-title)?="([a-z0-9_]+)"/g)) keys.add(m[1]);
  for (const [prefix, values] of Object.entries(DYNAMIC)) {
    keys.delete(prefix);
    values.forEach(v => keys.add(prefix + v));
  }
  return keys;
}

test('English and Portuguese have exactly the same keys', () => {
  assert.deepStrictEqual(Object.keys(I.STRINGS.pt).sort(), Object.keys(I.STRINGS.en).sort());
});

test('every key the UI uses exists', () => {
  const missing = [...usedKeys()].filter(k => !(k in I.STRINGS.en));
  assert.deepStrictEqual(missing, []);
});

test('placeholders are filled, missing keys fall back', () => {
  assert.strictEqual(I.t('pt', 'n_messages', { n: '3' }), '3 mensagens');
  assert.strictEqual(I.t('pt', 'nope'), 'nope');
});

test('detect maps any Portuguese locale to pt', () => {
  assert.strictEqual(I.detect('pt-BR'), 'pt');
  assert.strictEqual(I.detect('pt'), 'pt');
  assert.strictEqual(I.detect('en-US'), 'en');
  assert.strictEqual(I.detect(undefined), 'en');
});
