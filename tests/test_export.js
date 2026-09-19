// Tests for the pure half of static/export.js. Run by tests/test_js.py.
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert');
const E = require('../static/export.js');
const { chat } = require('./helpers.js');

const opts = {
  names: ['Pepe', 'Jenni'],
  typeLabel: k => ({ t: 'Text', a: 'Audio' })[k],
  weekdayLabel: wd => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wd],
  headers: ['Time', 'Sender', 'Message', 'Type', 'Weekday'],
};

test('rows: header then one row per message, wall-clock time', () => {
  const t = E.rows(chat([['2024-02-03 23:30', 1, 't', 'oi'], ['2024-02-04 00:10', 0, 'a', '']]), opts);
  assert.deepStrictEqual(t, [
    ['Time', 'Sender', 'Message', 'Type', 'Weekday'],
    ['2024-02-03 23:30:00', 'Jenni', 'oi', 'Text', 'Sat'],
    ['2024-02-04 00:10:00', 'Pepe', '', 'Audio', 'Sun'],
  ]);
});

test('csv quotes commas, quotes and newlines, uses CRLF and a BOM', () => {
  const csv = E.toCsv([['a', 'b,c'], ['say "hi"', 'line\nbreak']]);
  assert.strictEqual(csv, '\ufeffa,"b,c"\r\n"say ""hi""","line\nbreak"\r\n');
});
