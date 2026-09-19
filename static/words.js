'use strict';

/* Words, emojis and links.
 *
 * Tokens and emojis are cached on each message object (m._tok / m._emo), so a
 * date-range change only re-counts — it never re-tokenises 100k messages.
 *
 * Pure functions, loaded as a plain script and required by tests/test_words.js. */

const ChatWords = (function () {

  // PT + EN, including everything the Streamlit version removed.
  const STOPWORDS = new Set((
    'a ao aos à às ainda agora aqui algo aí assim ai até ah audio anexado apagada ' +
    'b c com como coisa cara d da das de deu do dos dar dele dela deles delas depois ' +
    'e eu estar então está esta este isto estou eh é em ele ela eles elas esse essa esses essas estão era eram ' +
    'f foi faz fazer fica g h https http i isso ia ir j ja já jpg k l la lá lo ' +
    'm mas mais me meu minha meus minhas ma muito muita mim mensagem ' +
    'n né no nos não nao nós nada na nas nem num numa ' +
    'o os ou opus omitido omitida oculta ocultado ocultada ' +
    'p pra pro pras pros para porque pode por pq porq photo pelo pela ' +
    'q que quando qual quer quem r s sim se sem sobre sabe ser seu sua seus suas só são sou ' +
    't ta tá tão tem têm tô tudo todo toda todos ter te tava tal tb também tipo ' +
    'u uma um umas uns v vc vcs você voce vou vai vão ver viu vez w www x y z ' +
    'the and to of in is it you that i for on with this was are be at have not but ' +
    'my me so do just what your all can if we they he she her his its or an as from ' +
    'up out about was were will would there their them then than im i\'m it\'s dont don\'t ' +
    'omitted image video sticker deleted message media gif document null'
  ).split(/\s+/));

  const URL_RE = /https?:\/\/\S+/gi;
  const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'']*/gu;
  // One emoji = a pictograph or flag pair, its variation selector / skin tone,
  // and any ZWJ-joined continuation (👨\u200d👩\u200d👧 stays one family).
  const EMOJI_RE = /(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}[\ufe0f\u{1F3FB}-\u{1F3FF}]*(?:\u200d\p{Extended_Pictographic}[\ufe0f\u{1F3FB}-\u{1F3FF}]*)*)/gu;

  function isText(m) { return m.k === 't' || m.k === 'l'; }

  function tokens(m) {
    if (m._tok) return m._tok;
    const out = [];
    if (isText(m)) {
      for (const w of m.x.replace(URL_RE, ' ').toLowerCase().match(WORD_RE) || []) {
        if (w.length < 2 || /^\d+$/.test(w) || STOPWORDS.has(w)) continue;
        out.push(w);
      }
    }
    m._tok = out;
    return out;
  }

  function emojisOf(m) {
    if (!m._emo) m._emo = isText(m) ? (m.x.match(EMOJI_RE) || []) : [];
    return m._emo;
  }

  function countBy(msgs, pick, person) {
    const out = new Map();
    for (const m of msgs) {
      if (person != null && m.p !== person) continue;
      for (const w of pick(m)) out.set(w, (out.get(w) || 0) + 1);
    }
    return out;
  }

  function top(map, n) {
    return [...map].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
  }

  function wordCounts(msgs, person = null) { return countBy(msgs, tokens, person); }
  function emojiCounts(msgs, person = null) { return countBy(msgs, emojisOf, person); }

  /* Words a person uses more than everyone else does: count × (their rate /
   * everyone's rate). Needs at least 3 uses so one-offs don't win. */
  function signatureWords(msgs, nPeople, n = 5) {
    const all = wordCounts(msgs);
    const allTotal = [...all.values()].reduce((a, b) => a + b, 0) || 1;
    return Array.from({ length: nPeople }, (_, p) => {
      const mine = wordCounts(msgs, p);
      const myTotal = [...mine.values()].reduce((a, b) => a + b, 0) || 1;
      const scored = new Map();
      for (const [w, c] of mine) {
        if (c < 3) continue;
        scored.set(w, c * ((c / myTotal) / (all.get(w) / allTotal)));
      }
      return top(scored, n).map(([w]) => [w, mine.get(w)]);
    });
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* Build the matcher once per search. Whole-word boundaries are Unicode
   * letters/digits, so "oi" no longer counts inside "noite" and "você" works. */
  function termMatcher(term, { wholeWord = true, matchCase = false } = {}) {
    const t = term.trim();
    if (!t) return null;
    const body = escapeRe(t);
    const src = wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body;
    return new RegExp(src, 'gu' + (matchCase ? '' : 'i'));
  }

  /* The word counter: per person, total, and per 'YYYY-MM'. */
  function countTerm(msgs, nPeople, term, opts) {
    const re = termMatcher(term, opts);
    const byPerson = new Array(nPeople).fill(0);
    const byMonth = new Map();
    let total = 0;
    if (!re) return { byPerson, total, byMonth };
    for (const m of msgs) {
      if (!isText(m)) continue;
      const hits = (m.x.match(re) || []).length;
      if (!hits) continue;
      byPerson[m.p] += hits;
      total += hits;
      const key = new Date(m.t * 1000).toISOString().slice(0, 7);
      byMonth.set(key, (byMonth.get(key) || 0) + hits);
    }
    return { byPerson, total, byMonth };
  }

  /* Top domains, www. stripped; the rest fold into one 'other' row. */
  function linkDomains(msgs, n = 5) {
    const c = new Map();
    for (const m of msgs) {
      if (m.k !== 'l') continue;
      for (const u of m.x.match(URL_RE) || []) {
        const d = u.replace(/^https?:\/\//i, '').split(/[/?#:]/)[0].toLowerCase().replace(/^www\./, '');
        if (d) c.set(d, (c.get(d) || 0) + 1);
      }
    }
    const ranked = top(c, Infinity);
    if (ranked.length <= n) return ranked;
    const rest = ranked.slice(n).reduce((s, [, v]) => s + v, 0);
    return ranked.slice(0, n).concat([['other', rest]]);
  }

  return { STOPWORDS, tokens, emojisOf, wordCounts, emojiCounts, top, signatureWords,
           termMatcher, countTerm, linkDomains };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ChatWords;
