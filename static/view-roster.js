'use strict';

/* The participants modal: who is in the analysis, what colour each person is,
 * and which names are really one person.
 *
 * All the rules live in roster.js — this file only renders a roster and turns
 * clicks, drags and keystrokes into ChatRoster calls. It edits a draft copy, so
 * closing without applying leaves App.state.roster exactly as it was. */

const ChatRosterView = (function (App, Roster) {

  const $ = id => document.getElementById(id);

  // draft: the roster being edited. dismissed: suggestion keys the user rejected,
  // kept for the life of the upload so a rejected guess never comes back.
  const local = { draft: null, open: -1, menu: -1, dismissed: new Set(), refocus: null, returnTo: null };

  function chat() { return App.state.raw; }

  /* Canonical key for a suggested pair. suggest() orders each pair by message
   * count, so `a` is not always the lower index — the reader here and the writer
   * in the banner (Task 9) must agree on one spelling, or a dismissal silently
   * fails to stick. */
  function suggKey(x, y) { return Math.min(x, y) + ':' + Math.max(x, y); }

  function suggestions() {
    return App.state.suggestions.filter(s =>
      !local.dismissed.has(suggKey(s.a, s.b)) && !Roster.sameEntry(local.draft, s.a, s.b));
  }

  function row(e, i, count, max) {
    const { esc, num, t } = App;
    const merged = e.src.length > 1;
    const body = merged
      ? `<input class="ros-name" id="rosName${i}" value="${esc(e.name)}" aria-label="${esc(e.name)}">`
      : `<span class="nm">${esc(e.name)}</span>
         <span class="ros-bar"><div style="width:${max ? count / max * 100 : 0}%;background:${App.slotColor(e.color)}"></div></span>`;
    const action = merged
      ? `<button class="ros-act" data-split="${i}" title="${esc(t('roster_unmerge'))}" aria-label="${esc(t('roster_unmerge'))}"><i class="ti ti-unlink"></i></button>`
      : `<span class="ros-menu"><button class="ros-act ${local.menu === i ? 'lit' : ''}" data-menu="${i}" title="${esc(t('roster_same_as'))}" aria-label="${esc(t('roster_same_as'))}"><i class="ti ti-arrows-join-2"></i></button>${local.menu === i ? menu(i) : ''}</span>`;
    return `<div class="ros-row ${e.on ? '' : 'off'}" data-i="${i}" draggable="true">
      <span class="ros-grip" aria-hidden="true"><i class="ti ti-grip-vertical"></i></span>
      <input type="checkbox" class="ros-cb" data-toggle="${i}" ${e.on ? 'checked' : ''} aria-label="${esc(e.name)}">
      <button class="ros-dot ${local.open === i ? 'open' : ''}" data-color="${i}" style="background:${App.slotColor(e.color)}" aria-label="${esc(t('roster_colour_for', { name: e.name }))}"></button>
      ${body}
      <span class="ct">${esc(num(count))}</span>
      ${action}</div>`;
  }

  function menu(i) {
    const { esc } = App;
    const items = local.draft.entries.map((o, j) => j === i ? '' :
      `<button data-merge="${i}" data-into="${j}"><span class="dot" style="background:${App.slotColor(o.color)}"></span>${esc(o.name)}</button>`).join('');
    return `<div class="menu-list"><div style="font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);padding:5px 9px">${esc(App.t('roster_same_as'))}</div>${items}</div>`;
  }

  function group(e, i, count) {
    const { esc, num } = App;
    const per = kidCounts(e);
    return `<div class="ros-group">${row(e, i, count, 0)}
      <div class="ros-kids">${e.src.map((s, k) =>
        `<div class="ros-kid"><span aria-hidden="true">&#8627;</span>${esc(chat().people[s])}<span class="c">${esc(num(per[k]))}</span></div>`).join('')}</div></div>`;
  }

  function kidCounts(e) {
    const per = new Array(chat().people.length).fill(0);
    for (const r of chat().rows) per[r[1]]++;
    return e.src.map(s => per[s]);
  }

  /* The colour editor: twelve slots and a live People card. The card carries
   * every contrast-critical use of a person's colour at once — filled avatar,
   * colour-as-text percentage, labelled share segment — so what you see in it
   * is what the People tab will draw. */
  function editor(e, i, count, sel) {
    const { esc, t, num, pct } = App;
    const taken = Roster.takenSlots(local.draft, i);
    const owner = slot => {
      const o = local.draft.entries.find((x, j) => j !== i && x.color === slot);
      return o ? o.name : '';
    };
    const sws = Array.from({ length: Roster.SLOTS }, (_, s) =>
      `<button class="ros-sw ${s === e.color ? 'sel' : ''} ${taken.has(s) && s !== e.color ? 'taken' : ''}"
         data-slot="${s}" data-for="${i}" style="background:${App.slotColor(s)}"
         title="${taken.has(s) && s !== e.color ? esc(t('roster_taken', { name: owner(s) })) : ''}"
         aria-label="${s + 1}"></button>`).join('');
    const name = e.name;
    // Excluded people are dropped from the analysis, so the People tab divides by
    // the selected total — the preview must match it. For an entry that is
    // currently off, add its own messages back, so the preview answers "how would
    // this person look if I included them" rather than showing a share of a set
    // they are not in.
    const denom = e.on ? sel : sel + count;
    return `<div class="ros-edit" style="--hue:${App.slotColor(e.color)}">
      <div class="l">${esc(t('roster_colour_for', { name }))}</div>
      <div class="ros-sws">${sws}</div>
      <div class="ros-prev" style="--hue:${App.slotColor(e.color)}">
        <div class="ros-prev-h">
          <div class="avatar">${esc([...name][0] || '?')}</div>
          <div style="min-width:0"><div class="n">${esc(name)}</div></div>
          <div class="s"><div class="v">${esc(pct(denom ? count / denom : 0))}</div><div class="l">${esc(t('of_messages'))}</div></div>
        </div>
        <div class="ros-prev-strip"><div style="background:${App.slotColor(e.color)};width:100%">${esc(name)} · ${esc(num(count))}</div></div>
      </div>
      <div class="note"><i class="ti ti-info-circle"></i>${esc(t('roster_preview_note', { name }))}</div></div>`;
  }

  /* One card per probable duplicate, with the evidence spelled out so a wrong
   * guess is easy to reject. Never applies itself. */
  function banner() {
    const { esc, t } = App;
    const people = chat().people;
    return suggestions().map(s => {
      const a = people[s.a], b = people[s.b];
      const why = s.reasons.map(k => t('reason_' + k, { a, b })).join(' ');
      return `<div class="ros-sugg" data-sugg="${esc(suggKey(s.a, s.b))}">
        <div class="r1"><i class="ti ti-alert-triangle"></i><div>${t('roster_dup_title', { a: esc(a), b: esc(b) })}</div></div>
        <div class="why">${esc(why)}</div>
        <div class="acts">
          <button class="btn btn-primary" data-keep="${s.a}" data-drop="${s.b}">${esc(t('roster_dup_merge_as', { name: a }))}</button>
          <button class="btn" data-keep="${s.b}" data-drop="${s.a}">${esc(t('roster_dup_merge_as', { name: b }))}</button>
          <button class="btn" data-reject="${esc(suggKey(s.a, s.b))}">${esc(t('roster_dup_reject'))}</button>
        </div></div>`;
    }).join('');
  }

  function render() {
    const { esc, t, num } = App;
    const c = Roster.counts(chat(), local.draft);
    const max = Math.max(...c.perEntry, 1);
    // The preview mimics a real People card, so it must use the population the
    // People tab actually draws — the date-filtered one. The rows and footer
    // above deliberately stay whole-chat. Only computed when an editor is open,
    // so an ordinary render does not pay for a second O(rows) pass.
    const cr = local.open >= 0 ? Roster.counts(chat(), local.draft, App.state.from, App.state.to) : null;
    const list = local.draft.entries.map((e, i) => {
      const main = e.src.length > 1 ? group(e, i, c.perEntry[i]) : row(e, i, c.perEntry[i], max);
      return main + (local.open === i ? editor(e, i, cr.perEntry[i], cr.messages) : '');
    }).join('');
    $('rosterModal').innerHTML = `
      <div class="modal-h">
        <div class="ic"><i class="ti ti-users-group"></i></div>
        <div style="min-width:0">
          <h3 id="rosterTitle">${esc(t('roster_title'))}</h3>
          <p>${esc(t('roster_sub', { n: num(local.draft.entries.length) }))}</p>
        </div>
        <button class="x" id="rosClose" aria-label="${esc(t('roster_cancel'))}">&times;</button>
      </div>
      <div id="rosBanner">${banner()}</div>
      <div id="rosList">${list}</div>
      <div class="note" style="padding:0 17px 10px"><i class="ti ti-info-circle"></i>${esc(t('roster_merge_note'))}</div>
      <div class="modal-f">
        <button class="btn" id="rosReset">${esc(t('roster_reset'))}</button>
        <span class="sp"></span>
        <span class="cnt">${c.on ? esc(t('roster_footer', { n: num(c.on), msgs: num(c.messages) })) : esc(t('roster_none_selected'))}</span>
        <button class="btn btn-primary" id="rosApply" ${c.on ? '' : 'disabled'}>${esc(t('roster_analyse'))}</button>
      </div>`;
    wire();
    if (local.refocus) {
      const el = $('rosterModal').querySelector(local.refocus);
      if (el) el.focus();
      local.refocus = null;
    }
  }

  /* innerHTML is replaced wholesale on every edit, which drops focus to body.
   * Remember which control to restore so a keyboard user does not lose their
   * place after each toggle or merge. */
  function edit(fn, refocus) {
    local.draft = fn(local.draft);
    local.menu = -1;
    local.refocus = refocus || null;
    render();
  }

  function wire() {
    const m = $('rosterModal');
    $('rosClose').addEventListener('click', close);
    $('rosReset').addEventListener('click', () => { local.open = -1; edit(() => Roster.initial(chat()), '#rosReset'); });
    $('rosApply').addEventListener('click', apply);

    m.querySelectorAll('[data-color]').forEach(el =>
      el.addEventListener('click', () => {
        const i = +el.dataset.color;
        local.open = local.open === i ? -1 : i;
        local.menu = -1;
        render();
      }));
    m.querySelectorAll('[data-slot]').forEach(el =>
      el.addEventListener('click', () => {
        const i = +el.dataset.for, slot = +el.dataset.slot;
        edit(r => Roster.setColor(r, i, slot), '[data-slot="' + slot + '"][data-for="' + i + '"]');
      }));
    m.querySelectorAll('[data-toggle]').forEach(el =>
      el.addEventListener('change', () => edit(r => Roster.toggle(r, +el.dataset.toggle), '[data-toggle="' + el.dataset.toggle + '"]')));
    m.querySelectorAll('[data-split]').forEach(el =>
      el.addEventListener('click', () => {
        local.open = -1;
        const i = +el.dataset.split;
        edit(r => Roster.split(r, i, chat()), '[data-menu="' + i + '"]');
      }));
    m.querySelectorAll('[data-menu]').forEach(el =>
      el.addEventListener('click', e => {
        e.stopPropagation();
        const i = +el.dataset.menu;
        const opening = local.menu !== i;
        local.menu = opening ? i : -1;
        // render() destroys the button that was just activated: focus the first
        // menu item when opening, and the ⇄ button again when closing.
        local.refocus = opening ? `[data-merge="${i}"]` : `[data-menu="${i}"]`;
        render();
      }));
    m.querySelectorAll('[data-merge]').forEach(el =>
      el.addEventListener('click', () => {
        local.open = -1;
        const into = +el.dataset.into;
        edit(r => Roster.merge(r, into, +el.dataset.merge), '[data-split="' + into + '"]');
      }));
    m.querySelectorAll('.ros-name').forEach(el => {
      el.addEventListener('change', () => {
        const i = +el.closest('.ros-row').dataset.i;
        local.draft = Roster.rename(local.draft, i, el.value, chat());
      });
      el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); });
    });

    m.querySelectorAll('[data-keep]').forEach(el =>
      el.addEventListener('click', () => {
        const keep = +el.dataset.keep, drop = +el.dataset.drop;
        local.dismissed.add(suggKey(keep, drop));
        local.open = -1;
        edit(r => {
          const target = Roster.entryOf(r, keep), other = Roster.entryOf(r, drop);
          if (target < 0 || other < 0 || target === other) return r;
          // merge() splices `other` out of the entries array: when other < target
          // every later index shifts down by one, so the surviving entry always
          // ends up at the lower of the two indices, regardless of which side of
          // the pair the user chose to keep.
          return Roster.rename(Roster.merge(r, target, other), Math.min(target, other),
                               chat().people[keep], chat());
        });
      }));
    m.querySelectorAll('[data-reject]').forEach(el =>
      el.addEventListener('click', () => { local.dismissed.add(el.dataset.reject); render(); }));

    m.querySelectorAll('.ros-row').forEach(el => {
      el.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', el.dataset.i);
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('drag');
      });
      el.addEventListener('dragend', () => el.classList.remove('drag'));
      el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drop'); });
      el.addEventListener('dragleave', () => el.classList.remove('drop'));
      el.addEventListener('drop', e => {
        e.preventDefault();
        el.classList.remove('drop');
        const from = +e.dataTransfer.getData('text/plain'), into = +el.dataset.i;
        if (Number.isFinite(from) && from !== into) {
          local.open = -1;
          edit(r => Roster.merge(r, into, from), '[data-split="' + into + '"]');
        }
      });
    });
  }

  function apply() {
    if (!Roster.counts(chat(), local.draft).on) return;
    App.state.roster = local.draft;
    App.applyRoster();
    close();
  }

  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

  function focusables() {
    return [...$('rosterModal').querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
  }

  /* Tab must not escape to the page behind — aria-modal does not do this. */
  function trapTab(e) {
    if (e.key !== 'Tab' || !isOpen()) return;
    const els = focusables();
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    // Focus can sit outside the modal entirely — render() replaces innerHTML and
    // drops it to <body>. A boundary-only check never fires there, so Tab would
    // walk into the page behind the dim. Pull it back in.
    if (!$('rosterModal').contains(document.activeElement)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function open() {
    local.draft = Roster.clone(App.state.roster);
    local.open = local.menu = -1;
    local.returnTo = document.activeElement;
    $('rosterBack').classList.remove('hidden');
    render();
    const first = $('rosterModal').querySelector('input,button');
    if (first) first.focus();
    document.addEventListener('keydown', trapTab);
  }

  function close() {
    $('rosterBack').classList.add('hidden');
    local.draft = null;
    document.removeEventListener('keydown', trapTab);
    const back = local.returnTo && local.returnTo.isConnected ? local.returnTo : $('rosterBtn');
    if (back) back.focus();
    local.returnTo = null;
  }

  function isOpen() { return !$('rosterBack').classList.contains('hidden'); }

  function newChat() { local.dismissed.clear(); }

  return { open, close, isOpen, render, newChat, local, suggKey };
})(App, typeof ChatRoster !== 'undefined' ? ChatRoster : null);
