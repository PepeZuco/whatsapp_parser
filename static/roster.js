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

  return { SLOTS, RosterError, clone, initial, apply, counts,
           toggle, setColor, rename, merge, split, takenSlots, entryOf, sameEntry };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ChatRoster;
