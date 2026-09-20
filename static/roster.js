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

  return { SLOTS, RosterError, clone, initial, apply, counts };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ChatRoster;
