// Shared builders for the JS model tests. A message only needs the fields the
// rule under test reads, so tests build the smallest chat that exercises it.

const R = require('../static/range.js');

// 'YYYY-MM-DD HH:MM' in chat wall-clock → epoch seconds (encoded as UTC).
function at(stamp) {
  return Date.parse(stamp.replace(' ', 'T') + ':00Z') / 1000;
}

// rows: [stamp, person, type?, text?] → prepared messages.
function chat(rows) {
  return R.prepare({ rows: rows.map(([s, p, k = 't', x = '']) => [at(s), p, k, x]) });
}

module.exports = { at, chat, day: R.dayOfIso };
