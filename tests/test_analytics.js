// Tests for the custom-event wrapper around Umami's tracker. Run by tests/test_js.py.

const test = require('node:test');
const assert = require('node:assert');
const A = require('../static/analytics.js');

function fakeUmami() {
  const calls = [];
  return { calls, track(name, data) { calls.push([name, data]); } };
}

test('an event reaches the tracker with its data', () => {
  const u = fakeUmami();
  assert.strictEqual(A.track('tab', { tab: 'people' }, u), true);
  assert.deepStrictEqual(u.calls, [['tab', { tab: 'people' }]]);
});

test('an event with no data is sent without a data object', () => {
  const u = fakeUmami();
  A.track('new-chat', undefined, u);
  assert.deepStrictEqual(u.calls, [['new-chat', undefined]]);
});

test('no tracker on the page is a quiet no-op', () => {
  assert.strictEqual(A.track('tab', { tab: 'people' }, undefined), false);
  assert.strictEqual(A.track('tab', { tab: 'people' }, {}), false);
});

test('a tracker that throws never reaches the caller', () => {
  const broken = { track() { throw new Error('blocked'); } };
  assert.strictEqual(A.track('tab', { tab: 'people' }, broken), false);
});

test('names and string values are cut to what Umami stores', () => {
  const u = fakeUmami();
  A.track('x'.repeat(80), { code: 'y'.repeat(900) }, u);
  const [name, data] = u.calls[0];
  assert.strictEqual(name.length, 50);
  assert.strictEqual(data.code.length, 500);
});

test('empty values are dropped, numbers and booleans kept', () => {
  const u = fakeUmami();
  A.track('chat-load', { kind: 'pair', people: 2, zip: false, gone: null, none: undefined, blank: '' }, u);
  assert.deepStrictEqual(u.calls[0][1], { kind: 'pair', people: 2, zip: false });
});

test('the data object handed in is not changed', () => {
  const u = fakeUmami();
  const data = { code: 'z'.repeat(600), gone: null };
  A.track('parse-error', data, u);
  assert.strictEqual(data.code.length, 600);
  assert.ok('gone' in data);
});

test('an empty event name is not sent', () => {
  const u = fakeUmami();
  assert.strictEqual(A.track('', {}, u), false);
  assert.strictEqual(u.calls.length, 0);
});

test('sizeBucket rounds a message count into a coarse band', () => {
  assert.strictEqual(A.sizeBucket(0), '<1k');
  assert.strictEqual(A.sizeBucket(999), '<1k');
  assert.strictEqual(A.sizeBucket(1000), '1k-10k');
  assert.strictEqual(A.sizeBucket(9999), '1k-10k');
  assert.strictEqual(A.sizeBucket(10000), '10k-100k');
  assert.strictEqual(A.sizeBucket(250000), '100k+');
});

test('chatSummary describes the export without anything from inside it', () => {
  const chat = {
    platform: 'ios', language: 'pt', title: 'Família Silva',
    people: ['Ana', 'Pepe', 'Jenni'], start: 19000, end: 19400,
    rows: Array.from({ length: 1500 }, (_, i) => [i, 0, 't', 'segredo']),
  };
  const s = A.chatSummary(chat, 'Conversa do WhatsApp com Ana.zip');
  assert.deepStrictEqual(s, { platform: 'ios', language: 'pt', kind: 'group', people: 3, size: '1k-10k', source: 'zip' });
  const flat = JSON.stringify(s);
  for (const secret of ['Família', 'Ana', 'Pepe', 'segredo', 'Conversa']) assert.ok(!flat.includes(secret), secret);
});

test('chatSummary: a two-person .txt export is a pair', () => {
  const s = A.chatSummary({ platform: 'android', language: 'en', people: ['A', 'B'], rows: [] }, 'chat.TXT');
  assert.strictEqual(s.kind, 'pair');
  assert.strictEqual(s.source, 'txt');
  assert.strictEqual(s.size, '<1k');
});
