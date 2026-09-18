# Chat Analyzer — rebuild in the portfolio identity

**Date:** 2026-09-18
**Status:** Approved design, awaiting spec review
**Mockup:** `.superpowers/brainstorm/2300-1789770289/content/mockup-v1.html` (approved as-is)

## Goal

Rebuild `whatsapp_parser` (Streamlit) as a Flask + vanilla-JS app that shares
vinyl-collection's visual identity, keeps every existing feature, fixes the
known defects, and adds four new feature bundles: Overview KPIs + calendar,
People profiles, Message browser, and a Chat Wrapped card.

## Decisions already made

| Topic | Decision |
|---|---|
| Stack | Flask + a single `templates/index.html` + plain JS modules in `static/`, like vinyl-collection. Streamlit is removed. |
| Identity | Vinyl's design system (ground, walnut borders, Inter + Courier Prime, 3–4px radii, KPI tiles, section labels, nav tabs, Tabler icons). Only the accent differs: this app's accent is green `#5FBF7A` in dark mode and `#3d8a55` in light mode, where vinyl's is gold. |
| Storage | Stateless. The upload is parsed in memory and the result returned as JSON. Nothing is written to disk or logged. |
| Architecture | "Thin parse API": the server only parses; every aggregate is computed in the browser, so changing the date range never needs a re-upload. |
| Layout | Landing screen → 5 tabs: **Overview · Activity · People · Messages · Wrapped**, with a date-range bar that stays in place on every tab. |

## Non-goals (this version)

- Accounts, saved analyses, shareable links, any database.
- AI summaries or sentiment. They would mean sending chat text to a third party, which breaks the privacy promise.
- Media analysis (exports are "without media").
- Comparing two chats or two periods side by side.

## Identity / theming

- Copy vinyl's token block verbatim, then override the accent:
  - dark: `--accent:#5FBF7A; --accent-rgb:95,191,122`
  - light: `--accent:#3d8a55; --accent-rgb:61,138,85`
- Person palette `--p1…--p6` reuses vinyl's event colours (green, gold, blue, violet, red, pink), with light-mode variants as in the mockup. Groups with more than 6 people cycle through the palette; charts show the top 8 senders plus "Others".
- Dark/light theme toggle in the header, persisted in `localStorage` (wrapped in try/catch).
- Fonts: Google Fonts Inter + Courier Prime. Icons: `@tabler/icons-webfont@3.6.0` from jsDelivr, the same version vinyl pins.
- Logo: a record label with the Tabler `message-circle-2` icon, the counterpart of vinyl's record logo.
- All charts are hand-built SVG/CSS, as in vinyl. No Plotly, matplotlib or wordcloud.

## Architecture

```
browser                                   Flask (app.py)
───────                                   ──────────────
landing: drop .txt/.zip ──POST /api/parse──▶ parse.py
                                             ├─ unzip (if .zip) → _chat.txt
                                             ├─ detect platform (iOS / Android)
                                             ├─ whatstk → rows
                                             ├─ classify type, strip system msgs
                                             └─ JSON  (nothing persisted)
state = parsed JSON  ◀────────────────────── 
  │
  ├─ static/range.js     filter rows by [start,end], presets
  ├─ static/stats.js     KPIs, streaks, calendar, hours, heatmap, types, share
  ├─ static/people.js    per-person profile, reply times, convo starters, first/last
  ├─ static/words.js     tokenizer, stopwords, word cloud counts, word counter, emojis, links
  ├─ static/wrapped.js   Wrapped card model + PNG render (canvas)
  ├─ static/i18n.js      EN/PT strings, auto-detect
  └─ templates/index.html  layout, CSS, rendering, event wiring
```

Every `static/*.js` model module is made of pure functions over the row array.
Each is loaded as a plain script in the browser and `require`d by node tests,
using the same UMD-ish pattern as vinyl's `activity.js` / `grouping.js`.
Rendering lives in `index.html`.

### Files

| File | Purpose |
|---|---|
| `app.py` | Flask app: `GET /`, `POST /api/parse`, `GET /healthz`. |
| `parse.py` | Pure parsing: bytes → dict. No Flask imports. Replaces `whatsapp_parser/whats_app_parser.py` and `utils.py`. |
| `templates/index.html` | Whole UI. |
| `static/*.js` | Model modules listed above. |
| `static/chat-icon.svg` / `.png` | Favicon. |
| `requirements.txt` | `flask`, `gunicorn`, `whatstk` (+ its deps only). |
| `requirements-dev.txt` | `-r requirements.txt`, `pytest`. |
| `Procfile`, `railway.toml`, `Dockerfile` | Deploy (gunicorn). Same shape as vinyl. |
| `tests/` | pytest suite, plus `test_*.js` run through pytest wrappers (vinyl's pattern). |

**Deleted:** `streamlit.py`, `utils.py` (the Fernet key code), `.streamlit/`,
`whatsapp_parser/`, `wpp_logo.png`, `language/*.json` (strings move into `static/i18n.js`).

**.gitignore fix:** the current file ignores `*.html` and `tests/`. Both must
go, or `templates/index.html` and the test suite would never be committed.
Add `.superpowers/`.

## API

### `POST /api/parse`

- Request: `multipart/form-data`, field `file`, either a `.txt` or a `.zip` (iPhone exports are zips containing `_chat.txt`; take the first `.txt` inside).
- Limit: `MAX_UPLOAD_MB` env var, default 50. An oversized upload returns 413.
- The upload is read into memory (`BytesIO`); zips are opened with `zipfile` in memory. `whatstk.df_from_txt_whatsapp` takes a file path, so the decoded text is written to a `tempfile.NamedTemporaryFile(delete=True)` inside a `with` block and parsed from there. The file is removed even if an exception is raised. This is the only file the app ever writes, and it exists only for the length of the request.
- No request body or message text is ever logged. Errors are logged by class name only.
- Response 200:

```json
{
  "platform": "ios" | "android",
  "language": "pt" | "en",          // detected from system strings, fallback "en"
  "title": "Group name" | null,     // groups only
  "people": ["Pepe", "Jenni"],      // ordered by message count desc
  "start": "2023-03-04", "end": "2026-09-14",
  "rows": [
    // [epoch_seconds, person_index, type_code, text]
    [1677931200, 0, "t", "bom dia"],
    [1677931260, 1, "a", ""]
  ]
}
```

  - Rows are arrays, not objects, to keep the payload small. The text for media and deleted rows is `""`.
  - Type codes: `t` text, `a` audio, `p` photo, `s` sticker, `v` video, `g` GIF, `d` document, `m` generic media (Android `<Media omitted>`), `x` deleted, `l` link (text that contains a URL; the text is kept).
  - Timestamps are the chat's local wall-clock time, encoded as if UTC, so the browser never applies a timezone shift. The client reads them with `getUTC*`.
- Response 4xx: `{"error": "<code>"}`, where code is one of `no_file`, `bad_type`, `too_large`, `empty_zip`, `unparseable`, `no_messages`. The client maps each code to an i18n string on the landing screen.

### `GET /healthz` → `ok`

## Parsing rules (`parse.py`)

1. Decode as UTF-8 (falling back to `utf-8-sig`), and strip `‎`, ` ` and `​`.
2. Platform: a first non-empty line starting with `[` means iOS; otherwise Android.
3. Build rows with whatstk. Pass date formats through explicitly when auto-detection fails. Both the iOS `dd/mm/yyyy, HH:MM:SS` and Android `dd/mm/yyyy HH:MM` families must parse. If whatstk fails, return `unparseable`.
4. System messages are dropped: encryption notice, "created group", "added you", "changed the subject", "left", "joined using this group's invite link", "changed this group's icon", and "security code changed", in PT and EN. Keep the list as a table in `parse.py`.
5. Group title: in iOS groups the first (system) line's sender is the group name. Capture it before dropping that line. Android gives `null`.
6. Type classification, a table-driven map in PT and EN:
   - iOS: `audio omitted/áudio ocultado`, `image omitted/imagem ocultada`, `sticker omitted/figurinha omitida`, `video omitted/vídeo omitido`, `GIF omitted/GIF omitido`, `document omitted/documento omitido` (also when prefixed by a filename)
   - Android: `<Media omitted>/<Mídia oculta>` → `m`
   - both: `This message was deleted/Mensagem apagada/You deleted this message/Você apagou esta mensagem` → `x`
   - any `https?://` in a text message → `l`
   - otherwise `t`
7. Language: `pt` if any PT system or media string was seen, else `en`.
8. People are ordered by message count, descending.

## Client features

### Landing (no chat loaded)

Drop zone (click or drag) for `.txt`/`.zip`, then the privacy line, export steps for iPhone and Android, and a footer linking GitHub, LinkedIn and Vinyl Collection. While parsing, the record spins and the text says "Reading N MB…". Errors appear inline under the drop zone.

### Header (chat loaded)

The subtitle reads `<names or group title> · N messages · iPhone/Android export · Portuguese/English`. Then: EN/PT toggle (auto-set from `language`, the user can override), theme toggle, **Export** (a menu with `.xlsx` and `.csv` of the *filtered* rows), and **New chat** (back to the landing screen, clearing state).

Export runs entirely in the browser. CSV is built in JS. XLSX uses SheetJS from cdnjs (`xlsx/0.18.5/xlsx.full.min.js`), loaded lazily on the first xlsx click. The columns match today's Excel file: timestamp, sender, message, type, weekday.

### Date bar (persistent)

Presets: **All**, **12 mo**, **30 d**, and one button per calendar year present in the chat. Two date inputs are bounded by the chat's `start`/`end`. If start > end, show an inline warning and leave the last valid range active. The bar shows `N days · M msgs` for the range. The range, active tab and language are kept in the URL hash, so a refresh after re-upload restores the view (nothing about the chat itself goes in the URL).

Everything below uses the filtered range: word cloud, word counter and export included. Those three ignored the range before; that was the bug being fixed.

### Overview

- **KPIs (4 tiles):**
  1. Messages: total, per-day average, total words, and a sparkline of weekly counts.
  2. Active days: days with ≥ 1 message out of days in the range, the % talked, and bars for the weekday distribution.
  3. Longest streak: consecutive active days, its dates, and the current streak if the range ends on the chat's last day.
  4. Busiest day: its count and date, with a "read that day →" link that jumps to Messages.
- **Calendar:** one year at a time (year buttons, defaulting to the latest year in range), in a GitHub-style 7×53 grid. Accent intensity is split into 4 quantile buckets of non-zero days. Hover shows the date and count; a click opens Messages at that day. Days outside the range are dimmed.
- **Who talks more:** a horizontal share bar plus a ranked list. Groups show the top 8 plus "Others".
- **What gets sent:** a horizontal bar per type, each split by person, with bar length on a sqrt scale so small types stay visible. Android shows `Media` in place of the breakdown and a note explaining why.
- **Word cloud:** Everyone / per-person switch. Top 40 words after stopwords (a PT + EN list, which includes the current `words_to_be_removed`). Size ∝ sqrt(count). Clicking a word opens Messages with that search.

### Activity

- **Messages over time:** one SVG line per person (top 5 plus "Others" in groups), with Day / Week / Month granularity (default Week) and a "Fill empty days" toggle (the existing feature). Hover shows a crosshair with per-person values.
- **Weekday × hour heatmap:** a 7×24 grid showing counts in cells, with a Count / "% of week" switch. Hover shows a tooltip; a click opens Messages filtered to that weekday + hour. The week starts on Sunday, matching today's labels.
- **By hour:** 24 bars with a day/night gradient strip under the axis (a nod to the old per-hour palette).
- **Opens & closes the day:** share bars for first message of the day, last message of the day (the old hidden Graph 7), and conversation starters (first message after ≥ 4 h of silence).

### People

One card per person (grid, sortable by messages, fastest reply, longest messages, or night owl):

- Share %, and a one-line role derived from the person's extremes. Examples: "Night owl" when after-midnight % is highest; "Fastest replier"; "Starts most conversations"; "Says good night" when they send the most last-messages. Show at most 2 roles, only for groups of 2–12.
- Stats: messages, words/msg, median reply time (only replies sent < 12 h after a message from someone else), starts convos %, after midnight % (00:00–04:59), media sent.
- Top 5 emojis (Unicode extended-pictographic regex, ZWJ sequences kept whole).
- Signature words: top 5 by count × (their rate / everyone's rate), which puts distinctive words above merely common ones.
- "Their day": 24 small hourly bars.
- Clicking a card opens Messages filtered to that person.

### Messages

- A virtualised chat-bubble list (render only the visible window, to handle 100k+ rows) with sticky day separators. The first person listed is drawn on the "me" side; a setting swaps sides. Groups show sender names in their person colour.
- Toolbar: search (with highlight, hit count, and ↑/↓ to step through hits), person filter, and type filter.
- Entry points from other tabs (calendar day, busiest day, heatmap cell, word, person card) set filters and scroll to the target.
- **Word counter** (side panel; the existing feature, improved): the search term, **Whole words only** (default on, Unicode-aware word boundaries) and **Match case** (default off); per-person bars and a total; a per-month sparkline.
- **Links shared:** top domains with counts.

### Wrapped

- A 360×640 card (Story 9:16) or 360×360 (Square), in the fixed dark palette regardless of theme, so shared images look the same.
- Period: one button per year in the chat, plus All time. The card ignores the date bar and uses its own period, which is explained in a note.
- Content: message total, longest streak, busiest day, peak hour, top emoji, fastest replier, top word (**hidden by default**, opt-in), and a per-person split bar. Groups show the top 3 people and "+N".
- Privacy toggles: hide names ("You"/"Them", or "Person 1…N" in groups) and hide top word.
- **Download PNG:** drawn to a `<canvas>` at 3× (1080×1920), not an HTML screenshot, so it needs no library. **Copy image** uses `navigator.clipboard.write` where supported and hides the button where it isn't.
- Footer brand: `● Chat Analyzer`. No domain until one exists.

## i18n

- `static/i18n.js` exports `{en:{…}, pt:{…}}` with every UI string, including the old `language/*.json` content that is still relevant.
- The default comes from the parsed `language`, then from `navigator.language` on the landing screen. The header toggle overrides it.
- Weekday and month names come from `Intl.DateTimeFormat` for the active language.
- Numbers use `Intl.NumberFormat` for the active language.

## Error handling

- Server: every parse failure maps to one of the error codes above. Unexpected exceptions return 500 `{"error":"internal"}`, and the log records only the exception class.
- Client: a network or 5xx error shows the old "something went wrong, email me" help text (shortened) on the landing screen, with the error code and no chat contents. The client never retries automatically.
- Empty range (0 messages): every tab shows a single "No messages in this range" state instead of empty charts.
- A 1-person chat (e.g. messages to yourself) works: People shows 1 card, and the reply and starter stats show "—".

## Performance budget

- Parsing a 100k-message chat takes under 5 s on the server; the JSON payload is 8 MB or less.
- Recomputing all stats after a range change takes under 150 ms for 100k rows. Tokenising for words and emojis is cached per row index, so a range change only re-aggregates.
- The Messages list stays at 60 fps while scrolling 100k rows (virtualised).

## Testing

pytest is the single command, following vinyl's layout:

- `tests/test_parse.py`: fixtures in `tests/fixtures/` of small synthetic exports: iOS PT, iOS EN, Android PT, Android EN, an iOS group with a title, a zip, a multi-line message, and a deleted message. Each asserts platform, language, people order, row count, type codes and dropped system lines. The fixtures are hand-written, never real chats.
- `tests/test_api.py`: Flask test client covering 200 on each fixture, each error code, 413 for an oversized upload, and that no file remains in the temp dir after the request.
- `tests/test_stats.js`, `test_people.js`, `test_words.js`, `test_range.js`, `test_wrapped.js`: `node --test` on the pure modules, covering streaks across month/year edges, quantile buckets, reply-time rules (the 12 h cut-off, self-replies ignored), starter rule (≥ 4 h), whole-word matching ("oi" ≠ "noite", accents such as "você"), emoji ZWJ sequences, stopwords, and the privacy toggles on the Wrapped model. Each has a `tests/test_*.py` wrapper that skips when node is missing (vinyl's pattern).
- Manual verification doc: `docs/rebuild-manual-verification.md`, a checklist per tab in both themes and both languages at 400px and 1280px.

## Deployment

The deploy target is Railway (like vinyl): `Procfile` runs `web: gunicorn app:app`. The `Dockerfile` is kept and updated to gunicorn on `$PORT`. Environment variables: `MAX_UPLOAD_MB` (optional). No secrets needed.

## Migration of existing features (checklist)

| Streamlit feature | New home |
|---|---|
| Language select PT/EN | Header toggle, auto-detected |
| File uploader (.txt) | Landing drop zone (.txt **and .zip**) |
| "No database" warning | Privacy line, now accurate (the Fernet code is removed) |
| Start/end date + reset | Date bar + presets ("All" = reset) |
| Dataframe view | Messages tab (bubbles), plus Export for the tabular view |
| Word cloud | Overview → Words (range-aware, per person) |
| Activity heatmap | Activity → heatmap |
| Messages per hour | Activity → By hour |
| Messages per day + fill missing | Activity → Messages over time (+ granularity) |
| Types per user (iOS) | Overview → What gets sent (split by person) |
| Messages per user (pie) | Overview → Who talks more |
| Types of messages (iOS) | Overview → What gets sent |
| First/last message (unused) | Activity → Opens & closes the day |
| Word occurrences by person | Messages → Word counter (range-aware, whole-word) |
| Excel download | Header → Export (.xlsx/.csv, range-aware) |
| Android notice | Header shows "Android export"; types panel explains the Media row |
