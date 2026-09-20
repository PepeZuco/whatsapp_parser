'use strict';

/* Days, ranges and the URL hash.
 *
 * Timestamps from /api/parse are the chat's wall clock encoded as UTC, so a
 * "day" is just floor(ts / 86400) and every calendar read uses getUTC*. The
 * rest of the client works on these integer days, never on Date objects.
 *
 * Pure functions, loaded as a plain script in the browser and required by
 * tests/test_range.js. */

const ChatRange = (function () {

  const DAY = 86400;

  function dayOf(ts) { return Math.floor(ts / DAY); }

  function isoOfDay(day) { return new Date(day * DAY * 1000).toISOString().slice(0, 10); }

  function dayOfIso(iso) { return Math.floor(Date.parse(iso + 'T00:00:00Z') / 1000 / DAY); }

  function yearOfDay(day) { return new Date(day * DAY * 1000).getUTCFullYear(); }

  /* API rows → message objects, sorted by time (exports are chronological, but
   * a stable sort costs nothing and makes filter's binary search safe). */
  function prepare(chat) {
    const msgs = chat.rows.map((r, i) => {
      const d = new Date(r[0] * 1000);
      return { i, t: r[0], p: r[1], k: r[2], x: r[3], day: dayOf(r[0]),
               h: d.getUTCHours(), wd: d.getUTCDay() };
    });
    msgs.sort((a, b) => a.t - b.t || a.i - b.i);
    msgs.forEach((m, i) => { m.i = i; });
    return msgs;
  }

  function lowerBound(msgs, day) {
    let lo = 0, hi = msgs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (msgs[mid].day < day) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /* Messages with from <= day <= to. */
  function filter(msgs, from, to) {
    return msgs.slice(lowerBound(msgs, from), lowerBound(msgs, to + 1));
  }

  /* The date bar's buttons. 12 mo / 30 d count back from the chat's last day
   * and are clamped to its first; each calendar year the chat touches gets one. */
  function presets(first, last) {
    const out = [
      { id: 'all', from: first, to: last },
      { id: '12mo', from: Math.max(first, last - 364), to: last },
      { id: '30d', from: Math.max(first, last - 29), to: last },
    ];
    for (let y = yearOfDay(first); y <= yearOfDay(last); y++) {
      out.push({ id: 'y' + y, label: String(y),
                 from: Math.max(first, dayOfIso(y + '-01-01')),
                 to: Math.min(last, dayOfIso(y + '-12-31')) });
    }
    return out;
  }

  function presetFor(list, from, to) {
    const p = list.find(x => x.from === from && x.to === to);
    return p ? p.id : null;
  }

  /* Clamp to the chat and refuse an inverted range: the caller keeps its last
   * valid one and shows the warning. */
  function validate(from, to, first, last) {
    if (!Number.isFinite(from) || !Number.isFinite(to)) return { error: 'invalid' };
    if (from > to) return { error: 'inverted' };
    return { from: Math.max(first, from), to: Math.min(last, to) };
  }

  /* Message counts in `n` equal slices of first..last, for the sidebar's
   * sparkline. Also returns each slice's first day so a handle position maps
   * back to a bucket without redoing the arithmetic. */
  function histogram(msgs, first, last, n) {
    const span = last - first + 1;
    const counts = new Array(n).fill(0);
    for (const m of msgs) {
      if (m.day < first || m.day > last) continue;
      counts[Math.min(n - 1, Math.floor((m.day - first) * n / span))]++;
    }
    return { counts, starts: counts.map((_, i) => first + Math.ceil(i * span / n)) };
  }

  /* View state in the hash — tab, range, language — never anything from the chat. */
  function encodeHash(s) {
    const q = new URLSearchParams();
    if (s.tab) q.set('tab', s.tab);
    if (s.from != null) q.set('from', isoOfDay(s.from));
    if (s.to != null) q.set('to', isoOfDay(s.to));
    if (s.lang) q.set('lang', s.lang);
    return '#' + q.toString();
  }

  function decodeHash(hash) {
    const q = new URLSearchParams((hash || '').replace(/^#/, ''));
    const out = {};
    if (q.get('tab')) out.tab = q.get('tab');
    const f = q.get('from'), t = q.get('to');
    if (f && /^\d{4}-\d{2}-\d{2}$/.test(f)) out.from = dayOfIso(f);
    if (t && /^\d{4}-\d{2}-\d{2}$/.test(t)) out.to = dayOfIso(t);
    if (q.get('lang') === 'en' || q.get('lang') === 'pt') out.lang = q.get('lang');
    return out;
  }

  return { DAY, dayOf, isoOfDay, dayOfIso, yearOfDay, prepare, filter, presets, presetFor,
           histogram, validate, encodeHash, decodeHash };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ChatRange;
