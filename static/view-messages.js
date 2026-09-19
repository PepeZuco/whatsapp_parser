'use strict';

/* Messages tab: the chat as bubbles, filters, search with hit stepping, the
 * word counter and links.
 *
 * The list is windowed: at most MAX_WINDOW bubbles are in the DOM, and more
 * are rendered as the reader nears either edge. Re-rendering keeps the first
 * visible bubble where it was on screen, so the scroll never jumps. */

(function (App, W) {

  const CHUNK = 150, MAX_WINDOW = 450, EDGE = 300;
  const TYPE_ICON = { a: 'ti-microphone', p: 'ti-photo', s: 'ti-sticker', v: 'ti-video', g: 'ti-gif',
                      d: 'ti-file', m: 'ti-photo-video', x: 'ti-trash' };

  const local = {
    person: null, type: '', slot: null, search: '', me: 0,
    jumpDay: null, list: [], hits: [], hitPos: -1, start: 0, end: 0,
    finder: null, whole: true, matchCase: false,
  };

  function reset() {
    Object.assign(local, { person: null, type: '', slot: null, search: '', me: 0, jumpDay: null, finder: null });
  }

  /* Called by App.openMessages before the tab renders. */
  function focus(f) {
    local.person = f.person ?? null;
    local.type = '';
    local.slot = f.slot || null;
    local.search = f.search || '';
    local.jumpDay = f.day ?? null;
  }

  function computeList() {
    const { person, type, slot } = local;
    local.list = App.state.view.filter(m =>
      (person == null || m.p === person) && (!type || m.k === type) &&
      (!slot || (m.wd === slot.wd && m.h === slot.h)));
    const re = W.termMatcher(local.search, { wholeWord: false });
    local.hits = [];
    // String#search ignores the regex's g flag and lastIndex, so one matcher serves every row.
    if (re) local.list.forEach((m, i) => { if ((m.k === 't' || m.k === 'l') && m.x.search(re) >= 0) local.hits.push(i); });
    local.hitPos = local.hits.length ? 0 : -1;
  }

  function bubbles(from, to) {
    const { esc, t } = App;
    const re = W.termMatcher(local.search, { wholeWord: false });
    const group = App.state.chat.people.length > 2;
    const hitSet = new Set(local.hits);
    let html = '', prevDay = null;
    for (let i = from; i < to; i++) {
      const m = local.list[i];
      if (m.day !== prevDay) {
        html += `<div class="daysep"><span>${esc(App.fmtDay(m.day, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</span></div>`;
        prevDay = m.day;
      }
      const side = m.p === local.me ? 'me' : 'them';
      const who = group || side === 'them' ? `<span class="who" style="color:${App.color(m.p)}">${esc(App.name(m.p))}</span>` : '';
      const time = `<span class="t">${App.fmtTime(m.t)}</span>`;
      if (TYPE_ICON[m.k]) {
        html += `<div class="bub ${side} media" data-i="${i}">${who}<i class="ti ${TYPE_ICON[m.k]}"></i>${esc(t('type_' + m.k))}${time}</div>`;
      } else {
        html += `<div class="bub ${side}${hitSet.has(i) ? ' hit' : ''}" data-i="${i}">${who}${W.highlight(m.x, re)}${time}</div>`;
      }
    }
    return html;
  }

  /* Render [start, end) keeping `keep` (a list index) at the same screen offset. */
  function paint(box, start, end, keep) {
    let before = null;
    if (keep != null) {
      const el = box.querySelector(`[data-i="${keep}"]`);
      if (el) before = el.offsetTop - box.scrollTop;
    }
    local.start = start;
    local.end = end;
    box.innerHTML = local.list.length ? bubbles(start, end) : `<div class="empty"><i class="ti ti-filter-off"></i>${App.esc(App.t('no_match'))}</div>`;
    if (before != null) {
      const el = box.querySelector(`[data-i="${keep}"]`);
      if (el) box.scrollTop = el.offsetTop - before;
    }
  }

  function firstVisible(box) {
    for (const el of box.querySelectorAll('[data-i]')) {
      if (el.offsetTop + el.offsetHeight > box.scrollTop) return +el.dataset.i;
    }
    return null;
  }

  function scrollToIndex(box, i) {
    if (i < local.start || i >= local.end) {
      const start = Math.max(0, i - CHUNK / 2);
      paint(box, start, Math.min(local.list.length, start + CHUNK * 2), null);
    }
    const el = box.querySelector(`[data-i="${i}"]`);
    if (!el) return;
    box.scrollTop = el.offsetTop - box.clientHeight / 3;
    el.classList.remove('flash');
    void el.offsetWidth;  // restart the animation
    el.classList.add('flash');
  }

  function onScroll(box) {
    const n = local.list.length;
    if (box.scrollTop < EDGE && local.start > 0) {
      const start = Math.max(0, local.start - CHUNK);
      paint(box, start, Math.min(local.end, start + MAX_WINDOW), firstVisible(box));
    } else if (box.scrollHeight - box.scrollTop - box.clientHeight < EDGE && local.end < n) {
      const end = Math.min(n, local.end + CHUNK);
      paint(box, Math.max(local.start, end - MAX_WINDOW), end, firstVisible(box));
    }
  }

  function initialIndex() {
    const list = local.list;
    if (local.jumpDay != null) {
      const i = list.findIndex(m => m.day >= local.jumpDay);
      local.jumpDay = null;
      if (i >= 0) return i;
    }
    if (local.hits.length) return local.hits[0];
    return list.length - 1;
  }

  function finderPanel(st) {
    const { t, esc, num } = App;
    const n = st.chat.people.length;
    if (local.finder == null) local.finder = t('finder_default');
    const r = W.countTerm(st.view, n, local.finder, { wholeWord: local.whole, matchCase: local.matchCase });
    const ranked = r.byPerson.map((v, p) => [p, v]).filter(([, v]) => v).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const max = ranked.length ? ranked[0][1] : 1;
    const rows = ranked.map(([p, v]) => `<div class="row"><span>${esc(App.name(p))}</span>
      <div class="track"><div style="width:${v / max * 100}%;background:${App.color(p)}"></div></div><span class="v">${num(v)}</span></div>`).join('');
    // Per-month sparkline across every month of the range, zeros included.
    const months = [];
    for (let d = st.from; d <= st.to;) {
      const dt = new Date(d * 864e5);
      months.push(dt.toISOString().slice(0, 7));
      d = Math.floor(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1) / 864e5);
    }
    const vals = months.map(m => r.byMonth.get(m) || 0);
    const vmax = Math.max(...vals, 1);
    const pts = vals.map((v, i) => `${(vals.length > 1 ? i / (vals.length - 1) * 280 : 140).toFixed(1)},${(42 - v / vmax * 38).toFixed(1)}`).join(' ');
    return `<div class="panel finder">
      <div class="sec-h"><div class="t"><i class="ti ti-text-scan-2"></i>${esc(t('word_counter'))}</div></div>
      <input type="text" id="finderIn" value="${esc(local.finder)}" placeholder="${esc(t('finder_ph'))}">
      <label class="check"><input type="checkbox" id="finderWhole" ${local.whole ? 'checked' : ''}>${esc(t('whole_words'))}</label>
      <label class="check"><input type="checkbox" id="finderCase" ${local.matchCase ? 'checked' : ''}>${esc(t('match_case'))}</label>
      <div class="fres" id="fres">${rows || `<span class="dash">${esc(t('no_hits'))}</span>`}
        <div class="row total"><span class="dash">${esc(t('total'))}</span><span></span><span class="v">${num(r.total)}</span></div></div>
      <div style="margin-top:14px"><div class="pc-body" style="padding:0"><div class="l">${esc(t('per_month'))}</div></div>
        <svg viewBox="0 0 280 44" style="width:100%;height:44px" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${App.colorValue(0)}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg></div>
    </div>`;
  }

  function linksPanel(st) {
    const { t, esc, num } = App;
    const d = W.linkDomains(st.view, 5);
    const max = d.length ? Math.max(...d.map(x => x[1])) : 1;
    return `<div class="panel"><div class="sec-h"><div class="t"><i class="ti ti-link"></i>${esc(t('links_shared'))}</div></div>
      <div class="hbars">${d.length ? d.map(([k, v]) => `<div class="hbar" style="grid-template-columns:120px 1fr 40px"><span class="k">${esc(k === 'other' ? t('other') : k)}</span>
        <div class="track"><div style="width:${v / max * 100}%;background:var(--accent)"></div></div><span class="v">${num(v)}</span></div>`).join('')
        : `<span class="dash">${esc(t('no_links'))}</span>`}</div></div>`;
  }

  function toolbar(st) {
    const { t, esc } = App;
    const people = st.chat.people;
    const types = [...new Set(st.view.map(m => m.k))];
    const slot = local.slot ? `<span class="chip">${esc(App.weekdayName(local.slot.wd))} ${local.slot.h}:00<button id="clearSlot" aria-label="clear">✕</button></span>` : '';
    return `<div class="toolbar">
      <div class="search"><i class="ti ti-search"></i><input id="msgSearch" value="${esc(local.search)}" placeholder="${esc(t('search_ph'))}">
        <span class="cnt" id="hitCount"></span></div>
      <select id="personSel"><option value="">${esc(t('everyone'))}</option>${people.map((p, i) =>
        `<option value="${i}" ${local.person === i ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
      <select id="typeSel"><option value="">${esc(t('all_types'))}</option>${types.map(k =>
        `<option value="${k}" ${local.type === k ? 'selected' : ''}>${esc(t('type_' + k))}</option>`).join('')}</select>
      <select id="meSel" title="${esc(t('right_side'))}">${people.map((p, i) =>
        `<option value="${i}" ${local.me === i ? 'selected' : ''}>${esc(t('right_side'))}: ${esc(p)}</option>`).join('')}</select>
      ${slot}</div>`;
  }

  function updateHitCount(root) {
    const el = root.querySelector('#hitCount');
    if (!local.search.trim()) { el.innerHTML = ''; return; }
    el.innerHTML = local.hits.length
      ? `${App.num(local.hitPos + 1)}/${App.num(local.hits.length)} <button data-step="-1" aria-label="previous">↑</button><button data-step="1" aria-label="next">↓</button>`
      : App.esc(App.t('no_hits'));
  }

  function render(root) {
    const st = App.state;
    if (!st.view.length) return App.emptyState(root);
    if (local.person != null && local.person >= st.chat.people.length) local.person = null;
    if (local.type && !st.view.some(m => m.k === local.type)) local.type = '';
    computeList();
    root.innerHTML = `<div class="msg-layout"><div>${toolbar(st)}<div class="chat" id="chatBox" style="position:relative"></div></div>
      <div class="side-stack"><div id="finderSlot">${finderPanel(st)}</div>${linksPanel(st)}</div></div>`;
    const box = root.querySelector('#chatBox');
    const i = initialIndex();
    const start = Math.max(0, i - CHUNK);
    paint(box, start, Math.min(local.list.length, start + CHUNK * 2), null);
    if (i >= 0) scrollToIndex(box, i);
    updateHitCount(root);
    wire(root, box);
  }

  function refilter(root, box) {
    computeList();
    const i = local.hits.length ? local.hits[0] : local.list.length - 1;
    paint(box, Math.max(0, i - CHUNK), Math.min(local.list.length, Math.max(0, i - CHUNK) + CHUNK * 2), null);
    if (i >= 0) scrollToIndex(box, i);
    updateHitCount(root);
  }

  function wire(root, box) {
    box.addEventListener('scroll', () => onScroll(box), { passive: true });
    let timer = null;
    root.querySelector('#msgSearch').addEventListener('input', e => {
      clearTimeout(timer);
      timer = setTimeout(() => { local.search = e.target.value; refilter(root, box); }, 200);
    });
    root.querySelector('#msgSearch').addEventListener('keydown', e => {
      if (e.key === 'Enter' && local.hits.length) {
        local.hitPos = (local.hitPos + (e.shiftKey ? -1 : 1) + local.hits.length) % local.hits.length;
        scrollToIndex(box, local.hits[local.hitPos]);
        updateHitCount(root);
      }
    });
    root.querySelector('#hitCount').addEventListener('click', e => {
      const b = e.target.closest('[data-step]');
      if (!b || !local.hits.length) return;
      local.hitPos = (local.hitPos + +b.dataset.step + local.hits.length) % local.hits.length;
      scrollToIndex(box, local.hits[local.hitPos]);
      updateHitCount(root);
    });
    root.querySelector('#personSel').addEventListener('change', e => { local.person = e.target.value === '' ? null : +e.target.value; refilter(root, box); });
    root.querySelector('#typeSel').addEventListener('change', e => { local.type = e.target.value; refilter(root, box); });
    root.querySelector('#meSel').addEventListener('change', e => { local.me = +e.target.value; paint(box, local.start, local.end, firstVisible(box)); });
    const clear = root.querySelector('#clearSlot');
    if (clear) clear.addEventListener('click', () => { local.slot = null; render(root); });

    const slot = root.querySelector('#finderSlot');
    const redoFinder = () => {
      const pos = slot.querySelector('#finderIn').selectionStart;
      slot.innerHTML = finderPanel(App.state);
      const inp = slot.querySelector('#finderIn');
      inp.focus();
      inp.setSelectionRange(pos, pos);
    };
    let ftimer = null;
    slot.addEventListener('input', e => {
      if (e.target.id !== 'finderIn') return;
      clearTimeout(ftimer);
      ftimer = setTimeout(() => { local.finder = e.target.value; redoFinder(); }, 200);
    });
    slot.addEventListener('change', e => {
      if (e.target.id === 'finderWhole') { local.whole = e.target.checked; redoFinder(); }
      if (e.target.id === 'finderCase') { local.matchCase = e.target.checked; redoFinder(); }
    });
  }

  App.register('messages', { render, focus, reset });
})(App, ChatWords);
