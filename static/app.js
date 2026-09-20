'use strict';

/* The shell: state, upload, tabs, date bar, theme, language and the URL hash.
 *
 * Each tab is a view module (static/view-*.js) that registers itself with
 * App.register(name, render). render(root) rebuilds its pane from App state.
 * Only the visible tab renders; the others are marked dirty and render when
 * opened, so a range change on a 100k chat never draws five tabs. */

const App = (function (R, Roster) {

  const TABS = ['overview', 'activity', 'people', 'messages', 'wrapped'];
  const $ = id => document.getElementById(id);

  const state = {
    raw: null,       // the /api/parse response, never mutated
    roster: null,    // the user's configuration over it
    suggestions: [], // probable duplicate identities, computed once per upload
    chat: null,      // raw projected through roster — shaped like the API response
    msgs: [],        // every prepared message
    view: [],        // messages in the date range
    first: 0, last: 0, from: 0, to: 0,
    presets: [],
    tab: 'overview',
    lang: 'en',
    hashRange: null, // from/to decoded from the URL hash, consumed by the first applyRoster
  };
  const views = {};
  const dirty = new Set(TABS);

  // ---------- helpers shared by the views ----------

  function t(key, vars) { return ChatI18n.t(state.lang, key, vars); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function num(n, digits = 0) {
    return new Intl.NumberFormat(state.lang, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
  }

  function pct(f) { return num(Math.round(f * 100)) + '%'; }

  /* Days are UTC-encoded wall clock, so format them in UTC. */
  function fmtDay(day, opts = { year: 'numeric', month: 'short', day: 'numeric' }) {
    return new Intl.DateTimeFormat(state.lang, Object.assign({ timeZone: 'UTC' }, opts)).format(new Date(day * 864e5));
  }

  function fmtTime(ts) {
    return new Date(ts * 1000).toISOString().slice(11, 16);
  }

  function weekdayName(wd, style = 'short') {
    // 2023-01-01 was a Sunday: day 19358.
    return fmtDay(19358 + wd, { weekday: style });
  }

  function fmtDuration(sec) {
    if (sec == null) return '—';
    if (sec < 60) return Math.round(sec) + ' s';
    if (sec < 3600) return Math.round(sec / 60) + ' min';
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return m ? `${h} h ${m}` : `${h} h`;
  }

  const SLOTS = 12;

  /* A palette slot (0-11) → its CSS variable. The one place a slot becomes a
   * colour; everything else goes through here or through color(p). */
  function slotVar(slot) { return `--p${((slot % SLOTS) + SLOTS) % SLOTS + 1}`; }

  function slotColor(slot) { return `var(${slotVar(slot)})`; }

  function slotColorValue(slot) { return cssValue(slotVar(slot)); }

  function cssValue(v) {
    return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  }

  /* p indexes the PROJECTED chat (state.chat.people), so its colour comes from
   * the roster's slot for that person. The modal lists excluded people too, who
   * have no projected index — it uses slotColor(entry.color) directly instead. */
  function slotOf(p) {
    const c = state.chat && state.chat.colors;
    return c && c[p] != null ? c[p] : p % SLOTS;
  }

  function color(p) { return p < 0 ? 'var(--muted)' : slotColor(slotOf(p)); }

  /* The resolved colour, for canvas and inline SVG fills. */
  function colorValue(p) {
    return p < 0 ? cssValue('--muted') : slotColorValue(slotOf(p));
  }

  function name(p) { return p < 0 ? t('others') : state.chat.people[p]; }

  const tip = () => $('tip');
  function showTip(e, html) {
    const el = tip();
    el.innerHTML = html;
    el.classList.remove('hidden');
    const x = Math.min(e.clientX + 12, window.innerWidth - el.offsetWidth - 8);
    el.style.left = x + 'px';
    el.style.top = (e.clientY + 14) + 'px';
  }
  function hideTip() { tip().classList.add('hidden'); }

  function emptyState(root, key = 'no_messages_range') {
    root.innerHTML = `<div class="empty"><i class="ti ti-message-off"></i>${esc(t(key))}</div>`;
  }

  // ---------- i18n + theme ----------

  function applyI18n() {
    document.documentElement.lang = state.lang === 'pt' ? 'pt-BR' : 'en';
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
    document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
    $('langSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.lang === state.lang));
  }

  function setLang(lang) {
    state.lang = lang;
    applyI18n();
    renderHeader();
    if (state.chat) { renderDatebar(); invalidate(); writeHash(); }
  }

  function storage(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) { return null; }
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $('themeBtn').innerHTML = theme === 'dark' ? '<i class="ti ti-sun"></i>' : '<i class="ti ti-moon"></i>';
    storage('chat-theme', theme);
    if (state.chat) invalidate();  // SVG/canvas colours are resolved at render time
  }

  // ---------- upload ----------

  const ERRORS = ['no_file', 'bad_type', 'too_large', 'empty_zip', 'unparseable', 'no_messages', 'internal', 'network'];

  function showError(code) {
    const el = $('dropError');
    const known = ERRORS.includes(code) ? code : 'internal';
    const help = known === 'internal' || known === 'network' ? t('error_help') : '';
    el.innerHTML = `<b>${esc(t('err_' + known))}</b>${help ? '<br>' + help : ''} <code>(${esc(code)})</code>`;
    el.classList.remove('hidden');
  }

  async function upload(file) {
    if (!file) return;
    $('dropError').classList.add('hidden');
    const drop = $('dropzone');
    drop.classList.add('busy');
    $('dropTitle').textContent = t('reading', { mb: num(file.size / 1048576, 1) });
    const body = new FormData();
    body.append('file', file);
    try {
      const res = await fetch('/api/parse', { method: 'POST', body });
      let json = null;
      try { json = await res.json(); } catch (e) { /* non-JSON error page */ }
      if (!res.ok) { showError((json && json.error) || (res.status === 413 ? 'too_large' : 'internal')); return; }
      load(json);
    } catch (e) {
      showError('network');
    } finally {
      drop.classList.remove('busy');
      $('dropTitle').textContent = t('drop_title');
      $('fileInput').value = '';
    }
  }

  // ---------- loading a chat ----------

  function load(chat) {
    state.raw = chat;
    state.roster = Roster.initial(chat);
    state.suggestions = Roster.suggest(chat);
    const h = R.decodeHash(location.hash);
    state.lang = h.lang || chat.language || state.lang;
    state.tab = TABS.includes(h.tab) ? h.tab : 'overview';
    state.hashRange = { from: h.from, to: h.to };
    $('landing').classList.add('hidden');
    $('appView').classList.remove('hidden');
    document.querySelectorAll('.chat-only').forEach(el => el.classList.remove('hidden'));
    applyRoster();
    showTab(state.tab);
    if (typeof ChatRosterView !== 'undefined') { ChatRosterView.newChat(); ChatRosterView.open(); }
  }

  /* Project the raw chat through the current roster and rebuild everything that
   * hangs off it. Called on load and whenever the roster changes; the range is
   * re-validated because excluding people can shrink the chat's span. */
  function applyRoster() {
    state.chat = Roster.apply(state.raw, state.roster);
    state.msgs = R.prepare(state.chat);
    state.first = R.dayOfIso(state.chat.start);
    state.last = R.dayOfIso(state.chat.end);
    state.presets = R.presets(state.first, state.last);
    const want = state.hashRange || { from: state.from, to: state.to };
    state.hashRange = null;
    const v = R.validate(want.from ?? state.first, want.to ?? state.last, state.first, state.last);
    state.from = v.error ? state.first : v.from;
    state.to = v.error ? state.last : v.to;
    if (state.from > state.to) { state.from = state.first; state.to = state.last; }
    state.view = R.filter(state.msgs, state.from, state.to);
    Object.keys(views).forEach(k => views[k].reset && views[k].reset());
    applyI18n();
    renderHeader();
    renderDatebar();
    invalidate();
    writeHash();
  }

  function unload() {
    state.chat = state.raw = state.roster = null;
    state.suggestions = [];
    state.msgs = state.view = [];
    $('appView').classList.add('hidden');
    $('landing').classList.remove('hidden');
    document.querySelectorAll('.chat-only').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('[data-pane]').forEach(p => { p.innerHTML = ''; });
    $('rosterModal').innerHTML = '';
    history.replaceState(null, '', location.pathname);
    renderHeader();
  }

  function renderHeader() {
    const sub = $('chatSub');
    if (!state.chat) { sub.textContent = t('tagline'); return; }
    const c = state.chat;
    const who = c.title || (c.people.length <= 3 ? c.people.join(' & ') : t('n_people', { n: c.people.length }));
    const off = state.roster
      ? state.roster.entries.reduce((n, e) => n + (e.on ? 0 : e.src.length), 0) : 0;
    sub.innerHTML = `<b>${esc(who)}</b> · ${esc(t('n_messages', { n: num(state.msgs.length) }))} · ` +
      `${esc(t(c.platform === 'ios' ? 'iphone_export' : 'android_export'))} · ${esc(t('lang_' + c.language))}` +
      (off ? ` · ${esc(t('roster_excluded', { n: num(off) }))}` : '');
  }

  // ---------- date bar ----------

  function renderDatebar() {
    const active = R.presetFor(state.presets, state.from, state.to);
    $('presets').innerHTML = state.presets.map(p =>
      `<button data-preset="${p.id}" class="${p.id === active ? 'on' : ''}">${esc(p.label || t('preset_' + p.id))}</button>`).join('');
    for (const [id, day] of [['fromIn', state.from], ['toIn', state.to]]) {
      const el = $(id);
      el.min = state.chat.start;
      el.max = state.chat.end;
      el.value = R.isoOfDay(day);
    }
    $('rangeInfo').innerHTML = t('range_info', {
      days: `<b>${num(state.to - state.from + 1)}</b>`, msgs: `<b>${num(state.view.length)}</b>`,
    });
  }

  function setRange(from, to) {
    const v = R.validate(from, to, state.first, state.last);
    $('rangeWarn').classList.toggle('hidden', !v.error);
    if (v.error) return;
    state.from = v.from;
    state.to = v.to;
    state.view = R.filter(state.msgs, state.from, state.to);
    renderDatebar();
    invalidate();
    writeHash();
  }

  // ---------- tabs ----------

  function register(name, view) { views[name] = view; }

  function invalidate() {
    TABS.forEach(tab => dirty.add(tab));
    renderTab();
  }

  function renderTab() {
    const tab = state.tab;
    if (!state.chat || !dirty.has(tab) || !views[tab]) return;
    dirty.delete(tab);
    views[tab].render(document.querySelector(`[data-pane="${tab}"]`));
  }

  function showTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== tab));
    renderTab();
    writeHash();
  }

  /* Cross-tab entry point: calendar day, busiest day, heatmap cell, word,
   * person card → Messages with those filters. */
  function openMessages(filters) {
    views.messages.focus(filters);
    dirty.add('messages');
    showTab('messages');
    window.scrollTo(0, 0);
  }

  function writeHash() {
    if (!state.chat) return;
    const h = R.encodeHash({ tab: state.tab, from: state.from, to: state.to, lang: state.lang });
    if (h !== location.hash) history.replaceState(null, '', h);
  }

  // ---------- boot ----------

  function boot() {
    const saved = storage('chat-theme');
    setTheme(saved === 'light' || saved === 'dark' ? saved : 'dark');
    const h = R.decodeHash(location.hash);
    state.lang = h.lang || ChatI18n.detect(navigator.language);
    applyI18n();
    renderHeader();

    $('langSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setLang(b.dataset.lang); });
    $('themeBtn').addEventListener('click', () =>
      setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
    $('newChatBtn').addEventListener('click', unload);
    $('rosterBtn').addEventListener('click', () => ChatRosterView.open());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && typeof ChatRosterView !== 'undefined' && ChatRosterView.isOpen()) ChatRosterView.close();
    });

    const drop = $('dropzone'), input = $('fileInput');
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => upload(input.files[0]));
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('over');
      upload(e.dataTransfer.files[0]);
    });

    $('tabs').addEventListener('click', e => { const b = e.target.closest('.nav-tab'); if (b) showTab(b.dataset.tab); });
    $('presets').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const p = state.presets.find(x => x.id === b.dataset.preset);
      setRange(p.from, p.to);
    });
    const onDate = () => setRange(R.dayOfIso($('fromIn').value), R.dayOfIso($('toIn').value));
    $('fromIn').addEventListener('change', onDate);
    $('toIn').addEventListener('change', onDate);

    $('exportBtn').addEventListener('click', e => { e.stopPropagation(); $('exportMenu').classList.toggle('hidden'); });
    document.addEventListener('click', () => $('exportMenu').classList.add('hidden'));
    $('exportMenu').addEventListener('click', e => {
      const b = e.target.closest('[data-export]');
      if (b) ChatExport.download(b.dataset.export, state.view, {
        names: state.chat.people, typeLabel: k => t('type_' + k), weekdayLabel: wd => weekdayName(wd, 'long'),
        headers: ['col_time', 'col_sender', 'col_message', 'col_type', 'col_weekday'].map(k => t(k)),
      });
    });
  }

  return { state, t, esc, num, pct, fmtDay, fmtTime, weekdayName, fmtDuration, color, colorValue, slotColor, slotColorValue, name,
           showTip, hideTip, emptyState, register, openMessages, setRange, boot, load, applyRoster };
})(typeof ChatRange !== 'undefined' ? ChatRange : require('./range.js'),
   typeof ChatRoster !== 'undefined' ? ChatRoster : require('./roster.js'));

if (typeof module !== 'undefined' && module.exports) module.exports = App;
