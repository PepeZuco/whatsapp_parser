// Tests for static/stats.js. Run by tests/test_js.py.
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert');
const S = require('../static/stats.js');
const { chat, day } = require('./helpers.js');

test('totals: per-day average over every day in range, words from text and links only', () => {
  const msgs = chat([['2024-01-01 10:00', 0, 't', 'bom dia amor'], ['2024-01-01 11:00', 1, 'a'],
                     ['2024-01-03 10:00', 1, 'l', 'olha https://x.com']]);
  const t = S.totals(msgs, day('2024-01-01'), day('2024-01-04'));
  assert.deepStrictEqual(t, { messages: 3, days: 4, activeDays: 2, activePct: 0.5, perDay: 0.75, words: 5 });
});

test('streaks run across a month and a year edge', () => {
  const msgs = chat([['2023-12-30 10:00', 0], ['2023-12-31 10:00', 0], ['2024-01-01 10:00', 0],
                     ['2024-01-05 10:00', 0], ['2024-01-06 10:00', 0]]);
  const s = S.streaks(msgs, day('2024-01-06'));
  assert.deepStrictEqual(s.longest, { len: 3, from: day('2023-12-30'), to: day('2024-01-01') });
  assert.strictEqual(s.current, 2);
});

test('current streak is 0 when the chat went on after the range', () => {
  const msgs = chat([['2024-01-05 10:00', 0]]);
  assert.strictEqual(S.streaks(msgs, day('2024-02-01')).current, 0);
});

test('busiest day: highest count, earliest on ties', () => {
  const msgs = chat([['2024-01-02 10:00', 0], ['2024-01-02 11:00', 1], ['2024-01-01 10:00', 0], ['2024-01-01 12:00', 0]]);
  assert.deepStrictEqual(S.busiestDay(msgs), { day: day('2024-01-01'), count: 2 });
  assert.strictEqual(S.busiestDay([]), null);
});

test('levels use quantiles of non-zero days', () => {
  const daily = new Map([[1, 1], [2, 2], [3, 3], [4, 4], [5, 100]]);
  const th = S.levelThresholds(daily);
  assert.deepStrictEqual(th, [2, 3, 4]);
  assert.deepStrictEqual([0, 1, 2, 3, 100].map(n => S.levelOf(n, th)), [0, 1, 2, 3, 4]);
});

test('calendarYear leads with blanks so Jan 1 sits on its weekday', () => {
  const cal = S.calendarYear(new Map(), 2026, day('2026-03-01'), day('2026-03-31'));
  assert.strictEqual(cal.lead, 4);          // 2026-01-01 is a Thursday
  assert.strictEqual(cal.cells.length, 365);
  assert.strictEqual(cal.cells[0].inRange, false);
  assert.strictEqual(cal.cells[59].inRange, true);  // Mar 1
});

test('hours and heatmap bucket by wall clock', () => {
  const msgs = chat([['2024-02-03 23:30', 0], ['2024-02-04 00:10', 1]]);  // Sat 23h, Sun 0h
  const h = S.hours(msgs);
  assert.strictEqual(h[23] + h[0], 2);
  const hm = S.heatmap(msgs);
  assert.strictEqual(hm[6][23], 1);
  assert.strictEqual(hm[0][0], 1);
});

test('types are ranked and split per person', () => {
  const msgs = chat([['2024-01-01 10:00', 0, 'a'], ['2024-01-01 10:01', 1, 'a'], ['2024-01-01 10:02', 1, 't', 'x']]);
  assert.deepStrictEqual(S.types(msgs, 2), [{ k: 'a', total: 2, byPerson: [1, 1] }, { k: 't', total: 1, byPerson: [0, 1] }]);
});

test('share folds everyone past topN into Others', () => {
  const rows = [];
  [5, 4, 3, 2, 1].forEach((n, p) => { for (let i = 0; i < n; i++) rows.push(['2024-01-01 10:00', p]); });
  const s = S.share(chat(rows), 5, 3);
  assert.deepStrictEqual(s.map(e => [e.p, e.count]), [[0, 5], [1, 4], [2, 3], [-1, 3]]);
});

test('series by week starts on Sunday; fill=false drops empty days', () => {
  const msgs = chat([['2024-01-01 10:00', 0], ['2024-01-03 10:00', 1], ['2024-01-08 10:00', 0]]);
  const w = S.series(msgs, day('2024-01-01'), day('2024-01-10'), 'week', 2);
  assert.deepStrictEqual(w.buckets, [day('2023-12-31'), day('2024-01-07')]);
  assert.deepStrictEqual(w.lines.map(l => l.values), [[1, 1], [1, 0]]);
  const d = S.series(msgs, day('2024-01-01'), day('2024-01-10'), 'day', 2, false);
  assert.deepStrictEqual(d.buckets, [day('2024-01-01'), day('2024-01-03'), day('2024-01-08')]);
});

test('series by month uses calendar months', () => {
  const msgs = chat([['2024-01-31 10:00', 0], ['2024-02-01 10:00', 0]]);
  const m = S.series(msgs, day('2024-01-15'), day('2024-02-10'), 'month', 1);
  assert.deepStrictEqual(m.buckets, [day('2024-01-01'), day('2024-02-01')]);
  assert.deepStrictEqual(m.lines[0].values, [1, 1]);
});
