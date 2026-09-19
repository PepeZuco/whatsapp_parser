// Tests for static/words.js. Run by tests/test_js.py.
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert');
const W = require('../static/words.js');
const { chat } = require('./helpers.js');

test('tokens: lower-cased, stopwords, numbers and URLs dropped', () => {
  const [m] = chat([['2024-01-01 10:00', 0, 'l', 'Olha o DISCO que eu comprei 2024 https://discogs.com/x']]);
  assert.deepStrictEqual(W.tokens(m), ['olha', 'disco', 'comprei']);
});

test('tokens are cached on the message', () => {
  const [m] = chat([['2024-01-01 10:00', 0, 't', 'saudade']]);
  assert.strictEqual(W.tokens(m), W.tokens(m));
});

test('media messages have no tokens or emojis', () => {
  const [m] = chat([['2024-01-01 10:00', 0, 'a', '']]);
  assert.deepStrictEqual(W.tokens(m), []);
  assert.deepStrictEqual(W.emojisOf(m), []);
});

test('emojis keep ZWJ families, skin tones, VS16 and flags whole', () => {
  const [m] = chat([['2024-01-01 10:00', 0, 't', 'oi 👨\u200d👩\u200d👧 👍🏽 ❤\ufe0f 🇧🇷 😂😂']]);
  assert.deepStrictEqual(W.emojisOf(m), ['👨\u200d👩\u200d👧', '👍🏽', '❤\ufe0f', '🇧🇷', '😂', '😂']);
});

test('word and emoji counts per person', () => {
  const msgs = chat([['2024-01-01 10:00', 0, 't', 'disco disco 😂'], ['2024-01-01 10:01', 1, 't', 'disco']]);
  assert.strictEqual(W.wordCounts(msgs).get('disco'), 3);
  assert.strictEqual(W.wordCounts(msgs, 1).get('disco'), 1);
  assert.deepStrictEqual(W.top(W.emojiCounts(msgs, 0), 3), [['😂', 1]]);
});

test('signature words favour what one person says more than the rest', () => {
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(['2024-01-01 10:00', 0, 't', 'vinil amor']);
  for (let i = 0; i < 5; i++) rows.push(['2024-01-01 11:00', 1, 't', 'gato amor']);
  const [a, b] = W.signatureWords(chat(rows), 2, 1);
  assert.deepStrictEqual(a, [['vinil', 5]]);
  assert.deepStrictEqual(b, [['gato', 5]]);
});

test('whole-word search: "oi" does not count inside "noite"; accents are letters', () => {
  const msgs = chat([['2024-01-01 10:00', 0, 't', 'oi, boa noite! Oi'], ['2024-02-01 10:00', 1, 't', 'você? vocês']]);
  assert.strictEqual(W.countTerm(msgs, 2, 'oi', {}).total, 2);
  assert.strictEqual(W.countTerm(msgs, 2, 'oi', { wholeWord: false }).total, 3);
  assert.strictEqual(W.countTerm(msgs, 2, 'você', {}).total, 1);
});

test('match case and per-month buckets', () => {
  const msgs = chat([['2024-01-01 10:00', 0, 't', 'Oi oi'], ['2024-02-01 10:00', 1, 't', 'oi']]);
  const r = W.countTerm(msgs, 2, 'oi', { matchCase: true });
  assert.deepStrictEqual(r.byPerson, [1, 1]);
  assert.deepStrictEqual([...r.byMonth], [['2024-01', 1], ['2024-02', 1]]);
});

test('an empty term or one with regex characters is safe', () => {
  const msgs = chat([['2024-01-01 10:00', 0, 't', 'a.b (c)']]);
  assert.strictEqual(W.countTerm(msgs, 1, '  ', {}).total, 0);
  assert.strictEqual(W.countTerm(msgs, 1, '(c)', { wholeWord: false }).total, 1);
});

test('link domains strip www and fold the tail into other', () => {
  const rows = ['https://www.youtube.com/a', 'http://youtube.com/b', 'https://open.spotify.com/x', 'https://a.com', 'https://b.com']
    .map(u => ['2024-01-01 10:00', 0, 'l', 'olha ' + u]);
  assert.deepStrictEqual(W.linkDomains(chat(rows), 2), [['youtube.com', 2], ['a.com', 1], ['other', 2]]);
});
