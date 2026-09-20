# Participant Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a chat loads, a modal lets the user drop participants from the analysis, recolour anyone from a curated twelve-slot palette, and fuse duplicate identities under a chosen name.

**Architecture:** The roster is a *projection*, not a filter. `ChatRoster.apply(rawChat, roster)` returns an object shaped exactly like the `/api/parse` response (plus a `colors` array), which becomes `App.state.chat`. Because `stats.js`, `people.js`, `words.js`, `wrapped.js`, `export.js` and all five views already consume only `(msgs, nPeople)` and `chat.people`, none of them change — they cannot tell a projected chat from a parsed one. All testable logic lives in the pure module `static/roster.js`; `static/view-roster.js` is render plus event wiring only.

**Tech Stack:** Flask (untouched), vanilla ES2020 in `static/*.js` as IIFE modules with a `module.exports` tail, `node --test` driven by `tests/test_js.py`, Tabler icon webfont, CSS custom properties for theming.

**Spec:** `docs/superpowers/specs/2026-09-20-participant-roster-design.md`

## Global Constraints

- **Branch:** `feat/participant-roster` (already created; the spec is committed on it).
- **No new dependencies.** No npm, no jsdom, no Python packages. Stdlib and what is already pinned.
- **`parse.py`, `app.py` and `/api/parse` are not modified.** This feature is entirely client-side.
- **Every new `static/*.js` module** follows the house pattern: `'use strict';`, a leading block comment explaining the rules it encodes, an IIFE assigned to a `Chat*` const, and a `if (typeof module !== 'undefined' && module.exports) module.exports = X;` tail so `node --test` can require it.
- **Pure logic goes in `roster.js`; DOM goes in `view-roster.js`.** There is no DOM test harness in this project, so anything worth testing must be reachable without a `document`.
- **Colour slots are integers `0…11`.** A hex never enters the roster. `var(--p${slot + 1})` is the only place a slot becomes a colour, and the only function allowed to build that string is `App.slotColor`.
- **Tests:** `python -m pytest` must pass. New JS test files are picked up automatically by `tests/test_js.py`'s glob — no registration needed.
- **i18n:** every user-visible string is a key present in **both** `en` and `pt`. `tests/test_i18n.js` fails on any key present in one and missing from the other.
- **Message rows are chronological**, as produced by `parse.py`; `roster.js` may rely on this exactly as `parse.py` does for its own `start`/`end`.
- **Responsive to 480px**, dark and light themes both correct. Drag-and-drop always has a non-drag equivalent.

---

### Task 1: Extend the person palette to twelve slots

The existing palette is `--p1…--p6`, cycled with `p % 6`. Six slots is the reason a group repeats colours, and the roster needs twelve. `wrapped.js` carries its own hardcoded copy of the palette because the Wrapped card is drawn on a canvas that is always dark and cannot read CSS variables.

**Files:**
- Modify: `templates/index.html` (the `[data-theme="dark"]` and `[data-theme="light"]` token blocks)
- Modify: `static/app.js` (`color`, `colorValue`, and the returned object)
- Modify: `static/wrapped.js:14-15` (`PALETTE.people`)
- Test: `tests/test_app_color.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `App.slotColor(slot) -> 'var(--pN)'`, `App.slotColorValue(slot) -> '#rrggbb'`, and `App.color(p)` / `App.colorValue(p)` keeping their existing signatures. `ChatWrapped.PALETTE.people` becomes a 12-element array of dark-theme hexes.

- [ ] **Step 1: Write the failing test**

Create `tests/test_app_color.js`:

```js
// Tests for the palette helpers on static/app.js. Run by tests/test_js.py.
// app.js is the shell and mostly touches document/window — these helpers are
// the pure part, so this file never calls App.boot().
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const App = require('../static/app.js');
const Wr = require('../static/wrapped.js');

test('slotColor maps slot 0..11 onto --p1..--p12', () => {
  assert.strictEqual(App.slotColor(0), 'var(--p1)');
  assert.strictEqual(App.slotColor(11), 'var(--p12)');
});

test('slotColor wraps out-of-range slots into the palette', () => {
  assert.strictEqual(App.slotColor(12), 'var(--p1)');
  assert.strictEqual(App.slotColor(-1), 'var(--p12)');
});

test('color() reads the projected chat\'s colour slots', () => {
  App.state.chat = { colors: [4, 0, 9] };
  assert.strictEqual(App.color(0), 'var(--p5)');
  assert.strictEqual(App.color(1), 'var(--p1)');
  assert.strictEqual(App.color(2), 'var(--p10)');
  App.state.chat = null;
});

test('color() falls back to cycling when there are no slots', () => {
  App.state.chat = null;
  assert.strictEqual(App.color(0), 'var(--p1)');
  assert.strictEqual(App.color(13), 'var(--p2)');
  App.state.chat = { people: ['a'] };
  assert.strictEqual(App.color(0), 'var(--p1)');
  App.state.chat = null;
});

test('color() still resolves the Others bucket to muted', () => {
  App.state.chat = { colors: [0, 1] };
  assert.strictEqual(App.color(-1), 'var(--muted)');
  App.state.chat = null;
});

test('the Wrapped canvas palette has one hex per slot', () => {
  assert.strictEqual(Wr.PALETTE.people.length, 12);
  assert.ok(Wr.PALETTE.people.every(c => /^#[0-9A-Fa-f]{6}$/.test(c)));
  assert.strictEqual(new Set(Wr.PALETTE.people).size, 12);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --test tests/test_app_color.js`
Expected: FAIL — `App.slotColor is not a function`.

- [ ] **Step 3: Add the six new tokens to both themes**

In `templates/index.html`, in the `[data-theme="dark"]` block, replace the line

```
  --p1:#5FBF7A;--p2:#F5C518;--p3:#4AA3C4;--p4:#9B7FD4;--p5:#E05A5A;--p6:#D4608A;
```

with

```
  --p1:#5FBF7A;--p2:#F5C518;--p3:#4AA3C4;--p4:#9B7FD4;--p5:#E05A5A;--p6:#D4608A;
  --p7:#E08A45;--p8:#46C9B0;--p9:#A8C24A;--p10:#7E8FE0;--p11:#B8865F;--p12:#5FD2E0;
```

and in the `[data-theme="light"]` block, replace

```
  --p1:#3d8a55;--p2:#b39609;--p3:#2b7f99;--p4:#6f4fae;--p5:#b33b3b;--p6:#b24a72;
```

with

```
  --p1:#3d8a55;--p2:#b39609;--p3:#2b7f99;--p4:#6f4fae;--p5:#b33b3b;--p6:#b24a72;
  --p7:#b3601f;--p8:#1f8a78;--p9:#6f8a1f;--p10:#4d5fb3;--p11:#85583a;--p12:#1f8a99;
```

The light values are deepened counterparts of the dark ones, tuned the same way
the first six already are: a person's colour is overwhelmingly used as a **fill
carrying `#0c0c0c` text** — avatar, share segment, dot, KPI rail, finder track —
in 8 of its 13 call sites, so the light-mode value is darkened enough to read on
cream while staying light enough for black text to sit on it.

It does **not** clear 4.5:1 when used as small text, and neither do four of the
six existing slots (`--p1` the app's own accent is 3.62:1 on `--surface`). The two
uses pull in opposite directions and cannot both be maximised by one token; the
palette resolves toward fills. `.bub .who` in `static/view-messages.js:60` is the
one place a person's colour becomes 11px bold text, and it is a pre-existing
accessibility gap that this task widens from six slots to twelve. **Do not retune
the hexes to chase 4.5:1** — that would make the six new colours systematically
darker than the original six and degrade the dominant fill use. Transcribe the
values above exactly.

- [ ] **Step 4: Rewire the colour helpers in `static/app.js`**

Replace these two functions:

```js
  function color(p) { return p < 0 ? 'var(--muted)' : `var(--p${(p % 6) + 1})`; }

  /* The resolved colour, for canvas and inline SVG fills. */
  function colorValue(p) {
    const v = p < 0 ? '--muted' : `--p${(p % 6) + 1}`;
    return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  }
```

with:

```js
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
```

Then add `slotColor` and `slotColorValue` to the object `App` returns, next to `color, colorValue`.

- [ ] **Step 5: Grow the Wrapped canvas palette**

In `static/wrapped.js`, replace the `PALETTE` declaration:

```js
  const PALETTE = { bg: '#0a0a0a', text: '#e8e8e0', muted: '#9a9a92', faint: '#555', accent: '#5FBF7A',
                    border: '#3A2C1D', people: ['#5FBF7A', '#F5C518', '#4AA3C4', '#9B7FD4', '#E05A5A', '#D4608A'] };
```

with:

```js
  // The card is always dark — it is a shareable image, not a themed page — so
  // these are the dark-theme person colours, one per palette slot, inlined
  // because a canvas cannot read CSS custom properties.
  const PALETTE = { bg: '#0a0a0a', text: '#e8e8e0', muted: '#9a9a92', faint: '#555', accent: '#5FBF7A',
                    border: '#3A2C1D',
                    people: ['#5FBF7A', '#F5C518', '#4AA3C4', '#9B7FD4', '#E05A5A', '#D4608A',
                             '#E08A45', '#46C9B0', '#A8C24A', '#7E8FE0', '#B8865F', '#5FD2E0'] };
```

- [ ] **Step 6: Run the tests**

Run: `node --test tests/test_app_color.js && python -m pytest -q`
Expected: PASS. Nothing else should regress — `App.color(p)` with no projected chat now cycles `% 12` instead of `% 6`, which only ever widens the set of colours used.

- [ ] **Step 7: Commit**

```bash
git add templates/index.html static/app.js static/wrapped.js tests/test_app_color.js
git commit -m "feat: twelve person palette slots, resolved through App.slotColor"
```

---

### Task 2: The roster model — `initial` and `apply`

The projection is the load-bearing piece: get it right and nothing downstream needs to change.

**Files:**
- Create: `static/roster.js`
- Test: `tests/test_roster.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `ChatRoster.SLOTS` (12), `ChatRoster.RosterError`, `ChatRoster.initial(chat) -> roster`, `ChatRoster.apply(chat, roster) -> projectedChat`, `ChatRoster.counts(chat, roster) -> { perEntry, on, messages }`. A roster is `{ entries: [{ src: number[], name: string, color: number, on: boolean }] }`. A projected chat is `{ platform, language, title, people, colors, start, end, rows }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_roster.js`:

```js
// Tests for static/roster.js. Run by tests/test_js.py.
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert');
const Roster = require('../static/roster.js');
const { at } = require('./helpers.js');

// A parsed chat, shaped exactly like /api/parse returns one.
function raw(people, rows) {
  return {
    platform: 'ios', language: 'en', title: null, people,
    start: '2024-01-01', end: '2024-01-01',
    rows: rows.map(([s, p, k = 't', x = '']) => [at(s), p, k, x]),
  };
}

const CHAT = raw(['Ana', 'Pepe', 'Caio'], [
  ['2024-01-01 08:00', 2, 't', 'early'],
  ['2024-03-10 09:00', 0, 't', 'hi'],
  ['2024-03-10 09:05', 1, 't', 'hey'],
  ['2024-03-11 10:00', 0, 'p'],
  ['2024-06-30 22:00', 2, 't', 'late'],
]);

test('initial gives every person their own entry, in parse order', () => {
  const r = Roster.initial(CHAT);
  assert.deepStrictEqual(r.entries, [
    { src: [0], name: 'Ana', color: 0, on: true },
    { src: [1], name: 'Pepe', color: 1, on: true },
    { src: [2], name: 'Caio', color: 2, on: true },
  ]);
});

test('initial cycles colour slots once there are more than twelve people', () => {
  const many = raw(Array.from({ length: 14 }, (_, i) => 'P' + i), [['2024-01-01 08:00', 13]]);
  const r = Roster.initial(many);
  assert.strictEqual(r.entries[12].color, 0);
  assert.strictEqual(r.entries[13].color, 1);
});

test('apply passes the parse metadata through untouched', () => {
  const p = Roster.apply(CHAT, Roster.initial(CHAT));
  assert.strictEqual(p.platform, 'ios');
  assert.strictEqual(p.language, 'en');
  assert.strictEqual(p.title, null);
  assert.deepStrictEqual(p.people, ['Ana', 'Pepe', 'Caio']);
  assert.deepStrictEqual(p.colors, [0, 1, 2]);
  assert.strictEqual(p.rows.length, 5);
});

test('an excluded person loses every row and the rest reindex densely', () => {
  let r = Roster.initial(CHAT);
  r.entries[1].on = false;                       // drop Pepe, the middle index
  const p = Roster.apply(CHAT, r);
  assert.deepStrictEqual(p.people, ['Ana', 'Caio']);
  assert.deepStrictEqual(p.colors, [0, 2]);
  assert.strictEqual(p.rows.length, 4);
  assert.deepStrictEqual(p.rows.map(x => x[1]), [1, 0, 0, 1]);
});

test('excluding the person who owned the first and last day moves start and end', () => {
  let r = Roster.initial(CHAT);
  r.entries[2].on = false;                       // Caio owns 2024-01-01 and 2024-06-30
  const p = Roster.apply(CHAT, r);
  assert.strictEqual(p.start, '2024-03-10');
  assert.strictEqual(p.end, '2024-03-11');
});

test('start and end come from the extremes, not from row order', () => {
  const shuffled = raw(['Ana'], [['2024-05-05 12:00', 0], ['2024-02-02 12:00', 0]]);
  const p = Roster.apply(shuffled, Roster.initial(shuffled));
  assert.strictEqual(p.start, '2024-02-02');
  assert.strictEqual(p.end, '2024-05-05');
});

test('a merged entry collapses its sources onto one index and adds up', () => {
  const r = { entries: [
    { src: [0, 1], name: 'Ana', color: 3, on: true },
    { src: [2], name: 'Caio', color: 2, on: true },
  ] };
  const p = Roster.apply(CHAT, r);
  assert.deepStrictEqual(p.people, ['Ana', 'Caio']);
  assert.deepStrictEqual(p.colors, [3, 2]);
  assert.deepStrictEqual(p.rows.map(x => x[1]), [1, 0, 0, 0, 1]);
});

test('apply mutates neither the chat nor the roster', () => {
  const r = Roster.initial(CHAT);
  const chatBefore = JSON.stringify(CHAT), rosterBefore = JSON.stringify(r);
  Roster.apply(CHAT, r);
  assert.strictEqual(JSON.stringify(CHAT), chatBefore);
  assert.strictEqual(JSON.stringify(r), rosterBefore);
});

test('apply refuses a roster that leaves no messages', () => {
  const r = Roster.initial(CHAT);
  r.entries.forEach(e => { e.on = false; });
  assert.throws(() => Roster.apply(CHAT, r), e => e instanceof Roster.RosterError && e.code === 'empty');
});

test('counts reports per-entry totals and the live selected totals', () => {
  const r = { entries: [
    { src: [0, 1], name: 'Ana', color: 0, on: true },
    { src: [2], name: 'Caio', color: 1, on: false },
  ] };
  assert.deepStrictEqual(Roster.counts(CHAT, r), { perEntry: [3, 2], on: 1, messages: 3 });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `node --test tests/test_roster.js`
Expected: FAIL — `Cannot find module '../static/roster.js'`.

- [ ] **Step 3: Create `static/roster.js` with just this much**

```js
'use strict';

/* The participant roster: the user's configuration over one parsed chat.
 *
 *   { entries: [{ src, name, color, on }] }
 *
 * src holds indices into the parsed chat's people array. Every index appears in
 * exactly one entry's src, exactly once — that invariant is what makes the
 * projection total. color is a palette slot (0-11), never a hex, so the theme
 * toggle keeps working. Entry order is display order and becomes the person
 * index in the projected chat.
 *
 * apply() returns an object shaped like the /api/parse response, so stats.js,
 * people.js, words.js, wrapped.js, export.js and every view keep working on it
 * unchanged — they cannot tell a projected chat from a parsed one.
 *
 * Pure functions, loaded as a plain script and required by tests/test_roster.js. */

const ChatRoster = (function () {

  const SLOTS = 12;
  const DAY = 86400;

  class RosterError extends Error {
    constructor(code) { super(code); this.code = code; }
  }

  function clone(roster) {
    return { entries: roster.entries.map(e =>
      ({ src: e.src.slice(), name: e.name, color: e.color, on: e.on })) };
  }

  function initial(chat) {
    return { entries: chat.people.map((name, i) =>
      ({ src: [i], name, color: i % SLOTS, on: true })) };
  }

  function isoOfTs(ts) {
    return new Date(Math.floor(ts / DAY) * DAY * 1000).toISOString().slice(0, 10);
  }

  /* chat × roster → a chat shaped like the API's, with only the selected people
   * in it and person indices remapped onto the surviving entries. */
  function apply(chat, roster) {
    const on = roster.entries.filter(e => e.on);
    const map = new Array(chat.people.length).fill(-1);
    on.forEach((e, j) => e.src.forEach(s => { map[s] = j; }));

    const rows = [];
    let lo = Infinity, hi = -Infinity;
    for (const r of chat.rows) {
      const p = map[r[1]];
      if (p < 0) continue;
      rows.push([r[0], p, r[2], r[3]]);
      if (r[0] < lo) lo = r[0];
      if (r[0] > hi) hi = r[0];
    }
    if (!rows.length) throw new RosterError('empty');

    return {
      platform: chat.platform,
      language: chat.language,
      title: chat.title,
      people: on.map(e => e.name),
      colors: on.map(e => e.color),
      start: isoOfTs(lo),
      end: isoOfTs(hi),
      rows,
    };
  }

  /* Message totals for the modal: one per entry (merged entries add up), plus
   * how many entries and messages are currently selected. */
  function counts(chat, roster) {
    const per = new Array(chat.people.length).fill(0);
    for (const r of chat.rows) per[r[1]]++;
    const perEntry = roster.entries.map(e => e.src.reduce((s, i) => s + per[i], 0));
    let on = 0, messages = 0;
    roster.entries.forEach((e, i) => { if (e.on) { on++; messages += perEntry[i]; } });
    return { perEntry, on, messages };
  }

  return { SLOTS, RosterError, clone, initial, apply, counts };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ChatRoster;
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/test_roster.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add static/roster.js tests/test_roster.js
git commit -m "feat: roster model — project a parsed chat through a participant roster"
```

---

### Task 3: The roster edit operations

**Files:**
- Modify: `static/roster.js`
- Modify: `tests/test_roster.js`

**Interfaces:**
- Consumes: `ChatRoster.clone`, `ChatRoster.SLOTS` from Task 2.
- Produces: `toggle(roster, i)`, `setColor(roster, i, slot)`, `rename(roster, i, name, chat)`, `merge(roster, target, other)`, `split(roster, i, chat)` — all returning a **new** roster — plus `takenSlots(roster, exceptIndex) -> Set`, `entryOf(roster, srcIndex) -> number`, `sameEntry(roster, a, b) -> boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_roster.js`:

```js
test('toggle flips one entry and leaves the input alone', () => {
  const r = Roster.initial(CHAT);
  const out = Roster.toggle(r, 1);
  assert.strictEqual(out.entries[1].on, false);
  assert.strictEqual(r.entries[1].on, true);
});

test('setColor wraps a slot into the palette', () => {
  const r = Roster.initial(CHAT);
  assert.strictEqual(Roster.setColor(r, 0, 5).entries[0].color, 5);
  assert.strictEqual(Roster.setColor(r, 0, 12).entries[0].color, 0);
  assert.strictEqual(Roster.setColor(r, 0, -1).entries[0].color, 11);
});

test('rename trims, and an empty name falls back to the first source name', () => {
  const r = Roster.initial(CHAT);
  assert.strictEqual(Roster.rename(r, 0, '  Aninha  ', CHAT).entries[0].name, 'Aninha');
  assert.strictEqual(Roster.rename(r, 0, '   ', CHAT).entries[0].name, 'Ana');
});

test('merge keeps the target name, colour and on-state and drops the other row', () => {
  let r = Roster.initial(CHAT);
  r = Roster.setColor(r, 0, 7);
  r = Roster.toggle(r, 2);                        // Caio is off
  const out = Roster.merge(r, 0, 2);              // fuse Caio into Ana
  assert.strictEqual(out.entries.length, 2);
  assert.deepStrictEqual(out.entries[0], { src: [0, 2], name: 'Ana', color: 7, on: true });
  assert.deepStrictEqual(out.entries[1].src, [1]);
});

test('merge works when the target sits after the other entry', () => {
  const out = Roster.merge(Roster.initial(CHAT), 2, 0);
  assert.strictEqual(out.entries.length, 2);
  const caio = out.entries.find(e => e.name === 'Caio');
  assert.deepStrictEqual(caio.src, [2, 0]);
});

test('merging an entry into itself is a no-op', () => {
  const out = Roster.merge(Roster.initial(CHAT), 1, 1);
  assert.strictEqual(out.entries.length, 3);
});

test('split restores original names in src order, in place', () => {
  let r = Roster.merge(Roster.initial(CHAT), 0, 2);   // Ana + Caio
  r = Roster.rename(r, 0, 'Ana S.', CHAT);
  const out = Roster.split(r, 0, CHAT);
  assert.deepStrictEqual(out.entries.map(e => e.name), ['Ana', 'Caio', 'Pepe']);
  assert.deepStrictEqual(out.entries.map(e => e.src), [[0], [2], [1]]);
});

test('split gives the first member the group colour and the rest unused slots', () => {
  let r = Roster.merge(Roster.initial(CHAT), 0, 2);
  r = Roster.setColor(r, 0, 5);                      // group is slot 5; Pepe holds slot 1
  const out = Roster.split(r, 0, CHAT);
  assert.strictEqual(out.entries[0].color, 5);
  assert.strictEqual(out.entries[1].color, 0);       // lowest slot nobody is using
  assert.strictEqual(new Set(out.entries.map(e => e.color)).size, 3);
});

test('split members inherit the group on-state, and a lone entry is untouched', () => {
  let r = Roster.merge(Roster.initial(CHAT), 0, 2);
  r = Roster.toggle(r, 0);
  const out = Roster.split(r, 0, CHAT);
  assert.deepStrictEqual(out.entries.slice(0, 2).map(e => e.on), [false, false]);
  assert.strictEqual(Roster.split(Roster.initial(CHAT), 1, CHAT).entries.length, 3);
});

test('merge then split then merge keeps every source index exactly once', () => {
  const all = r => r.entries.flatMap(e => e.src).sort((a, b) => a - b);
  let r = Roster.merge(Roster.initial(CHAT), 0, 1);
  assert.deepStrictEqual(all(r), [0, 1, 2]);
  r = Roster.split(r, 0, CHAT);
  assert.deepStrictEqual(all(r), [0, 1, 2]);
  r = Roster.merge(r, 2, 1);
  assert.deepStrictEqual(all(r), [0, 1, 2]);
  assert.ok(Roster.apply(CHAT, r).rows.length > 0);
});

test('takenSlots lists the colours other entries are using', () => {
  const r = Roster.initial(CHAT);
  assert.deepStrictEqual([...Roster.takenSlots(r, 1)].sort(), [0, 2]);
});

test('entryOf and sameEntry locate a source index after merging', () => {
  const r = Roster.merge(Roster.initial(CHAT), 0, 2);
  assert.strictEqual(Roster.entryOf(r, 2), 0);
  assert.strictEqual(Roster.entryOf(r, 1), 1);
  assert.strictEqual(Roster.sameEntry(r, 0, 2), true);
  assert.strictEqual(Roster.sameEntry(r, 0, 1), false);
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `node --test tests/test_roster.js`
Expected: FAIL — `Roster.toggle is not a function`.

- [ ] **Step 3: Implement the operations**

In `static/roster.js`, insert after `counts` and before the `return`:

```js
  // ---------- edits (every one returns a new roster) ----------

  function toggle(roster, i) {
    const r = clone(roster);
    r.entries[i].on = !r.entries[i].on;
    return r;
  }

  function setColor(roster, i, slot) {
    const r = clone(roster);
    r.entries[i].color = ((slot % SLOTS) + SLOTS) % SLOTS;
    return r;
  }

  /* A name trimmed to nothing falls back to the export's own name for the
   * entry's first source, so an entry can never end up nameless. */
  function rename(roster, i, name, chat) {
    const r = clone(roster);
    r.entries[i].name = String(name).trim() || chat.people[r.entries[i].src[0]];
    return r;
  }

  /* Fuse `other` into `target`: the result keeps the target's name, colour and
   * on-state, which is what makes "merge as <this name>" a single action. */
  function merge(roster, target, other) {
    const r = clone(roster);
    if (target === other) return r;
    r.entries[target].src = r.entries[target].src.concat(r.entries[other].src);
    r.entries.splice(other, 1);
    return r;
  }

  function takenSlots(roster, except) {
    const out = new Set();
    roster.entries.forEach((e, i) => { if (i !== except) out.add(e.color); });
    return out;
  }

  /* Undo a merge in place: one entry per source, original names, the first
   * keeping the group's colour and the rest taking slots nobody else holds. */
  function split(roster, i, chat) {
    const e = roster.entries[i];
    if (e.src.length < 2) return clone(roster);
    const used = takenSlots(roster, i);
    const restored = e.src.map((s, k) => {
      let color = e.color;
      if (k > 0) {
        color = s % SLOTS;
        for (let c = 0; c < SLOTS; c++) if (!used.has(c)) { color = c; break; }
      }
      used.add(color);
      return { src: [s], name: chat.people[s], color, on: e.on };
    });
    const r = clone(roster);
    r.entries.splice(i, 1, ...restored);
    return r;
  }

  function entryOf(roster, src) {
    return roster.entries.findIndex(e => e.src.indexOf(src) >= 0);
  }

  function sameEntry(roster, a, b) {
    const i = entryOf(roster, a);
    return i >= 0 && i === entryOf(roster, b);
  }
```

Then extend the returned object to:

```js
  return { SLOTS, RosterError, clone, initial, apply, counts,
           toggle, setColor, rename, merge, split, takenSlots, entryOf, sameEntry };
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/test_roster.js`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
git add static/roster.js tests/test_roster.js
git commit -m "feat: roster edits — toggle, recolour, rename, merge, split"
```

---

### Task 4: Duplicate detection

The one part that can be confidently wrong, so the bar is deliberately high: a pair is suggested only when the names are related **and** the activity spans barely overlap **and** the two never reply to each other. A false positive is worse than a miss, because accepting a suggestion is one click and silently changes every number in the app.

**Files:**
- Modify: `static/roster.js`
- Modify: `tests/test_roster.js`

**Interfaces:**
- Consumes: `counts`, `initial` from Task 2.
- Produces: `ChatRoster.suggest(chat) -> [{ a, b, reasons }]` where `a` and `b` index `chat.people` and `a` has at least as many messages as `b`; `reasons` is a subset of `['phone_number', 'similar_name', 'span_disjoint', 'no_replies']`. Also exported for testing: `isPhone(name)`, `normalise(name)`, `similarity(a, b)`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_roster.js`:

```js
test('isPhone recognises exported numbers but not ordinary names', () => {
  assert.strictEqual(Roster.isPhone('+55 11 98877-1234'), true);
  assert.strictEqual(Roster.isPhone('5511988771234'), true);
  assert.strictEqual(Roster.isPhone('+1 (555) 010-9999'), true);
  assert.strictEqual(Roster.isPhone('Ana'), false);
  assert.strictEqual(Roster.isPhone('Ana 2'), false);
});

test('normalise folds case, accents and runs of whitespace', () => {
  assert.strictEqual(Roster.normalise('  JOSÉ   da Silva '), 'jose da silva');
});

test('similarity is 1 for equal strings and low for unrelated ones', () => {
  assert.strictEqual(Roster.similarity('ana', 'ana'), 1);
  assert.ok(Roster.similarity('ana', 'bia') < 0.5);
  assert.ok(Roster.similarity('jenni', 'jenny') >= 0.8);
});

// Caio stops writing, then a number appears; they never answer each other.
const NEW_PHONE = raw(['Ana', 'Caio', '+55 11 98877-1234'], [
  ['2024-01-05 09:00', 0], ['2024-01-05 09:01', 1],
  ['2024-02-01 23:00', 1], ['2024-02-02 00:30', 1],
  ['2024-06-01 23:00', 2], ['2024-06-02 00:10', 2],
  ['2024-06-03 09:00', 0],
]);

test('suggest flags a saved name and the number that replaces it', () => {
  const s = Roster.suggest(NEW_PHONE);
  assert.strictEqual(s.length, 1);
  assert.strictEqual(NEW_PHONE.people[s[0].a], 'Caio');
  assert.strictEqual(NEW_PHONE.people[s[0].b], '+55 11 98877-1234');
  assert.ok(s[0].reasons.includes('phone_number'));
  assert.ok(s[0].reasons.includes('span_disjoint'));
  assert.ok(s[0].reasons.includes('no_replies'));
});

test('suggest orders the pair so the busier identity comes first', () => {
  const s = Roster.suggest(NEW_PHONE);
  const c = Roster.counts(NEW_PHONE, Roster.initial(NEW_PHONE)).perEntry;
  assert.ok(c[s[0].a] >= c[s[0].b]);
});

test('suggest flags a name that is a subset of another name', () => {
  const chat = raw(['Ana', 'Ana Souza'], [
    ['2024-01-01 09:00', 0], ['2024-02-01 09:00', 0],
    ['2024-09-01 09:00', 1], ['2024-09-02 09:00', 1],
  ]);
  const s = Roster.suggest(chat);
  assert.strictEqual(s.length, 1);
  assert.ok(s[0].reasons.includes('similar_name'));
});

test('suggest ignores accents and case when comparing names', () => {
  const chat = raw(['José', 'jose'], [
    ['2024-01-01 09:00', 0], ['2024-02-01 09:00', 0],
    ['2024-09-01 09:00', 1], ['2024-09-02 09:00', 1],
  ]);
  assert.strictEqual(Roster.suggest(chat).length, 1);
});

test('suggest stays silent when the two reply to each other', () => {
  const chat = raw(['Caio', '+55 11 98877-1234'], [
    ['2024-01-01 09:00', 0], ['2024-01-01 09:02', 1],
    ['2024-09-01 09:00', 1],
  ]);
  assert.deepStrictEqual(Roster.suggest(chat), []);
});

test('suggest stays silent when the two were active over the same period', () => {
  const chat = raw(['Ana', 'Ana Souza'], [
    ['2024-01-01 09:00', 0], ['2024-06-01 09:00', 0],
    ['2024-02-01 18:00', 1], ['2024-05-01 18:00', 1],
  ]);
  assert.deepStrictEqual(Roster.suggest(chat), []);
});

// The case a union-based overlap ratio gets wrong: Ana writes across the whole
// chat, the number only at the end, so their overlap is a rounding error against
// the union but the whole of the number's own span.
test('suggest does not pair a long-tenured person with a short-lived number', () => {
  const chat = raw(['Ana', '+55 11 98877-1234'], [
    ['2024-01-05 09:00', 0], ['2024-03-01 09:00', 0],
    ['2024-06-01 23:00', 1], ['2024-06-02 00:10', 1],
    ['2024-06-03 09:00', 0],
  ]);
  assert.deepStrictEqual(Roster.suggest(chat), []);
});

test('suggest stays silent for two plainly different names', () => {
  const chat = raw(['Ana', 'Bia'], [
    ['2024-01-01 09:00', 0], ['2024-02-01 09:00', 0],
    ['2024-09-01 09:00', 1], ['2024-09-02 09:00', 1],
  ]);
  assert.deepStrictEqual(Roster.suggest(chat), []);
});

test('suggest tells nothing from two different phone numbers', () => {
  const chat = raw(['+55 11 98877-1234', '+55 11 98877-1235'], [
    ['2024-01-01 09:00', 0], ['2024-02-01 09:00', 0],
    ['2024-09-01 09:00', 1], ['2024-09-02 09:00', 1],
  ]);
  assert.deepStrictEqual(Roster.suggest(chat), []);
});

test('suggest returns at most three pairs and nothing for a lone person', () => {
  const rows = [], people = [];
  for (let i = 0; i < 10; i++) {
    people.push('P' + i, 'P' + i + ' Silva');
    rows.push([`2024-01-0${(i % 9) + 1} 09:00`, i * 2], [`2024-01-0${(i % 9) + 1} 10:00`, i * 2],
              [`2025-01-0${(i % 9) + 1} 09:00`, i * 2 + 1], [`2025-01-0${(i % 9) + 1} 10:00`, i * 2 + 1]);
  }
  assert.strictEqual(Roster.suggest(raw(people, rows)).length, 3);
  assert.deepStrictEqual(Roster.suggest(raw(['Ana'], [['2024-01-01 09:00', 0]])), []);
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `node --test tests/test_roster.js`
Expected: FAIL — `Roster.isPhone is not a function`.

- [ ] **Step 3: Implement detection**

In `static/roster.js`, add these constants beside `SLOTS` and `DAY`:

```js
  const MAX_SUGGESTIONS = 3;
  const REPLY_MAX = 12 * 3600;   // the window people.js already calls a reply
  const OVERLAP_MAX = 0.05;      // spans may share at most 5% of their union
  const NAME_SIM_MIN = 0.85;
  const PHONE = /^\+?\d[\d\s()\-.]{6,}$/;
```

Then insert before the `return`:

```js
  // ---------- probable duplicates ----------

  function normalise(s) {
    return String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function isPhone(name) { return PHONE.test(String(name).trim()); }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length || !b.length) return Math.max(a.length, b.length);
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
                          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function similarity(a, b) {
    const max = Math.max(a.length, b.length);
    return max ? 1 - levenshtein(a, b) / max : 1;
  }

  function wordSubset(a, b) {
    const A = a.split(' '), B = b.split(' ');
    const sub = (x, y) => x.every(w => y.indexOf(w) >= 0);
    return sub(A, B) || sub(B, A);
  }

  /* Why these two names might belong to one person, or null. Two phone numbers
   * say nothing either way — near-identical numbers are usually two people. */
  function nameAffinity(a, b) {
    const pa = isPhone(a), pb = isPhone(b);
    if (pa && pb) return null;
    if (pa !== pb) return 'phone_number';
    const na = normalise(a), nb = normalise(b);
    if (na === nb || wordSubset(na, nb) || similarity(na, nb) >= NAME_SIM_MIN) return 'similar_name';
    return null;
  }

  /* First and last day each person wrote. */
  function spans(chat) {
    const out = chat.people.map(() => null);
    for (const r of chat.rows) {
      const d = Math.floor(r[0] / DAY), s = out[r[1]];
      if (!s) out[r[1]] = { lo: d, hi: d };
      else { if (d < s.lo) s.lo = d; if (d > s.hi) s.hi = d; }
    }
    return out;
  }

  /* Overlap measured against the SHORTER span, never the union. Against the
   * union, anyone long-tenured looks disjoint from anyone short-lived — a person
   * writing for 18 months and a number appearing for 2 days at the end overlap
   * by under 1% of the union, and would be offered as the same person. Against
   * the shorter span those 2 days are 100%, so only a name that goes quiet
   * before the other starts can pass. */
  function overlapRatio(a, b) {
    if (!a || !b) return 1;
    const overlap = Math.max(0, Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) + 1);
    const shorter = Math.min(a.hi - a.lo + 1, b.hi - b.lo + 1);
    return shorter > 0 ? overlap / shorter : 1;
  }

  /* Pairs that ever answered each other inside REPLY_MAX. Relies on rows being
   * chronological, the same assumption parse.py makes for start/end; the gap >= 0
   * guard keeps unsorted input from reading a backward jump as an exchange. */
  function exchanged(chat) {
    const n = chat.people.length, seen = new Set();
    for (let i = 1; i < chat.rows.length; i++) {
      const prev = chat.rows[i - 1], cur = chat.rows[i];
      const gap = cur[0] - prev[0];
      if (prev[1] !== cur[1] && gap >= 0 && gap < REPLY_MAX) {
        seen.add(Math.min(prev[1], cur[1]) * n + Math.max(prev[1], cur[1]));
      }
    }
    return seen;
  }

  /* Pairs that look like one person twice. Conservative on purpose: accepting a
   * suggestion is one click and silently rewrites every number in the app, so a
   * false positive costs more than a miss. */
  function suggest(chat) {
    const n = chat.people.length;
    if (n < 2) return [];
    const sp = spans(chat), ex = exchanged(chat);
    const c = counts(chat, initial(chat)).perEntry;
    const out = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (ex.has(i * n + j)) continue;
        const affinity = nameAffinity(chat.people[i], chat.people[j]);
        if (!affinity) continue;
        if (overlapRatio(sp[i], sp[j]) > OVERLAP_MAX) continue;
        const [a, b] = c[i] >= c[j] ? [i, j] : [j, i];
        out.push({ a, b, reasons: [affinity, 'span_disjoint', 'no_replies'] });
      }
    }
    return out.sort((x, y) => (c[y.a] + c[y.b]) - (c[x.a] + c[x.b])).slice(0, MAX_SUGGESTIONS);
  }
```

Extend the returned object to add `suggest, isPhone, normalise, similarity`:

```js
  return { SLOTS, RosterError, clone, initial, apply, counts,
           toggle, setColor, rename, merge, split, takenSlots, entryOf, sameEntry,
           suggest, isPhone, normalise, similarity };
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/test_roster.js && python -m pytest -q`
Expected: PASS, 34 roster tests, whole suite green.

- [ ] **Step 5: Commit**

```bash
git add static/roster.js tests/test_roster.js
git commit -m "feat: conservative duplicate-identity detection"
```

---

### Task 5: The strings

**Files:**
- Modify: `static/i18n.js`

**Interfaces:**
- Consumes: nothing.
- Produces: the keys Tasks 6–9 render. `ChatI18n.t(lang, key, vars)` already substitutes `{name}` placeholders.

- [ ] **Step 1: Confirm the completeness test is the guard**

Run: `node --test tests/test_i18n.js`
Expected: PASS now, and it must still pass after this task — it fails on any key present in one language and missing from the other.

- [ ] **Step 2: Add the English keys**

In `static/i18n.js`, inside `STRINGS.en`, after the `export: 'Export', new_chat: 'New chat',` line, add:

```js
      roster_btn: 'People',
      roster_title: 'Who’s in this analysis?',
      roster_sub: '{n} names · drag one onto another if they’re the same person',
      roster_footer: '{n} in · {msgs} msgs',
      roster_analyse: 'Analyse',
      roster_cancel: 'Cancel',
      roster_reset: 'Reset',
      roster_colour_for: 'Colour for {name}',
      roster_same_as: 'Same person as…',
      roster_unmerge: 'Separate again',
      roster_drop_hint: 'drop to merge',
      roster_taken: 'already used by {name}',
      roster_preview_note: 'How {name} will look on the People tab.',
      roster_none_selected: 'Pick at least one person.',
      roster_merge_note: 'Merged people count as one, so messages between them stop counting as replies.',
      roster_excluded: '{n} excluded',
      roster_dup_title: '<b>{a}</b> and <b>{b}</b> look like the same person.',
      roster_dup_merge_as: 'Merge as “{name}”',
      roster_dup_reject: 'Different people',
      reason_no_replies: 'They never reply to each other.',
      reason_phone_number: 'One is a phone number, the other a saved name.',
      reason_similar_name: 'The names are nearly identical.',
      reason_span_disjoint: '{b} only starts writing after {a} stops.',
```

- [ ] **Step 3: Add the Portuguese keys**

In `STRINGS.pt`, at the matching position, add:

```js
      roster_btn: 'Pessoas',
      roster_title: 'Quem entra nesta análise?',
      roster_sub: '{n} nomes · arraste um sobre o outro se forem a mesma pessoa',
      roster_footer: '{n} dentro · {msgs} msgs',
      roster_analyse: 'Analisar',
      roster_cancel: 'Cancelar',
      roster_reset: 'Restaurar',
      roster_colour_for: 'Cor de {name}',
      roster_same_as: 'Mesma pessoa que…',
      roster_unmerge: 'Separar de novo',
      roster_drop_hint: 'solte para unir',
      roster_taken: 'já usada por {name}',
      roster_preview_note: 'Como {name} vai aparecer na aba Pessoas.',
      roster_none_selected: 'Escolha pelo menos uma pessoa.',
      roster_merge_note: 'Pessoas unidas contam como uma, então mensagens entre elas deixam de contar como respostas.',
      roster_excluded: '{n} fora',
      roster_dup_title: '<b>{a}</b> e <b>{b}</b> parecem ser a mesma pessoa.',
      roster_dup_merge_as: 'Unir como “{name}”',
      roster_dup_reject: 'Pessoas diferentes',
      reason_no_replies: 'Nunca respondem uma à outra.',
      reason_phone_number: 'Um é um número de telefone e o outro um nome salvo.',
      reason_similar_name: 'Os nomes são quase idênticos.',
      reason_span_disjoint: '{b} só começa a escrever depois que {a} para.',
```

- [ ] **Step 4: Run the i18n test**

Run: `node --test tests/test_i18n.js`
Expected: PASS — both languages complete.

- [ ] **Step 5: Commit**

```bash
git add static/i18n.js
git commit -m "feat: roster strings, EN and PT"
```

---

### Task 6: Wire the roster into the app shell

No modal yet. After this task the app projects every chat through a default roster, and `python -m pytest` plus a manual load must behave exactly as before. That is the point: prove the projection is invisible before putting UI on top of it.

**Files:**
- Modify: `static/app.js`
- Modify: `templates/index.html` (script tag, header button)
- Modify: `static/view-wrapped.js:29-30`

**Interfaces:**
- Consumes: `ChatRoster.initial`, `apply`, `counts`, `suggest`, `RosterError`; `App.slotColor` from Task 1.
- Produces: `App.state.raw`, `App.state.roster`, `App.state.suggestions`, `App.applyRoster()`, and a `#rosterBtn` element in the header. Task 7 calls `App.applyRoster()` and reads/writes `App.state.roster`.

- [ ] **Step 1: Load the module and add the header button**

In `templates/index.html`, add the script before `app.js` (order matters — `app.js` closes over its dependencies):

```html
<script src="/static/roster.js"></script>
```

so the block reads `range.js`, `stats.js`, `people.js`, `words.js`, `roster.js`, `i18n.js`, `wrapped.js`, `export.js`, `app.js`, then the views.

In the header, immediately before the export `div.menu`, add:

```html
      <button class="btn chat-only hidden" id="rosterBtn"><i class="ti ti-users-group"></i><span data-i18n="roster_btn"></span></button>
```

- [ ] **Step 2: Hold the raw chat and the roster in state**

In `static/app.js`, in the `state` object, replace the `chat: null,      // API response` line with:

```js
    raw: null,       // the /api/parse response, never mutated
    roster: null,    // the user's configuration over it
    suggestions: [], // probable duplicate identities, computed once per upload
    chat: null,      // raw projected through roster — shaped like the API response
```

- [ ] **Step 3: Split `load` into load + applyRoster**

Replace the whole `load` function with:

```js
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
```

`R.validate` clamps into the new span, and the extra `from > to` guard catches the case where the old range sat entirely outside it after an exclusion.

- [ ] **Step 4: Note exclusions in the header, and reset the new state on unload**

In `renderHeader`, replace the final `sub.innerHTML = ...` statement with:

```js
    const off = state.roster ? state.roster.entries.filter(e => !e.on).length : 0;
    sub.innerHTML = `<b>${esc(who)}</b> · ${esc(t('n_messages', { n: num(state.msgs.length) }))} · ` +
      `${esc(t(c.platform === 'ios' ? 'iphone_export' : 'android_export'))} · ${esc(t('lang_' + c.language))}` +
      (off ? ` · ${esc(t('roster_excluded', { n: num(off) }))}` : '');
```

In `unload`, replace `state.chat = null;` with:

```js
    state.chat = state.raw = state.roster = null;
    state.suggestions = [];
```

- [ ] **Step 5: Give the Wrapped card the roster's colours**

In `static/view-wrapped.js`, replace:

```js
    const colors = Wr.PALETTE.people;
    const split = m.split.map(s => ({ name: s.name, pct: s.pct, color: colors[s.p % 6] }));
```

with:

```js
    const colors = Wr.PALETTE.people, slots = App.state.chat.colors;
    const slot = p => (slots && slots[p] != null ? slots[p] : p) % colors.length;
    const split = m.split.map(s => ({ name: s.name, pct: s.pct, color: colors[slot(s.p)] }));
```

- [ ] **Step 6: Close the IIFE over `ChatRoster`**

At the bottom of `static/app.js`, the IIFE is invoked with one argument. Change the invocation

```js
})(typeof ChatRange !== 'undefined' ? ChatRange : require('./range.js'));
```

to

```js
})(typeof ChatRange !== 'undefined' ? ChatRange : require('./range.js'),
   typeof ChatRoster !== 'undefined' ? ChatRoster : require('./roster.js'));
```

and change the header `const App = (function (R) {` to `const App = (function (R, Roster) {`.

Add `applyRoster` to the object `App` returns.

- [ ] **Step 7: Run the tests**

Run: `python -m pytest -q`
Expected: PASS, including `test_app_color.js` and `test_app_esc.js` — `require('../static/app.js')` still works because `roster.js` resolves through the same `require` fallback.

- [ ] **Step 8: Verify by hand that nothing changed — with one deliberate exception**

Run: `python app.py`, open `http://localhost:5001`, upload `chats/group.txt`.
Expected: identical to before — five tabs, same numbers, date bar and hash still
restore a range on reload-after-reupload. A **People** button now sits in the
header and does nothing yet.

**The one deliberate exception: chats with more than six participants get new
colours.** The palette grew from six slots to twelve in Task 1, so `App.color(p)`
already went from `p % 6` to `p % 12` app-wide, and Step 5 brings the Wrapped
canvas into line. People at index 6–11 therefore now get their own colour instead
of reusing person 0–5's. That is the entire point of the palette expansion, not a
regression — but it *is* user-visible, so check a 7+ person chat's Wrapped tab and
People cards and confirm the new colours look right, rather than checking that
nothing moved. On a chat of six or fewer, nothing changes at all.

- [ ] **Step 9: Commit**

```bash
git add static/app.js static/view-wrapped.js templates/index.html
git commit -m "feat: project every chat through a roster; colours follow its slots"
```

---

### Task 7: The modal — roster list, selection and merging

**Files:**
- Create: `static/view-roster.js`
- Modify: `templates/index.html` (modal container, CSS, script tag)
- Modify: `static/app.js` (open on load, header button, Esc)

**Interfaces:**
- Consumes: `App.state.raw/roster/suggestions`, `App.applyRoster()`, `App.slotColor`, `App.t/esc/num`, and all of `ChatRoster`.
- Produces: `ChatRosterView.open()` and `ChatRosterView.close()`. Tasks 8 and 9 add the colour editor and the banner to this module's `render()`.

- [ ] **Step 1: Add the modal container and its CSS**

In `templates/index.html`, add before `<div class="tip hidden" id="tip"></div>`:

```html
<div class="modal-back hidden" id="rosterBack">
  <div class="modal" id="rosterModal" role="dialog" aria-modal="true" aria-labelledby="rosterTitle"></div>
</div>
```

Add to the stylesheet, after the `.tip` rule:

```css
.modal-back{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:200;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:40px 16px}
@media(max-width:480px){.modal-back{padding:0}}
.modal{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);width:100%;max-width:540px;box-shadow:0 28px 80px rgba(0,0,0,.7)}
@media(max-width:480px){.modal{max-width:none;min-height:100vh;border:none;border-radius:0}}
.modal-h{padding:15px 17px 13px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:11px}
.modal-h .ic{width:30px;height:30px;border-radius:50%;flex-shrink:0;display:grid;place-items:center;background:radial-gradient(circle,var(--card) 0 34%,#000 35% 100%);box-shadow:0 0 0 1px var(--border);color:var(--accent)}
.modal-h h3{font-size:14.5px;font-weight:700;letter-spacing:-.02em}
.modal-h p{font-size:11px;color:var(--muted);line-height:1.45;margin-top:2px}
.modal-h .x{margin-left:auto;background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;line-height:1}
.modal-f{padding:11px 17px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.modal-f .sp{flex:1}
.modal-f .cnt{font:11px var(--font-mono);color:var(--muted)}

.ros-row{display:flex;align-items:center;gap:10px;padding:8px 17px;border-bottom:1px solid var(--border)}
.ros-row:last-child{border-bottom:none}
.ros-row.off{opacity:.4}
.ros-row.drop{outline:1px dashed var(--accent);outline-offset:-1px;background:rgba(var(--accent-rgb),.07)}
.ros-row.drag{opacity:.4}
.ros-row .nm{flex:1;min-width:0;font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ros-row .ct{font:11px var(--font-mono);color:var(--label);min-width:40px;text-align:right}
.ros-bar{width:58px;height:5px;background:var(--cell0);border-radius:2px;overflow:hidden;flex-shrink:0}
.ros-bar div{height:100%}
.ros-grip{color:var(--border);cursor:grab;flex-shrink:0;font-size:13px;line-height:1}
.ros-cb{accent-color:var(--accent);width:15px;height:15px;flex-shrink:0;cursor:pointer;margin:0}
.ros-dot{width:16px;height:16px;border-radius:50%;flex-shrink:0;cursor:pointer;border:none;padding:0;box-shadow:0 0 0 1px rgba(255,255,255,.15)}
[data-theme="light"] .ros-dot{box-shadow:0 0 0 1px rgba(0,0,0,.18)}
.ros-dot.open{box-shadow:0 0 0 1px var(--surface),0 0 0 3px var(--accent)}
.ros-act{width:22px;height:22px;border:1px solid transparent;border-radius:3px;background:none;color:var(--muted);cursor:pointer;flex-shrink:0;display:grid;place-items:center;font-size:13px}
.ros-act:hover,.ros-act.lit{color:var(--accent);border-color:var(--accent)}
.ros-group{margin:6px 11px;border:1px solid var(--accent);border-radius:var(--radius-sm);background:rgba(var(--accent-rgb),.05)}
.ros-group .ros-row{border-bottom:none;padding:8px 6px 7px}
.ros-kids{padding:0 8px 7px 44px}
.ros-kid{display:flex;gap:7px;font-size:11px;color:var(--muted);padding:2px 0}
.ros-kid .c{margin-left:auto;font-family:var(--font-mono)}
.ros-name{flex:1;min-width:0;height:26px;background:var(--bg);border:1px solid var(--accent);border-radius:3px;color:var(--text);padding:0 8px;font:600 12.5px var(--font);outline:none}
.ros-menu{position:relative}
.ros-menu .menu-list{max-height:210px;overflow-y:auto;right:0}
.ros-menu .menu-list button{font-size:12px;padding:6px 9px}
```

Add the script tag after `roster.js`'s, at the end of the view block:

```html
<script src="/static/view-roster.js"></script>
```

- [ ] **Step 2: Write the modal module**

Create `static/view-roster.js`:

```js
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
  const local = { draft: null, open: -1, menu: -1, dismissed: new Set() };

  function chat() { return App.state.raw; }

  function suggestions() {
    return App.state.suggestions.filter(s =>
      !local.dismissed.has(s.a + ':' + s.b) && !Roster.sameEntry(local.draft, s.a, s.b));
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

  function render() {
    const { esc, t, num } = App;
    const c = Roster.counts(chat(), local.draft);
    const max = Math.max(...c.perEntry, 1);
    const list = local.draft.entries.map((e, i) =>
      e.src.length > 1 ? group(e, i, c.perEntry[i]) : row(e, i, c.perEntry[i], max)).join('');
    $('rosterModal').innerHTML = `
      <div class="modal-h">
        <div class="ic"><i class="ti ti-users-group"></i></div>
        <div style="min-width:0">
          <h3 id="rosterTitle">${esc(t('roster_title'))}</h3>
          <p>${esc(t('roster_sub', { n: num(local.draft.entries.length) }))}</p>
        </div>
        <button class="x" id="rosClose" aria-label="${esc(t('roster_cancel'))}">&times;</button>
      </div>
      <div id="rosBanner"></div>
      <div id="rosList">${list}</div>
      <div class="note" style="padding:0 17px 10px"><i class="ti ti-info-circle"></i>${esc(t('roster_merge_note'))}</div>
      <div class="modal-f">
        <button class="btn" id="rosReset">${esc(t('roster_reset'))}</button>
        <span class="sp"></span>
        <span class="cnt">${c.on ? esc(t('roster_footer', { n: num(c.on), msgs: num(c.messages) })) : esc(t('roster_none_selected'))}</span>
        <button class="btn btn-primary" id="rosApply" ${c.on ? '' : 'disabled'}>${esc(t('roster_analyse'))}</button>
      </div>`;
    wire();
  }

  function edit(fn) { local.draft = fn(local.draft); local.menu = -1; render(); }

  function wire() {
    const m = $('rosterModal');
    $('rosClose').addEventListener('click', close);
    $('rosReset').addEventListener('click', () => { local.open = -1; edit(() => Roster.initial(chat())); });
    $('rosApply').addEventListener('click', apply);

    m.querySelectorAll('[data-toggle]').forEach(el =>
      el.addEventListener('change', () => edit(r => Roster.toggle(r, +el.dataset.toggle))));
    m.querySelectorAll('[data-split]').forEach(el =>
      el.addEventListener('click', () => { local.open = -1; edit(r => Roster.split(r, +el.dataset.split, chat())); }));
    m.querySelectorAll('[data-menu]').forEach(el =>
      el.addEventListener('click', e => {
        e.stopPropagation();
        const i = +el.dataset.menu;
        local.menu = local.menu === i ? -1 : i;
        render();
      }));
    m.querySelectorAll('[data-merge]').forEach(el =>
      el.addEventListener('click', () => {
        local.open = -1;
        edit(r => Roster.merge(r, +el.dataset.into, +el.dataset.merge));
      }));
    m.querySelectorAll('.ros-name').forEach(el => {
      el.addEventListener('change', () => {
        const i = +el.closest('.ros-row').dataset.i;
        local.draft = Roster.rename(local.draft, i, el.value, chat());
      });
      el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); });
    });

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
        if (Number.isFinite(from) && from !== into) { local.open = -1; edit(r => Roster.merge(r, into, from)); }
      });
    });
  }

  function apply() {
    App.state.roster = local.draft;
    App.applyRoster();
    close();
  }

  function open() {
    local.draft = Roster.clone(App.state.roster);
    local.open = local.menu = -1;
    $('rosterBack').classList.remove('hidden');
    render();
    const first = $('rosterModal').querySelector('input,button');
    if (first) first.focus();
  }

  function close() {
    $('rosterBack').classList.add('hidden');
    local.draft = null;
    const btn = $('rosterBtn');
    if (btn) btn.focus();
  }

  function isOpen() { return !$('rosterBack').classList.contains('hidden'); }

  function newChat() { local.dismissed.clear(); }

  return { open, close, isOpen, render, newChat, local };
})(App, typeof ChatRoster !== 'undefined' ? ChatRoster : null);
```

- [ ] **Step 3: Open it from `app.js`**

In `static/app.js`, at the end of `load()`, after `showTab(state.tab);`, add:

```js
    if (typeof ChatRosterView !== 'undefined') { ChatRosterView.newChat(); ChatRosterView.open(); }
```

In `boot()`, beside the other header listeners, add:

```js
    $('rosterBtn').addEventListener('click', () => ChatRosterView.open());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && typeof ChatRosterView !== 'undefined' && ChatRosterView.isOpen()) ChatRosterView.close();
    });
```

Esc closing means **cancel**: `local.draft` is thrown away and `App.state.roster` is untouched, which is why `load()` calls `applyRoster()` before opening — the charts behind the dim are already real and correct.

- [ ] **Step 4: Verify by hand**

Run: `python app.py`, upload `chats/group.txt`.
Expected, at 1280px and 400px, dark and light, EN and PT:
- the modal opens over rendered charts, not an empty page
- unchecking a person dims the row and the footer count drops; unchecking everyone disables **Analyse**
- dragging one row onto another produces a group with an editable name and its members listed with counts
- `⇄` opens "same person as…" and merging from it produces the same group
- Tab reaches every control including `⇄`; merging with keyboard only works
- the unlink button splits a group back apart
- **Analyse** closes the modal and every tab reflects the new roster; **Esc** closes it and changes nothing
- the header **People** button reopens it with the applied roster

- [ ] **Step 5: Run the suite and commit**

Run: `python -m pytest -q`
Expected: PASS.

```bash
git add static/view-roster.js templates/index.html static/app.js
git commit -m "feat: participants modal — selection and merging by drag or menu"
```

---

### Task 8: The colour editor and its live preview

**Files:**
- Modify: `static/view-roster.js`
- Modify: `templates/index.html` (CSS only)

**Interfaces:**
- Consumes: `Roster.setColor`, `Roster.takenSlots`, `Roster.counts`, `App.slotColor`, `App.pct`.
- Produces: nothing new; extends `render()`.

- [ ] **Step 1: Add the editor CSS**

Append to the stylesheet in `templates/index.html`, after the `.ros-menu` rules:

```css
.ros-edit{margin:0 11px 8px;border:1px solid var(--accent);border-radius:var(--radius-sm);background:var(--card);padding:11px 12px 12px}
.ros-edit .l{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:8px}
.ros-sws{display:grid;grid-template-columns:repeat(12,1fr);gap:6px;margin-bottom:12px}
@media(max-width:480px){.ros-sws{grid-template-columns:repeat(6,1fr)}}
.ros-sw{aspect-ratio:1;border-radius:50%;border:none;padding:0;cursor:pointer;box-shadow:0 0 0 1px rgba(255,255,255,.15)}
[data-theme="light"] .ros-sw{box-shadow:0 0 0 1px rgba(0,0,0,.18)}
.ros-sw.sel{box-shadow:0 0 0 2px var(--card),0 0 0 4px var(--accent)}
.ros-sw.taken{opacity:.45}
.ros-prev{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);position:relative;overflow:hidden}
.ros-prev::before{content:'';position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--hue)}
.ros-prev-h{display:flex;align-items:center;gap:10px;padding:10px 12px 8px}
.ros-prev-h .n{font-size:13px;font-weight:700}
.ros-prev-h .s{margin-left:auto;text-align:right}
.ros-prev-h .s .v{font-size:18px;font-weight:800;color:var(--hue);line-height:1;font-variant-numeric:tabular-nums}
.ros-prev-h .s .l{font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-top:2px}
.ros-prev .avatar{width:32px;height:32px;font-size:13px}
.ros-prev-strip{display:flex;height:20px;border-top:1px solid var(--border)}
.ros-prev-strip div{display:flex;align-items:center;padding:0 7px;font:700 9.5px var(--font);color:#0c0c0c;overflow:hidden;white-space:nowrap}
```

The preview reuses the real `.avatar` rule so its `color:#0c0c0c` on `var(--hue)` is the same pixels the People tab will draw.

- [ ] **Step 2: Render the editor under the open row**

In `static/view-roster.js`, add before `render()`:

```js
  /* The colour editor: twelve slots and a live People card. The card carries
   * every contrast-critical use of a person's colour at once — filled avatar,
   * colour-as-text percentage, labelled share segment — so what you see in it
   * is what the People tab will draw. */
  function editor(e, i, count, total) {
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
    return `<div class="ros-edit" style="--hue:${App.slotColor(e.color)}">
      <div class="l">${esc(t('roster_colour_for', { name }))}</div>
      <div class="ros-sws">${sws}</div>
      <div class="ros-prev" style="--hue:${App.slotColor(e.color)}">
        <div class="ros-prev-h">
          <div class="avatar">${esc([...name][0] || '?')}</div>
          <div style="min-width:0"><div class="n">${esc(name)}</div></div>
          <div class="s"><div class="v">${esc(pct(total ? count / total : 0))}</div><div class="l">${esc(t('of_messages'))}</div></div>
        </div>
        <div class="ros-prev-strip"><div style="background:${App.slotColor(e.color)};width:100%">${esc(name)} · ${esc(num(count))}</div></div>
      </div>
      <div class="note"><i class="ti ti-info-circle"></i>${esc(t('roster_preview_note', { name }))}</div></div>`;
  }
```

In `render()`, replace the `list` assignment with:

```js
    const total = c.perEntry.reduce((a, b) => a + b, 0);
    const list = local.draft.entries.map((e, i) => {
      const main = e.src.length > 1 ? group(e, i, c.perEntry[i]) : row(e, i, c.perEntry[i], max);
      return main + (local.open === i ? editor(e, i, c.perEntry[i], total) : '');
    }).join('');
```

- [ ] **Step 3: Wire the dot and the swatches**

In `wire()`, add:

```js
    m.querySelectorAll('[data-color]').forEach(el =>
      el.addEventListener('click', () => {
        const i = +el.dataset.color;
        local.open = local.open === i ? -1 : i;
        local.menu = -1;
        render();
      }));
    m.querySelectorAll('[data-slot]').forEach(el =>
      el.addEventListener('click', () => edit(r => Roster.setColor(r, +el.dataset.for, +el.dataset.slot))));
```

`edit()` already re-renders, and because `local.open` is untouched the editor stays open with the new colour showing in the preview.

- [ ] **Step 4: Verify by hand**

Run: `python app.py`, upload `chats/group.txt`, open the modal.
Expected:
- clicking a colour dot opens twelve swatches plus a preview card under that row; clicking it again closes them
- picking a swatch updates the dot, the row's share bar, and all three coloured parts of the preview at once
- slots another person holds are dimmed, carry a "already used by …" tooltip, and remain pickable
- **Analyse**, then People tab: that person's card is the colour the preview showed; Wrapped uses it too; toggling the theme keeps both correct
- at 400px the swatch grid wraps to two rows of six

- [ ] **Step 5: Run the suite and commit**

Run: `python -m pytest -q`
Expected: PASS.

```bash
git add static/view-roster.js templates/index.html
git commit -m "feat: twelve-slot colour editor with a live People-card preview"
```

---

### Task 9: The duplicate banner

**Files:**
- Modify: `static/view-roster.js`
- Modify: `templates/index.html` (CSS only)

**Interfaces:**
- Consumes: `App.state.suggestions` (from Task 6), `Roster.merge`, `Roster.entryOf`, `Roster.rename`.
- Produces: nothing new; fills `#rosBanner`.

- [ ] **Step 1: Add the banner CSS**

Append to the stylesheet:

```css
.ros-sugg{margin:11px 17px 6px;border:1px solid var(--accent);border-radius:var(--radius-sm);background:rgba(var(--accent-rgb),.07);padding:9px 11px;font-size:11.5px;line-height:1.5}
.ros-sugg .r1{display:flex;gap:8px;align-items:flex-start}
.ros-sugg .r1 i{color:var(--accent);flex-shrink:0}
.ros-sugg .why{color:var(--muted);font-size:10.5px;margin:6px 0 0 20px;padding-left:9px;border-left:1px solid var(--border);line-height:1.55}
.ros-sugg .acts{display:flex;gap:6px;margin:8px 0 0 20px;flex-wrap:wrap}
.ros-sugg .acts .btn{height:24px;font-size:11px;padding:0 9px}
```

- [ ] **Step 2: Render the banner**

In `static/view-roster.js`, add before `render()`:

```js
  /* One card per probable duplicate, with the evidence spelled out so a wrong
   * guess is easy to reject. Never applies itself. */
  function banner() {
    const { esc, t } = App;
    const people = chat().people;
    return suggestions().map(s => {
      const a = people[s.a], b = people[s.b];
      const why = s.reasons.map(k => t('reason_' + k, { a, b })).join(' ');
      return `<div class="ros-sugg" data-sugg="${s.a}:${s.b}">
        <div class="r1"><i class="ti ti-alert-triangle"></i><div>${t('roster_dup_title', { a: esc(a), b: esc(b) })}</div></div>
        <div class="why">${esc(why)}</div>
        <div class="acts">
          <button class="btn btn-primary" data-keep="${s.a}" data-drop="${s.b}">${esc(t('roster_dup_merge_as', { name: a }))}</button>
          <button class="btn" data-keep="${s.b}" data-drop="${s.a}">${esc(t('roster_dup_merge_as', { name: b }))}</button>
          <button class="btn" data-reject="${s.a}:${s.b}">${esc(t('roster_dup_reject'))}</button>
        </div></div>`;
    }).join('');
  }
```

`roster_dup_title` carries `<b>` tags, so its two names are escaped before substitution and the result is not escaped again.

In `render()`, replace `<div id="rosBanner"></div>` with `<div id="rosBanner">${banner()}</div>`.

- [ ] **Step 3: Wire the three buttons**

In `wire()`, add:

```js
    m.querySelectorAll('[data-keep]').forEach(el =>
      el.addEventListener('click', () => {
        const keep = +el.dataset.keep, drop = +el.dataset.drop;
        local.dismissed.add(Math.min(keep, drop) + ':' + Math.max(keep, drop));
        local.open = -1;
        edit(r => {
          const target = Roster.entryOf(r, keep), other = Roster.entryOf(r, drop);
          if (target < 0 || other < 0 || target === other) return r;
          return Roster.rename(Roster.merge(r, target, other), Math.min(target, other),
                               chat().people[keep], chat());
        });
      }));
    m.querySelectorAll('[data-reject]').forEach(el =>
      el.addEventListener('click', () => { local.dismissed.add(el.dataset.reject); render(); }));
```

`merge` splices the other entry out, so the surviving entry's index is `min(target, other)` — that is the index `rename` must target to make the kept name stick, whichever of the two the user chose.

Suggestion keys are always stored `min:max` so the `dismissed` set matches the key `suggest()` produced, regardless of which button was pressed.

- [ ] **Step 4: Verify by hand**

Build a fixture with a duplicate:

```bash
python tools/gen_chat.py chats/group.txt "Ana,Pepe,Jenni,Bia,Caio" "Vinyl Club"
```

then copy `chats/group.txt` and, in the copy, rename every `Caio` header after some mid-point date to `+55 11 98877-1234` so the two never interleave. Upload the copy.
Expected:
- the banner appears, names both identities, and explains itself in one sentence per reason
- `Merge as "Caio"` produces a group named Caio; `Merge as "+55 …"` produces one named by the number
- `Different people` dismisses the card, and it does not come back when the modal is reopened
- uploading a chat with no duplicates shows no banner at all
- both languages read correctly

- [ ] **Step 5: Run the suite and commit**

Run: `python -m pytest -q`
Expected: PASS.

```bash
git add static/view-roster.js templates/index.html
git commit -m "feat: duplicate-identity banner with its reasoning and one-click merge"
```

---

### Task 10: Fix the Activity legend, and document the manual checks

`opensCloses()` builds its legend from `st.chat.people.slice(0, 6)` while the three bars above it each come from `shareOf()`, which ranks **per metric** and keeps its own top 6 plus "Others". The legend can therefore name someone who appears in none of the three bars and omit someone who dominates one. It is pre-existing, and the roster makes it easier to hit by changing person order.

**Files:**
- Modify: `static/view-activity.js`
- Modify: `docs/rebuild-manual-verification.md`

**Interfaces:**
- Consumes: `App.color`, `App.name`.
- Produces: nothing.

- [ ] **Step 1: Build the legend from what the bars actually show**

In `static/view-activity.js`, in `opensCloses`, replace:

```js
    const legend = st.chat.people.slice(0, 6).map((p, i) => `<div class="who"><span class="dot" style="background:${App.color(i)}"></span>${esc(p)}</div>`).join('');
    return `<div class="fl-row">...
```

with:

```js
    const bars = [shareOf(fl.first), shareOf(fl.last), shareOf(starters)];
    // The three bars rank independently, so the legend is the union of whoever
    // any of them shows — never the chat's first six people, who may appear in
    // none of them.
    const shown = new Map();
    for (const entries of bars) for (const e of entries) shown.set(e.p, (shown.get(e.p) || 0) + e.count);
    const legend = [...shown.keys()]
      .sort((a, b) => (a < 0) - (b < 0) || shown.get(b) - shown.get(a))
      .map(p => `<div class="who"><span class="dot" style="background:${App.color(p)}"></span>${esc(App.name(p))}</div>`).join('');
    return `<div class="fl-row">
```

and change the three `bar(...)` calls to reuse the computed arrays: `bar(bars[0])`, `bar(bars[1])`, `bar(bars[2])`.

Sorting `(a < 0) - (b < 0)` first pushes the "Others" bucket to the end; `App.name(-1)` already renders it as the localised "Others".

- [ ] **Step 2: Verify by hand**

Run: `python app.py`, upload `chats/group.txt`, Activity tab.
Expected: every colour in the three bars has a legend entry with the right name, "Others" is last when present, and no legend entry is missing from all three bars. Exclude two people and reload the tab — the legend still matches.

- [ ] **Step 3: Document the manual checks**

Append to `docs/rebuild-manual-verification.md`:

```markdown
## Participants modal
- [ ] Opens automatically after every upload, over already-rendered charts (not a blank page)
- [ ] Unchecking a person dims the row, drops the footer count, and after Analyse removes them from every total, the calendar, reply medians, the word cloud, Wrapped and the .xlsx/.csv export
- [ ] Unchecking everyone disables Analyse and shows "Pick at least one person."
- [ ] Excluding whoever owns the first or last day shrinks the date bar's span, and a previously selected range outside the new span is clamped rather than left empty
- [ ] Drag one row onto another → group with an editable name, members listed with their own counts
- [ ] `⇄` → "same person as…" produces the identical group; reachable and usable by keyboard alone; works on a phone
- [ ] Unlink splits a group; names come back from the export, colours do not collide
- [ ] Colour dot → 12 swatches + live People card; picking one updates dot, share bar and all three coloured parts of the preview
- [ ] Slots held by someone else are dimmed with an "already used by …" tooltip and still pickable
- [ ] The chosen colour is what People, Activity, Messages, Wrapped and the card's canvas draw, in dark and light
- [ ] Duplicate banner: appears only when flagged, explains itself, both "Merge as …" buttons keep the right name, "Different people" dismisses it for good
- [ ] No banner at all on a chat with nothing flagged
- [ ] Esc and × cancel — the previous roster survives untouched
- [ ] Header "People" button reopens the modal with the applied roster
- [ ] Header subtitle gains "· N excluded" whenever anyone is out
- [ ] All of the above at 1280px and 400px, dark and light, EN and PT
```

- [ ] **Step 4: Run the whole suite**

Run: `python -m pytest -q`
Expected: PASS — every Python and JS test.

- [ ] **Step 5: Commit**

```bash
git add static/view-activity.js docs/rebuild-manual-verification.md
git commit -m "fix: Activity legend follows the bars, not the chat's first six people"
```

---

## Self-review

**Spec coverage** — every section maps to a task:

| Spec section | Task |
|---|---|
| Twelve-slot palette, `slotColor`, colour as an integer | 1 |
| `wrapped.js` palette grows to 12 | 1 |
| Roster model, invariant, `initial`, `apply`, `counts`, `RosterError` | 2 |
| `start`/`end` recomputed from surviving rows | 2 |
| `toggle`, `setColor`, `rename`, `merge`, `split`, `takenSlots`, `entryOf`, `sameEntry` | 3 |
| `suggest` — all three conditions, reasons, cap of 3, pair ordering | 4 |
| i18n keys, EN + PT | 5 |
| `state.raw`/`roster`/`suggestions`, `applyRoster`, range re-validation, `load()` applies before opening, header button, "N excluded" | 6 |
| `view-wrapped.js` colour slot | 6 |
| Modal shell, roster list, selection, drag merge, `⇄` fallback, group with editable name, split, footer, Esc = cancel, focus handling | 7 |
| Colour editor, twelve swatches, taken-slot marking, live preview tile | 8 |
| Duplicate banner, reasoning, merge-as-either-name, dismissal persisting across reopens | 9 |
| `view-activity.js` legend fix | 10 |
| Manual verification checklist | 10 |
| Non-goals (no persistence, no hash encoding, no free hex, server untouched) | Honoured by omission — no task adds any of them |

**Placeholder scan** — no TBD/TODO, no "add error handling", no "similar to Task N". Every code step carries the actual code.

**Type consistency** — checked across tasks: `slotColor(slot)` (Tasks 1, 7, 8), `Roster.counts(chat, roster) -> { perEntry, on, messages }` (Tasks 2, 7, 8), `rename(roster, i, name, chat)` and `split(roster, i, chat)` both take `chat` as the last argument (Tasks 3, 7, 9), `suggest(chat) -> [{ a, b, reasons }]` consumed as `state.suggestions` (Tasks 4, 6, 9), `applyRoster()` called by Task 7's `apply()`. `local.dismissed` keys are `min:max` in both the writer (Task 9) and the reader (Task 7's `suggestions()`).

**One deliberate gap:** Tasks 7–9 have no automated tests, because this project has no DOM harness — `tests/test_app_esc.js` says so explicitly and `requirements-dev.txt` pins only pytest. That is why every rule those tasks need lives in `roster.js` behind unit tests, and why each has a hand-verification step with concrete expectations.
