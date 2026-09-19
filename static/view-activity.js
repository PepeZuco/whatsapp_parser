'use strict';

/* Activity tab: messages over time, weekday × hour heatmap, by hour, and who
 * opens / closes the day and starts conversations. */

(function (App, S, P, R) {

  const local = { gran: 'week', fill: true, heatMode: 'count' };

  function lineChart(st) {
    const n = st.chat.people.length;
    const s = S.series(st.view, st.from, st.to, local.gran, n, local.fill);
    const W = 1000, H = 240, L = 44, B = 24, T = 10, Rt = 10;
    const count = s.buckets.length;
    let max = 1;
    s.lines.forEach(l => l.values.forEach(v => { if (v > max) max = v; }));
    const x = i => L + (count > 1 ? i * (W - L - Rt) / (count - 1) : (W - L - Rt) / 2);
    const y = v => T + (H - B - T) * (1 - v / max);
    let g = '';
    for (let k = 0; k <= 4; k++) {
      const v = max * k / 4, yy = y(v).toFixed(1);
      g += `<line class="gridl" x1="${L}" x2="${W - Rt}" y1="${yy}" y2="${yy}"/><text x="${L - 6}" y="${+yy + 3}" text-anchor="end">${App.num(Math.round(v))}</text>`;
    }
    // One x label per ~8 slots, formatted to the granularity.
    const every = Math.max(1, Math.ceil(count / 8));
    // Ranges over a year need the year on the axis; shorter ones need the day.
    const fmt = local.gran === 'month' || st.to - st.from > 365 ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' };
    for (let i = 0; i < count; i += every) {
      g += `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${App.esc(App.fmtDay(s.buckets[i], fmt))}</text>`;
    }
    const lines = s.lines.slice().reverse().map(l => {
      const pts = l.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${App.colorValue(l.p)}" stroke-width="1.8" stroke-linejoin="round"/>`;
    }).join('');
    const legend = s.lines.map(l => `<div class="who"><span class="dot" style="background:${App.color(l.p)}"></span>${App.esc(App.name(l.p))}</div>`).join('');
    local.series = s;
    local.geom = { x, W, L, Rt, H, B, T, count };
    return `<svg id="lineSvg" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${g}${lines}
      <line class="axis" x1="${L}" x2="${W - Rt}" y1="${y(0)}" y2="${y(0)}"/><line id="cross" class="cross hidden" y1="${T}" y2="${H - B}"/></svg>
      <div class="who-list row">${legend}</div>`;
  }

  function heatmap(st) {
    const { esc, num } = App;
    const m = S.heatmap(st.view);
    const total = st.view.length || 1;
    let max = 1;
    m.forEach(r => r.forEach(v => { if (v > max) max = v; }));
    let html = '<span></span>' + Array.from({ length: 24 }, (_, h) => `<span class="cl">${h}</span>`).join('');
    m.forEach((row, wd) => {
      html += `<span class="rl">${esc(App.weekdayName(wd))}</span>`;
      row.forEach((v, h) => {
        const a = v / max;
        const label = local.heatMode === 'pct' ? (v / total * 100).toFixed(1) : (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v);
        html += `<button class="hc" data-wd="${wd}" data-h="${h}" data-v="${v}" style="background:rgba(var(--accent-rgb),${(0.06 + a * 0.94).toFixed(3)});color:${a > 0.55 ? '#0c0c0c' : 'var(--label)'}">${v ? label : ''}</button>`;
      });
    });
    return html;
  }

  function hours(st) {
    const h = S.hours(st.view);
    const max = Math.max(...h, 1);
    return `<div class="hours" id="hours">${h.map((v, i) => `<div class="col" data-h="${i}" data-v="${v}"><div class="bar" style="height:${v / max * 100}%"></div></div>`).join('')}</div>
      <div class="sky"></div><div class="hlabels">${h.map((_, i) => `<span>${i % 3 === 0 ? i : ''}</span>`).join('')}</div>`;
  }

  function shareOf(counts) {
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    const ranked = counts.map((c, p) => ({ p, count: c, pct: c / total })).filter(e => e.count).sort((a, b) => b.count - a.count);
    if (ranked.length <= 6) return ranked;
    const rest = ranked.slice(6).reduce((s, e) => s + e.count, 0);
    return ranked.slice(0, 6).concat([{ p: -1, count: rest, pct: rest / total }]);
  }

  function bar(entries) {
    return `<div class="share">${entries.map(e =>
      `<div style="width:${e.pct * 100}%;background:${App.color(e.p)}" title="${App.esc(App.name(e.p))} · ${App.num(e.count)}">${e.pct >= 0.12 ? App.pct(e.pct) : ''}</div>`).join('')}</div>`;
  }

  function opensCloses(st) {
    const { t, esc } = App;
    const n = st.chat.people.length;
    if (n < 2) return `<div class="dash">${esc(t('needs_two'))}</div>`;
    const fl = P.firstLast(st.view, n);
    const starters = P.starters(st.view, n);
    const legend = st.chat.people.slice(0, 6).map((p, i) => `<div class="who"><span class="dot" style="background:${App.color(i)}"></span>${esc(p)}</div>`).join('');
    return `<div class="fl-row"><span class="k"><i class="ti ti-sunrise" style="color:var(--p2)"></i>${esc(t('first_message'))}</span>${bar(shareOf(fl.first))}</div>
      <div class="fl-row"><span class="k"><i class="ti ti-moon" style="color:var(--p3)"></i>${esc(t('last_message'))}</span>${bar(shareOf(fl.last))}</div>
      <div class="fl-row"><span class="k"><i class="ti ti-message-plus" style="color:var(--accent)"></i>${esc(t('starts_convos'))}</span>${bar(shareOf(starters))}</div>
      <div class="who-list row">${legend}</div>
      <div class="note"><i class="ti ti-info-circle"></i>${esc(t('starter_note'))}</div>`;
  }

  function seg(id, options, current) {
    return `<span class="seg sm" id="${id}">${options.map(([v, label]) =>
      `<button data-v="${v}" class="${v === current ? 'on' : ''}">${App.esc(label)}</button>`).join('')}</span>`;
  }

  function render(root) {
    const st = App.state;
    const { t, esc } = App;
    if (!st.view.length) return App.emptyState(root);
    root.innerHTML = `
      <div class="sec"><div class="sec-h"><div class="t"><i class="ti ti-chart-line"></i>${esc(t('over_time'))}</div>
        <div class="r">${seg('gran', [['day', t('gran_day')], ['week', t('gran_week')], ['month', t('gran_month')]], local.gran)}
          <label class="check" style="margin:0 0 0 8px"><input type="checkbox" id="fill" ${local.fill ? 'checked' : ''} ${local.gran !== 'day' ? 'disabled' : ''}>
          <span title="${esc(t('fill_help'))}">${esc(t('fill_empty'))}</span></label></div></div>
        <div class="panel">${lineChart(st)}</div></div>
      <div class="sec"><div class="sec-h"><div class="t"><i class="ti ti-grid-dots"></i>${esc(t('when_heatmap'))}</div>
        <div class="r">${seg('heatMode', [['count', t('heat_count')], ['pct', t('heat_pct')]], local.heatMode)}</div></div>
        <div class="panel"><div class="heat-wrap"><div class="heat" id="heat">${heatmap(st)}</div></div>
        <div class="note"><i class="ti ti-pointer"></i>${esc(t('heat_hint'))}</div></div></div>
      <div class="grid3 sec">
        <div><div class="sec-h"><div class="t"><i class="ti ti-clock-hour-4"></i>${esc(t('by_hour'))}</div></div><div class="panel">${hours(st)}</div></div>
        <div><div class="sec-h"><div class="t"><i class="ti ti-sunrise"></i>${esc(t('opens_closes'))}</div></div><div class="panel">${opensCloses(st)}</div></div>
      </div>`;

    root.querySelector('#gran').addEventListener('click', e => {
      const b = e.target.closest('button'); if (b) { local.gran = b.dataset.v; render(root); }
    });
    root.querySelector('#fill').addEventListener('change', e => { local.fill = e.target.checked; render(root); });
    root.querySelector('#heatMode').addEventListener('click', e => {
      const b = e.target.closest('button'); if (b) { local.heatMode = b.dataset.v; render(root); }
    });

    const svg = root.querySelector('#lineSvg'), cross = root.querySelector('#cross');
    svg.addEventListener('mousemove', e => {
      const g = local.geom, s = local.series;
      if (!g.count) return;
      const rect = svg.getBoundingClientRect();
      const vx = (e.clientX - rect.left) / rect.width * g.W;
      const i = Math.max(0, Math.min(g.count - 1, Math.round((vx - g.L) / ((g.W - g.L - g.Rt) / Math.max(1, g.count - 1)))));
      cross.setAttribute('x1', g.x(i)); cross.setAttribute('x2', g.x(i));
      cross.classList.remove('hidden');
      const rows = s.lines.map(l => `<span style="color:${App.color(l.p)}">●</span> ${esc(App.name(l.p))}: <b>${App.num(l.values[i])}</b>`).join('<br>');
      App.showTip(e, `<b>${esc(App.fmtDay(s.buckets[i]))}</b><br>${rows}`);
    });
    svg.addEventListener('mouseleave', () => { cross.classList.add('hidden'); App.hideTip(); });

    const heat = root.querySelector('#heat');
    heat.addEventListener('mousemove', e => {
      const c = e.target.closest('.hc');
      if (!c) return App.hideTip();
      App.showTip(e, `<b>${esc(App.weekdayName(+c.dataset.wd, 'long'))} ${c.dataset.h}:00</b> · ${esc(t('n_messages', { n: App.num(+c.dataset.v) }))}`);
    });
    heat.addEventListener('mouseleave', App.hideTip);
    heat.addEventListener('click', e => {
      const c = e.target.closest('.hc');
      if (c && +c.dataset.v) { App.hideTip(); App.openMessages({ slot: { wd: +c.dataset.wd, h: +c.dataset.h } }); }
    });

    const hrs = root.querySelector('#hours');
    hrs.addEventListener('mousemove', e => {
      const c = e.target.closest('.col');
      if (!c) return App.hideTip();
      App.showTip(e, `<b>${c.dataset.h}:00</b> · ${esc(t('n_messages', { n: App.num(+c.dataset.v) }))}`);
    });
    hrs.addEventListener('mouseleave', App.hideTip);
  }

  App.register('activity', { render });
})(App, ChatStats, ChatPeople, ChatRange);
