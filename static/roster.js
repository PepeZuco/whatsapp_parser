'use strict';

/* The participant roster: the user's configuration over one parsed chat.
 *
 *   { entries: [{ src, name, color, on }] }
 *
 * src holds indices into the parsed chat's people array. Every index appears in
 * exactly one entry's src, exactly once — that invariant is what makes the
 * projection total. color is a palette slot (0-11), never a hex, so the theme
 * toggle keeps working. Entry order is display order and becomes the person
 * index in the projected chat.
 *
 * apply() returns an object shaped like the /api/parse response, so stats.js,
 * people.js, words.js, wrapped.js, export.js and every view keep working on it
 * unchanged — they cannot tell a projected chat from a parsed one.
 *
 * Pure functions, loaded as a plain script and required by tests/test_roster.js. */

const ChatRoster = (function () {

  const SLOTS = 12;
  const DAY = 86400;
  const MAX_SUGGESTIONS = 3;
  const REPLY_MAX = 12 * 3600;   // the window people.js already calls a reply
  const OVERLAP_MAX = 0.05;      // spans may share at most 5% of their union
  const NAME_SIM_MIN = 0.85;
  const PHONE = /^\+?\d[\d\s()\-.]{6,}$/;

  class RosterError extends Error {
    constructor(code) { super(code); this.code = code; }
  }

  function clone(roster) {
    return { entries: roster.entries.map(e =>
      ({ src: e.src.slice(), name: e.name, color: e.color, on: e.on })) };
  }

  function initial(chat) {
    return { entries: chat.people.map((name, i) =>
      ({ src: [i], name, color: i % SLOTS, on: true })) };
  }

  function isoOfTs(ts) {
    return new Date(Math.floor(ts / DAY) * DAY * 1000).toISOString().slice(0, 10);
  }

  /* chat × roster → a chat shaped like the API's, with only the selected people
   * in it and person indices remapped onto the surviving entries. */
  function apply(chat, roster) {
    const on = roster.entries.filter(e => e.on);
    const map = new Array(chat.people.length).fill(-1);
    on.forEach((e, j) => e.src.forEach(s => { map[s] = j; }));

    const rows = [];
    let lo = Infinity, hi = -Infinity;
    for (const r of chat.rows) {
      const p = map[r[1]];
      if (p < 0) continue;
      rows.push([r[0], p, r[2], r[3]]);
      if (r[0] < lo) lo = r[0];
      if (r[0] > hi) hi = r[0];
    }
    if (!rows.length) throw new RosterError('empty');

    return {
      platform: chat.platform,
      language: chat.language,
      title: chat.title,
      people: on.map(e => e.name),
      colors: on.map(e => e.color),
      start: isoOfTs(lo),
      end: isoOfTs(hi),
      rows,
    };
  }

  /* Message totals for the modal: one per entry (merged entries add up), plus
   * how many entries and messages are currently selected. */
  function counts(chat, roster) {
    const per = new Array(chat.people.length).fill(0);
    for (const r of chat.rows) per[r[1]]++;
    const perEntry = roster.entries.map(e => e.src.reduce((s, i) => s + per[i], 0));
    let on = 0, messages = 0;
    roster.entries.forEach((e, i) => { if (e.on) { on++; messages += perEntry[i]; } });
    return { perEntry, on, messages };
  }

  // ---------- edits (every one returns a new roster) ----------

  function toggle(roster, i) {
    const r = clone(roster);
    r.entries[i].on = !r.entries[i].on;
    return r;
  }

  function setColor(roster, i, slot) {
    const r = clone(roster);
    r.entries[i].color = ((slot % SLOTS) + SLOTS) % SLOTS;
    return r;
  }

  /* A name trimmed to nothing falls back to the export's own name for the
   * entry's first source, so an entry can never end up nameless. */
  function rename(roster, i, name, chat) {
    const r = clone(roster);
    r.entries[i].name = String(name).trim() || chat.people[r.entries[i].src[0]];
    return r;
  }

  /* Fuse `other` into `target`: the result keeps the target's name, colour and
   * on-state, which is what makes "merge as <this name>" a single action. */
  function merge(roster, target, other) {
    const r = clone(roster);
    if (target === other) return r;
    r.entries[target].src = r.entries[target].src.concat(r.entries[other].src);
    r.entries.splice(other, 1);
    return r;
  }

  function takenSlots(roster, except) {
    const out = new Set();
    roster.entries.forEach((e, i) => { if (i !== except) out.add(e.color); });
    return out;
  }

  /* Undo a merge in place: one entry per source, original names, the first
   * keeping the group's colour and the rest taking slots nobody else holds. */
  function split(roster, i, chat) {
    const e = roster.entries[i];
    if (e.src.length < 2) return clone(roster);
    const used = takenSlots(roster, i);
    const restored = e.src.map((s, k) => {
      let color = e.color;
      if (k > 0) {
        color = s % SLOTS;
        for (let c = 0; c < SLOTS; c++) if (!used.has(c)) { color = c; break; }
      }
      used.add(color);
      return { src: [s], name: chat.people[s], color, on: e.on };
    });
    const r = clone(roster);
    r.entries.splice(i, 1, ...restored);
    return r;
  }

  function entryOf(roster, src) {
    return roster.entries.findIndex(e => e.src.indexOf(src) >= 0);
  }

  function sameEntry(roster, a, b) {
    const i = entryOf(roster, a);
    return i >= 0 && i === entryOf(roster, b);
  }

  // ---------- probable duplicates ----------

  function normalise(s) {
    return String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function isPhone(name) { return PHONE.test(String(name).trim()); }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length || !b.length) return Math.max(a.length, b.length);
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
                          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function similarity(a, b) {
    const max = Math.max(a.length, b.length);
    return max ? 1 - levenshtein(a, b) / max : 1;
  }

  function wordSubset(a, b) {
    const A = a.split(' '), B = b.split(' ');
    const sub = (x, y) => x.every(w => y.indexOf(w) >= 0);
    return sub(A, B) || sub(B, A);
  }

  /* Why these two names might belong to one person, or null. Two phone numbers
   * say nothing either way — near-identical numbers are usually two people. */
  function nameAffinity(a, b) {
    const pa = isPhone(a), pb = isPhone(b);
    if (pa && pb) return null;
    if (pa !== pb) return 'phone_number';
    const na = normalise(a), nb = normalise(b);
    if (na === nb || wordSubset(na, nb) || similarity(na, nb) >= NAME_SIM_MIN) return 'similar_name';
    return null;
  }

  /* First and last day each person wrote. */
  function spans(chat) {
    const out = chat.people.map(() => null);
    for (const r of chat.rows) {
      const d = Math.floor(r[0] / DAY), s = out[r[1]];
      if (!s) out[r[1]] = { lo: d, hi: d };
      else { if (d < s.lo) s.lo = d; if (d > s.hi) s.hi = d; }
    }
    return out;
  }

  /* Overlap measured against the SHORTER span, never the union. Against the
   * union, anyone long-tenured looks disjoint from anyone short-lived — a person
   * writing for 18 months and a number appearing for 2 days at the end overlap
   * by under 1% of the union, and would be offered as the same person. Against
   * the shorter span those 2 days are 100%, so only a name that goes quiet
   * before the other starts can pass. */
  function overlapRatio(a, b) {
    if (!a || !b) return 1;
    const overlap = Math.max(0, Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) + 1);
    const shorter = Math.min(a.hi - a.lo + 1, b.hi - b.lo + 1);
    return shorter > 0 ? overlap / shorter : 1;
  }

  /* Pairs that ever answered each other inside REPLY_MAX. Relies on rows being
   * chronological, the same assumption parse.py makes for start/end; the gap >= 0
   * guard keeps unsorted input from reading a backward jump as an exchange. */
  function exchanged(chat) {
    const n = chat.people.length, seen = new Set();
    for (let i = 1; i < chat.rows.length; i++) {
      const prev = chat.rows[i - 1], cur = chat.rows[i];
      const gap = cur[0] - prev[0];
      if (prev[1] !== cur[1] && gap >= 0 && gap < REPLY_MAX) {
        seen.add(Math.min(prev[1], cur[1]) * n + Math.max(prev[1], cur[1]));
      }
    }
    return seen;
  }

  /* Pairs that look like one person twice. Conservative on purpose: accepting a
   * suggestion is one click and silently rewrites every number in the app, so a
   * false positive costs more than a miss. */
  function suggest(chat) {
    const n = chat.people.length;
    if (n < 2) return [];
    const sp = spans(chat), ex = exchanged(chat);
    const c = counts(chat, initial(chat)).perEntry;
    const out = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (ex.has(i * n + j)) continue;
        const affinity = nameAffinity(chat.people[i], chat.people[j]);
        if (!affinity) continue;
        if (overlapRatio(sp[i], sp[j]) > OVERLAP_MAX) continue;
        const [a, b] = c[i] >= c[j] ? [i, j] : [j, i];
        out.push({ a, b, reasons: [affinity, 'span_disjoint', 'no_replies'] });
      }
    }
    return out.sort((x, y) => (c[y.a] + c[y.b]) - (c[x.a] + c[x.b])).slice(0, MAX_SUGGESTIONS);
  }

  return { SLOTS, RosterError, clone, initial, apply, counts,
           toggle, setColor, rename, merge, split, takenSlots, entryOf, sameEntry,
           suggest, isPhone, normalise, similarity };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ChatRoster;
