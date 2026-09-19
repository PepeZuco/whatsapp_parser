// Tests for static/people.js. Run by tests/test_js.py.
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert');
const P = require('../static/people.js');
const { chat } = require('./helpers.js');

test('first and last message of each day', () => {
  const msgs = chat([['2024-01-01 08:00', 0], ['2024-01-01 23:00', 1], ['2024-01-02 09:00', 1]]);
  assert.deepStrictEqual(P.firstLast(msgs, 2), { first: [1, 1], last: [0, 2] });
});

test('a conversation starts after 4 h of silence, not 3 h 59', () => {
  const msgs = chat([['2024-01-01 08:00', 0], ['2024-01-01 11:59', 1], ['2024-01-01 15:59', 1]]);
  assert.deepStrictEqual(P.starters(msgs, 2), [1, 1]);
});

test('reply gaps skip self-follow-ups and anything 12 h or older', () => {
  const msgs = chat([['2024-01-01 08:00', 0], ['2024-01-01 08:02', 1], ['2024-01-01 08:03', 1],
                     ['2024-01-01 20:03', 0], ['2024-01-01 20:13', 1]]);
  assert.deepStrictEqual(P.replyGaps(msgs, 2), [[], [120, 600]]);
});

test('median of odd, even and empty lists', () => {
  assert.strictEqual(P.median([3, 1, 2]), 2);
  assert.strictEqual(P.median([4, 1, 2, 3]), 2.5);
  assert.strictEqual(P.median([]), null);
});

test('profiles: words per text message, media, after midnight', () => {
  const msgs = chat([['2024-01-01 01:00', 0, 't', 'um dois tres'], ['2024-01-01 10:00', 0, 'p'],
                     ['2024-01-01 10:05', 1, 't', 'oi']]);
  const [a, b] = P.profiles(msgs, 2);
  assert.strictEqual(a.wordsPerMsg, 3);
  assert.strictEqual(a.media, 1);
  assert.strictEqual(a.afterMidnightPct, 0.5);
  assert.strictEqual(b.medianReply, 300);
  assert.strictEqual(a.startsPct, 1);
});

test('a one-person chat has no reply time or starter share', () => {
  const [a] = P.profiles(chat([['2024-01-01 10:00', 0]]), 1);
  assert.strictEqual(a.medianReply, null);
  assert.strictEqual(a.startsPct, null);
});

test('roles: at most two per person, none when alone', () => {
  const msgs = chat([['2024-01-01 01:00', 0], ['2024-01-01 01:01', 1], ['2024-01-01 09:00', 0],
                     ['2024-01-01 09:30', 1]]);
  const profs = P.profiles(msgs, 2);
  const r = P.roles(profs, P.firstLast(msgs, 2));
  assert.ok(r.every(x => x.length <= 2));
  assert.deepStrictEqual(r[0].slice(0, 1), ['starter']);   // opened both conversations
  assert.deepStrictEqual(r[1].slice(0, 1), ['fastest']);   // replies in 1 and 30 min vs 7 h 59
  assert.deepStrictEqual(P.roles(P.profiles(chat([['2024-01-01 10:00', 0]]), 1), { first: [1], last: [1] }), [[]]);
});

test('night owl needs at least 2% of messages after midnight', () => {
  // Each person sends one message after midnight, then `day` more at 10:xx.
  const roles = day => {
    const rows = [['2024-01-01 00:00', 0], ['2024-01-01 00:30', 1]];
    for (let i = 0; i < day; i++) {
      const at = '2024-01-01 10:' + String(i).padStart(2, '0');
      rows.push([at, 0], [at, 1]);
    }
    const msgs = chat(rows);
    return P.roles(P.profiles(msgs, 2), P.firstLast(msgs, 2)).flat();
  };
  assert.ok(roles(20).includes('night_owl'));   // 1 of 21 ≈ 4.8%
  assert.ok(!roles(60).includes('night_owl'));  // 1 of 61 ≈ 1.6%
});

test('sorted hides silent people and orders by the chosen key', () => {
  const msgs = chat([['2024-01-01 10:00', 0, 't', 'a b c d'], ['2024-01-01 10:01', 1, 't', 'a'], ['2024-01-01 10:02', 1, 't', 'b']]);
  const profs = P.profiles(msgs, 3);
  assert.deepStrictEqual(P.sorted(profs, 'messages').map(p => p.p), [1, 0]);
  assert.deepStrictEqual(P.sorted(profs, 'longest').map(p => p.p), [0, 1]);
});
