# Participant roster — selection, colours and merged identities

**Date:** 2026-09-20
**Status:** Approved design, awaiting spec review
**Mockups:** `.superpowers/brainstorm/3275-1789872244/content/` —
`participants-modal.html` (three approaches, **B** chosen), `colour-freedom.html`
(curated palette chosen, with option 3's live preview), `popup-v1.html`
(consolidated design, approved as-is)

## Goal

After a chat loads, open a modal listing every participant. There the user can
drop people from the analysis, give anyone a different colour, and fuse two
names that are really one person into a single identity under a chosen name.
The modal can be reopened from the header at any time.

## Decisions made during brainstorming

| Topic | Decision |
|---|---|
| Merge gesture | Drag one row onto another. A `⇄` button on each row opens a "same person as…" list — the same operation for keyboard and touch, since drag-and-drop is unusable on a phone and unreachable by keyboard, and this app is responsive to 480px. |
| Unselecting | The person is **dropped entirely**. Their messages leave the dataset: every total, percentage, reply median, heatmap cell, word count, Wrapped figure and export row is computed as if they never wrote. "87% of messages" keeps meaning 87% of what is shown. |
| Colour choice | A **curated palette of twelve** theme-paired slots. A colour is stored as a slot index, never a hex, so the theme toggle keeps working and no pick can be illegible. "Illegible" here means *as a fill* — see Palette contrast below. |
| Colour preview | Picking a colour shows a **live People card** for that person underneath the swatches, in the current theme only. |
| Duplicate detection | In v1, **conservative**: flag a pair only on strong name affinity *and* near-disjoint activity *and* no replies between them. Shows its reasoning. Never auto-applies. |
| When it opens | On **every** load, including a two-person chat with nothing to decide. |
| Recomputation | Changing the roster re-runs every tab synchronously. No progress state. |

## Non-goals

- **Persisting the roster.** Nothing about the chat survives a reload today —
  the file is parsed in memory and dropped — so there is nothing for a saved
  roster to attach to. A new upload starts from a fresh default roster.
- **Putting the roster in the URL hash.** Merged identities carry a user-typed
  display name; a real person's name in a URL breaks the app's stated promise
  that nothing is stored, logged or sent anywhere. The hash keeps carrying only
  tab, range and language.
- **Free-form colour picking.** Ruled out during brainstorming: a person's
  colour is painted as an avatar background with `#0c0c0c` text on it, *and* as
  the share percentage in text on the panel. Those pull opposite ways, the app
  ships two separately-tuned themes, and an unguarded hex silently produces an
  unreadable card.
- **Server-side anything.** `parse.py` and `/api/parse` are untouched.
- Editing a non-merged person's display name. Names come from the export.

## Palette contrast — a known, inherited limit

Measured during Task 1's review rather than assumed. A person's colour serves two
incompatible jobs. In 8 of its 13 call sites it is a **fill carrying `#0c0c0c`
text** (avatar, share segment, legend dot, KPI rail, finder track), which wants a
*light* value. In one site — `.bub .who`, `static/view-messages.js:60` — it is
**11px bold text on a near-white bubble**, which wants a *dark* value. One token
cannot maximise both.

The existing six slots resolve this toward fills, and consequently four of them
fail 4.5:1 as small text on `--surface`: `--p1` 3.62:1 (the app's own accent),
`--p2` 2.47:1, `--p3` 3.91:1, `--p6` 4.36:1. The six new slots are tuned the same
way and four of them fail likewise (`--p7` 3.90, `--p8` 3.62, `--p9` 3.37, `--p12`
3.49).

**This feature does not fix that, and deliberately does not retune the palette to
chase it.** Making the new six pass would leave them visibly darker than the
original six — incoherent in a design system copied wholesale from
vinyl-collection — and would weaken the dominant fill use. What this feature does
do is widen the exposure from six slots to twelve.

The real fix is one of two things, both outside this scope: stop using the raw
person colour as small text at `view-messages.js:60` (e.g. keep the name in
`--text` and carry identity with a coloured dot, as the Activity legend already
does), or retune all twelve light values and accept the visual change. Recorded
here so the next person finds it stated rather than rediscovering it.

## Architecture

The roster is a **projection over the parse result**, not a filter threaded
through the app.

```
/api/parse ──► state.raw        (the API response, never mutated)
                   │
                   ├── Roster.initial(raw) ──► state.roster   (user's config)
                   │
               Roster.apply(raw, roster)
                   │
                   ▼
              state.chat        (same shape as the API response)
                   │
              ChatRange.prepare ──► state.msgs ──► every view, unchanged
```

`apply` returns an object with the same shape `/api/parse` returns, plus a
`colors` array. That is the whole trick: `stats.js`, `people.js`, `words.js`,
`wrapped.js`, `export.js` and all five views already take `(msgs, nPeople)` and
`chat.people`, so **none of them change**. They cannot tell a projected chat
from a parsed one.

Person indices in `state.chat` are dense and in roster-entry order. Nothing
downstream holds an index across a roster change, because `applyRoster()`
rebuilds `state.msgs` and calls each view's `reset()` before re-rendering — the
same path `load()` already uses.

### Files

| File | Change |
|---|---|
| `static/roster.js` | **New.** Pure functions: the roster model, `apply`, the edit operations, duplicate detection. No DOM. |
| `static/view-roster.js` | **New.** The modal: markup, drag-and-drop, the `⇄` fallback menu, colour editor, preview tile, duplicate banner. |
| `static/app.js` | `state.raw` / `state.roster`; `color()` and `colorValue()` read `state.chat.colors`; `load()` opens the modal; new `applyRoster()`; header button; `renderHeader()` notes exclusions. |
| `static/wrapped.js` | `PALETTE.people` grows from 6 to 12 dark hexes. |
| `static/view-wrapped.js` | `colors[s.p % 6]` → the person's roster slot. |
| `static/i18n.js` | New keys, EN + PT. |
| `static/view-activity.js` | Targeted fix, see below. |
| `templates/index.html` | `--p7…--p12` in both theme blocks; modal markup and CSS; header button. |
| `tests/test_roster.js` | **New.** Picked up automatically by `tests/test_js.py`. |
| `docs/rebuild-manual-verification.md` | New section for the modal. |

## The roster model (`static/roster.js`)

```js
{
  entries: [
    { src: [0, 6], name: 'Ana',  color: 0, on: true  },
    { src: [1],    name: 'Pepe', color: 1, on: true  },
    { src: [4],    name: 'Caio', color: 4, on: false },
  ]
}
```

`src` holds indices into `raw.people`. **Invariant:** every index of
`raw.people` appears in exactly one entry's `src`, exactly once. `color` is a
slot in `0…11`. Entry order is display order and becomes the person index in
the projected chat.

Every function is pure and returns a new roster; none mutates its input.

| Function | Behaviour |
|---|---|
| `initial(chat)` | One entry per person, in the order `parse.py` returned them (already sorted by message count), `src:[i]`, `name: chat.people[i]`, `color: i % 12`, `on: true`. |
| `apply(chat, roster)` | The projected chat. See below. |
| `toggle(roster, i)` | Flips `on`. |
| `setColor(roster, i, slot)` | Sets `color`. Duplicate slots are allowed — the modal flags them, it does not forbid them. |
| `rename(roster, i, name)` | Sets `name`. A name trimmed to empty falls back to the first `src` member's original name. |
| `merge(roster, target, other)` | Appends `other.src` onto `target.src` and drops `other`. The result keeps the **target's** `name`, `color` and `on`. |
| `split(roster, i)` | Replaces a multi-`src` entry with one entry per member, in `src` order, each with its original name, at entry `i`'s position. The first keeps entry `i`'s colour; each remaining one takes the lowest slot in `0…11` no other entry is using, or `src index % 12` if all twelve are taken. Each restored entry inherits entry `i`'s `on`. |
| `suggest(chat)` | Probable duplicates. See below. |

### `apply(chat, roster)`

```js
{
  platform, language, title,   // copied through
  people: ['Ana', 'Pepe'],     // name of each on-entry, in entry order
  colors: [0, 1],              // colour slot of each on-entry
  rows:  [...],                // surviving rows, person index remapped
  start: '2023-04-02',         // recomputed
  end:   '2026-09-18',         // recomputed
}
```

- Build `map` of length `chat.people.length`, filled with `-1`; for each
  `on` entry at new index `j`, set `map[s] = j` for every `s` in its `src`.
- `rows` keeps rows where `map[r[1]] >= 0`, with `r[1]` replaced by `map[r[1]]`.
  Row order is preserved, so the result stays chronological.
- `start` / `end` come from the **first and last surviving row**, not from the
  input chat. Excluding the only person who wrote in the first year genuinely
  moves the chat's first day, and the date bar, presets and date inputs all
  read `chat.start` / `chat.end`.
- `apply` requires at least one `on` entry whose `src` covers at least one
  message; the modal's Analyse button enforces this, and `apply` throws
  `RosterError('empty')` if called anyway. `RosterError` is exported alongside
  the functions, mirroring how `parse.py` exports `ParseError`.

Merging is real, not cosmetic: once `Ana` and `Ana Souza` are one person,
messages between them stop counting as replies to each other, which shifts
everyone's reply medians and the conversation-starter shares. That is the
correct reading of "same person" and is called out in the modal copy.

### Duplicate detection — `suggest(chat)`

Returns at most **3** pairs, each `{ a, b, reasons: [...] }`, ordered so `a` has
more messages than `b` (so "Merge as *a*" is the leading button). A pair is
suggested only when **all three** hold:

1. **No replies between them.** No message from `b` immediately follows a
   message from `a`, or vice versa, within `ChatPeople.REPLY_MAX` (12 h). Two
   identities of one person essentially never answer each other.
2. **Name affinity**, any one of:
   - exactly one of the two is phone-shaped — `/^\+?[\d][\d\s()\-.]{6,}$/` on
     the trimmed name (the "same person, new number" case);
   - after normalising (casefold, strip diacritics, collapse whitespace) one
     name's words are a subset of the other's — `Ana` ⊂ `Ana Souza`;
   - normalised Levenshtein similarity ≥ `0.85`.
3. **Near-disjoint activity.** With each person's span running first message day
   → last message day, `overlapDays / min(spanA, spanB) <= 0.05`.

   The denominator is the **shorter** span, not the union. Measured against the
   union, anyone with a long tenure looks disjoint from anyone short-lived: in a
   chat where Ana writes across eighteen months and a new number appears for two
   days at the end, their two days of overlap are under 1% of the union, so Ana
   and the number would be offered as the same person. Against the shorter span
   those same two days are 100% overlap, and only a number that appears *after*
   its predecessor goes quiet survives the test.

`reasons` are keys (`no_replies`, `phone_number`, `similar_name`,
`span_disjoint`) rendered through i18n, so the banner can explain itself. People
already inside a multi-`src` entry are skipped.

The bar is deliberately high. A false positive is worse than a miss here,
because accepting a suggestion is one click and silently changes every number in
the app.

## The modal (`static/view-roster.js`)

Not an `App.register` view — that is for tabs. The module exposes
`ChatRosterView.open()` and `close()`; `app.js` owns the state transition.

Structure, top to bottom, as approved in `popup-v1.html`:

- **Header** — title, `{n} names · drag one onto another if they're the same
  person`, close button.
- **Duplicate banner** — only when `suggest()` returned something. Per pair: the
  two names, the reasons as prose, and three buttons —
  `Merge as "A"`, `Merge as "B"`, `Different people`. Dismissing a pair hides it
  until a new chat is loaded — including across modal reopens, so a rejected
  guess never comes back to nag.
- **Roster list** — one row per entry: drag handle, checkbox, colour dot, name,
  share bar, message count, and `⇄`. An `off` row is dimmed. A multi-`src` entry
  renders as a bordered group: its display name is an `<input>`, its members are
  listed beneath with their individual counts, and `✕` splits it.
- **Colour editor** — opened by the colour dot, inline under that row. Twelve
  swatches; the slots another entry already uses are marked but still pickable.
  Beneath them, a live People card for that person — filled avatar, colour-as-
  text percentage, labelled share segment — which is every contrast-critical use
  of a person's colour in one tile.
- **Footer** — `Reset`, the live `{n} in · {msgs} msgs` count, `Analyse`.
  `Analyse` is disabled while nothing is selected.

### Interaction and accessibility

- Rows are `draggable="true"`; `dragover` marks the drop target, `drop` merges
  the dragged entry into the target.
- `⇄` opens a menu of the other entries — the same merge, reachable by keyboard
  and usable on a phone. Both paths call `Roster.merge`.
- `role="dialog"`, `aria-modal="true"`, focus moved into the modal on open and
  restored on close, Tab trapped inside it.
- Esc closes the modal, which means **cancel**: the roster reverts to what it
  was when the modal opened, consistent with the Esc handling
  `tests/test_app_esc.js` already covers.
- On first load, cancelling still applies the default roster, so the user
  always lands on the charts.

## Changes in `app.js`

```js
state.raw      // the /api/parse response
state.roster   // the user's config
state.chat     // Roster.apply(state.raw, state.roster)
```

- `slotColor(slot)` / `slotColorValue(slot)` — new, and the only place a slot
  becomes a CSS variable: `var(--p${slot + 1})`.
- `color(p)` / `colorValue(p)` keep their signature and their meaning — **`p` is
  an index into the projected `state.chat.people`** — but resolve through the
  roster: `slotColor(state.chat.colors[p])`, falling back to `p % 12` when
  `colors` is absent. `p < 0` still resolves to `--muted` for the "Others"
  bucket.
- The modal must **not** use `color(p)`. Its rows include excluded entries, which
  have no index in the projected chat, so it colours every row and its preview
  tile from `slotColor(entry.color)` directly.
- `load(chat)` sets `state.raw` and `state.roster = Roster.initial(chat)`, runs
  `Roster.suggest(chat)`, calls `applyRoster()` so the app is in a fully
  rendered, valid state, and *then* opens the modal over it. Nothing downstream
  ever sees a null `state.chat`, the ghosted charts behind the dim are real, and
  cancelling out of the first modal needs no special case.
- `applyRoster()` — new: projects the chat, re-prepares `state.msgs`, recomputes
  `first` / `last` / `presets`, **re-validates `from`/`to` against the new span
  and clamps them** (a narrow range can fall outside the chat after an
  exclusion), calls each view's `reset()`, then `renderHeader()`,
  `renderDatebar()` and `invalidate()`.
- A **People** button joins Export and New chat in the header, `chat-only`,
  reopening the modal against the current roster.
- `renderHeader()` appends `· {n} excluded` when any entry is `off`, so a
  filtered analysis never looks like the whole chat.

## Targeted fix in `view-activity.js`

`opensCloses()` builds its legend from `st.chat.people.slice(0, 6)` coloured by
`App.color(i)`, while the three bars above it come from `shareOf()`, which ranks
**per metric** and keeps its own top 6 plus "Others". The legend can therefore
name someone who appears in none of the three bars, and omit someone who
dominates one. It is pre-existing, and the roster makes it easier to hit by
changing person order. Fix: build the legend from the union of `e.p` across the
three `shareOf()` results, in descending share, plus "Others" when any bar has
it. Nothing else in that file changes.

## i18n

New keys in both languages: `roster_btn`, `roster_title`, `roster_sub`,
`roster_footer`, `roster_analyse`, `roster_cancel`, `roster_reset`,
`roster_colour_for`, `roster_same_as`, `roster_unmerge`, `roster_drop_hint`,
`roster_taken`, `roster_preview_note`, `roster_none_selected`,
`roster_merge_note`, `roster_excluded`, `roster_dup_title`,
`roster_dup_merge_as`, `roster_dup_reject`, and one per reason —
`reason_no_replies`, `reason_phone_number`, `reason_similar_name`,
`reason_span_disjoint`. `tests/test_i18n.js` already fails on any key present in
one language and missing from the other.

## Performance

- `apply` is one filter and one map over `rows` — a few milliseconds at 100k
  messages, and it runs only when the roster changes.
- `suggest` is one O(rows) adjacency pass plus O(people²) span comparisons, once
  per upload.
- Reopening the modal and pressing Analyse re-runs all five tabs through the
  existing `invalidate()` path. At 100k messages that is a visible pause;
  accepted, as agreed, with no progress state in v1.

## Testing

`tests/test_roster.js`, run by the existing `tests/test_js.py` parametrisation
(no registration needed), using `tests/helpers.js`:

**`apply`**
- an excluded person's rows are gone and the surviving indices are dense
- a merged entry collapses two source indices to one; counts add up
- `start` / `end` move when the excluded person owned the first or last day
- neither the input chat nor the input roster is mutated
- `colors` lines up with `people`
- no `on` entry → `RosterError('empty')`

**Edit operations**
- `merge` keeps the target's name, colour and `on`, and drops the other entry
- `split` restores original names in `src` order and assigns unused colour slots
- `toggle`, `setColor`, `rename` are pure; an empty `rename` falls back
- the every-index-exactly-once invariant survives merge → split → merge

**`suggest`**
- flags a phone-number successor: disjoint spans, no replies between them
- flags `Ana` / `Ana Souza`
- silent when the two reply to each other inside 12 h
- silent when the spans overlap
- silent for a long-tenured person against a short-lived number that overlaps
  them — the case the union-based ratio would have got wrong
- tells nothing from two similar-looking phone numbers
- silent for two plainly different names
- accent- and case-insensitive (`José` / `jose`)
- never returns more than 3 pairs

Manual verification, appended to `docs/rebuild-manual-verification.md`: the
modal on a two-person and a group export, drag merge, `⇄` merge, merge by
keyboard only, split, colour change reflected on People / Activity / Wrapped /
export, exclusion shrinking the date range, Esc cancelling, and reopening from
the header.
