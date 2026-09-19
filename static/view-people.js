'use strict';

/* People tab: one card per person. Click a card → Messages for that person. */

(function (App, P, W) {

  const local = { sort: 'messages' };

  function card(o, roleKeys, emojis, sig) {
    const { t, esc, num, pct } = App;
    const maxH = Math.max(...o.hours, 1);
    const name = App.name(o.p);
    const stats = [
      [t('stat_messages'), num(o.messages)],
      [t('stat_words_msg'), num(o.wordsPerMsg, 1)],
      [t('stat_reply'), App.fmtDuration(o.medianReply)],
      [t('stat_starts'), o.startsPct == null ? '—' : pct(o.startsPct)],
      [t('stat_midnight'), pct(o.afterMidnightPct)],
      [t('stat_media'), num(o.media)],
    ];
    return `<div class="pcard" data-p="${o.p}" style="--hue:${App.color(o.p)}">
      <div class="pc-head"><div class="avatar">${esc([...name][0] || '?')}</div>
        <div style="min-width:0"><div class="pc-name">${esc(name)}</div>
          <div class="pc-role">${esc(roleKeys.map(k => t('role_' + k)).join(' · '))}</div></div>
        <div class="pc-share"><div class="v">${pct(o.share)}</div><div class="l">${esc(t('of_messages'))}</div></div></div>
      <div class="pc-stats">${stats.map(([l, v]) => `<div><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>
      <div class="pc-body">
        <div><div class="l">${esc(t('top_emojis'))}</div>${emojis.length
          ? `<div class="emojis">${emojis.map(([e, c]) => `<span>${esc(e)}<small>${num(c)}</small></span>`).join('')}</div>`
          : `<span class="dash">—</span>`}</div>
        <div><div class="l">${esc(t('signature_words'))}</div>${sig.length
          ? `<div class="chips">${sig.map(([w, c]) => `<span class="chip">${esc(w)}<b>${num(c)}</b></span>`).join('')}</div>`
          : `<span class="dash">—</span>`}</div>
        <div><div class="l">${esc(t('their_day'))}</div>
          <div class="minihours">${o.hours.map(v => `<div style="height:${v / maxH * 100}%"></div>`).join('')}</div>
          <div class="hlabels" style="gap:2px">${o.hours.map((_, h) => `<span>${h % 6 === 0 ? h : ''}</span>`).join('')}</div></div>
      </div></div>`;
  }

  function render(root) {
    const st = App.state;
    const { t, esc } = App;
    if (!st.view.length) return App.emptyState(root);
    const n = st.chat.people.length;
    const profs = P.profiles(st.view, n);
    const roles = P.roles(profs, P.firstLast(st.view, n));
    const sig = W.signatureWords(st.view, n, 5);
    const list = P.sorted(profs, local.sort);
    const sorts = ['messages', 'fastest', 'longest', 'night'];
    root.innerHTML = `<div class="sec-h"><div class="t"><i class="ti ti-users"></i>${esc(t('n_people', { n: list.length }))}</div>
      <div class="r"><select id="peopleSort">${sorts.map(s => `<option value="${s}" ${s === local.sort ? 'selected' : ''}>${esc(t('sort_' + s))}</option>`).join('')}</select></div></div>
      <div class="people">${list.map(o => card(o, roles[o.p], W.top(W.emojiCounts(st.view, o.p), 5), sig[o.p])).join('')}</div>`;
    root.querySelector('#peopleSort').addEventListener('change', e => { local.sort = e.target.value; render(root); });
    root.querySelector('.people').addEventListener('click', e => {
      const c = e.target.closest('.pcard');
      if (c) App.openMessages({ person: +c.dataset.p });
    });
  }

  App.register('people', { render });
})(App, ChatPeople, ChatWords);
