'use strict';

/* Chat Wrapped: the numbers for the shareable card (model) and the canvas that
 * draws it (draw). The card has its own period and ignores the date bar.
 *
 * Privacy: the model never carries message text. The one exception, the top
 * word, is null unless showTopWord is set. Names come in from the caller, which
 * swaps them for "You"/"Them" when hiding names.
 *
 * model is pure and tested (tests/test_wrapped.js); draw needs a real canvas. */

const ChatWrapped = (function (R, S, P, W) {

  // The card is always dark — it is a shareable image, not a themed page — so
  // these are the dark-theme person colours, one per palette slot, inlined
  // because a canvas cannot read CSS custom properties.
  const PALETTE = { bg: '#0a0a0a', text: '#e8e8e0', muted: '#9a9a92', faint: '#555', accent: '#5FBF7A',
                    border: '#3A2C1D',
                    people: ['#5FBF7A', '#F5C518', '#4AA3C4', '#9B7FD4', '#E05A5A', '#D4608A',
                             '#E08A45', '#46C9B0', '#A8C24A', '#7E8FE0', '#B8865F', '#5FD2E0'] };
  const MIN_REPLIES = 5;

  function periods(first, last) {
    const out = [];
    for (let y = R.yearOfDay(first); y <= R.yearOfDay(last); y++) out.push(String(y));
    return out.concat(['all']);
  }

  function select(msgs, period) {
    if (period === 'all') return msgs;
    const y = +period;
    return R.filter(msgs, R.dayOfIso(y + '-01-01'), R.dayOfIso(y + '-12-31'));
  }

  function model(allMsgs, names, period, { showTopWord = false } = {}) {
    const msgs = select(allMsgs, period);
    const n = names.length;
    const hours = S.hours(msgs);
    const peak = msgs.length ? hours.indexOf(Math.max(...hours)) : null;
    const emoji = W.top(W.emojiCounts(msgs), 1)[0] || null;
    const gaps = P.replyGaps(msgs, n);
    let fastest = null;
    gaps.forEach((g, p) => {
      if (g.length < MIN_REPLIES) return;
      const med = P.median(g);
      if (!fastest || med < fastest.sec) fastest = { p, name: names[p], sec: med };
    });
    const share = S.share(msgs, n, Infinity);
    const top3 = share.slice(0, 3).map(e => ({ p: e.p, name: names[e.p], pct: e.pct }));
    const word = showTopWord ? (W.top(W.wordCounts(msgs), 1)[0] || [null])[0] : null;
    return {
      period,
      total: msgs.length,
      streak: S.streaks(msgs, null).longest.len,
      busiest: S.busiestDay(msgs),
      peakHour: peak,
      topEmoji: emoji,
      fastest,
      topWord: word,
      split: top3,
      more: Math.max(0, share.length - 3),
    };
  }

  // ---------- drawing ----------

  function fit(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    let s = text;
    // Array.from splits by Unicode code point, not UTF-16 code unit, so this
    // never cuts a surrogate pair (e.g. an emoji) in half.
    while (s.length > 1 && ctx.measureText(s + '…').width > max) s = Array.from(s).slice(0, -1).join('');
    return s + '…';
  }

  /* card: { kicker, title, sub, big, bigLabel, cells: [[label, value, small]],
   *         split: [{ name, pct, color }], footL, footR, brand }
   * fmt: 'story' (360×640) or 'square' (360×360), drawn at `scale`. */
  function draw(canvas, card, fmt = 'story', scale = 3) {
    const Wd = 360, H = fmt === 'story' ? 640 : 360, pad = 26;
    canvas.width = Wd * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.textBaseline = 'alphabetic';
    const C = PALETTE;

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, Wd, H);

    // The record in the corner: grooves, then the green label.
    const cx = Wd + 50, cy = -50;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, 170, 0, Math.PI * 2); ctx.fillStyle = '#121212'; ctx.fill();
    ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 1;
    for (let r = 70; r < 170; r += 4) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(cx, cy, 58, 0, Math.PI * 2); ctx.fillStyle = C.accent; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fillStyle = C.bg; ctx.fill();
    ctx.restore();

    let y = pad + 14;
    ctx.fillStyle = C.accent;
    ctx.font = "700 12px 'Courier Prime', monospace";
    ctx.fillText(card.kicker.toUpperCase(), pad, y);

    y += 38;
    ctx.fillStyle = C.text;
    ctx.font = "800 32px Inter, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'";
    ctx.fillText(fit(ctx, card.title, Wd - pad * 2 - 60), pad, y);
    y += 22;
    ctx.fillStyle = C.muted;
    ctx.font = "500 13px Inter, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'";
    ctx.fillText(fit(ctx, card.sub, Wd - pad * 2), pad, y);

    y += fmt === 'story' ? 76 : 58;
    ctx.fillStyle = C.text;
    ctx.font = `800 ${fmt === 'story' ? 64 : 52}px Inter, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'`;
    ctx.fillText(card.big, pad, y);
    y += 20;
    ctx.fillStyle = C.muted;
    ctx.font = "600 12px Inter, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'";
    ctx.fillText(card.bigLabel.toUpperCase(), pad, y);

    const cells = fmt === 'story' ? card.cells : card.cells.slice(0, 2);
    const colW = (Wd - pad * 2 - 14) / 2;
    const barY = H - pad - 58;
    y += fmt === 'story' ? 40 : 30;
    // Spread the rows over the space above the split bar, so a story card
    // with few cells doesn't leave a hole in the middle.
    const rows = Math.ceil(cells.length / 2) || 1;
    const rowH = Math.min(96, Math.max(58, (barY - 40 - y) / rows));
    cells.forEach((cell, i) => {
      const x = pad + (i % 2) * (colW + 14);
      const yy = y + Math.floor(i / 2) * rowH;
      ctx.fillStyle = C.muted;
      ctx.font = "600 10px Inter, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'";
      ctx.fillText(cell[0].toUpperCase(), x, yy);
      ctx.fillStyle = C.text;
      ctx.font = "800 20px Inter, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'";
      const v = fit(ctx, cell[1], colW - 4);
      ctx.fillText(v, x, yy + 26);
      if (cell[2]) {
        const w = ctx.measureText(v + ' ').width;
        ctx.fillStyle = C.muted;
        ctx.font = "600 12px Inter, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'";
        ctx.fillText(fit(ctx, cell[2], colW - w - 4), x + w, yy + 26);
      }
    });

    // Split bar + names, then the brand line.
    let bx = pad;
    const barW = Wd - pad * 2;
    card.split.forEach(s => {
      ctx.fillStyle = s.color;
      ctx.fillRect(bx, barY, s.pct * barW, 10);
      bx += s.pct * barW;
    });
    if (bx < pad + barW) { ctx.fillStyle = C.faint; ctx.fillRect(bx, barY, pad + barW - bx, 10); }
    ctx.font = "400 11px 'Courier Prime', monospace";
    ctx.fillStyle = C.muted;
    ctx.fillText(fit(ctx, card.footL, barW / 2 - 6), pad, barY + 26);
    ctx.textAlign = 'right';
    ctx.fillText(fit(ctx, card.footR, barW / 2 - 6), Wd - pad, barY + 26);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.faint;
    ctx.font = "700 10px 'Courier Prime', monospace";
    ctx.fillText(card.brand.toUpperCase(), pad, H - pad);
    return canvas;
  }

  return { PALETTE, MIN_REPLIES, periods, select, model, draw };
})(
  typeof ChatRange !== 'undefined' ? ChatRange : require('./range.js'),
  typeof ChatStats !== 'undefined' ? ChatStats : require('./stats.js'),
  typeof ChatPeople !== 'undefined' ? ChatPeople : require('./people.js'),
  typeof ChatWords !== 'undefined' ? ChatWords : require('./words.js'),
);

if (typeof module !== 'undefined' && module.exports) module.exports = ChatWrapped;
