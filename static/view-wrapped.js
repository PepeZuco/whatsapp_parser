'use strict';

/* Wrapped tab: the card is drawn straight onto the canvas that is shown, so
 * the preview and the downloaded PNG are the same pixels. */

(function (App, Wr) {

  const local = { period: null, hideNames: false, showTopWord: false, fmt: 'story' };

  function names(n) {
    const real = App.state.chat.people;
    if (!local.hideNames) return real;
    if (n === 2) return [App.t('you'), App.t('them')];
    return real.map((_, i) => App.t('person_n', { n: i + 1 }));
  }

  function card(m, nm) {
    const { t, num, fmtDay, fmtDuration } = App;
    const title = App.state.chat.title && !local.hideNames ? App.state.chat.title
      : nm.slice(0, 2).join(' & ') + (nm.length > 2 ? ` +${nm.length - 2}` : '');
    const cells = [
      [t('w_streak'), num(m.streak), t('days')],
      [t('w_busiest'), m.busiest ? fmtDay(m.busiest.day, { day: 'numeric', month: 'short' }) : '—', m.busiest ? num(m.busiest.count) : ''],
      [t('w_peak_hour'), m.peakHour == null ? '—' : `${m.peakHour}h`, ''],
      [t('w_top_emoji'), m.topEmoji ? m.topEmoji[0] : '—', m.topEmoji ? '×' + num(m.topEmoji[1]) : ''],
      [t('w_fastest'), m.fastest ? m.fastest.name : '—', m.fastest ? fmtDuration(m.fastest.sec) : ''],
    ];
    if (m.topWord) cells.push([t('w_top_word'), `"${m.topWord}"`, '']);
    const colors = Wr.PALETTE.people, slots = App.state.chat.colors;
    const slot = p => (slots && slots[p] != null ? slots[p] : p) % colors.length;
    const split = m.split.map(s => ({ name: s.name, pct: s.pct, color: colors[slot(s.p)] }));
    const foot = s => s ? `${s.name} ${Math.round(s.pct * 100)}%` : '';
    return {
      kicker: m.period === 'all' ? t('w_all_time') : t('w_year_in_chat', { year: m.period }),
      title,
      sub: m.period === 'all'
        ? `${fmtDay(App.state.first, { month: 'short', year: 'numeric' })} – ${fmtDay(App.state.last, { month: 'short', year: 'numeric' })}`
        : t('w_sub'),
      big: num(m.total),
      bigLabel: t('w_messages_sent'),
      cells,
      split,
      footL: foot(split[0]),
      footR: split.length > 1 ? foot(split[1]) + (m.more ? ` +${m.more}` : '') : '',
      brand: '● Chat Analyzer',
    };
  }

  function draw(canvas) {
    const st = App.state;
    const nm = names(st.chat.people.length);
    const m = Wr.model(st.msgs, nm, local.period, { showTopWord: local.showTopWord });
    Wr.draw(canvas, card(m, nm), local.fmt, 3);
  }

  function seg(id, opts, cur) {
    return `<span class="seg" id="${id}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${App.esc(l)}</button>`).join('')}</span>`;
  }

  function render(root) {
    const st = App.state;
    const { t, esc } = App;
    const periods = Wr.periods(st.first, st.last);
    if (!periods.includes(local.period)) local.period = periods[Math.max(0, periods.length - 2)];
    const canCopy = typeof window.ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write;
    root.innerHTML = `<div class="wr-layout">
      <canvas id="wrappedCanvas" aria-label="${esc(t('tab_wrapped'))}"></canvas>
      <div class="wr-opts">
        <div class="panel"><div class="l">${esc(t('w_period'))}</div>${seg('wPeriod', periods.map(p => [p, p === 'all' ? t('w_all_time') : p]), local.period)}
          <div class="note"><i class="ti ti-info-circle"></i>${esc(t('w_period_note'))}</div></div>
        <div class="panel"><div class="l">${esc(t('w_privacy'))}</div>
          <label class="check" style="margin-top:0"><input type="checkbox" id="wHide" ${local.hideNames ? 'checked' : ''}>${esc(t('w_hide_names'))}</label>
          <label class="check"><input type="checkbox" id="wWord" ${local.showTopWord ? 'checked' : ''}>${esc(t('w_show_word'))}</label>
          <div class="note"><i class="ti ti-shield-lock"></i>${esc(t('w_privacy_note'))}</div></div>
        <div class="panel"><div class="l">${esc(t('w_format'))}</div>${seg('wFmt', [['story', t('w_story')], ['square', t('w_square')]], local.fmt)}</div>
        <div class="wr-actions"><button class="btn btn-primary" id="wDownload"><i class="ti ti-download"></i>${esc(t('w_download'))}</button>
          ${canCopy ? `<button class="btn" id="wCopy"><i class="ti ti-copy"></i>${esc(t('w_copy'))}</button>` : ''}</div>
      </div></div>`;
    const canvas = root.querySelector('#wrappedCanvas');
    // Inter / Courier Prime must be loaded before the canvas measures text.
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => draw(canvas));

    const redraw = () => draw(canvas);
    root.querySelector('#wPeriod').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { local.period = b.dataset.v; render(root); } });
    root.querySelector('#wFmt').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { local.fmt = b.dataset.v; render(root); } });
    root.querySelector('#wHide').addEventListener('change', e => { local.hideNames = e.target.checked; redraw(); });
    root.querySelector('#wWord').addEventListener('change', e => { local.showTopWord = e.target.checked; redraw(); });
    root.querySelector('#wDownload').addEventListener('click', () => canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `chat-wrapped-${local.period}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png'));
    const copy = root.querySelector('#wCopy');
    if (copy) copy.addEventListener('click', () => canvas.toBlob(async blob => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        copy.innerHTML = `<i class="ti ti-check"></i>${esc(t('w_copied'))}`;
      } catch (e) {
        copy.innerHTML = `<i class="ti ti-x"></i>${esc(t('w_copy_failed'))}`;
      }
    }, 'image/png'));
  }

  App.register('wrapped', { render, reset() {
    Object.assign(local, { period: null, hideNames: false, showTopWord: false, fmt: 'story' });
  } });
})(App, ChatWrapped);
