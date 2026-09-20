// Tests for static/range.js. Run by tests/test_js.py.
process.env.TZ = 'America/Sao_Paulo';  // proves nothing depends on the machine's zone

const test = require('node:test');
const assert = require('node:assert');
const R = require('../static/range.js');
const { chat, day } = require('./helpers.js');

test('prepare reads the wall clock as UTC, whatever the local zone', () => {
  const [m] = chat([['2024-02-03 23:30', 0]]);
  assert.strictEqual(m.day, day('2024-02-03'));
  assert.strictEqual(m.h, 23);
  assert.strictEqual(m.wd, 6);  // Saturday
});

test('isoOfDay and dayOfIso round-trip', () => {
  assert.strictEqual(R.isoOfDay(R.dayOfIso('2026-09-18')), '2026-09-18');
});

test('filter is inclusive on both ends', () => {
  const msgs = chat([['2024-01-01 10:00', 0], ['2024-01-02 10:00', 0], ['2024-01-03 23:59', 1], ['2024-01-04 00:00', 1]]);
  const got = R.filter(msgs, day('2024-01-02'), day('2024-01-03'));
  assert.deepStrictEqual(got.map(m => m.i), [1, 2]);
});

test('presets clamp to the chat and list every year it touches', () => {
  const first = day('2022-03-04'), last = day('2024-01-10');
  const p = R.presets(first, last);
  assert.deepStrictEqual(p.map(x => x.id), ['all', '12mo', '30d', 'y2022', 'y2023', 'y2024']);
  assert.strictEqual(p[1].from, last - 364);
  assert.deepStrictEqual([p[3].from, p[3].to], [first, day('2022-12-31')]);
  assert.deepStrictEqual([p[5].from, p[5].to], [day('2024-01-01'), last]);
});

test('12 mo on a short chat is the whole chat', () => {
  const first = day('2024-01-01'), last = day('2024-01-10');
  assert.strictEqual(R.presets(first, last)[1].from, first);
  assert.strictEqual(R.presetFor(R.presets(first, last), first, last), 'all');
});

test('validate refuses inverted ranges and clamps to the chat', () => {
  assert.deepStrictEqual(R.validate(10, 5, 0, 100), { error: 'inverted' });
  assert.deepStrictEqual(R.validate(-5, 500, 0, 100), { from: 0, to: 100 });
});

test('hash round-trips view state and ignores junk', () => {
  const s = { tab: 'people', from: day('2024-01-01'), to: day('2024-02-01'), lang: 'pt' };
  assert.deepStrictEqual(R.decodeHash(R.encodeHash(s)), s);
  assert.deepStrictEqual(R.decodeHash('#from=yesterday&lang=fr'), {});
});

test('histogram buckets messages across the chat and ignores strays', () => {
  const msgs = chat([['2024-01-01 10:00', 0], ['2024-01-01 11:00', 0], ['2024-01-10 10:00', 1]]);
  const h = R.histogram(msgs, day('2024-01-01'), day('2024-01-10'), 2);
  assert.deepStrictEqual(h.counts, [2, 1]);
  assert.deepStrictEqual(h.starts, [day('2024-01-01'), day('2024-01-06')]);
  assert.deepStrictEqual(R.histogram(msgs, day('2024-01-02'), day('2024-01-09'), 2).counts, [0, 0]);
});
