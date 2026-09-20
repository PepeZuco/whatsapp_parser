'use strict';

/* Overview tab: KPI tiles, the year calendar, share, message types, words. */

(function (App, S, W, R) {

  const TYPE_ICON = { t: 'ti-message', a: 'ti-microphone', p: 'ti-photo', s: 'ti-sticker', v: 'ti-video',
                      g: 'ti-gif', d: 'ti-file', m: 'ti-photo-video', x: 'ti-trash', l: 'ti-link' };
  const local = { scroll: null, cloudPerson: null };

  function sparkline(values, color) {
    if (values.length < 2) return '';
    const max = Math.max(...values, 1);
    const pts = values.map((v, i) => `${(i / (values.length - 1) * 200).toFixed(1)},${(30 - v / max * 28).toFixed(1)}`);
    return `<svg class="kpi-spark" viewBox="0 0 200 30" preserveAspectRatio="none"><polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function kpis(st) {
    const { t, num, pct, fmtDay, esc } = App;
    const tot = S.totals(st.view, st.from, st.to);
    const streak = S.streaks(st.view, st.last);
    const busy = S.busiestDay(st.view);
    const wk = S.weekdayCounts(st.view);
    const wkMax = Math.max(...wk, 1);
    const L = streak.longest;
    return `<div class="kpi">
      <div class="kpi-tile" style="--hue:var(--p1)">
        <div class="kpi-l"><i class="ti ti-message"></i>${esc(t('kpi_messages'))}</div>
        <div class="kpi-v">${num(tot.messages)}</div>
        <div class="kpi-s">${esc(t('kpi_messages_sub', { perDay: num(tot.perDay, 1), words: num(tot.words) }))}</div>
        <div class="kpi-foot">${sparkline(S.weeklySeries(st.view, st.from, st.to), App.colorValue(0))}</div>
      </div>
      <div class="kpi-tile" style="--hue:var(--p3)">
        <div class="kpi-l"><i class="ti ti-calendar-check"></i>${esc(t('kpi_active'))}</div>
        <div class="kpi-v">${num(tot.activeDays)}<small>/ ${num(tot.days)}</small></div>
        <div class="kpi-s">${esc(t('kpi_active_sub', { pct: pct(tot.activePct) }))}</div>
        <div class="kpi-foot"><div class="kpi-bars">${wk.map(v => `<div class="b" style="height:${v / wkMax * 100}%"></div>`).join('')}</div>
          <div class="kpi-days">${wk.map((_, i) => `<span>${esc(App.weekdayName(i, 'narrow'))}</span>`).join('')}</div></div>
      </div>
      <div class="kpi-tile" style="--hue:var(--p2)">
        <div class="kpi-l"><i class="ti ti-flame"></i>${esc(t('kpi_streak'))}</div>
        <div class="kpi-v">${num(L.len)}<small>${esc(t('days'))}</small></div>
        <div class="kpi-s">${L.len ? esc(fmtDay(L.from)) + ' → ' + esc(fmtDay(L.to)) : ''}<br>${esc(t('kpi_streak_current', { n: num(streak.current) }))}</div>
      </div>
      <div class="kpi-tile" style="--hue:var(--p4)">
        <div class="kpi-l"><i class="ti ti-bolt"></i>${esc(t('kpi_busiest'))}</div>
        <div class="kpi-v">${busy ? num(busy.count) : '—'}</div>
        <div class="kpi-s">${busy ? esc(fmtDay(busy.day, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })) +
          `<br><button class="link" data-open-day="${busy.day}">${esc(t('read_that_day'))} →</button>` : ''}</div>
      </div>
    </div>`;
  }

  function calendar(st) {
    const { t, esc } = App;
    const years = [];
    for (let y = R.yearOfDay(st.from); y <= R.yearOfDay(st.to); y++) years.push(y);
    const daily = S.dailyCounts(st.view);
    const blocks = years.map(y => {
      const cal = S.calendarYear(daily, y, st.from, st.to);
      const cells = [];
      for (let i = 0; i < cal.lead; i++) cells.push('<span class="c blank"></span>');
      for (const c of cal.cells) {
        const cls = `c${c.level ? ' l' + c.level : ''}${c.inRange ? '' : ' out'}`;
        cells.push(`<button class="${cls}" data-day="${c.day}" data-n="${c.count}" aria-label="${R.isoOfDay(c.day)}"></button>`);
      }
      const months = [];
      for (let m = 0; m < 12; m++) {
        const d = R.dayOfIso(`${y}-${String(m + 1).padStart(2, '0')}-01`);
        const col = Math.floor((d - cal.cells[0].day + cal.lead) / 7) + 1;
        months.push(`<span style="grid-column:${col}/span 4">${esc(App.fmtDay(d, { month: 'short' }))}</span>`);
      }
      return { th: cal.thresholds, html: `<div class="cal-year" data-y="${y}"><div class="cal-yl">${y}</div>
        <div class="cal-months">${months.join('')}</div><div class="cal">${cells.join('')}</div></div>` };
    });
    const wd = [0, 1, 2, 3, 4, 5, 6].map(i => `<span>${i % 2 ? esc(App.weekdayName(i)) : ''}</span>`).join('');
    const th = blocks[0].th;
    return `<div class="sec">
      <div class="sec-h"><div class="t"><i class="ti ti-calendar-stats"></i>${esc(t('every_day'))}</div>
        <div class="r"><span class="seg sm" id="calYears">${years.map(y => `<button data-year="${y}" class="${y === years[0] ? 'on' : ''}">${y}</button>`).join('')}</span></div></div>
      <div class="panel">
        <div class="cal-row"><div class="cal-days">${wd}</div>
          <div class="cal-wrap" id="calWrap"><div class="cal-strip" id="cal">${blocks.map(b => b.html).join('')}</div></div></div>
        <div class="legend"><span>${esc(t('cal_hint'))}</span><span class="sp"></span>${esc(t('less'))}
          <span class="c" style="background:var(--cell0)"></span>
          <span class="c" style="background:rgba(var(--accent-rgb),.25)" title="< ${th[0]}"></span>
          <span class="c" style="background:rgba(var(--accent-rgb),.5)" title="< ${th[1]}"></span>
          <span class="c" style="background:rgba(var(--accent-rgb),.75)" title="< ${th[2]}"></span>
          <span class="c" style="background:var(--accent)" title="≥ ${th[2]}"></span> ${esc(t('more'))}</div>
      </div></div>`;
  }

  function shareBar(entries) {
    return `<div class="share">${entries.map(e =>
      `<div style="width:${e.pct * 100}%;background:${App.color(e.p)}" title="${App.esc(App.name(e.p))}">${e.pct >= 0.08 ? App.pct(e.pct) : ''}</div>`).join('')}</div>`;
  }

  function share(st) {
    const { t, esc, num } = App;
    const s = S.share(st.view, st.chat.people.length);
    return `<div><div class="sec-h"><div class="t"><i class="ti ti-chart-pie-2"></i>${esc(t('who_talks_more'))}</div></div>
      <div class="panel">${shareBar(s)}
        <div class="who-list">${s.map(e => `<div class="who"><span class="dot" style="background:${App.color(e.p)}"></span>
          <span class="n">${esc(App.name(e.p))}</span><span class="v">${num(e.count)}</span></div>`).join('')}</div>
      </div></div>`;
  }

  function types(st) {
    const { t, esc, num } = App;
    const n = st.chat.people.length;
    const list = S.types(st.view, n);
    const max = Math.sqrt(list.length ? list[0].total : 1);
    const rows = list.map(e => {
      const w = Math.sqrt(e.total) / max * 100;
      const parts = e.byPerson.map((c, p) => c ? `<div style="width:${c / e.total * w}%;background:${App.color(p)}"></div>` : '').join('');
      return `<div class="hbar"><span class="k"><i class="ti ${TYPE_ICON[e.k]}"></i>${esc(t('type_' + e.k))}</span>
        <div class="track">${parts}</div><span class="v">${num(e.total)}</span></div>`;
    }).join('');
    const note = st.chat.platform === 'android'
      ? `<div class="note"><i class="ti ti-info-circle"></i>${esc(t('android_types_note'))}</div>` : '';
    return `<div><div class="sec-h"><div class="t"><i class="ti ti-category"></i>${esc(t('what_gets_sent'))}</div></div>
      <div class="panel"><div class="hbars">${rows}</div>${note}</div></div>`;
  }

  function cloud(st) {
    const { t, esc } = App;
    const n = st.chat.people.length;
    if (local.cloudPerson != null && local.cloudPerson >= n) local.cloudPerson = null;
    const words = W.top(W.wordCounts(st.view, local.cloudPerson), 40);
    const max = words.length ? words[0][1] : 1;
    const shuffled = words.map((w, i) => [w, (i * 7919) % 97]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    const palette = ['var(--p1)', 'var(--p2)', 'var(--text)', 'var(--p3)', 'var(--label)'];
    const body = shuffled.map(([w, c], i) => {
      const size = 12 + Math.sqrt(c / max) * 36;
      return `<button data-word="${esc(w)}" style="font-size:${size.toFixed(0)}px;color:${palette[i % 5]};opacity:${(0.55 + 0.45 * Math.sqrt(c / max)).toFixed(2)}" title="${c}">${esc(w)}</button>`;
    }).join('');
    const who = n <= 6 ? `<span class="seg sm" id="cloudWho"><button data-p="" class="${local.cloudPerson == null ? 'on' : ''}">${esc(t('everyone'))}</button>` +
      st.chat.people.map((p, i) => `<button data-p="${i}" class="${local.cloudPerson === i ? 'on' : ''}">${esc(p)}</button>`).join('') + '</span>'
      : `<select id="cloudWhoSel"><option value="">${esc(t('everyone'))}</option>${st.chat.people.map((p, i) =>
        `<option value="${i}" ${local.cloudPerson === i ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>`;
    return `<div class="sec"><div class="sec-h"><div class="t"><i class="ti ti-cloud"></i>${esc(t('words'))}</div><div class="r">${who}</div></div>
      <div class="panel"><div class="cloud" id="cloud">${body || `<span class="dash">${esc(t('no_words'))}</span>`}</div>
      <div class="note"><i class="ti ti-pointer"></i>${esc(t('cloud_hint'))}</div></div></div>`;
  }

  /* Horizontal year strip: oldest year first, eases right toward the newest
   * (unless the user interferes); year buttons scroll a year's January to the
   * left edge; the active button follows the scroll. */
  function calendarScroll(root) {
    const wrap = root.querySelector('#calWrap');
    const btns = [...root.querySelectorAll('#calYears button')];
    const blocks = [...wrap.querySelectorAll('.cal-year')];
    const last = blocks[blocks.length - 1];
    const pad = wrap.clientWidth - last.offsetWidth;
    if (pad > 0) wrap.firstElementChild.style.paddingRight = pad + 'px';
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const glide = (to, ms) => {
      stop();
      const from = wrap.scrollLeft, t0 = performance.now();
      const step = now => {
        const k = Math.min(1, (now - t0) / ms);
        wrap.scrollLeft = from + (to - from) * (1 - Math.pow(1 - k, 3));
        raf = k < 1 ? requestAnimationFrame(step) : 0;
      };
      raf = requestAnimationFrame(step);
    };
    const left = i => blocks[i].offsetLeft - blocks[0].offsetLeft;
    const mark = () => {
      let cur = 0;
      blocks.forEach((b, i) => { if (left(i) <= wrap.scrollLeft + 8) cur = i; });
      btns.forEach((b, i) => b.classList.toggle('on', i === cur));
    };
    wrap.addEventListener('scroll', () => { local.scroll = wrap.scrollLeft; mark(); });
    ['wheel', 'pointerdown', 'touchstart'].forEach(ev => wrap.addEventListener(ev, stop, { passive: true }));
    root.querySelector('#calYears').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const i = btns.indexOf(b);
      still ? (wrap.scrollLeft = left(i)) : glide(left(i), 900);
    });
    if (local.scroll != null) { wrap.scrollLeft = local.scroll; mark(); return; }
    mark();
    if (still || blocks.length < 2) return;
    // Hold until the people modal is confirmed/closed, then slide to older years.
    const go = () => { if (wrap.isConnected && local.scroll == null) glide(left(blocks.length - 1), 900 + 800 * blocks.length); };
    if (App.state.awaitingRoster || (typeof ChatRosterView !== 'undefined' && ChatRosterView.isOpen())) {
      document.addEventListener('roster:closed', go, { once: true });
    } else go();
  }

  function render(root) {
    const st = App.state;
    if (!st.view.length) return App.emptyState(root);
    root.innerHTML = kpis(st) + calendar(st) +
      `<div class="grid2 sec">${share(st)}${types(st)}</div>` + cloud(st);

    root.querySelectorAll('[data-open-day]').forEach(b =>
      b.addEventListener('click', () => App.openMessages({ day: +b.dataset.openDay })));
    calendarScroll(root);
    const cal = root.querySelector('#cal');
    cal.addEventListener('mousemove', e => {
      const c = e.target.closest('[data-day]');
      if (!c) return App.hideTip();
      App.showTip(e, `<b>${App.esc(App.fmtDay(+c.dataset.day))}</b> · ${App.esc(App.t('n_messages', { n: App.num(+c.dataset.n) }))}`);
    });
    cal.addEventListener('mouseleave', App.hideTip);
    cal.addEventListener('click', e => {
      const c = e.target.closest('[data-day]');
      if (c && +c.dataset.n) { App.hideTip(); App.openMessages({ day: +c.dataset.day }); }
    });
    root.querySelector('#cloud').addEventListener('click', e => {
      const b = e.target.closest('[data-word]');
      if (b) App.openMessages({ search: b.dataset.word, person: local.cloudPerson });
    });
    const who = root.querySelector('#cloudWho');
    if (who) who.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) { local.cloudPerson = b.dataset.p === '' ? null : +b.dataset.p; render(root); }
    });
    const whoSel = root.querySelector('#cloudWhoSel');
    if (whoSel) whoSel.addEventListener('change', () => {
      local.cloudPerson = whoSel.value === '' ? null : +whoSel.value; render(root);
    });
  }

  App.register('overview', { render, reset() { local.scroll = null; local.cloudPerson = null; } });
})(App, ChatStats, ChatWords, ChatRange);
