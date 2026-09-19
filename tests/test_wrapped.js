// Tests for the pure half of static/wrapped.js. Run by tests/test_js.py.
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert');
const Wr = require('../static/wrapped.js');
const { chat, day } = require('./helpers.js');

function sample() {
  const rows = [['2024-12-31 22:00', 0, 't', 'segredo segredo segredo']];
  // 2025: person 1 replies within a minute, six times; person 0 takes an hour.
  for (let i = 1; i <= 6; i++) {
    const d = `2025-01-0${i}`;
    rows.push([`${d} 09:00`, 0, 't', 'bom dia 😂'], [`${d} 09:01`, 1, 't', 'oi'], [`${d} 10:01`, 0, 't', 'ok']);
  }
  return chat(rows);
}

test('periods: every year then all', () => {
  assert.deepStrictEqual(Wr.periods(day('2024-12-31'), day('2025-01-06')), ['2024', '2025', 'all']);
});

test('a year period ignores other years', () => {
  const m = Wr.model(sample(), ['A', 'B'], '2025');
  assert.strictEqual(m.total, 18);
  assert.strictEqual(m.streak, 6);
  assert.strictEqual(m.peakHour, 9);
  assert.deepStrictEqual(m.topEmoji, ['😂', 6]);
  assert.strictEqual(Wr.model(sample(), ['A', 'B'], 'all').total, 19);
});

test('fastest replier needs at least MIN_REPLIES replies', () => {
  const m = Wr.model(sample(), ['A', 'B'], '2025');
  assert.deepStrictEqual(m.fastest, { p: 1, name: 'B', sec: 60 });
  assert.strictEqual(Wr.model(sample(), ['A', 'B'], '2024').fastest, null);
});

test('top word is hidden unless asked for', () => {
  assert.strictEqual(Wr.model(sample(), ['A', 'B'], 'all').topWord, null);
  // "bom" and "dia" tie at 6; ties break alphabetically.
  assert.strictEqual(Wr.model(sample(), ['A', 'B'], 'all', { showTopWord: true }).topWord, 'bom');
  assert.strictEqual(Wr.model(sample(), ['A', 'B'], '2024', { showTopWord: true }).topWord, 'segredo');
});

test('names come only from the caller, so hiding them is the caller swapping the list', () => {
  const m = Wr.model(sample(), ['You', 'Them'], '2025');
  assert.deepStrictEqual(m.split.map(s => s.name), ['You', 'Them']);
  assert.ok(!JSON.stringify(m).includes('bom dia'));
});

test('split keeps the top 3 and counts the rest', () => {
  const rows = [0, 0, 0, 0, 1, 1, 1, 2, 2, 3, 4].map((p, i) => [`2025-01-01 10:${String(i).padStart(2, '0')}`, p]);
  const m = Wr.model(chat(rows), ['a', 'b', 'c', 'd', 'e'], '2025');
  assert.deepStrictEqual(m.split.map(s => s.p), [0, 1, 2]);
  assert.strictEqual(m.more, 2);
});

test('an empty period is all zeros and nulls, not a crash', () => {
  const m = Wr.model(sample(), ['A', 'B'], '2030');
  assert.deepStrictEqual([m.total, m.streak, m.busiest, m.peakHour, m.topEmoji, m.fastest], [0, 0, null, null, null, null]);
});
