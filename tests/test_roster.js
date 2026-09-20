// Tests for static/roster.js. Run by tests/test_js.py.
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert');
const Roster = require('../static/roster.js');
const { at } = require('./helpers.js');

// A parsed chat, shaped exactly like /api/parse returns one.
function raw(people, rows) {
  return {
    platform: 'ios', language: 'en', title: null, people,
    start: '2024-01-01', end: '2024-01-01',
    rows: rows.map(([s, p, k = 't', x = '']) => [at(s), p, k, x]),
  };
}

const CHAT = raw(['Ana', 'Pepe', 'Caio'], [
  ['2024-01-01 08:00', 2, 't', 'early'],
  ['2024-03-10 09:00', 0, 't', 'hi'],
  ['2024-03-10 09:05', 1, 't', 'hey'],
  ['2024-03-11 10:00', 0, 'p'],
  ['2024-06-30 22:00', 2, 't', 'late'],
]);

test('initial gives every person their own entry, in parse order', () => {
  const r = Roster.initial(CHAT);
  assert.deepStrictEqual(r.entries, [
    { src: [0], name: 'Ana', color: 0, on: true },
    { src: [1], name: 'Pepe', color: 1, on: true },
    { src: [2], name: 'Caio', color: 2, on: true },
  ]);
});

test('initial cycles colour slots once there are more than twelve people', () => {
  const many = raw(Array.from({ length: 14 }, (_, i) => 'P' + i), [['2024-01-01 08:00', 13]]);
  const r = Roster.initial(many);
  assert.strictEqual(r.entries[12].color, 0);
  assert.strictEqual(r.entries[13].color, 1);
});

test('apply passes the parse metadata through untouched', () => {
  const p = Roster.apply(CHAT, Roster.initial(CHAT));
  assert.strictEqual(p.platform, 'ios');
  assert.strictEqual(p.language, 'en');
  assert.strictEqual(p.title, null);
  assert.deepStrictEqual(p.people, ['Ana', 'Pepe', 'Caio']);
  assert.deepStrictEqual(p.colors, [0, 1, 2]);
  assert.strictEqual(p.rows.length, 5);
});

test('an excluded person loses every row and the rest reindex densely', () => {
  let r = Roster.initial(CHAT);
  r.entries[1].on = false;                       // drop Pepe, the middle index
  const p = Roster.apply(CHAT, r);
  assert.deepStrictEqual(p.people, ['Ana', 'Caio']);
  assert.deepStrictEqual(p.colors, [0, 2]);
  assert.strictEqual(p.rows.length, 4);
  assert.deepStrictEqual(p.rows.map(x => x[1]), [1, 0, 0, 1]);
});

test('excluding the person who owned the first and last day moves start and end', () => {
  let r = Roster.initial(CHAT);
  r.entries[2].on = false;                       // Caio owns 2024-01-01 and 2024-06-30
  const p = Roster.apply(CHAT, r);
  assert.strictEqual(p.start, '2024-03-10');
  assert.strictEqual(p.end, '2024-03-11');
});

test('start and end come from the extremes, not from row order', () => {
  const shuffled = raw(['Ana'], [['2024-05-05 12:00', 0], ['2024-02-02 12:00', 0]]);
  const p = Roster.apply(shuffled, Roster.initial(shuffled));
  assert.strictEqual(p.start, '2024-02-02');
  assert.strictEqual(p.end, '2024-05-05');
});

test('a merged entry collapses its sources onto one index and adds up', () => {
  const r = { entries: [
    { src: [0, 1], name: 'Ana', color: 3, on: true },
    { src: [2], name: 'Caio', color: 2, on: true },
  ] };
  const p = Roster.apply(CHAT, r);
  assert.deepStrictEqual(p.people, ['Ana', 'Caio']);
  assert.deepStrictEqual(p.colors, [3, 2]);
  assert.deepStrictEqual(p.rows.map(x => x[1]), [1, 0, 0, 0, 1]);
});

test('apply mutates neither the chat nor the roster', () => {
  const r = Roster.initial(CHAT);
  const chatBefore = JSON.stringify(CHAT), rosterBefore = JSON.stringify(r);
  Roster.apply(CHAT, r);
  assert.strictEqual(JSON.stringify(CHAT), chatBefore);
  assert.strictEqual(JSON.stringify(r), rosterBefore);
});

test('apply refuses a roster that leaves no messages', () => {
  const r = Roster.initial(CHAT);
  r.entries.forEach(e => { e.on = false; });
  assert.throws(() => Roster.apply(CHAT, r), e => e instanceof Roster.RosterError && e.code === 'empty');
});

test('counts reports per-entry totals and the live selected totals', () => {
  const r = { entries: [
    { src: [0, 1], name: 'Ana', color: 0, on: true },
    { src: [2], name: 'Caio', color: 1, on: false },
  ] };
  assert.deepStrictEqual(Roster.counts(CHAT, r), { perEntry: [3, 2], on: 1, messages: 3 });
});
