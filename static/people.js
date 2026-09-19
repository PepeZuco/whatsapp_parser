'use strict';

/* Per-person behaviour: who opens and closes each day, who starts
 * conversations, how fast each person replies, and the profile card numbers.
 *
 * Rules (from the spec):
 *  - a conversation starts with the first message after >= 4 h of silence
 *    (the very first message in range counts too)
 *  - a reply is a message whose previous message came from someone else less
 *    than 12 h earlier; its reply time is the gap
 *  - "after midnight" is 00:00–04:59
 *
 * Pure functions, loaded as a plain script and required by tests/test_people.js. */

const ChatPeople = (function (stats) {

  const STARTER_GAP = 4 * 3600;
  const REPLY_MAX = 12 * 3600;
  const NIGHT_OWL_MIN = 0.02;

  function firstLast(msgs, n) {
    const first = new Array(n).fill(0), last = new Array(n).fill(0);
    for (let i = 0; i < msgs.length; i++) {
      if (i === 0 || msgs[i - 1].day !== msgs[i].day) first[msgs[i].p]++;
      if (i === msgs.length - 1 || msgs[i + 1].day !== msgs[i].day) last[msgs[i].p]++;
    }
    return { first, last };
  }

  function starters(msgs, n) {
    const out = new Array(n).fill(0);
    for (let i = 0; i < msgs.length; i++) {
      if (i === 0 || msgs[i].t - msgs[i - 1].t >= STARTER_GAP) out[msgs[i].p]++;
    }
    return out;
  }

  function replyGaps(msgs, n) {
    const out = Array.from({ length: n }, () => []);
    for (let i = 1; i < msgs.length; i++) {
      const gap = msgs[i].t - msgs[i - 1].t;
      if (msgs[i].p !== msgs[i - 1].p && gap < REPLY_MAX) out[msgs[i].p].push(gap);
    }
    return out;
  }

  function median(arr) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b), mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  /* The numbers on each person's card. medianReply/startsPct are null for a
   * one-person chat, where neither means anything. */
  function profiles(msgs, n) {
    const gaps = replyGaps(msgs, n);
    const st = starters(msgs, n);
    const totalStarts = st.reduce((a, b) => a + b, 0);
    const out = Array.from({ length: n }, (_, p) => ({
      p, messages: 0, words: 0, textMsgs: 0, media: 0, lateNight: 0, hours: new Array(24).fill(0),
    }));
    for (const m of msgs) {
      const o = out[m.p];
      o.messages++;
      o.hours[m.h]++;
      if (m.h < 5) o.lateNight++;
      if (stats.MEDIA.has(m.k)) o.media++;
      if (m.k === 't' || m.k === 'l') { o.textMsgs++; o.words += stats.words(m.x); }
    }
    const total = msgs.length || 1;
    for (const o of out) {
      o.share = o.messages / total;
      o.wordsPerMsg = o.textMsgs ? o.words / o.textMsgs : 0;
      o.afterMidnightPct = o.messages ? o.lateNight / o.messages : 0;
      o.medianReply = n > 1 ? median(gaps[o.p]) : null;
      o.startsPct = n > 1 && totalStarts ? st[o.p] / totalStarts : null;
    }
    return out;
  }

  /* At most two roles per person, each role going to the single person at the
   * extreme. Only for 2–12 people: alone it's meaningless, in a crowd it's noise. */
  function roles(profs, fl) {
    const out = profs.map(() => []);
    const active = profs.filter(p => p.messages > 0);
    if (active.length < 2 || active.length > 12) return out;
    const pick = (score, better) => {
      let best = null;
      for (const p of active) {
        const v = score(p);
        if (v == null) continue;
        if (best === null || better(v, score(best))) best = p;
      }
      return best;
    };
    const max = (a, b) => a > b, min = (a, b) => a < b;
    const rules = [
      ['starter', pick(p => p.startsPct, max)],
      ['fastest', pick(p => p.medianReply, min)],
      // Under 2% after midnight nobody is a night owl, however the rest compare.
      ['night_owl', pick(p => (p.afterMidnightPct >= NIGHT_OWL_MIN ? p.afterMidnightPct : null), max)],
      ['good_night', pick(p => fl.last[p.p], max)],
      ['good_morning', pick(p => fl.first[p.p], max)],
    ];
    for (const [role, who] of rules) {
      if (who && out[who.p].length < 2) out[who.p].push(role);
    }
    return out;
  }

  const SORTS = {
    messages: (a, b) => b.messages - a.messages,
    fastest: (a, b) => (a.medianReply ?? Infinity) - (b.medianReply ?? Infinity),
    longest: (a, b) => b.wordsPerMsg - a.wordsPerMsg,
    night: (a, b) => b.afterMidnightPct - a.afterMidnightPct,
  };

  function sorted(profs, key) {
    return [...profs].filter(p => p.messages > 0).sort((a, b) => SORTS[key](a, b) || a.p - b.p);
  }

  return { STARTER_GAP, REPLY_MAX, firstLast, starters, replyGaps, median, profiles, roles, sorted };
})(typeof ChatStats !== 'undefined' ? ChatStats : require('./stats.js'));

if (typeof module !== 'undefined' && module.exports) module.exports = ChatPeople;
