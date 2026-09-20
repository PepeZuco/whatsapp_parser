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

test('counts restricts to a day range when bounds are given', () => {
  const r = Roster.initial(CHAT);
  const day = s => Math.floor(at(s) / 86400);
  assert.deepStrictEqual(Roster.counts(CHAT, r).perEntry, [2, 1, 2]);
  const march = Roster.counts(CHAT, r, day('2024-03-01 00:00'), day('2024-03-31 00:00'));
  assert.deepStrictEqual(march.perEntry, [2, 1, 0]);
  assert.strictEqual(march.messages, 3);
});

test('counts with no bounds counts the whole chat', () => {
  const r = Roster.initial(CHAT);
  assert.deepStrictEqual(Roster.counts(CHAT, r), Roster.counts(CHAT, r, null, null));
});

test('toggle flips one entry and leaves the input alone', () => {
  const r = Roster.initial(CHAT);
  const out = Roster.toggle(r, 1);
  assert.strictEqual(out.entries[1].on, false);
  assert.strictEqual(r.entries[1].on, true);
});

test('setColor wraps a slot into the palette', () => {
  const r = Roster.initial(CHAT);
  assert.strictEqual(Roster.setColor(r, 0, 5).entries[0].color, 5);
  assert.strictEqual(Roster.setColor(r, 0, 12).entries[0].color, 0);
  assert.strictEqual(Roster.setColor(r, 0, -1).entries[0].color, 11);
});

test('rename trims, and an empty name falls back to the first source name', () => {
  const r = Roster.initial(CHAT);
  assert.strictEqual(Roster.rename(r, 0, '  Aninha  ', CHAT).entries[0].name, 'Aninha');
  assert.strictEqual(Roster.rename(r, 0, '   ', CHAT).entries[0].name, 'Ana');
});

test('merge keeps the target name, colour and on-state and drops the other row', () => {
  let r = Roster.initial(CHAT);
  r = Roster.setColor(r, 0, 7);
  r = Roster.toggle(r, 2);                        // Caio is off
  const out = Roster.merge(r, 0, 2);              // fuse Caio into Ana
  assert.strictEqual(out.entries.length, 2);
  assert.deepStrictEqual(out.entries[0], { src: [0, 2], name: 'Ana', color: 7, on: true });
  assert.deepStrictEqual(out.entries[1].src, [1]);
});

test('merge works when the target sits after the other entry', () => {
  const out = Roster.merge(Roster.initial(CHAT), 2, 0);
  assert.strictEqual(out.entries.length, 2);
  const caio = out.entries.find(e => e.name === 'Caio');
  assert.deepStrictEqual(caio.src, [2, 0]);
});

test('merging an entry into itself is a no-op', () => {
  const out = Roster.merge(Roster.initial(CHAT), 1, 1);
  assert.strictEqual(out.entries.length, 3);
});

test('split restores original names in src order, in place', () => {
  let r = Roster.merge(Roster.initial(CHAT), 0, 2);   // Ana + Caio
  r = Roster.rename(r, 0, 'Ana S.', CHAT);
  const out = Roster.split(r, 0, CHAT);
  assert.deepStrictEqual(out.entries.map(e => e.name), ['Ana', 'Caio', 'Pepe']);
  assert.deepStrictEqual(out.entries.map(e => e.src), [[0], [2], [1]]);
});

test('split gives the first member the group colour and the rest unused slots', () => {
  let r = Roster.merge(Roster.initial(CHAT), 0, 2);
  r = Roster.setColor(r, 0, 5);                      // group is slot 5; Pepe holds slot 1
  const out = Roster.split(r, 0, CHAT);
  assert.strictEqual(out.entries[0].color, 5);
  assert.strictEqual(out.entries[1].color, 0);       // lowest slot nobody is using
  assert.strictEqual(new Set(out.entries.map(e => e.color)).size, 3);
});

test('split members inherit the group on-state, and a lone entry is untouched', () => {
  let r = Roster.merge(Roster.initial(CHAT), 0, 2);
  r = Roster.toggle(r, 0);
  const out = Roster.split(r, 0, CHAT);
  assert.deepStrictEqual(out.entries.slice(0, 2).map(e => e.on), [false, false]);
  assert.strictEqual(Roster.split(Roster.initial(CHAT), 1, CHAT).entries.length, 3);
});

test('merge then split then merge keeps every source index exactly once', () => {
  const all = r => r.entries.flatMap(e => e.src).sort((a, b) => a - b);
  let r = Roster.merge(Roster.initial(CHAT), 0, 1);
  assert.deepStrictEqual(all(r), [0, 1, 2]);
  r = Roster.split(r, 0, CHAT);
  assert.deepStrictEqual(all(r), [0, 1, 2]);
  r = Roster.merge(r, 2, 1);
  assert.deepStrictEqual(all(r), [0, 1, 2]);
  assert.ok(Roster.apply(CHAT, r).rows.length > 0);
});

test('takenSlots lists the colours other entries are using', () => {
  const r = Roster.initial(CHAT);
  assert.deepStrictEqual([...Roster.takenSlots(r, 1)].sort(), [0, 2]);
});

test('entryOf and sameEntry locate a source index after merging', () => {
  const r = Roster.merge(Roster.initial(CHAT), 0, 2);
  assert.strictEqual(Roster.entryOf(r, 2), 0);
  assert.strictEqual(Roster.entryOf(r, 1), 1);
  assert.strictEqual(Roster.sameEntry(r, 0, 2), true);
  assert.strictEqual(Roster.sameEntry(r, 0, 1), false);
});

test('isPhone recognises exported numbers but not ordinary names', () => {
  assert.strictEqual(Roster.isPhone('+55 11 98877-1234'), true);
  assert.strictEqual(Roster.isPhone('5511988771234'), true);
  assert.strictEqual(Roster.isPhone('+1 (555) 010-9999'), true);
  assert.strictEqual(Roster.isPhone('Ana'), false);
  assert.strictEqual(Roster.isPhone('Ana 2'), false);
});

test('normalise folds case, accents and runs of whitespace', () => {
  assert.strictEqual(Roster.normalise('  JOSÉ   da Silva '), 'jose da silva');
});

test('similarity is 1 for equal strings and low for unrelated ones', () => {
  assert.strictEqual(Roster.similarity('ana', 'ana'), 1);
  assert.ok(Roster.similarity('ana', 'bia') < 0.5);
  assert.ok(Roster.similarity('jenni', 'jenny') >= 0.8);
});

// Caio stops writing, then a number appears; they never answer each other.
const NEW_PHONE = raw(['Ana', 'Caio', '+55 11 98877-1234'], [
  ['2024-01-05 09:00', 0], ['2024-01-05 09:01', 1],
  ['2024-02-01 23:00', 1], ['2024-02-02 00:30', 1],
  ['2024-06-01 23:00', 2], ['2024-06-02 00:10', 2],
  ['2024-06-03 09:00', 0],
]);

test('suggest flags a saved name and the number that replaces it', () => {
  const s = Roster.suggest(NEW_PHONE);
  assert.strictEqual(s.length, 1);
  assert.strictEqual(NEW_PHONE.people[s[0].a], 'Caio');
  assert.strictEqual(NEW_PHONE.people[s[0].b], '+55 11 98877-1234');
  assert.ok(s[0].reasons.includes('phone_number'));
  assert.ok(s[0].reasons.includes('span_disjoint'));
  assert.ok(s[0].reasons.includes('no_replies'));
});

test('suggest orders the pair so the busier identity comes first', () => {
  const s = Roster.suggest(NEW_PHONE);
  const c = Roster.counts(NEW_PHONE, Roster.initial(NEW_PHONE)).perEntry;
  assert.ok(c[s[0].a] >= c[s[0].b]);
});

test('suggest flags a name that is a subset of another name', () => {
  const chat = raw(['Ana', 'Ana Souza'], [
    ['2024-01-01 09:00', 0], ['2024-02-01 09:00', 0],
    ['2024-09-01 09:00', 1], ['2024-09-02 09:00', 1],
  ]);
  const s = Roster.suggest(chat);
  assert.strictEqual(s.length, 1);
  assert.ok(s[0].reasons.includes('similar_name'));
});

test('suggest ignores accents and case when comparing names', () => {
  const chat = raw(['José', 'jose'], [
    ['2024-01-01 09:00', 0], ['2024-02-01 09:00', 0],
    ['2024-09-01 09:00', 1], ['2024-09-02 09:00', 1],
  ]);
  assert.strictEqual(Roster.suggest(chat).length, 1);
});

test('suggest stays silent when the two reply to each other', () => {
  const chat = raw(['Caio', '+55 11 98877-1234'], [
    ['2024-01-01 09:00', 0], ['2024-01-01 09:02', 1],
    ['2024-09-01 09:00', 1],
  ]);
  assert.deepStrictEqual(Roster.suggest(chat), []);
});

test('suggest stays silent when the two were active over the same period', () => {
  const chat = raw(['Ana', 'Ana Souza'], [
    ['2024-01-01 09:00', 0], ['2024-06-01 09:00', 0],
    ['2024-02-01 18:00', 1], ['2024-05-01 18:00', 1],
  ]);
  assert.deepStrictEqual(Roster.suggest(chat), []);
});

// The case a union-based overlap ratio gets wrong: Ana writes across the whole
// chat, the number only at the end, so their overlap is a rounding error against
// the union but the whole of the number's own span.
test('suggest does not pair a long-tenured person with a short-lived number', () => {
  const chat = raw(['Ana', '+55 11 98877-1234'], [
    ['2024-01-05 09:00', 0], ['2024-03-01 09:00', 0],
    ['2024-06-01 23:00', 1], ['2024-06-02 00:10', 1],
    ['2024-06-03 09:00', 0],
  ]);
  assert.deepStrictEqual(Roster.suggest(chat), []);
});

test('suggest stays silent for two plainly different names', () => {
  const chat = raw(['Ana', 'Bia'], [
    ['2024-01-01 09:00', 0], ['2024-02-01 09:00', 0],
    ['2024-09-01 09:00', 1], ['2024-09-02 09:00', 1],
  ]);
  assert.deepStrictEqual(Roster.suggest(chat), []);
});

test('suggest tells nothing from two different phone numbers', () => {
  const chat = raw(['+55 11 98877-1234', '+55 11 98877-1235'], [
    ['2024-01-01 09:00', 0], ['2024-02-01 09:00', 0],
    ['2024-09-01 09:00', 1], ['2024-09-02 09:00', 1],
  ]);
  assert.deepStrictEqual(Roster.suggest(chat), []);
});

test('suggest returns at most three pairs and nothing for a lone person', () => {
  const rows = [], people = [];
  for (let i = 0; i < 10; i++) {
    people.push('P' + i, 'P' + i + ' Silva');
    rows.push([`2024-01-0${(i % 9) + 1} 09:00`, i * 2], [`2024-01-0${(i % 9) + 1} 10:00`, i * 2],
              [`2025-01-0${(i % 9) + 1} 09:00`, i * 2 + 1], [`2025-01-0${(i % 9) + 1} 10:00`, i * 2 + 1]);
  }
  assert.strictEqual(Roster.suggest(raw(people, rows)).length, 3);
  assert.deepStrictEqual(Roster.suggest(raw(['Ana'], [['2024-01-01 09:00', 0]])), []);
});

// The gap >= 0 guard in exchanged(): rows here are deliberately out of order, so
// row 2 follows row 1 with a NEGATIVE gap. Without the guard that backward jump
// reads as a reply between the two identities and silently suppresses a valid
// suggestion; with it, the pair is still offered.
test('suggest is not fooled by a backward time jump in unsorted rows', () => {
  const chat = raw(['Caio', '+55 11 98877-1234'], [
    ['2024-09-01 10:00', 1],
    ['2024-01-01 10:00', 0],
    ['2024-01-02 10:00', 0],
    ['2024-09-02 10:00', 1],
  ]);
  const s = Roster.suggest(chat);
  assert.strictEqual(s.length, 1);
  assert.ok(s[0].reasons.includes('phone_number'));
});
