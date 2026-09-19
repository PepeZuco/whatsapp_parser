'use strict';

/* Counting: KPIs, streaks, the calendar, hours, the heatmap, types, share and
 * the over-time series. Every function takes already range-filtered messages
 * (see range.js prepare/filter) and returns plain data for the views.
 *
 * Pure functions, loaded as a plain script and required by tests/test_stats.js. */

const ChatStats = (function (range) {

  const MEDIA = new Set(['a', 'p', 's', 'v', 'g', 'd', 'm']);

  function words(text) {
    const m = text.match(/\S+/g);
    return m ? m.length : 0;
  }

  function dailyCounts(msgs) {
    const out = new Map();
    for (const m of msgs) out.set(m.day, (out.get(m.day) || 0) + 1);
    return out;
  }

  function totals(msgs, from, to) {
    const days = to - from + 1;
    const active = dailyCounts(msgs).size;
    let w = 0;
    for (const m of msgs) if (m.k === 't' || m.k === 'l') w += words(m.x);
    return { messages: msgs.length, days, activeDays: active,
             activePct: days ? active / days : 0,
             perDay: days ? msgs.length / days : 0, words: w };
  }

  /* Weekly totals from `from`, for the KPI sparkline. */
  function weeklySeries(msgs, from, to) {
    const out = new Array(Math.floor((to - from) / 7) + 1).fill(0);
    for (const m of msgs) out[Math.floor((m.day - from) / 7)]++;
    return out;
  }

  /* Active days per weekday, Sunday first. */
  function weekdayCounts(msgs) {
    const out = new Array(7).fill(0);
    for (const day of dailyCounts(msgs).keys()) out[new Date(day * 864e5).getUTCDay()]++;
    return out;
  }

  /* Longest run of consecutive active days, and the run still going on the
   * chat's last day (0 when the range stops before it or that day was quiet). */
  function streaks(msgs, chatLastDay) {
    const days = [...dailyCounts(msgs).keys()].sort((a, b) => a - b);
    let best = { len: 0, from: null, to: null }, start = null, prev = null;
    for (const d of days) {
      if (prev === null || d !== prev + 1) start = d;
      if (d - start + 1 > best.len) best = { len: d - start + 1, from: start, to: d };
      prev = d;
    }
    const current = prev === chatLastDay ? prev - start + 1 : 0;
    return { longest: best, current };
  }

  function busiestDay(msgs) {
    let best = null;
    for (const [day, count] of dailyCounts(msgs)) {
      if (!best || count > best.count || (count === best.count && day < best.day)) best = { day, count };
    }
    return best;
  }

  /* Quantile thresholds (25/50/75%) over the non-zero days, so one wild day
   * doesn't wash every other cell out to the palest level. */
  function levelThresholds(daily) {
    const v = [...daily.values()].filter(n => n > 0).sort((a, b) => a - b);
    if (!v.length) return [1, 1, 1];
    const q = f => v[Math.min(v.length - 1, Math.floor(f * v.length))];
    return [q(0.25), q(0.5), q(0.75)];
  }

  function levelOf(n, th) {
    if (!n) return 0;
    if (n < th[0]) return 1;
    if (n < th[1]) return 2;
    if (n < th[2]) return 3;
    return 4;
  }

  /* One calendar year as week columns: `lead` blank cells put Jan 1 on its
   * weekday row, then one cell per day. inRange=false dims days outside the
   * date bar's range (they still show, so the year keeps its shape). */
  function calendarYear(daily, year, from, to) {
    const first = range.dayOfIso(year + '-01-01');
    const last = range.dayOfIso(year + '-12-31');
    const th = levelThresholds(daily);
    const cells = [];
    for (let d = first; d <= last; d++) {
      const count = daily.get(d) || 0;
      cells.push({ day: d, count, level: levelOf(count, th), inRange: d >= from && d <= to });
    }
    return { lead: new Date(first * 864e5).getUTCDay(), cells, thresholds: th };
  }

  function hours(msgs) {
    const out = new Array(24).fill(0);
    for (const m of msgs) out[m.h]++;
    return out;
  }

  /* 7 rows (Sunday first) × 24 hours. */
  function heatmap(msgs) {
    const out = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const m of msgs) out[m.wd][m.h]++;
    return out;
  }

  /* One entry per type present, biggest first, split per person. */
  function types(msgs, nPeople) {
    const by = new Map();
    for (const m of msgs) {
      if (!by.has(m.k)) by.set(m.k, { k: m.k, total: 0, byPerson: new Array(nPeople).fill(0) });
      const e = by.get(m.k);
      e.total++;
      e.byPerson[m.p]++;
    }
    return [...by.values()].sort((a, b) => b.total - a.total);
  }

  /* Ranked senders; beyond topN they fold into one { p: -1 } "Others" entry. */
  function share(msgs, nPeople, topN = 8) {
    const c = new Array(nPeople).fill(0);
    for (const m of msgs) c[m.p]++;
    const total = msgs.length || 1;
    const ranked = c.map((count, p) => ({ p, count, pct: count / total }))
      .filter(e => e.count > 0).sort((a, b) => b.count - a.count || a.p - b.p);
    if (ranked.length <= topN) return ranked;
    const rest = ranked.slice(topN).reduce((s, e) => s + e.count, 0);
    return ranked.slice(0, topN).concat([{ p: -1, count: rest, pct: rest / total }]);
  }

  function bucketStart(day, gran) {
    if (gran === 'day') return day;
    const d = new Date(day * 864e5);
    if (gran === 'week') return day - d.getUTCDay();
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 864e5);
  }

  function nextBucket(start, gran) {
    if (gran === 'day') return start + 1;
    if (gran === 'week') return start + 7;
    const d = new Date(start * 864e5);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 864e5);
  }

  /* Over-time lines, one per top-N sender plus "Others" (p: -1) when needed.
   * fill=false drops empty buckets — the old "fill empty days" switch, which
   * only changes anything at day granularity. */
  function series(msgs, from, to, gran, nPeople, fill = true, topN = 5) {
    const top = share(msgs, nPeople, topN);
    const lineOf = new Map();
    top.forEach((e, i) => { if (e.p >= 0) lineOf.set(e.p, i); });
    const others = top.some(e => e.p === -1);
    const buckets = [];
    const index = new Map();
    for (let b = bucketStart(from, gran); b <= to; b = nextBucket(b, gran)) {
      index.set(b, buckets.length);
      buckets.push(b);
    }
    const lines = top.map(e => ({ p: e.p, values: new Array(buckets.length).fill(0) }));
    for (const m of msgs) {
      const li = lineOf.has(m.p) ? lineOf.get(m.p) : (others ? lines.length - 1 : -1);
      if (li >= 0) lines[li].values[index.get(bucketStart(m.day, gran))]++;
    }
    if (fill || gran !== 'day') return { buckets, lines };
    const keep = buckets.map((_, i) => lines.some(l => l.values[i] > 0));
    return { buckets: buckets.filter((_, i) => keep[i]),
             lines: lines.map(l => ({ p: l.p, values: l.values.filter((_, i) => keep[i]) })) };
  }

  return { MEDIA, words, dailyCounts, totals, weeklySeries, weekdayCounts, streaks, busiestDay,
           levelThresholds, levelOf, calendarYear, hours, heatmap, types, share, series };
})(typeof ChatRange !== 'undefined' ? ChatRange : require('./range.js'));

if (typeof module !== 'undefined' && module.exports) module.exports = ChatStats;
