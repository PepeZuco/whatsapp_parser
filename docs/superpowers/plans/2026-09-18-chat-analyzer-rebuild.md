# Chat Analyzer Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Streamlit WhatsApp analyzer with a stateless Flask + vanilla-JS app in the vinyl-collection visual identity, keeping every old feature and adding the Overview KPIs/calendar, People profiles, Message browser, and Chat Wrapped card.

**Architecture:** `POST /api/parse` turns a `.txt`/`.zip` export into compact JSON rows with a stdlib parser and keeps nothing. The browser does all analysis in pure JS model modules (`static/range|stats|people|words|wrapped|export|i18n.js`), rendered by one view module per tab (`static/view-*.js`) under a small shell (`static/app.js`). `templates/index.html` is markup + CSS only.

**Tech Stack:** Python 3.12+, Flask 3.0.3, gunicorn 22.0.0, pytest 9.1.1; node ≥ 20 for `node --test`; browser-side: no build step, Tabler icons 3.6.0 (jsDelivr), Inter + Courier Prime (Google Fonts), SheetJS 0.18.5 (cdnjs, lazy, xlsx export only).

**Spec:** `docs/superpowers/specs/2026-09-18-chat-analyzer-rebuild-design.md`

**Provenance:** every code block in this plan was run before the plan was written — all 45 pytest cases (26 parser, 12 API, and the seven JS suites via `tests/test_js.py`) pass, and the full UI was smoke-tested in headless Chromium on synthetic 22k-message pair and 10-person group chats at 1280px and 400px (no console errors, no horizontal overflow, every tab renders in < 75 ms). Copy the blocks verbatim.

## Global Constraints

- Work on branch `rebuild-flask` (already created; the spec is committed there). Every commit message ends with a blank line then `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Stateless: the server writes no files and never logs request bodies or message text — errors are logged by exception class name only.
- `requirements.txt` is exactly `flask==3.0.3` and `gunicorn==22.0.0`. No pandas/whatstk/plotly/streamlit.
- Timestamps are chat wall-clock encoded as UTC; client code reads dates only with `getUTC*` / `timeZone: 'UTC'`.
- Every string that came from the chat (names, words, message text, group title) goes through `App.esc` before touching `innerHTML`.
- Accent: dark `#5FBF7A` (`--accent-rgb:95,191,122`), light `#3d8a55` (`61,138,85`). All other tokens copied from vinyl-collection.
- Test fixtures are synthetic only — never commit a real chat export.
- `pytest` (from the repo root) is the one command that runs everything.

---

### Task 1: Clear out Streamlit and scaffold the Flask app

**Files:**
- Delete: `streamlit.py`, `utils.py`, `.streamlit/`, `whatsapp_parser/`, `wpp_logo.png`, `language/`
- Modify: `.gitignore`, `requirements.txt`, `Dockerfile`
- Create: `requirements-dev.txt`, `pytest.ini`, `Procfile`, `railway.toml`, `app.py` (first version), `templates/index.html` (stub, replaced in Task 10), `tests/__init__.py`, `tests/test_api.py` (first version)

**Interfaces:**
- Produces: Flask `app` object in `app.py` with `GET /` (renders `templates/index.html`) and `GET /healthz` → `ok`.

- [ ] **Step 1: Remove the Streamlit app**

```bash
git rm -r -q streamlit.py utils.py .streamlit whatsapp_parser wpp_logo.png language
```

- [ ] **Step 2: Replace `.gitignore`** (the old one ignored `*.html` and `tests/`, which would hide the new page and the whole suite)

```gitignore
*.ipynb
run.py
chats/
__pycache__/
.pytest_cache/
.vscode/
.superpowers/
secret.key
```

- [ ] **Step 3: Dependencies and pytest config**

`requirements.txt`:

```text
flask==3.0.3
gunicorn==22.0.0
```

`requirements-dev.txt`:

```text
# Test-only dependencies, kept out of requirements.txt so the deploy image stays small.
-r requirements.txt

pytest==9.1.1
```

`pytest.ini`:

```ini
[pytest]
pythonpath = .
testpaths = tests
```

Create an empty `tests/__init__.py` (tests import `tests.chats` in Task 2).

- [ ] **Step 4: Deploy files** (same shape as vinyl-collection)

`Procfile`:

```text
web: gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120
```

`railway.toml`:

```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120"
healthcheckPath = "/healthz"
healthcheckTimeout = 30
restartPolicyType = "on_failure"
```

`Dockerfile`:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PORT=8000
EXPOSE 8000
CMD gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120
```

- [ ] **Step 5: Write the failing test** — `tests/test_api.py`

```python
import pytest

import app as app_module


@pytest.fixture
def client():
    app_module.app.config['TESTING'] = True
    return app_module.app.test_client()


def test_healthz(client):
    assert client.get('/healthz').data == b'ok'


def test_index_serves_the_page(client):
    r = client.get('/')
    assert r.status_code == 200
    assert b'Chat Analyzer' in r.data
```

- [ ] **Step 6: Run it to see it fail**

Run: `pip install -r requirements-dev.txt && python -m pytest tests/test_api.py -v`
Expected: FAIL / collection error — `ModuleNotFoundError: No module named 'app'`.

- [ ] **Step 7: Minimal app** — `app.py`

```python
"""Chat Analyzer — stateless Flask front for parse.py."""

import os

from flask import Flask, render_template

app = Flask(__name__)


@app.get('/')
def index():
    return render_template('index.html')


@app.get('/healthz')
def healthz():
    return 'ok'


if __name__ == '__main__':
    app.run(debug=True, port=int(os.environ.get('PORT', '5001')))
```

`templates/index.html` (stub; Task 10 replaces it):

```html
<!DOCTYPE html>
<title>Chat Analyzer</title>
```

- [ ] **Step 8: Run tests — expect PASS**

Run: `python -m pytest -v`
Expected: 2 passed.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: replace Streamlit with a Flask scaffold

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Stdlib WhatsApp parser (`parse.py`)

**Files:**
- Create: `parse.py`, `tests/chats.py`, `tests/test_parse.py`

**Interfaces:**
- Produces:
  - `parse_text(text: str) -> dict` with keys `platform` (`'ios'|'android'`), `language` (`'pt'|'en'`), `title` (`str|None`), `people` (`list[str]`, by message count desc, ties by first appearance), `start`/`end` (`'YYYY-MM-DD'`), `rows` (`list[[epoch_seconds:int, person_index:int, type_code:str, text:str]]`).
  - `parse_upload(data: bytes, filename: str) -> dict` — same dict; handles `.txt` and `.zip`.
  - `classify(text: str) -> str` — one of `t a p s v g d m x l`.
  - `class ParseError(Exception)` with `.code` in `unparseable | no_messages | empty_zip | bad_type`.

Key rules (spec § Parsing rules): day/month order decided once per file (a field > 12 settles it, else day-first); 12h clocks; continuation lines join with `\n`; Android sender-less headers and iOS LRM-prefixed non-media lines are system lines; the iOS group title is the first sender if they end with zero kept messages.

- [ ] **Step 1: Synthetic fixtures** — `tests/chats.py`

```python
"""Synthetic WhatsApp exports, one per platform/language family.

Hand-written — never real chats. Kept as Python strings (not .txt fixtures) so
the invisible characters WhatsApp puts in exports stay visible as escapes:
LRM = U+200E marks iOS system/media lines, NNBSP = U+202F sits before AM/PM.
"""

LRM = '\u200e'
NNBSP = '\u202f'

# iPhone, Portuguese, 1:1. Day-first (25/03 proves it). The encryption notice
# comes from the contact, not a group title.
IOS_PT = (
    f"[12/03/2023, 09:15:02] Jenni: {LRM}As mensagens e as ligações são protegidas com a criptografia de ponta a ponta.\n"
    "[12/03/2023, 09:15:02] Pepe: bom dia\n"
    "[12/03/2023, 09:16:40] Jenni: bom dia amor\n"
    "tudo bem?\n"
    f"[12/03/2023, 09:17:00] Jenni: {LRM}áudio ocultado\n"
    f"[12/03/2023, 22:01:13] Pepe: {LRM}imagem ocultada\n"
    "[13/03/2023, 00:10:00] Pepe: olha https://open.spotify.com/album/x\n"
    f"[14/03/2023, 07:00:00] Jenni: {LRM}Mensagem apagada\n"
    f"[25/03/2023, 18:30:00] Pepe: {LRM}figurinha omitida\n"
)

# iPhone, English, group. Month-first (3/13 proves it), 2-digit year, 12h clock.
# Every line from "Vinyl Club" is a system line, which is how the title is found.
IOS_EN_GROUP = (
    f"[3/12/23, 9:15:02{NNBSP}AM] Vinyl Club: {LRM}Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.\n"
    f"[3/12/23, 9:15:02{NNBSP}AM] Vinyl Club: {LRM}Pepe created group “Vinyl Club”\n"
    f"[3/12/23, 9:16:10{NNBSP}AM] Pepe: welcome!\n"
    f"[3/12/23, 9:20:00{NNBSP}AM] Ana: hi all\n"
    f"[3/13/23, 10:05:33{NNBSP}PM] Jenni: {LRM}GIF omitted\n"
    f"[3/14/23, 11:00:00{NNBSP}AM] Ana: {LRM}video omitted\n"
    f"[3/14/23, 11:01:00{NNBSP}AM] Ana: {LRM}report.pdf • {LRM}3 pages {LRM}document omitted\n"
    f"[3/15/23, 12:30:00{NNBSP}PM] Ana: {LRM}This message was deleted.\n"
)

# Android, Portuguese, 1:1. System lines have no "Sender:" part. The last
# message continues onto a second line that carries a link.
ANDROID_PT = (
    "12/03/2023 09:15 - As mensagens e ligações são protegidas com a criptografia de ponta a ponta e ficam somente entre você e os participantes desta conversa.\n"
    "12/03/2023 09:15 - Pepe: bom dia\n"
    "12/03/2023 09:16 - Jenni: <Mídia oculta>\n"
    "13/03/2023 21:40 - Jenni: Mensagem apagada\n"
    "13/03/2023 21:41 - Pepe: vê isso\n"
    "https://youtube.com/watch?v=1\n"
)

# Android, English, 1:1, month-first 12h clock. 12:05 AM is just after midnight.
ANDROID_EN = (
    "3/12/23, 9:15 AM - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them. Tap to learn more.\n"
    "3/12/23, 9:15 AM - Pepe: morning\n"
    "3/12/23, 9:16 AM - Jenni: <Media omitted>\n"
    "3/12/23, 11:59 PM - Jenni: good night\n"
    "3/20/23, 12:05 AM - Pepe: still up?\n"
)
```

- [ ] **Step 2: Write the failing tests** — `tests/test_parse.py`

```python
import calendar
import io
import zipfile

import pytest

from parse import ParseError, classify, parse_text, parse_upload
from tests.chats import ANDROID_EN, ANDROID_PT, IOS_EN_GROUP, IOS_PT


def ts(y, mo, d, h, mi, s=0):
    return calendar.timegm((y, mo, d, h, mi, s, 0, 0, 0))


def types(result):
    return [r[2] for r in result['rows']]


# --- iPhone, Portuguese, 1:1 -------------------------------------------------

def test_ios_pt_shape():
    r = parse_text(IOS_PT)
    assert r['platform'] == 'ios'
    assert r['language'] == 'pt'
    assert r['title'] is None
    assert r['people'] == ['Pepe', 'Jenni']  # 4 messages vs 3
    assert (r['start'], r['end']) == ('2023-03-12', '2023-03-25')


def test_ios_pt_drops_encryption_notice_and_classifies():
    r = parse_text(IOS_PT)
    assert types(r) == ['t', 't', 'a', 'p', 'l', 'x', 's']


def test_ios_pt_joins_continuation_lines():
    r = parse_text(IOS_PT)
    assert r['rows'][1] == [ts(2023, 3, 12, 9, 16, 40), 1, 't', 'bom dia amor\ntudo bem?']


def test_ios_pt_media_rows_carry_no_text_but_links_do():
    r = parse_text(IOS_PT)
    assert r['rows'][2][3] == ''
    assert r['rows'][4][3] == 'olha https://open.spotify.com/album/x'


def test_ios_pt_is_day_first():
    r = parse_text(IOS_PT)
    assert r['rows'][-1][0] == ts(2023, 3, 25, 18, 30)


# --- iPhone, English, group --------------------------------------------------

def test_ios_group_title_and_people():
    r = parse_text(IOS_EN_GROUP)
    assert r['title'] == 'Vinyl Club'
    assert r['language'] == 'en'
    assert r['people'] == ['Ana', 'Pepe', 'Jenni']  # Pepe/Jenni tie: first seen wins


def test_ios_group_types_include_gif_video_document_deleted():
    assert types(parse_text(IOS_EN_GROUP)) == ['t', 't', 'g', 'v', 'd', 'x']


def test_ios_group_is_month_first_with_12h_clock():
    rows = parse_text(IOS_EN_GROUP)['rows']
    assert rows[2][0] == ts(2023, 3, 13, 22, 5, 33)   # 10:05:33 PM
    assert rows[5][0] == ts(2023, 3, 15, 12, 30)      # 12:30 PM stays noon


# --- Android ------------------------------------------------------------------

def test_android_pt():
    r = parse_text(ANDROID_PT)
    assert (r['platform'], r['language'], r['title']) == ('android', 'pt', None)
    assert r['people'] == ['Pepe', 'Jenni']
    assert types(r) == ['t', 'm', 'x', 'l']
    assert r['rows'][3][3] == 'vê isso\nhttps://youtube.com/watch?v=1'


def test_android_en_midnight_and_month_first():
    r = parse_text(ANDROID_EN)
    assert r['language'] == 'en'
    assert types(r) == ['t', 'm', 't', 't']
    assert r['rows'][2][0] == ts(2023, 3, 12, 23, 59)
    assert r['rows'][3][0] == ts(2023, 3, 20, 0, 5)   # 12:05 AM


def test_ambiguous_dates_default_to_day_first():
    r = parse_text("01/02/2024 10:00 - Pepe: oi\n")
    assert r['start'] == '2024-02-01'


def test_year_first_dates():
    r = parse_text("[2024-02-03, 10:00:00] Pepe: oi\n")
    assert r['start'] == '2024-02-03'


# --- classify -----------------------------------------------------------------

@pytest.mark.parametrize('text,code', [
    ('hello', 't'),
    ('see http://x.com', 'l'),
    ('\u200eimage omitted', 'p'),
    ('Mensagem apagada', 'x'),
    ('You deleted this message.', 'x'),
    ('notes.docx \u200edocumento omitido', 'd'),
    ('<Media omitted>', 'm'),
])
def test_classify(text, code):
    assert classify(text) == code


# --- errors and uploads -------------------------------------------------------

def test_garbage_is_unparseable():
    with pytest.raises(ParseError) as e:
        parse_text("just some text\nwith no headers\n")
    assert e.value.code == 'unparseable'


def test_only_system_lines_is_no_messages():
    with pytest.raises(ParseError) as e:
        parse_text("12/03/2023 09:15 - Messages and calls are end-to-end encrypted.\n")
    assert e.value.code == 'no_messages'


def _zip(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()


def test_upload_zip_prefers_chat_txt():
    data = _zip({'notes.txt': 'x', '_chat.txt': IOS_PT.encode()})
    assert parse_upload(data, 'WhatsApp Chat - Jenni.zip')['people'] == ['Pepe', 'Jenni']


def test_upload_zip_without_txt():
    with pytest.raises(ParseError) as e:
        parse_upload(_zip({'a.jpg': b'x'}), 'chat.zip')
    assert e.value.code == 'empty_zip'


def test_upload_broken_zip_is_bad_type():
    with pytest.raises(ParseError) as e:
        parse_upload(b'not a zip', 'chat.zip')
    assert e.value.code == 'bad_type'


def test_upload_other_extension_is_bad_type():
    with pytest.raises(ParseError) as e:
        parse_upload(b'x', 'chat.pdf')
    assert e.value.code == 'bad_type'


def test_upload_txt_with_bom():
    r = parse_upload(b'\xef\xbb\xbf' + ANDROID_EN.encode(), 'chat.txt')
    assert r['platform'] == 'android'
```

- [ ] **Step 3: Run to see them fail**

Run: `python -m pytest tests/test_parse.py -v`
Expected: collection error — `ModuleNotFoundError: No module named 'parse'`.

- [ ] **Step 4: Implement** — `parse.py`

```python
"""WhatsApp export → compact JSON-ready dict. Stdlib only, no Flask.

The browser does every aggregate; this module only turns the export's text into
rows of [epoch_seconds, person_index, type_code, text]. Timestamps are the
chat's wall clock encoded as if it were UTC, so the client reads them with
getUTC* and no timezone ever shifts a message to another day.
"""

import calendar
import io
import re
import time
import zipfile

LRM = '\u200e'

# Both header families: the date's field order is resolved per file later, so
# the regexes only capture three numbers.
_DATE = r'(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])?\.?\s?(?:[Mm]\.?)?'
IOS_HEADER = re.compile(r'^\[' + _DATE + r'\]\s(.*)$')
ANDROID_HEADER = re.compile(r'^' + _DATE + r'\s[-–]\s(.*)$')

# Normalised (LRM stripped, lower-cased, trailing '.' dropped) → type code.
MEDIA_EXACT = {
    'audio omitted': 'a', 'áudio ocultado': 'a', 'áudio omitido': 'a',
    'image omitted': 'p', 'imagem ocultada': 'p', 'imagem omitida': 'p',
    'sticker omitted': 's', 'figurinha omitida': 's',
    'video omitted': 'v', 'vídeo omitido': 'v', 'vídeo ocultado': 'v',
    'gif omitted': 'g', 'gif omitido': 'g',
    '<media omitted>': 'm', '<mídia oculta>': 'm', '<arquivo de mídia oculto>': 'm',
    'this message was deleted': 'x', 'you deleted this message': 'x',
    'mensagem apagada': 'x', 'você apagou esta mensagem': 'x',
    'esta mensagem foi apagada': 'x',
}
# iOS prefixes documents with their filename and page count.
MEDIA_SUFFIX = {'document omitted': 'd', 'documento omitido': 'd'}

ENCRYPTION_NOTICE = ('end-to-end encrypted', 'criptografia de ponta a ponta')

# Any of these in the export means it was produced by a Portuguese phone.
PT_HINTS = ('criptografia', 'ocultad', 'omitid', 'mídia oculta', 'mensagem apagada',
            'apagou esta mensagem', 'figurinha')

URL = re.compile(r'https?://', re.I)


class ParseError(Exception):
    """Carries one of the API's error codes."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _clean(text):
    # Narrow/regular no-break spaces become plain spaces (they sit before AM/PM);
    # the other invisible marks go, except LRM, which the iOS system rule reads.
    return (text.replace('\u202f', ' ').replace('\u00a0', ' ')
                .replace('\u200f', '').replace('\u200b', '').replace('\ufeff', ''))


def _norm(text):
    return text.replace(LRM, '').strip().lower().rstrip('.').strip()


def classify(text):
    """Type code for a message's (joined, cleaned) text."""
    n = _norm(text)
    if n in MEDIA_EXACT:
        return MEDIA_EXACT[n]
    for suffix, code in MEDIA_SUFFIX.items():
        if n.endswith(suffix):
            return code
    if URL.search(text):
        return 'l'
    return 't'


def _split_headers(text):
    """[(platform, date_fields, rest)] with continuation lines folded in."""
    lines = _clean(text).splitlines()
    first = next((l for l in lines if l.strip()), '')
    platform = 'ios' if first.lstrip(LRM).startswith('[') else 'android'
    header = IOS_HEADER if platform == 'ios' else ANDROID_HEADER
    out = []
    for line in lines:
        m = header.match(line.lstrip(LRM))
        if m:
            out.append([m.groups()[:7], m.group(8)])
        elif out:
            out[-1][1] += '\n' + line
    return platform, out


def _day_first(fields):
    # A first field over 12 can only be a day; a second over 12 can only be one
    # too. Neither seen means an ambiguous file: day-first, the PT default.
    for f in fields:
        if len(f[0]) == 4:
            continue
        if int(f[0]) > 12:
            return True
        if int(f[1]) > 12:
            return False
    return True


def _epoch(f, day_first):
    a, b, c, hh, mm, ss, ampm = f
    if len(a) == 4:
        y, mo, d = int(a), int(b), int(c)
    elif day_first:
        d, mo, y = int(a), int(b), int(c)
    else:
        mo, d, y = int(a), int(b), int(c)
    if y < 100:
        y += 2000
    h = int(hh)
    if ampm:
        h = h % 12 + (12 if ampm.lower() == 'p' else 0)
    return calendar.timegm((y, mo, d, h, int(mm), int(ss or 0), 0, 0, 0))


def _day(ts):
    return time.strftime('%Y-%m-%d', time.gmtime(ts))


def _is_system(platform, sender, text, index):
    if sender is None:
        return True
    n = _norm(text)
    if index == 0 and any(k in n for k in ENCRYPTION_NOTICE):
        return True
    # iOS marks system lines with a leading LRM — so do media and deleted
    # markers, which are real messages.
    if platform == 'ios' and text.startswith(LRM):
        return classify(text) in ('t', 'l')
    return False


def parse_text(text):
    platform, headers = _split_headers(text)
    if not headers:
        raise ParseError('unparseable')
    day_first = _day_first([h[0] for h in headers])

    first_sender = None
    kept = []
    for i, (fields, rest) in enumerate(headers):
        sender, sep, body = rest.partition(': ')
        if not sep:
            sender, body = None, rest
        if i == 0:
            first_sender = sender
        if _is_system(platform, sender, body, i):
            continue
        kept.append((_epoch(fields, day_first), sender, body.strip()))

    if not kept:
        raise ParseError('no_messages')

    counts, order = {}, []
    for _, sender, _ in kept:
        if sender not in counts:
            counts[sender] = 0
            order.append(sender)
        counts[sender] += 1
    people = sorted(order, key=lambda p: -counts[p])  # stable: ties keep first appearance
    index = {p: i for i, p in enumerate(people)}

    rows = []
    for ts, sender, body in kept:
        code = classify(body)
        rows.append([ts, index[sender], code, body.replace(LRM, '') if code in ('t', 'l') else ''])

    title = first_sender if platform == 'ios' and first_sender and first_sender not in counts else None
    lowered = text.lower()
    language = 'pt' if any(h in lowered for h in PT_HINTS) else 'en'

    return {
        'platform': platform,
        'language': language,
        'title': title,
        'people': people,
        'start': _day(rows[0][0]),
        'end': _day(rows[-1][0]),
        'rows': rows,
    }


def parse_upload(data, filename):
    """Bytes of a .txt or .zip export → parse_text dict, or raise ParseError."""
    name = (filename or '').lower()
    if name.endswith('.zip'):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                txts = [n for n in z.namelist() if n.lower().endswith('.txt')]
                if not txts:
                    raise ParseError('empty_zip')
                pick = next((n for n in txts if n.endswith('_chat.txt')), txts[0])
                data = z.read(pick)
        except zipfile.BadZipFile:
            raise ParseError('bad_type')
    elif not name.endswith('.txt'):
        raise ParseError('bad_type')
    return parse_text(data.decode('utf-8-sig', errors='replace'))
```

- [ ] **Step 5: Run — expect PASS**

Run: `python -m pytest tests/test_parse.py -v`
Expected: 26 passed.

- [ ] **Step 6: Commit**

```bash
git add parse.py tests/chats.py tests/test_parse.py
git commit -m "feat: stdlib parser for iOS and Android WhatsApp exports

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `POST /api/parse`

**Files:**
- Modify: `app.py` (full replacement below)
- Modify: `tests/test_api.py` (full replacement below)

**Interfaces:**
- Consumes: `parse_upload`, `ParseError` from Task 2.
- Produces: `POST /api/parse` (multipart field `file`) → 200 parse dict, 400 `{"error": code}`, 413 `{"error": "too_large"}`, 500 `{"error": "internal"}`. `MAX_UPLOAD_MB` env (default 50).

- [ ] **Step 1: Write the failing tests** — replace `tests/test_api.py`

```python
import io

import pytest

import app as app_module
from tests.chats import ANDROID_EN, ANDROID_PT, IOS_EN_GROUP, IOS_PT


@pytest.fixture
def client():
    app_module.app.config['TESTING'] = True
    return app_module.app.test_client()


def upload(client, content, name='chat.txt'):
    data = {'file': (io.BytesIO(content), name)}
    return client.post('/api/parse', data=data, content_type='multipart/form-data')


def test_healthz(client):
    assert client.get('/healthz').data == b'ok'


def test_index_serves_the_page(client):
    r = client.get('/')
    assert r.status_code == 200
    assert b'Chat Analyzer' in r.data


@pytest.mark.parametrize('chat', [IOS_PT, IOS_EN_GROUP, ANDROID_PT, ANDROID_EN])
def test_parse_ok(client, chat):
    r = upload(client, chat.encode())
    assert r.status_code == 200
    body = r.get_json()
    assert set(body) == {'platform', 'language', 'title', 'people', 'start', 'end', 'rows'}
    assert all(len(row) == 4 for row in body['rows'])


def test_no_file(client):
    r = client.post('/api/parse', data={}, content_type='multipart/form-data')
    assert (r.status_code, r.get_json()) == (400, {'error': 'no_file'})


@pytest.mark.parametrize('content,name,code', [
    (b'x', 'chat.pdf', 'bad_type'),
    (b'no headers here', 'chat.txt', 'unparseable'),
    (b'12/03/2023 09:15 - Messages and calls are end-to-end encrypted.', 'chat.txt', 'no_messages'),
])
def test_error_codes(client, content, name, code):
    r = upload(client, content, name)
    assert (r.status_code, r.get_json()) == (400, {'error': code})


def test_too_large(client, monkeypatch):
    monkeypatch.setitem(app_module.app.config, 'MAX_CONTENT_LENGTH', 100)
    r = upload(client, b'x' * 1000)
    assert (r.status_code, r.get_json()) == (413, {'error': 'too_large'})


def test_unexpected_error_is_500_and_not_leaked(client, monkeypatch, caplog):
    def boom(data, name):
        raise RuntimeError('secret message text')
    monkeypatch.setattr(app_module, 'parse_upload', boom)
    r = upload(client, IOS_PT.encode())
    assert (r.status_code, r.get_json()) == (500, {'error': 'internal'})
    assert 'secret message text' not in caplog.text
    assert 'RuntimeError' in caplog.text
```

- [ ] **Step 2: Run to see them fail**

Run: `python -m pytest tests/test_api.py -v`
Expected: the parse/error/413/500 tests FAIL with 404/405 (route missing); healthz and index still pass.

- [ ] **Step 3: Implement** — replace `app.py`

```python
"""Chat Analyzer — stateless Flask front for parse.py.

Nothing here writes to disk or logs message content: an upload is parsed in
memory, returned as JSON, and dropped with the request.
"""

import logging
import os

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import RequestEntityTooLarge

from parse import ParseError, parse_upload

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_UPLOAD_MB', '50')) * 1024 * 1024
log = logging.getLogger(__name__)


@app.get('/')
def index():
    return render_template('index.html')


@app.get('/healthz')
def healthz():
    return 'ok'


@app.post('/api/parse')
def api_parse():
    f = request.files.get('file')
    if f is None or not f.filename:
        return jsonify(error='no_file'), 400
    try:
        return jsonify(parse_upload(f.read(), f.filename))
    except ParseError as e:
        return jsonify(error=e.code), 400
    except Exception as e:  # never log the payload — only what kind of failure
        log.error('parse failed: %s', type(e).__name__)
        return jsonify(error='internal'), 500


@app.errorhandler(RequestEntityTooLarge)
def too_large(_):
    return jsonify(error='too_large'), 413


if __name__ == '__main__':
    app.run(debug=True, port=int(os.environ.get('PORT', '5001')))
```

- [ ] **Step 4: Run — expect PASS**

Run: `python -m pytest -v`
Expected: all of test_parse.py and test_api.py pass (38).

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_api.py
git commit -m "feat: stateless /api/parse endpoint with error codes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Days, ranges and the URL hash (`static/range.js`) + the JS test harness

**Files:**
- Create: `static/range.js`, `tests/helpers.js`, `tests/test_range.js`, `tests/test_js.py`

**Interfaces:**
- Produces global `ChatRange` (and CommonJS export) with:
  - `DAY = 86400`; `dayOf(ts) -> int`; `isoOfDay(day) -> 'YYYY-MM-DD'`; `dayOfIso(iso) -> int`; `yearOfDay(day) -> int`
  - `prepare(chat) -> msgs` — each msg `{ i, t, p, k, x, day, h, wd }` (index, epoch, person, type code, text, day int, UTC hour, UTC weekday 0=Sun), sorted by `t`, `i` renumbered.
  - `filter(msgs, from, to) -> msgs` (inclusive days, binary search)
  - `presets(first, last) -> [{ id, label?, from, to }]` — ids `all`, `12mo`, `30d`, then `y<YYYY>` per year (with `label`).
  - `presetFor(list, from, to) -> id|null`
  - `validate(from, to, first, last) -> {from, to} | {error: 'inverted'|'invalid'}`
  - `encodeHash({tab, from, to, lang}) -> '#…'`; `decodeHash(hash) -> {tab?, from?, to?, lang?}`
- `tests/helpers.js` exports `at(stamp)`, `chat(rows)` (rows `[stamp, person, type='t', text='']` → prepared msgs), `day(iso)` — used by every later JS test.
- JS module pattern (all later model modules follow it): `const X = (function (deps) { … return {…}; })(typeof Dep !== 'undefined' ? Dep : require('./dep.js'));` then `if (typeof module !== 'undefined' && module.exports) module.exports = X;`

- [ ] **Step 1: Test helpers** — `tests/helpers.js`

```javascript
// Shared builders for the JS model tests. A message only needs the fields the
// rule under test reads, so tests build the smallest chat that exercises it.

const R = require('../static/range.js');

// 'YYYY-MM-DD HH:MM' in chat wall-clock → epoch seconds (encoded as UTC).
function at(stamp) {
  return Date.parse(stamp.replace(' ', 'T') + ':00Z') / 1000;
}

// rows: [stamp, person, type?, text?] → prepared messages.
function chat(rows) {
  return R.prepare({ rows: rows.map(([s, p, k = 't', x = '']) => [at(s), p, k, x]) });
}

module.exports = { at, chat, day: R.dayOfIso };
```

- [ ] **Step 2: pytest wrapper** — `tests/test_js.py` (runs every `tests/test_*.js`; later tasks only add `.js` files)

```python
"""Run the JavaScript model tests under pytest.

The model rules live in static/*.js as pure functions, testable only by a JS
runtime. Shelling out to node's built-in runner keeps `pytest` the one command
that runs everything — the same pattern as vinyl-collection.
"""

import pathlib
import shutil
import subprocess

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
JS_TESTS = sorted(p.name for p in (REPO_ROOT / 'tests').glob('test_*.js'))


@pytest.mark.skipif(shutil.which('node') is None, reason='node is not installed')
@pytest.mark.parametrize('name', JS_TESTS)
def test_js(name):
    result = subprocess.run(
        ['node', '--test', f'tests/{name}'],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
```

- [ ] **Step 3: Write the failing tests** — `tests/test_range.js`

```javascript
// Tests for static/range.js. Run by tests/test_js.py.
process.env.TZ = 'America/Sao_Paulo';  // proves nothing depends on the machine's zone

const test = require('node:test');
const assert = require('node:assert');
const R = require('../static/range.js');
const { chat, day } = require('./helpers.js');

test('prepare reads the wall clock as UTC, whatever the local zone', () => {
  const [m] = chat([['2024-02-03 23:30', 0]]);
  assert.strictEqual(m.day, day('2024-02-03'));
  assert.strictEqual(m.h, 23);
  assert.strictEqual(m.wd, 6);  // Saturday
});

test('isoOfDay and dayOfIso round-trip', () => {
  assert.strictEqual(R.isoOfDay(R.dayOfIso('2026-09-18')), '2026-09-18');
});

test('filter is inclusive on both ends', () => {
  const msgs = chat([['2024-01-01 10:00', 0], ['2024-01-02 10:00', 0], ['2024-01-03 23:59', 1], ['2024-01-04 00:00', 1]]);
  const got = R.filter(msgs, day('2024-01-02'), day('2024-01-03'));
  assert.deepStrictEqual(got.map(m => m.i), [1, 2]);
});

test('presets clamp to the chat and list every year it touches', () => {
  const first = day('2022-03-04'), last = day('2024-01-10');
  const p = R.presets(first, last);
  assert.deepStrictEqual(p.map(x => x.id), ['all', '12mo', '30d', 'y2022', 'y2023', 'y2024']);
  assert.strictEqual(p[1].from, last - 364);
  assert.deepStrictEqual([p[3].from, p[3].to], [first, day('2022-12-31')]);
  assert.deepStrictEqual([p[5].from, p[5].to], [day('2024-01-01'), last]);
});

test('12 mo on a short chat is the whole chat', () => {
  const first = day('2024-01-01'), last = day('2024-01-10');
  assert.strictEqual(R.presets(first, last)[1].from, first);
  assert.strictEqual(R.presetFor(R.presets(first, last), first, last), 'all');
});

test('validate refuses inverted ranges and clamps to the chat', () => {
  assert.deepStrictEqual(R.validate(10, 5, 0, 100), { error: 'inverted' });
  assert.deepStrictEqual(R.validate(-5, 500, 0, 100), { from: 0, to: 100 });
});

test('hash round-trips view state and ignores junk', () => {
  const s = { tab: 'people', from: day('2024-01-01'), to: day('2024-02-01'), lang: 'pt' };
  assert.deepStrictEqual(R.decodeHash(R.encodeHash(s)), s);
  assert.deepStrictEqual(R.decodeHash('#from=yesterday&lang=fr'), {});
});
```

- [ ] **Step 4: Run to see them fail**

Run: `node --test tests/test_range.js`
Expected: FAIL — `Cannot find module '../static/range.js'`.

- [ ] **Step 5: Implement** — `static/range.js`

```javascript
'use strict';

/* Days, ranges and the URL hash.
 *
 * Timestamps from /api/parse are the chat's wall clock encoded as UTC, so a
 * "day" is just floor(ts / 86400) and every calendar read uses getUTC*. The
 * rest of the client works on these integer days, never on Date objects.
 *
 * Pure functions, loaded as a plain script in the browser and required by
 * tests/test_range.js. */

const ChatRange = (function () {

  const DAY = 86400;

  function dayOf(ts) { return Math.floor(ts / DAY); }

  function isoOfDay(day) { return new Date(day * DAY * 1000).toISOString().slice(0, 10); }

  function dayOfIso(iso) { return Math.floor(Date.parse(iso + 'T00:00:00Z') / 1000 / DAY); }

  function yearOfDay(day) { return new Date(day * DAY * 1000).getUTCFullYear(); }

  /* API rows → message objects, sorted by time (exports are chronological, but
   * a stable sort costs nothing and makes filter's binary search safe). */
  function prepare(chat) {
    const msgs = chat.rows.map((r, i) => {
      const d = new Date(r[0] * 1000);
      return { i, t: r[0], p: r[1], k: r[2], x: r[3], day: dayOf(r[0]),
               h: d.getUTCHours(), wd: d.getUTCDay() };
    });
    msgs.sort((a, b) => a.t - b.t || a.i - b.i);
    msgs.forEach((m, i) => { m.i = i; });
    return msgs;
  }

  function lowerBound(msgs, day) {
    let lo = 0, hi = msgs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (msgs[mid].day < day) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /* Messages with from <= day <= to. */
  function filter(msgs, from, to) {
    return msgs.slice(lowerBound(msgs, from), lowerBound(msgs, to + 1));
  }

  /* The date bar's buttons. 12 mo / 30 d count back from the chat's last day
   * and are clamped to its first; each calendar year the chat touches gets one. */
  function presets(first, last) {
    const out = [
      { id: 'all', from: first, to: last },
      { id: '12mo', from: Math.max(first, last - 364), to: last },
      { id: '30d', from: Math.max(first, last - 29), to: last },
    ];
    for (let y = yearOfDay(first); y <= yearOfDay(last); y++) {
      out.push({ id: 'y' + y, label: String(y),
                 from: Math.max(first, dayOfIso(y + '-01-01')),
                 to: Math.min(last, dayOfIso(y + '-12-31')) });
    }
    return out;
  }

  function presetFor(list, from, to) {
    const p = list.find(x => x.from === from && x.to === to);
    return p ? p.id : null;
  }

  /* Clamp to the chat and refuse an inverted range: the caller keeps its last
   * valid one and shows the warning. */
  function validate(from, to, first, last) {
    if (!Number.isFinite(from) || !Number.isFinite(to)) return { error: 'invalid' };
    if (from > to) return { error: 'inverted' };
    return { from: Math.max(first, from), to: Math.min(last, to) };
  }

  /* View state in the hash — tab, range, language — never anything from the chat. */
  function encodeHash(s) {
    const q = new URLSearchParams();
    if (s.tab) q.set('tab', s.tab);
    if (s.from != null) q.set('from', isoOfDay(s.from));
    if (s.to != null) q.set('to', isoOfDay(s.to));
    if (s.lang) q.set('lang', s.lang);
    return '#' + q.toString();
  }

  function decodeHash(hash) {
    const q = new URLSearchParams((hash || '').replace(/^#/, ''));
    const out = {};
    if (q.get('tab')) out.tab = q.get('tab');
    const f = q.get('from'), t = q.get('to');
    if (f && /^\d{4}-\d{2}-\d{2}$/.test(f)) out.from = dayOfIso(f);
    if (t && /^\d{4}-\d{2}-\d{2}$/.test(t)) out.to = dayOfIso(t);
    if (q.get('lang') === 'en' || q.get('lang') === 'pt') out.lang = q.get('lang');
    return out;
  }

  return { DAY, dayOf, isoOfDay, dayOfIso, yearOfDay, prepare, filter, presets, presetFor,
           validate, encodeHash, decodeHash };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ChatRange;
```

- [ ] **Step 6: Run — expect PASS**

Run: `node --test tests/test_range.js && python -m pytest -q`
Expected: 7 node tests pass; pytest all green.

- [ ] **Step 7: Commit**

```bash
git add static/range.js tests/helpers.js tests/test_range.js tests/test_js.py
git commit -m "feat: day/range/hash model and node test harness

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Counting model (`static/stats.js`)

**Files:**
- Create: `static/stats.js`, `tests/test_stats.js`

**Interfaces:**
- Consumes: `ChatRange.dayOfIso` (Task 4).
- Produces global `ChatStats`:
  - `MEDIA: Set` of media type codes; `words(text) -> int`
  - `dailyCounts(msgs) -> Map<day, count>`
  - `totals(msgs, from, to) -> { messages, days, activeDays, activePct, perDay, words }`
  - `weeklySeries(msgs, from, to) -> number[]`; `weekdayCounts(msgs) -> number[7]` (active days, Sunday first)
  - `streaks(msgs, chatLastDay) -> { longest: {len, from, to}, current }`
  - `busiestDay(msgs) -> {day, count} | null`
  - `levelThresholds(daily) -> [q25, q50, q75]`; `levelOf(n, th) -> 0..4`
  - `calendarYear(daily, year, from, to) -> { lead, cells: [{day, count, level, inRange}], thresholds }`
  - `hours(msgs) -> number[24]`; `heatmap(msgs) -> number[7][24]`
  - `types(msgs, nPeople) -> [{ k, total, byPerson[] }]` (desc)
  - `share(msgs, nPeople, topN = 8) -> [{ p, count, pct }]` (p = -1 is "Others")
  - `series(msgs, from, to, gran: 'day'|'week'|'month', nPeople, fill = true, topN = 5) -> { buckets: day[], lines: [{ p, values[] }] }`

- [ ] **Step 1: Write the failing tests** — `tests/test_stats.js`

```javascript
// Tests for static/stats.js. Run by tests/test_js.py.
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert');
const S = require('../static/stats.js');
const { chat, day } = require('./helpers.js');

test('totals: per-day average over every day in range, words from text and links only', () => {
  const msgs = chat([['2024-01-01 10:00', 0, 't', 'bom dia amor'], ['2024-01-01 11:00', 1, 'a'],
                     ['2024-01-03 10:00', 1, 'l', 'olha https://x.com']]);
  const t = S.totals(msgs, day('2024-01-01'), day('2024-01-04'));
  assert.deepStrictEqual(t, { messages: 3, days: 4, activeDays: 2, activePct: 0.5, perDay: 0.75, words: 5 });
});

test('streaks run across a month and a year edge', () => {
  const msgs = chat([['2023-12-30 10:00', 0], ['2023-12-31 10:00', 0], ['2024-01-01 10:00', 0],
                     ['2024-01-05 10:00', 0], ['2024-01-06 10:00', 0]]);
  const s = S.streaks(msgs, day('2024-01-06'));
  assert.deepStrictEqual(s.longest, { len: 3, from: day('2023-12-30'), to: day('2024-01-01') });
  assert.strictEqual(s.current, 2);
});

test('current streak is 0 when the chat went on after the range', () => {
  const msgs = chat([['2024-01-05 10:00', 0]]);
  assert.strictEqual(S.streaks(msgs, day('2024-02-01')).current, 0);
});

test('busiest day: highest count, earliest on ties', () => {
  const msgs = chat([['2024-01-02 10:00', 0], ['2024-01-02 11:00', 1], ['2024-01-01 10:00', 0], ['2024-01-01 12:00', 0]]);
  assert.deepStrictEqual(S.busiestDay(msgs), { day: day('2024-01-01'), count: 2 });
  assert.strictEqual(S.busiestDay([]), null);
});

test('levels use quantiles of non-zero days', () => {
  const daily = new Map([[1, 1], [2, 2], [3, 3], [4, 4], [5, 100]]);
  const th = S.levelThresholds(daily);
  assert.deepStrictEqual(th, [2, 3, 4]);
  assert.deepStrictEqual([0, 1, 2, 3, 100].map(n => S.levelOf(n, th)), [0, 1, 2, 3, 4]);
});

test('calendarYear leads with blanks so Jan 1 sits on its weekday', () => {
  const cal = S.calendarYear(new Map(), 2026, day('2026-03-01'), day('2026-03-31'));
  assert.strictEqual(cal.lead, 4);          // 2026-01-01 is a Thursday
  assert.strictEqual(cal.cells.length, 365);
  assert.strictEqual(cal.cells[0].inRange, false);
  assert.strictEqual(cal.cells[59].inRange, true);  // Mar 1
});

test('hours and heatmap bucket by wall clock', () => {
  const msgs = chat([['2024-02-03 23:30', 0], ['2024-02-04 00:10', 1]]);  // Sat 23h, Sun 0h
  const h = S.hours(msgs);
  assert.strictEqual(h[23] + h[0], 2);
  const hm = S.heatmap(msgs);
  assert.strictEqual(hm[6][23], 1);
  assert.strictEqual(hm[0][0], 1);
});

test('types are ranked and split per person', () => {
  const msgs = chat([['2024-01-01 10:00', 0, 'a'], ['2024-01-01 10:01', 1, 'a'], ['2024-01-01 10:02', 1, 't', 'x']]);
  assert.deepStrictEqual(S.types(msgs, 2), [{ k: 'a', total: 2, byPerson: [1, 1] }, { k: 't', total: 1, byPerson: [0, 1] }]);
});

test('share folds everyone past topN into Others', () => {
  const rows = [];
  [5, 4, 3, 2, 1].forEach((n, p) => { for (let i = 0; i < n; i++) rows.push(['2024-01-01 10:00', p]); });
  const s = S.share(chat(rows), 5, 3);
  assert.deepStrictEqual(s.map(e => [e.p, e.count]), [[0, 5], [1, 4], [2, 3], [-1, 3]]);
});

test('series by week starts on Sunday; fill=false drops empty days', () => {
  const msgs = chat([['2024-01-01 10:00', 0], ['2024-01-03 10:00', 1], ['2024-01-08 10:00', 0]]);
  const w = S.series(msgs, day('2024-01-01'), day('2024-01-10'), 'week', 2);
  assert.deepStrictEqual(w.buckets, [day('2023-12-31'), day('2024-01-07')]);
  assert.deepStrictEqual(w.lines.map(l => l.values), [[1, 1], [1, 0]]);
  const d = S.series(msgs, day('2024-01-01'), day('2024-01-10'), 'day', 2, false);
  assert.deepStrictEqual(d.buckets, [day('2024-01-01'), day('2024-01-03'), day('2024-01-08')]);
});

test('series by month uses calendar months', () => {
  const msgs = chat([['2024-01-31 10:00', 0], ['2024-02-01 10:00', 0]]);
  const m = S.series(msgs, day('2024-01-15'), day('2024-02-10'), 'month', 1);
  assert.deepStrictEqual(m.buckets, [day('2024-01-01'), day('2024-02-01')]);
  assert.deepStrictEqual(m.lines[0].values, [1, 1]);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/test_stats.js`
Expected: FAIL — `Cannot find module '../static/stats.js'`.

- [ ] **Step 3: Implement** — `static/stats.js`

```javascript
'use strict';

/* Counting: KPIs, streaks, the calendar, hours, the heatmap, types, share and
 * the over-time series. Every function takes already range-filtered messages
 * (see range.js prepare/filter) and returns plain data for the views.
 *
 * Pure functions, loaded as a plain script and required by tests/test_stats.js. */

const ChatStats = (function (range) {

  const MEDIA = new Set(['a', 'p', 's', 'v', 'g', 'd', 'm']);

  function words(text) {
    const m = text.match(/\S+/g);
    return m ? m.length : 0;
  }

  function dailyCounts(msgs) {
    const out = new Map();
    for (const m of msgs) out.set(m.day, (out.get(m.day) || 0) + 1);
    return out;
  }

  function totals(msgs, from, to) {
    const days = to - from + 1;
    const active = dailyCounts(msgs).size;
    let w = 0;
    for (const m of msgs) if (m.k === 't' || m.k === 'l') w += words(m.x);
    return { messages: msgs.length, days, activeDays: active,
             activePct: days ? active / days : 0,
             perDay: days ? msgs.length / days : 0, words: w };
  }

  /* Weekly totals from `from`, for the KPI sparkline. */
  function weeklySeries(msgs, from, to) {
    const out = new Array(Math.floor((to - from) / 7) + 1).fill(0);
    for (const m of msgs) out[Math.floor((m.day - from) / 7)]++;
    return out;
  }

  /* Active days per weekday, Sunday first. */
  function weekdayCounts(msgs) {
    const out = new Array(7).fill(0);
    for (const day of dailyCounts(msgs).keys()) out[new Date(day * 864e5).getUTCDay()]++;
    return out;
  }

  /* Longest run of consecutive active days, and the run still going on the
   * chat's last day (0 when the range stops before it or that day was quiet). */
  function streaks(msgs, chatLastDay) {
    const days = [...dailyCounts(msgs).keys()].sort((a, b) => a - b);
    let best = { len: 0, from: null, to: null }, start = null, prev = null;
    for (const d of days) {
      if (prev === null || d !== prev + 1) start = d;
      if (d - start + 1 > best.len) best = { len: d - start + 1, from: start, to: d };
      prev = d;
    }
    const current = prev === chatLastDay ? prev - start + 1 : 0;
    return { longest: best, current };
  }

  function busiestDay(msgs) {
    let best = null;
    for (const [day, count] of dailyCounts(msgs)) {
      if (!best || count > best.count || (count === best.count && day < best.day)) best = { day, count };
    }
    return best;
  }

  /* Quantile thresholds (25/50/75%) over the non-zero days, so one wild day
   * doesn't wash every other cell out to the palest level. */
  function levelThresholds(daily) {
    const v = [...daily.values()].filter(n => n > 0).sort((a, b) => a - b);
    if (!v.length) return [1, 1, 1];
    const q = f => v[Math.min(v.length - 1, Math.floor(f * v.length))];
    return [q(0.25), q(0.5), q(0.75)];
  }

  function levelOf(n, th) {
    if (!n) return 0;
    if (n < th[0]) return 1;
    if (n < th[1]) return 2;
    if (n < th[2]) return 3;
    return 4;
  }

  /* One calendar year as week columns: `lead` blank cells put Jan 1 on its
   * weekday row, then one cell per day. inRange=false dims days outside the
   * date bar's range (they still show, so the year keeps its shape). */
  function calendarYear(daily, year, from, to) {
    const first = range.dayOfIso(year + '-01-01');
    const last = range.dayOfIso(year + '-12-31');
    const th = levelThresholds(daily);
    const cells = [];
    for (let d = first; d <= last; d++) {
      const count = daily.get(d) || 0;
      cells.push({ day: d, count, level: levelOf(count, th), inRange: d >= from && d <= to });
    }
    return { lead: new Date(first * 864e5).getUTCDay(), cells, thresholds: th };
  }

  function hours(msgs) {
    const out = new Array(24).fill(0);
    for (const m of msgs) out[m.h]++;
    return out;
  }

  /* 7 rows (Sunday first) × 24 hours. */
  function heatmap(msgs) {
    const out = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const m of msgs) out[m.wd][m.h]++;
    return out;
  }

  /* One entry per type present, biggest first, split per person. */
  function types(msgs, nPeople) {
    const by = new Map();
    for (const m of msgs) {
      if (!by.has(m.k)) by.set(m.k, { k: m.k, total: 0, byPerson: new Array(nPeople).fill(0) });
      const e = by.get(m.k);
      e.total++;
      e.byPerson[m.p]++;
    }
    return [...by.values()].sort((a, b) => b.total - a.total);
  }

  /* Ranked senders; beyond topN they fold into one { p: -1 } "Others" entry. */
  function share(msgs, nPeople, topN = 8) {
    const c = new Array(nPeople).fill(0);
    for (const m of msgs) c[m.p]++;
    const total = msgs.length || 1;
    const ranked = c.map((count, p) => ({ p, count, pct: count / total }))
      .filter(e => e.count > 0).sort((a, b) => b.count - a.count || a.p - b.p);
    if (ranked.length <= topN) return ranked;
    const rest = ranked.slice(topN).reduce((s, e) => s + e.count, 0);
    return ranked.slice(0, topN).concat([{ p: -1, count: rest, pct: rest / total }]);
  }

  function bucketStart(day, gran) {
    if (gran === 'day') return day;
    const d = new Date(day * 864e5);
    if (gran === 'week') return day - d.getUTCDay();
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 864e5);
  }

  function nextBucket(start, gran) {
    if (gran === 'day') return start + 1;
    if (gran === 'week') return start + 7;
    const d = new Date(start * 864e5);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 864e5);
  }

  /* Over-time lines, one per top-N sender plus "Others" (p: -1) when needed.
   * fill=false drops empty buckets — the old "fill empty days" switch, which
   * only changes anything at day granularity. */
  function series(msgs, from, to, gran, nPeople, fill = true, topN = 5) {
    const top = share(msgs, nPeople, topN);
    const lineOf = new Map();
    top.forEach((e, i) => { if (e.p >= 0) lineOf.set(e.p, i); });
    const others = top.some(e => e.p === -1);
    const buckets = [];
    const index = new Map();
    for (let b = bucketStart(from, gran); b <= to; b = nextBucket(b, gran)) {
      index.set(b, buckets.length);
      buckets.push(b);
    }
    const lines = top.map(e => ({ p: e.p, values: new Array(buckets.length).fill(0) }));
    for (const m of msgs) {
      const li = lineOf.has(m.p) ? lineOf.get(m.p) : (others ? lines.length - 1 : -1);
      if (li >= 0) lines[li].values[index.get(bucketStart(m.day, gran))]++;
    }
    if (fill || gran !== 'day') return { buckets, lines };
    const keep = buckets.map((_, i) => lines.some(l => l.values[i] > 0));
    return { buckets: buckets.filter((_, i) => keep[i]),
             lines: lines.map(l => ({ p: l.p, values: l.values.filter((_, i) => keep[i]) })) };
  }

  return { MEDIA, words, dailyCounts, totals, weeklySeries, weekdayCounts, streaks, busiestDay,
           levelThresholds, levelOf, calendarYear, hours, heatmap, types, share, series };
})(typeof ChatRange !== 'undefined' ? ChatRange : require('./range.js'));

if (typeof module !== 'undefined' && module.exports) module.exports = ChatStats;
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test tests/test_stats.js`
Expected: 11 pass.

- [ ] **Step 5: Commit**

```bash
git add static/stats.js tests/test_stats.js
git commit -m "feat: counting model — KPIs, streaks, calendar, heatmap, series

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Per-person model (`static/people.js`)

**Files:**
- Create: `static/people.js`, `tests/test_people.js`

**Interfaces:**
- Consumes: `ChatStats.MEDIA`, `ChatStats.words` (Task 5).
- Produces global `ChatPeople`:
  - `STARTER_GAP = 4 h`, `REPLY_MAX = 12 h` (seconds)
  - `firstLast(msgs, n) -> { first[], last[] }`; `starters(msgs, n) -> number[]`
  - `replyGaps(msgs, n) -> number[][]` (seconds); `median(arr) -> number|null`
  - `profiles(msgs, n) -> [{ p, messages, words, textMsgs, media, lateNight, hours[24], share, wordsPerMsg, afterMidnightPct, medianReply|null, startsPct|null }]`
  - `roles(profiles, firstLast) -> string[][]` — keys `starter | fastest | night_owl | good_night | good_morning`, ≤ 2 per person, only for 2–12 active people; night owl needs ≥ 2% after midnight.
  - `sorted(profiles, 'messages'|'fastest'|'longest'|'night') -> profiles` (silent people dropped)

- [ ] **Step 1: Write the failing tests** — `tests/test_people.js`

```javascript
// Tests for static/people.js. Run by tests/test_js.py.
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert');
const P = require('../static/people.js');
const { chat } = require('./helpers.js');

test('first and last message of each day', () => {
  const msgs = chat([['2024-01-01 08:00', 0], ['2024-01-01 23:00', 1], ['2024-01-02 09:00', 1]]);
  assert.deepStrictEqual(P.firstLast(msgs, 2), { first: [1, 1], last: [0, 2] });
});

test('a conversation starts after 4 h of silence, not 3 h 59', () => {
  const msgs = chat([['2024-01-01 08:00', 0], ['2024-01-01 11:59', 1], ['2024-01-01 15:59', 1]]);
  assert.deepStrictEqual(P.starters(msgs, 2), [1, 1]);
});

test('reply gaps skip self-follow-ups and anything 12 h or older', () => {
  const msgs = chat([['2024-01-01 08:00', 0], ['2024-01-01 08:02', 1], ['2024-01-01 08:03', 1],
                     ['2024-01-01 20:03', 0], ['2024-01-01 20:13', 1]]);
  assert.deepStrictEqual(P.replyGaps(msgs, 2), [[], [120, 600]]);
});

test('median of odd, even and empty lists', () => {
  assert.strictEqual(P.median([3, 1, 2]), 2);
  assert.strictEqual(P.median([4, 1, 2, 3]), 2.5);
  assert.strictEqual(P.median([]), null);
});

test('profiles: words per text message, media, after midnight', () => {
  const msgs = chat([['2024-01-01 01:00', 0, 't', 'um dois tres'], ['2024-01-01 10:00', 0, 'p'],
                     ['2024-01-01 10:05', 1, 't', 'oi']]);
  const [a, b] = P.profiles(msgs, 2);
  assert.strictEqual(a.wordsPerMsg, 3);
  assert.strictEqual(a.media, 1);
  assert.strictEqual(a.afterMidnightPct, 0.5);
  assert.strictEqual(b.medianReply, 300);
  assert.strictEqual(a.startsPct, 1);
});

test('a one-person chat has no reply time or starter share', () => {
  const [a] = P.profiles(chat([['2024-01-01 10:00', 0]]), 1);
  assert.strictEqual(a.medianReply, null);
  assert.strictEqual(a.startsPct, null);
});

test('roles: at most two per person, none when alone', () => {
  const msgs = chat([['2024-01-01 01:00', 0], ['2024-01-01 01:01', 1], ['2024-01-01 09:00', 0],
                     ['2024-01-01 09:30', 1]]);
  const profs = P.profiles(msgs, 2);
  const r = P.roles(profs, P.firstLast(msgs, 2));
  assert.ok(r.every(x => x.length <= 2));
  assert.deepStrictEqual(r[0].slice(0, 1), ['starter']);   // opened both conversations
  assert.deepStrictEqual(r[1].slice(0, 1), ['fastest']);   // replies in 1 and 30 min vs 7 h 59
  assert.deepStrictEqual(P.roles(P.profiles(chat([['2024-01-01 10:00', 0]]), 1), { first: [1], last: [1] }), [[]]);
});

test('night owl needs at least 2% of messages after midnight', () => {
  // Each person sends one message after midnight, then `day` more at 10:xx.
  const roles = day => {
    const rows = [['2024-01-01 00:00', 0], ['2024-01-01 00:30', 1]];
    for (let i = 0; i < day; i++) {
      const at = '2024-01-01 10:' + String(i).padStart(2, '0');
      rows.push([at, 0], [at, 1]);
    }
    const msgs = chat(rows);
    return P.roles(P.profiles(msgs, 2), P.firstLast(msgs, 2)).flat();
  };
  assert.ok(roles(20).includes('night_owl'));   // 1 of 21 ≈ 4.8%
  assert.ok(!roles(60).includes('night_owl'));  // 1 of 61 ≈ 1.6%
});

test('sorted hides silent people and orders by the chosen key', () => {
  const msgs = chat([['2024-01-01 10:00', 0, 't', 'a b c d'], ['2024-01-01 10:01', 1, 't', 'a'], ['2024-01-01 10:02', 1, 't', 'b']]);
  const profs = P.profiles(msgs, 3);
  assert.deepStrictEqual(P.sorted(profs, 'messages').map(p => p.p), [1, 0]);
  assert.deepStrictEqual(P.sorted(profs, 'longest').map(p => p.p), [0, 1]);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/test_people.js`
Expected: FAIL — `Cannot find module '../static/people.js'`.

- [ ] **Step 3: Implement** — `static/people.js`

```javascript
'use strict';

/* Per-person behaviour: who opens and closes each day, who starts
 * conversations, how fast each person replies, and the profile card numbers.
 *
 * Rules (from the spec):
 *  - a conversation starts with the first message after >= 4 h of silence
 *    (the very first message in range counts too)
 *  - a reply is a message whose previous message came from someone else less
 *    than 12 h earlier; its reply time is the gap
 *  - "after midnight" is 00:00–04:59
 *
 * Pure functions, loaded as a plain script and required by tests/test_people.js. */

const ChatPeople = (function (stats) {

  const STARTER_GAP = 4 * 3600;
  const REPLY_MAX = 12 * 3600;
  const NIGHT_OWL_MIN = 0.02;

  function firstLast(msgs, n) {
    const first = new Array(n).fill(0), last = new Array(n).fill(0);
    for (let i = 0; i < msgs.length; i++) {
      if (i === 0 || msgs[i - 1].day !== msgs[i].day) first[msgs[i].p]++;
      if (i === msgs.length - 1 || msgs[i + 1].day !== msgs[i].day) last[msgs[i].p]++;
    }
    return { first, last };
  }

  function starters(msgs, n) {
    const out = new Array(n).fill(0);
    for (let i = 0; i < msgs.length; i++) {
      if (i === 0 || msgs[i].t - msgs[i - 1].t >= STARTER_GAP) out[msgs[i].p]++;
    }
    return out;
  }

  function replyGaps(msgs, n) {
    const out = Array.from({ length: n }, () => []);
    for (let i = 1; i < msgs.length; i++) {
      const gap = msgs[i].t - msgs[i - 1].t;
      if (msgs[i].p !== msgs[i - 1].p && gap < REPLY_MAX) out[msgs[i].p].push(gap);
    }
    return out;
  }

  function median(arr) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b), mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  /* The numbers on each person's card. medianReply/startsPct are null for a
   * one-person chat, where neither means anything. */
  function profiles(msgs, n) {
    const gaps = replyGaps(msgs, n);
    const st = starters(msgs, n);
    const totalStarts = st.reduce((a, b) => a + b, 0);
    const out = Array.from({ length: n }, (_, p) => ({
      p, messages: 0, words: 0, textMsgs: 0, media: 0, lateNight: 0, hours: new Array(24).fill(0),
    }));
    for (const m of msgs) {
      const o = out[m.p];
      o.messages++;
      o.hours[m.h]++;
      if (m.h < 5) o.lateNight++;
      if (stats.MEDIA.has(m.k)) o.media++;
      if (m.k === 't' || m.k === 'l') { o.textMsgs++; o.words += stats.words(m.x); }
    }
    const total = msgs.length || 1;
    for (const o of out) {
      o.share = o.messages / total;
      o.wordsPerMsg = o.textMsgs ? o.words / o.textMsgs : 0;
      o.afterMidnightPct = o.messages ? o.lateNight / o.messages : 0;
      o.medianReply = n > 1 ? median(gaps[o.p]) : null;
      o.startsPct = n > 1 && totalStarts ? st[o.p] / totalStarts : null;
    }
    return out;
  }

  /* At most two roles per person, each role going to the single person at the
   * extreme. Only for 2–12 people: alone it's meaningless, in a crowd it's noise. */
  function roles(profs, fl) {
    const out = profs.map(() => []);
    const active = profs.filter(p => p.messages > 0);
    if (active.length < 2 || active.length > 12) return out;
    const pick = (score, better) => {
      let best = null;
      for (const p of active) {
        const v = score(p);
        if (v == null) continue;
        if (best === null || better(v, score(best))) best = p;
      }
      return best;
    };
    const max = (a, b) => a > b, min = (a, b) => a < b;
    const rules = [
      ['starter', pick(p => p.startsPct, max)],
      ['fastest', pick(p => p.medianReply, min)],
      // Under 2% after midnight nobody is a night owl, however the rest compare.
      ['night_owl', pick(p => (p.afterMidnightPct >= NIGHT_OWL_MIN ? p.afterMidnightPct : null), max)],
      ['good_night', pick(p => fl.last[p.p], max)],
      ['good_morning', pick(p => fl.first[p.p], max)],
    ];
    for (const [role, who] of rules) {
      if (who && out[who.p].length < 2) out[who.p].push(role);
    }
    return out;
  }

  const SORTS = {
    messages: (a, b) => b.messages - a.messages,
    fastest: (a, b) => (a.medianReply ?? Infinity) - (b.medianReply ?? Infinity),
    longest: (a, b) => b.wordsPerMsg - a.wordsPerMsg,
    night: (a, b) => b.afterMidnightPct - a.afterMidnightPct,
  };

  function sorted(profs, key) {
    return [...profs].filter(p => p.messages > 0).sort((a, b) => SORTS[key](a, b) || a.p - b.p);
  }

  return { STARTER_GAP, REPLY_MAX, firstLast, starters, replyGaps, median, profiles, roles, sorted };
})(typeof ChatStats !== 'undefined' ? ChatStats : require('./stats.js'));

if (typeof module !== 'undefined' && module.exports) module.exports = ChatPeople;
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test tests/test_people.js`
Expected: 9 pass.

- [ ] **Step 5: Commit**

```bash
git add static/people.js tests/test_people.js
git commit -m "feat: per-person model — replies, starters, roles

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Words, emojis and links (`static/words.js`)

**Files:**
- Create: `static/words.js`, `tests/test_words.js`

**Interfaces:**
- Produces global `ChatWords`:
  - `STOPWORDS: Set` (PT + EN, includes the old Streamlit list)
  - `tokens(msg) -> string[]` / `emojisOf(msg) -> string[]` — cached on the message as `_tok` / `_emo`
  - `wordCounts(msgs, person = null) -> Map`; `emojiCounts(msgs, person = null) -> Map`; `top(map, n) -> [[key, count]]` (count desc, then key asc)
  - `signatureWords(msgs, nPeople, n = 5) -> [[word, count]][]` per person
  - `termMatcher(term, { wholeWord = true, matchCase = false }) -> RegExp|null` (flags `gu` + `i`)
  - `countTerm(msgs, nPeople, term, opts) -> { byPerson[], total, byMonth: Map<'YYYY-MM', n> }`
  - `linkDomains(msgs, n = 5) -> [[domain, count]]` (tail folded into `'other'`)

- [ ] **Step 1: Write the failing tests** — `tests/test_words.js`

```javascript
// Tests for static/words.js. Run by tests/test_js.py.
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert');
const W = require('../static/words.js');
const { chat } = require('./helpers.js');

test('tokens: lower-cased, stopwords, numbers and URLs dropped', () => {
  const [m] = chat([['2024-01-01 10:00', 0, 'l', 'Olha o DISCO que eu comprei 2024 https://discogs.com/x']]);
  assert.deepStrictEqual(W.tokens(m), ['olha', 'disco', 'comprei']);
});

test('tokens are cached on the message', () => {
  const [m] = chat([['2024-01-01 10:00', 0, 't', 'saudade']]);
  assert.strictEqual(W.tokens(m), W.tokens(m));
});

test('media messages have no tokens or emojis', () => {
  const [m] = chat([['2024-01-01 10:00', 0, 'a', '']]);
  assert.deepStrictEqual(W.tokens(m), []);
  assert.deepStrictEqual(W.emojisOf(m), []);
});

test('emojis keep ZWJ families, skin tones, VS16 and flags whole', () => {
  const [m] = chat([['2024-01-01 10:00', 0, 't', 'oi 👨\u200d👩\u200d👧 👍🏽 ❤\ufe0f 🇧🇷 😂😂']]);
  assert.deepStrictEqual(W.emojisOf(m), ['👨\u200d👩\u200d👧', '👍🏽', '❤\ufe0f', '🇧🇷', '😂', '😂']);
});

test('word and emoji counts per person', () => {
  const msgs = chat([['2024-01-01 10:00', 0, 't', 'disco disco 😂'], ['2024-01-01 10:01', 1, 't', 'disco']]);
  assert.strictEqual(W.wordCounts(msgs).get('disco'), 3);
  assert.strictEqual(W.wordCounts(msgs, 1).get('disco'), 1);
  assert.deepStrictEqual(W.top(W.emojiCounts(msgs, 0), 3), [['😂', 1]]);
});

test('signature words favour what one person says more than the rest', () => {
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(['2024-01-01 10:00', 0, 't', 'vinil amor']);
  for (let i = 0; i < 5; i++) rows.push(['2024-01-01 11:00', 1, 't', 'gato amor']);
  const [a, b] = W.signatureWords(chat(rows), 2, 1);
  assert.deepStrictEqual(a, [['vinil', 5]]);
  assert.deepStrictEqual(b, [['gato', 5]]);
});

test('whole-word search: "oi" does not count inside "noite"; accents are letters', () => {
  const msgs = chat([['2024-01-01 10:00', 0, 't', 'oi, boa noite! Oi'], ['2024-02-01 10:00', 1, 't', 'você? vocês']]);
  assert.strictEqual(W.countTerm(msgs, 2, 'oi', {}).total, 2);
  assert.strictEqual(W.countTerm(msgs, 2, 'oi', { wholeWord: false }).total, 3);
  assert.strictEqual(W.countTerm(msgs, 2, 'você', {}).total, 1);
});

test('match case and per-month buckets', () => {
  const msgs = chat([['2024-01-01 10:00', 0, 't', 'Oi oi'], ['2024-02-01 10:00', 1, 't', 'oi']]);
  const r = W.countTerm(msgs, 2, 'oi', { matchCase: true });
  assert.deepStrictEqual(r.byPerson, [1, 1]);
  assert.deepStrictEqual([...r.byMonth], [['2024-01', 1], ['2024-02', 1]]);
});

test('an empty term or one with regex characters is safe', () => {
  const msgs = chat([['2024-01-01 10:00', 0, 't', 'a.b (c)']]);
  assert.strictEqual(W.countTerm(msgs, 1, '  ', {}).total, 0);
  assert.strictEqual(W.countTerm(msgs, 1, '(c)', { wholeWord: false }).total, 1);
});

test('link domains strip www and fold the tail into other', () => {
  const rows = ['https://www.youtube.com/a', 'http://youtube.com/b', 'https://open.spotify.com/x', 'https://a.com', 'https://b.com']
    .map(u => ['2024-01-01 10:00', 0, 'l', 'olha ' + u]);
  assert.deepStrictEqual(W.linkDomains(chat(rows), 2), [['youtube.com', 2], ['a.com', 1], ['other', 2]]);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/test_words.js`
Expected: FAIL — `Cannot find module '../static/words.js'`.

- [ ] **Step 3: Implement** — `static/words.js`

```javascript
'use strict';

/* Words, emojis and links.
 *
 * Tokens and emojis are cached on each message object (m._tok / m._emo), so a
 * date-range change only re-counts — it never re-tokenises 100k messages.
 *
 * Pure functions, loaded as a plain script and required by tests/test_words.js. */

const ChatWords = (function () {

  // PT + EN, including everything the Streamlit version removed.
  const STOPWORDS = new Set((
    'a ao aos à às ainda agora aqui algo aí assim ai até ah audio anexado apagada ' +
    'b c com como coisa cara d da das de deu do dos dar dele dela deles delas depois ' +
    'e eu estar então está esta este isto estou eh é em ele ela eles elas esse essa esses essas estão era eram ' +
    'f foi faz fazer fica g h https http i isso ia ir j ja já jpg k l la lá lo ' +
    'm mas mais me meu minha meus minhas ma muito muita mim mensagem ' +
    'n né no nos não nao nós nada na nas nem num numa ' +
    'o os ou opus omitido omitida oculta ocultado ocultada ' +
    'p pra pro pras pros para porque pode por pq porq photo pelo pela ' +
    'q que quando qual quer quem r s sim se sem sobre sabe ser seu sua seus suas só são sou ' +
    't ta tá tão tem têm tô tudo todo toda todos ter te tava tal tb também tipo ' +
    'u uma um umas uns v vc vcs você voce vou vai vão ver viu vez w www x y z ' +
    'the and to of in is it you that i for on with this was are be at have not but ' +
    'my me so do just what your all can if we they he she her his its or an as from ' +
    'up out about was were will would there their them then than im i\'m it\'s dont don\'t ' +
    'omitted image video sticker deleted message media gif document null'
  ).split(/\s+/));

  const URL_RE = /https?:\/\/\S+/gi;
  const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;
  // One emoji = a pictograph or flag pair, its variation selector / skin tone,
  // and any ZWJ-joined continuation (👨\u200d👩\u200d👧 stays one family).
  const EMOJI_RE = /(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}[\ufe0f\u{1F3FB}-\u{1F3FF}]*(?:\u200d\p{Extended_Pictographic}[\ufe0f\u{1F3FB}-\u{1F3FF}]*)*)/gu;

  function isText(m) { return m.k === 't' || m.k === 'l'; }

  function tokens(m) {
    if (m._tok) return m._tok;
    const out = [];
    if (isText(m)) {
      for (const w of m.x.replace(URL_RE, ' ').toLowerCase().match(WORD_RE) || []) {
        if (w.length < 2 || /^\d+$/.test(w) || STOPWORDS.has(w)) continue;
        out.push(w);
      }
    }
    m._tok = out;
    return out;
  }

  function emojisOf(m) {
    if (!m._emo) m._emo = isText(m) ? (m.x.match(EMOJI_RE) || []) : [];
    return m._emo;
  }

  function countBy(msgs, pick, person) {
    const out = new Map();
    for (const m of msgs) {
      if (person != null && m.p !== person) continue;
      for (const w of pick(m)) out.set(w, (out.get(w) || 0) + 1);
    }
    return out;
  }

  function top(map, n) {
    return [...map].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
  }

  function wordCounts(msgs, person = null) { return countBy(msgs, tokens, person); }
  function emojiCounts(msgs, person = null) { return countBy(msgs, emojisOf, person); }

  /* Words a person uses more than everyone else does: count × (their rate /
   * everyone's rate). Needs at least 3 uses so one-offs don't win. */
  function signatureWords(msgs, nPeople, n = 5) {
    const all = wordCounts(msgs);
    const allTotal = [...all.values()].reduce((a, b) => a + b, 0) || 1;
    return Array.from({ length: nPeople }, (_, p) => {
      const mine = wordCounts(msgs, p);
      const myTotal = [...mine.values()].reduce((a, b) => a + b, 0) || 1;
      const scored = new Map();
      for (const [w, c] of mine) {
        if (c < 3) continue;
        scored.set(w, c * ((c / myTotal) / (all.get(w) / allTotal)));
      }
      return top(scored, n).map(([w]) => [w, mine.get(w)]);
    });
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* Build the matcher once per search. Whole-word boundaries are Unicode
   * letters/digits, so "oi" no longer counts inside "noite" and "você" works. */
  function termMatcher(term, { wholeWord = true, matchCase = false } = {}) {
    const t = term.trim();
    if (!t) return null;
    const body = escapeRe(t);
    const src = wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body;
    return new RegExp(src, 'gu' + (matchCase ? '' : 'i'));
  }

  /* The word counter: per person, total, and per 'YYYY-MM'. */
  function countTerm(msgs, nPeople, term, opts) {
    const re = termMatcher(term, opts);
    const byPerson = new Array(nPeople).fill(0);
    const byMonth = new Map();
    let total = 0;
    if (!re) return { byPerson, total, byMonth };
    for (const m of msgs) {
      if (!isText(m)) continue;
      const hits = (m.x.match(re) || []).length;
      if (!hits) continue;
      byPerson[m.p] += hits;
      total += hits;
      const key = new Date(m.t * 1000).toISOString().slice(0, 7);
      byMonth.set(key, (byMonth.get(key) || 0) + hits);
    }
    return { byPerson, total, byMonth };
  }

  /* Top domains, www. stripped; the rest fold into one 'other' row. */
  function linkDomains(msgs, n = 5) {
    const c = new Map();
    for (const m of msgs) {
      if (m.k !== 'l') continue;
      for (const u of m.x.match(URL_RE) || []) {
        const d = u.replace(/^https?:\/\//i, '').split(/[/?#:]/)[0].toLowerCase().replace(/^www\./, '');
        if (d) c.set(d, (c.get(d) || 0) + 1);
      }
    }
    const ranked = top(c, Infinity);
    if (ranked.length <= n) return ranked;
    const rest = ranked.slice(n).reduce((s, [, v]) => s + v, 0);
    return ranked.slice(0, n).concat([['other', rest]]);
  }

  return { STOPWORDS, tokens, emojisOf, wordCounts, emojiCounts, top, signatureWords,
           termMatcher, countTerm, linkDomains };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ChatWords;
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test tests/test_words.js`
Expected: 10 pass.

- [ ] **Step 5: Commit**

```bash
git add static/words.js tests/test_words.js
git commit -m "feat: words, emoji and link model with whole-word search

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Strings (`static/i18n.js`)

**Files:**
- Create: `static/i18n.js`, `tests/test_i18n.js`

**Interfaces:**
- Produces global `ChatI18n`: `STRINGS: { en: {…}, pt: {…} }`, `t(lang, key, vars?) -> string` (`{name}` placeholders; falls back to en, then to the key), `detect(navigatorLanguage) -> 'pt'|'en'`.
- The key set here is the complete set used by Tasks 10–15. `tests/test_i18n.js` scans `static/*.js` and `templates/index.html` for `t('…')` / `data-i18n*="…"` and fails if any is missing — so it keeps guarding every later task.

- [ ] **Step 1: Write the failing tests** — `tests/test_i18n.js`

```javascript
// Tests for static/i18n.js. Run by tests/test_js.py.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../static/i18n.js');

const ROOT = path.join(__dirname, '..');

// Keys built at runtime as prefix + value, with every value they can take.
const DYNAMIC = {
  err_: ['no_file', 'bad_type', 'too_large', 'empty_zip', 'unparseable', 'no_messages', 'internal', 'network'],
  type_: ['t', 'a', 'p', 's', 'v', 'g', 'd', 'm', 'x', 'l'],
  preset_: ['all', '12mo', '30d'],
  lang_: ['en', 'pt'],
  role_: ['starter', 'fastest', 'night_owl', 'good_night', 'good_morning'],
  sort_: ['messages', 'fastest', 'longest', 'night'],
};

function usedKeys() {
  const keys = new Set();
  const js = fs.readdirSync(path.join(ROOT, 'static')).filter(f => f.endsWith('.js') && f !== 'i18n.js')
    .map(f => fs.readFileSync(path.join(ROOT, 'static', f), 'utf8')).join('\n');
  const html = fs.readFileSync(path.join(ROOT, 'templates', 'index.html'), 'utf8');
  for (const m of js.matchAll(/\bt\('([a-z0-9_]+)'/g)) keys.add(m[1]);
  // keys passed around as bare strings: t(c.platform === 'ios' ? 'iphone_export' : …), emptyState(root, key = '…'), col_* lists
  for (const m of js.matchAll(/'((?:iphone|android)_export|no_messages_range|col_[a-z]+)'/g)) keys.add(m[1]);
  for (const m of html.matchAll(/data-i18n(?:-html|-title)?="([a-z0-9_]+)"/g)) keys.add(m[1]);
  for (const [prefix, values] of Object.entries(DYNAMIC)) {
    keys.delete(prefix);
    values.forEach(v => keys.add(prefix + v));
  }
  return keys;
}

test('English and Portuguese have exactly the same keys', () => {
  assert.deepStrictEqual(Object.keys(I.STRINGS.pt).sort(), Object.keys(I.STRINGS.en).sort());
});

test('every key the UI uses exists', () => {
  const missing = [...usedKeys()].filter(k => !(k in I.STRINGS.en));
  assert.deepStrictEqual(missing, []);
});

test('placeholders are filled, missing keys fall back', () => {
  assert.strictEqual(I.t('pt', 'n_messages', { n: '3' }), '3 mensagens');
  assert.strictEqual(I.t('pt', 'nope'), 'nope');
});

test('detect maps any Portuguese locale to pt', () => {
  assert.strictEqual(I.detect('pt-BR'), 'pt');
  assert.strictEqual(I.detect('pt'), 'pt');
  assert.strictEqual(I.detect('en-US'), 'en');
  assert.strictEqual(I.detect(undefined), 'en');
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/test_i18n.js`
Expected: FAIL — `Cannot find module '../static/i18n.js'`.

- [ ] **Step 3: Implement** — `static/i18n.js`

```javascript
'use strict';

/* Every UI string, English and Portuguese. {name} placeholders are filled by
 * t(). A key missing from one language falls back to English, then to the key
 * itself — tests/test_i18n.js keeps both languages complete. */

const ChatI18n = (function () {

  const STRINGS = {
    en: {
      tagline: 'Visualise any WhatsApp conversation',
      theme: 'Light / dark',
      export: 'Export', new_chat: 'New chat',
      drop_title: 'Drop your WhatsApp export here',
      drop_hint: 'The <b>.txt</b> or <b>.zip</b> file from “Export chat → Without media”',
      choose_file: 'Choose file',
      reading: 'Reading {mb} MB…',
      privacy: 'Parsed in memory and thrown away — nothing is stored, logged or sent anywhere else.',
      steps_ios: '<li>Open the chat and tap the <b>contact or group name</b></li><li>Scroll down → <b>Export chat</b></li><li>Choose <b>Without media</b></li><li>Save the <b>.zip</b> and drop it here</li>',
      steps_android: '<li>Open the chat and tap <b>⋮</b> (top-right)</li><li><b>More</b> → <b>Export chat</b></li><li>Choose <b>Without media</b></li><li>Save the <b>.txt</b> and drop it here</li>',
      made_by: 'A portfolio project by João Pedro Zucoloto',
      err_no_file: 'No file was received.',
      err_bad_type: 'That isn’t a WhatsApp export — use the .txt or .zip file.',
      err_too_large: 'That file is too big.',
      err_empty_zip: 'That .zip has no chat .txt inside.',
      err_unparseable: 'Couldn’t read any messages from that file. Is it a WhatsApp export?',
      err_no_messages: 'The file only has system messages — nothing to analyse.',
      err_internal: 'Something went wrong on our side.',
      err_network: 'Couldn’t reach the server.',
      error_help: 'If it keeps happening, email <a class="link" href="mailto:joaozuco@gmail.com">joaozuco@gmail.com</a> with the code below — no need to send the chat.',
      n_messages: '{n} messages', n_people: '{n} people',
      iphone_export: 'iPhone export', android_export: 'Android export',
      lang_en: 'English', lang_pt: 'Portuguese',
      tab_overview: 'Overview', tab_activity: 'Activity', tab_people: 'People', tab_messages: 'Messages', tab_wrapped: 'Wrapped',
      range: 'Range', preset_all: 'All', preset_12mo: '12 mo', preset_30d: '30 d',
      range_info: '{days} days · {msgs} msgs',
      date_conflict: 'The start date must be before the end date.',
      no_messages_range: 'No messages in this range.',
      kpi_messages: 'Messages', kpi_messages_sub: '{perDay} per day · {words} words',
      kpi_active: 'Active days', kpi_active_sub: 'talked on {pct} of days',
      kpi_streak: 'Longest streak', kpi_streak_current: 'current: {n} days', days: 'days',
      kpi_busiest: 'Busiest day', read_that_day: 'read that day',
      every_day: 'Every day', cal_hint: 'click a day to read it', less: 'less', more: 'more',
      who_talks_more: 'Who talks more', others: 'Others', everyone: 'Everyone',
      what_gets_sent: 'What gets sent',
      android_types_note: 'Android exports don’t say what kind of media was sent, so photos, audio, stickers and videos are all “Media”.',
      words: 'Words', no_words: 'No words in this range.', cloud_hint: 'Click a word to find it in Messages.',
      type_t: 'Text', type_a: 'Audio', type_p: 'Photo', type_s: 'Sticker', type_v: 'Video', type_g: 'GIF',
      type_d: 'Document', type_m: 'Media', type_x: 'Deleted', type_l: 'Link',
      over_time: 'Messages over time', gran_day: 'Day', gran_week: 'Week', gran_month: 'Month',
      fill_empty: 'Fill empty days', fill_help: 'Show days without messages as 0',
      when_heatmap: 'When — weekday × hour', heat_count: 'Count', heat_pct: '% of all',
      heat_hint: 'Click a cell to read the messages sent then.',
      by_hour: 'By hour of day', opens_closes: 'Opens & closes the day',
      first_message: 'First message', last_message: 'Last message', starts_convos: 'Starts convos',
      starter_note: 'A conversation starts with the first message after 4 h of silence.',
      needs_two: 'Needs at least two people.',
      sort_messages: 'Sort: most messages', sort_fastest: 'Sort: fastest reply', sort_longest: 'Sort: longest messages', sort_night: 'Sort: night owl',
      of_messages: 'of messages',
      stat_messages: 'Messages', stat_words_msg: 'Words / msg', stat_reply: 'Median reply', stat_starts: 'Starts convos',
      stat_midnight: 'After midnight', stat_media: 'Media sent',
      role_starter: 'Starts most conversations', role_fastest: 'Fastest replier', role_night_owl: 'Night owl',
      role_good_night: 'Says good night', role_good_morning: 'Says good morning',
      top_emojis: 'Top emojis', signature_words: 'Signature words', their_day: 'Their day',
      search_ph: 'Search messages', all_types: 'All types', right_side: 'Right side',
      no_hits: 'no matches', no_match: 'No messages match these filters.',
      word_counter: 'Word counter', finder_default: 'good morning', finder_ph: 'Word or phrase',
      whole_words: 'Whole words only', match_case: 'Match case', total: 'Total', per_month: 'Per month',
      links_shared: 'Links shared', no_links: 'No links in this range.', other: 'other',
      you: 'You', them: 'Them', person_n: 'Person {n}',
      w_period: 'Period', w_all_time: 'All time', w_year_in_chat: '{year} in chat',
      w_period_note: 'The card uses its own period, not the date range above.',
      w_privacy: 'Privacy', w_hide_names: 'Hide names', w_show_word: 'Show top word',
      w_privacy_note: 'The card never shows message text — except the top word, and only if you tick it.',
      w_format: 'Format', w_story: 'Story 9:16', w_square: 'Square 1:1',
      w_download: 'Download PNG', w_copy: 'Copy image', w_copied: 'Copied', w_copy_failed: 'Couldn’t copy',
      w_sub: 'a year of messages', w_messages_sent: 'messages sent', w_streak: 'Longest streak', w_busiest: 'Busiest day',
      w_peak_hour: 'Peak hour', w_top_emoji: 'Top emoji', w_fastest: 'Fastest replier', w_top_word: 'Top word',
      col_time: 'Date and time', col_sender: 'Sender', col_message: 'Message', col_type: 'Type', col_weekday: 'Weekday',
    },
    pt: {
      tagline: 'Visualize qualquer conversa do WhatsApp',
      theme: 'Claro / escuro',
      export: 'Exportar', new_chat: 'Nova conversa',
      drop_title: 'Solte aqui a conversa exportada',
      drop_hint: 'O arquivo <b>.txt</b> ou <b>.zip</b> de “Exportar conversa → Sem mídia”',
      choose_file: 'Escolher arquivo',
      reading: 'Lendo {mb} MB…',
      privacy: 'Lido em memória e descartado — nada é salvo, registrado ou enviado para outro lugar.',
      steps_ios: '<li>Abra a conversa e toque no <b>nome do contato ou grupo</b></li><li>Role até <b>Exportar conversa</b></li><li>Escolha <b>Sem mídia</b></li><li>Salve o <b>.zip</b> e solte aqui</li>',
      steps_android: '<li>Abra a conversa e toque em <b>⋮</b> (canto superior)</li><li><b>Mais</b> → <b>Exportar conversa</b></li><li>Escolha <b>Sem mídia</b></li><li>Salve o <b>.txt</b> e solte aqui</li>',
      made_by: 'Um projeto de portfólio de João Pedro Zucoloto',
      err_no_file: 'Nenhum arquivo foi recebido.',
      err_bad_type: 'Isso não é uma conversa exportada — use o arquivo .txt ou .zip.',
      err_too_large: 'Esse arquivo é grande demais.',
      err_empty_zip: 'Esse .zip não tem o .txt da conversa.',
      err_unparseable: 'Não consegui ler nenhuma mensagem desse arquivo. É uma conversa do WhatsApp?',
      err_no_messages: 'O arquivo só tem mensagens do sistema — nada para analisar.',
      err_internal: 'Algo deu errado do nosso lado.',
      err_network: 'Não consegui falar com o servidor.',
      error_help: 'Se continuar acontecendo, mande um e-mail para <a class="link" href="mailto:joaozuco@gmail.com">joaozuco@gmail.com</a> com o código abaixo — não precisa mandar a conversa.',
      n_messages: '{n} mensagens', n_people: '{n} pessoas',
      iphone_export: 'exportada do iPhone', android_export: 'exportada do Android',
      lang_en: 'Inglês', lang_pt: 'Português',
      tab_overview: 'Visão geral', tab_activity: 'Atividade', tab_people: 'Pessoas', tab_messages: 'Mensagens', tab_wrapped: 'Retrospectiva',
      range: 'Período', preset_all: 'Tudo', preset_12mo: '12 meses', preset_30d: '30 dias',
      range_info: '{days} dias · {msgs} msgs',
      date_conflict: 'A data inicial precisa ser anterior à data final.',
      no_messages_range: 'Nenhuma mensagem neste período.',
      kpi_messages: 'Mensagens', kpi_messages_sub: '{perDay} por dia · {words} palavras',
      kpi_active: 'Dias ativos', kpi_active_sub: 'conversaram em {pct} dos dias',
      kpi_streak: 'Maior sequência', kpi_streak_current: 'atual: {n} dias', days: 'dias',
      kpi_busiest: 'Dia mais movimentado', read_that_day: 'ler esse dia',
      every_day: 'Todos os dias', cal_hint: 'clique num dia para ler', less: 'menos', more: 'mais',
      who_talks_more: 'Quem fala mais', others: 'Outros', everyone: 'Todos',
      what_gets_sent: 'O que é enviado',
      android_types_note: 'Conversas exportadas do Android não dizem o tipo de mídia, então fotos, áudios, figurinhas e vídeos aparecem como “Mídia”.',
      words: 'Palavras', no_words: 'Nenhuma palavra neste período.', cloud_hint: 'Clique numa palavra para achá-la em Mensagens.',
      type_t: 'Texto', type_a: 'Áudio', type_p: 'Foto', type_s: 'Figurinha', type_v: 'Vídeo', type_g: 'GIF',
      type_d: 'Documento', type_m: 'Mídia', type_x: 'Apagada', type_l: 'Link',
      over_time: 'Mensagens ao longo do tempo', gran_day: 'Dia', gran_week: 'Semana', gran_month: 'Mês',
      fill_empty: 'Preencher dias vazios', fill_help: 'Mostra dias sem mensagens como 0',
      when_heatmap: 'Quando — dia da semana × hora', heat_count: 'Total', heat_pct: '% do total',
      heat_hint: 'Clique numa célula para ler as mensagens daquele horário.',
      by_hour: 'Por hora do dia', opens_closes: 'Abre e fecha o dia',
      first_message: 'Primeira mensagem', last_message: 'Última mensagem', starts_convos: 'Puxa conversa',
      starter_note: 'Uma conversa começa com a primeira mensagem depois de 4 h de silêncio.',
      needs_two: 'Precisa de pelo menos duas pessoas.',
      sort_messages: 'Ordenar: mais mensagens', sort_fastest: 'Ordenar: responde mais rápido', sort_longest: 'Ordenar: mensagens mais longas', sort_night: 'Ordenar: coruja',
      of_messages: 'das mensagens',
      stat_messages: 'Mensagens', stat_words_msg: 'Palavras / msg', stat_reply: 'Resposta (mediana)', stat_starts: 'Puxa conversa',
      stat_midnight: 'Depois da meia-noite', stat_media: 'Mídias enviadas',
      role_starter: 'Puxa mais conversas', role_fastest: 'Responde mais rápido', role_night_owl: 'Coruja',
      role_good_night: 'Dá boa noite', role_good_morning: 'Dá bom dia',
      top_emojis: 'Emojis favoritos', signature_words: 'Palavras marca registrada', their_day: 'Ritmo do dia',
      search_ph: 'Buscar mensagens', all_types: 'Todos os tipos', right_side: 'Lado direito',
      no_hits: 'nenhum resultado', no_match: 'Nenhuma mensagem com esses filtros.',
      word_counter: 'Contador de palavras', finder_default: 'bom dia', finder_ph: 'Palavra ou frase',
      whole_words: 'Só palavras inteiras', match_case: 'Diferenciar maiúsculas', total: 'Total', per_month: 'Por mês',
      links_shared: 'Links compartilhados', no_links: 'Nenhum link neste período.', other: 'outros',
      you: 'Você', them: 'Outra pessoa', person_n: 'Pessoa {n}',
      w_period: 'Período', w_all_time: 'Desde sempre', w_year_in_chat: '{year} na conversa',
      w_period_note: 'O cartão usa o próprio período, não o intervalo de datas acima.',
      w_privacy: 'Privacidade', w_hide_names: 'Esconder nomes', w_show_word: 'Mostrar palavra mais usada',
      w_privacy_note: 'O cartão nunca mostra texto de mensagens — só a palavra mais usada, e só se você marcar.',
      w_format: 'Formato', w_story: 'Story 9:16', w_square: 'Quadrado 1:1',
      w_download: 'Baixar PNG', w_copy: 'Copiar imagem', w_copied: 'Copiado', w_copy_failed: 'Não deu para copiar',
      w_sub: 'um ano de mensagens', w_messages_sent: 'mensagens enviadas', w_streak: 'Maior sequência', w_busiest: 'Dia mais movimentado',
      w_peak_hour: 'Horário de pico', w_top_emoji: 'Emoji favorito', w_fastest: 'Responde mais rápido', w_top_word: 'Palavra do ano',
      col_time: 'Data e hora', col_sender: 'Remetente', col_message: 'Mensagem', col_type: 'Tipo', col_weekday: 'Dia da semana',
    },
  };

  function t(lang, key, vars) {
    let s = (STRINGS[lang] && STRINGS[lang][key]) ?? STRINGS.en[key] ?? key;
    if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  }

  function detect(navLang) {
    return /^pt\b/i.test(navLang || '') ? 'pt' : 'en';
  }

  return { STRINGS, t, detect };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ChatI18n;
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test tests/test_i18n.js`
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add static/i18n.js tests/test_i18n.js
git commit -m "feat: English and Portuguese strings with completeness test

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Wrapped model + canvas, and export (`static/wrapped.js`, `static/export.js`)

**Files:**
- Create: `static/wrapped.js`, `static/export.js`, `tests/test_wrapped.js`, `tests/test_export.js`

**Interfaces:**
- Consumes: `ChatRange`, `ChatStats`, `ChatPeople`, `ChatWords`.
- Produces global `ChatWrapped`:
  - `PALETTE` (fixed dark palette, `people[6]`), `MIN_REPLIES = 5`
  - `periods(first, last) -> ['2023', …, 'all']`; `select(msgs, period) -> msgs`
  - `model(allMsgs, names, period, { showTopWord = false }) -> { period, total, streak, busiest|null, peakHour|null, topEmoji|null, fastest: {p, name, sec}|null, topWord|null, split: [{p, name, pct}] (top 3), more }`
  - `draw(canvas, card, fmt = 'story'|'square', scale = 3)` where `card = { kicker, title, sub, big, bigLabel, cells: [[label, value, small]], split: [{name, pct, color}], footL, footR, brand }`
- Produces global `ChatExport`: `rows(msgs, { names, typeLabel(k), weekdayLabel(wd), headers[5] }) -> string[][]`, `toCsv(table) -> string` (BOM + CRLF, RFC 4180), `download('csv'|'xlsx', msgs, opts)` (xlsx lazy-loads SheetJS 0.18.5 from cdnjs; falls back to CSV if the CDN fails).

- [ ] **Step 1: Write the failing tests** — `tests/test_wrapped.js`

```javascript
// Tests for the pure half of static/wrapped.js. Run by tests/test_js.py.
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert');
const Wr = require('../static/wrapped.js');
const { chat, day } = require('./helpers.js');

function sample() {
  const rows = [['2024-12-31 22:00', 0, 't', 'segredo segredo segredo']];
  // 2025: person 1 replies within a minute, six times; person 0 takes an hour.
  for (let i = 1; i <= 6; i++) {
    const d = `2025-01-0${i}`;
    rows.push([`${d} 09:00`, 0, 't', 'bom dia 😂'], [`${d} 09:01`, 1, 't', 'oi'], [`${d} 10:01`, 0, 't', 'ok']);
  }
  return chat(rows);
}

test('periods: every year then all', () => {
  assert.deepStrictEqual(Wr.periods(day('2024-12-31'), day('2025-01-06')), ['2024', '2025', 'all']);
});

test('a year period ignores other years', () => {
  const m = Wr.model(sample(), ['A', 'B'], '2025');
  assert.strictEqual(m.total, 18);
  assert.strictEqual(m.streak, 6);
  assert.strictEqual(m.peakHour, 9);
  assert.deepStrictEqual(m.topEmoji, ['😂', 6]);
  assert.strictEqual(Wr.model(sample(), ['A', 'B'], 'all').total, 19);
});

test('fastest replier needs at least MIN_REPLIES replies', () => {
  const m = Wr.model(sample(), ['A', 'B'], '2025');
  assert.deepStrictEqual(m.fastest, { p: 1, name: 'B', sec: 60 });
  assert.strictEqual(Wr.model(sample(), ['A', 'B'], '2024').fastest, null);
});

test('top word is hidden unless asked for', () => {
  assert.strictEqual(Wr.model(sample(), ['A', 'B'], 'all').topWord, null);
  // "bom" and "dia" tie at 6; ties break alphabetically.
  assert.strictEqual(Wr.model(sample(), ['A', 'B'], 'all', { showTopWord: true }).topWord, 'bom');
  assert.strictEqual(Wr.model(sample(), ['A', 'B'], '2024', { showTopWord: true }).topWord, 'segredo');
});

test('names come only from the caller, so hiding them is the caller swapping the list', () => {
  const m = Wr.model(sample(), ['You', 'Them'], '2025');
  assert.deepStrictEqual(m.split.map(s => s.name), ['You', 'Them']);
  assert.ok(!JSON.stringify(m).includes('bom dia'));
});

test('split keeps the top 3 and counts the rest', () => {
  const rows = [0, 0, 0, 0, 1, 1, 1, 2, 2, 3, 4].map((p, i) => [`2025-01-01 10:${String(i).padStart(2, '0')}`, p]);
  const m = Wr.model(chat(rows), ['a', 'b', 'c', 'd', 'e'], '2025');
  assert.deepStrictEqual(m.split.map(s => s.p), [0, 1, 2]);
  assert.strictEqual(m.more, 2);
});

test('an empty period is all zeros and nulls, not a crash', () => {
  const m = Wr.model(sample(), ['A', 'B'], '2030');
  assert.deepStrictEqual([m.total, m.streak, m.busiest, m.peakHour, m.topEmoji, m.fastest], [0, 0, null, null, null, null]);
});
```

`tests/test_export.js`:

```javascript
// Tests for the pure half of static/export.js. Run by tests/test_js.py.
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert');
const E = require('../static/export.js');
const { chat } = require('./helpers.js');

const opts = {
  names: ['Pepe', 'Jenni'],
  typeLabel: k => ({ t: 'Text', a: 'Audio' })[k],
  weekdayLabel: wd => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wd],
  headers: ['Time', 'Sender', 'Message', 'Type', 'Weekday'],
};

test('rows: header then one row per message, wall-clock time', () => {
  const t = E.rows(chat([['2024-02-03 23:30', 1, 't', 'oi'], ['2024-02-04 00:10', 0, 'a', '']]), opts);
  assert.deepStrictEqual(t, [
    ['Time', 'Sender', 'Message', 'Type', 'Weekday'],
    ['2024-02-03 23:30:00', 'Jenni', 'oi', 'Text', 'Sat'],
    ['2024-02-04 00:10:00', 'Pepe', '', 'Audio', 'Sun'],
  ]);
});

test('csv quotes commas, quotes and newlines, uses CRLF and a BOM', () => {
  const csv = E.toCsv([['a', 'b,c'], ['say "hi"', 'line\nbreak']]);
  assert.strictEqual(csv, '\ufeffa,"b,c"\r\n"say ""hi""","line\nbreak"\r\n');
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/test_wrapped.js tests/test_export.js`
Expected: FAIL — `Cannot find module '../static/wrapped.js'` / `'../static/export.js'`.

- [ ] **Step 3: Implement** — `static/wrapped.js`

```javascript
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

  const PALETTE = { bg: '#0a0a0a', text: '#e8e8e0', muted: '#9a9a92', faint: '#555', accent: '#5FBF7A',
                    border: '#3A2C1D', people: ['#5FBF7A', '#F5C518', '#4AA3C4', '#9B7FD4', '#E05A5A', '#D4608A'] };
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
    while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
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
```

`static/export.js`:

```javascript
'use strict';

/* Export the filtered messages as CSV or XLSX, entirely in the browser.
 * Columns match the Streamlit version's Excel file: time, sender, message,
 * type, weekday. SheetJS is only fetched the first time someone picks .xlsx.
 *
 * rows/toCsv are pure and tested (tests/test_export.js). */

const ChatExport = (function () {

  const XLSX_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  function stamp(ts) { return new Date(ts * 1000).toISOString().slice(0, 19).replace('T', ' '); }

  function rows(msgs, { names, typeLabel, weekdayLabel, headers }) {
    return [headers].concat(msgs.map(m => [stamp(m.t), names[m.p], m.x, typeLabel(m.k), weekdayLabel(m.wd)]));
  }

  function csvCell(v) {
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* RFC 4180, CRLF, with a BOM so Excel opens it as UTF-8. */
  function toCsv(table) {
    return '\ufeff' + table.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  function save(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  let xlsxLoading = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxLoading) {
      xlsxLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = XLSX_SRC;
        s.onload = () => resolve(window.XLSX);
        s.onerror = () => { xlsxLoading = null; reject(new Error('xlsx')); };
        document.head.appendChild(s);
      });
    }
    return xlsxLoading;
  }

  async function download(kind, msgs, opts) {
    const table = rows(msgs, opts);
    if (kind === 'csv') {
      save(new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' }), 'chat_analysis.csv');
      return;
    }
    try {
      const X = await loadXlsx();
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(table), 'Chat');
      X.writeFile(wb, 'chat_analysis.xlsx');
    } catch (e) {
      // CDN unreachable: CSV still works offline, so fall back to it.
      save(new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' }), 'chat_analysis.csv');
    }
  }

  return { rows, toCsv, download };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ChatExport;
```

- [ ] **Step 4: Run — expect PASS**

Run: `python -m pytest -q`
Expected: everything green (7 wrapped + 2 export node tests inside `test_js.py`).

- [ ] **Step 5: Commit**

```bash
git add static/wrapped.js static/export.js tests/test_wrapped.js tests/test_export.js
git commit -m "feat: Wrapped card model/canvas and CSV/XLSX export

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: The page shell — markup, CSS, `static/app.js`, favicon

**Files:**
- Modify: `templates/index.html` (full replacement)
- Create: `static/app.js`, `static/chat-icon.svg`

**Interfaces:**
- Consumes: all model globals + `ChatI18n`.
- Produces global `App`:
  - `state` — `{ chat, msgs, view, first, last, from, to, presets, tab, lang }` (`view` = msgs in range)
  - helpers: `t(key, vars)`, `esc(s)`, `num(n, digits=0)`, `pct(f)`, `fmtDay(day, intlOpts)`, `fmtTime(ts)`, `weekdayName(wd, 'short'|'long'|'narrow')`, `fmtDuration(sec)`, `color(p)` (CSS var), `colorValue(p)` (resolved hex), `name(p)`, `showTip(e, html)`, `hideTip()`, `emptyState(root, key?)`
  - `register(tab, { render(root), focus?(filters), reset?() })` — views call this at load
  - `openMessages({ day?, person?, search?, slot?: {wd, h} })` — switches to Messages via its `focus`
  - `setRange(from, to)`, `load(chat)`, `boot()`
- Only the visible tab renders; others re-render when opened after any range/lang/theme change.

The CSS is the approved mockup's (`.superpowers/brainstorm/2300-1789770289/content/mockup-v1.html`) minus the mockup-only switcher, plus states the mockup didn't have (busy drop zone, error box, empty state, windowed chat).

- [ ] **Step 1: Replace `templates/index.html`**

```html
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chat Analyzer</title>
<link rel="icon" type="image/svg+xml" href="/static/chat-icon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Courier+Prime:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.6.0/dist/tabler-icons.min.css">
<style>
*{box-sizing:border-box;margin:0;padding:0}
/* Shared portfolio system, copied from vinyl-collection. Only the accent
   differs: vinyl's house colour is gold, this app's is the muted green vinyl
   already uses for "played" — deepened for light mode so text on cream clears
   4.5:1, the same treatment vinyl gives its gold. */
[data-theme="dark"]{
  --bg:#0c0c0c;--surface:#141414;--card:#181818;--border:#3A2C1D;
  --text:#e8e8e0;--muted:#555;--label:#9a9a92;--accent:#5FBF7A;--accent-rgb:95,191,122;--danger:#c0392b;
  --card-hover:#1f1f1f;
  --p1:#5FBF7A;--p2:#F5C518;--p3:#4AA3C4;--p4:#9B7FD4;--p5:#E05A5A;--p6:#D4608A;
  --cell0:#1a1a1a;--bubble-me:#16261b;--bubble-them:#1b1b1b;
}
[data-theme="light"]{
  --bg:#e1ddd3;--surface:#f0ede6;--card:#f0ede6;--border:#CBB596;
  --text:#1a1a18;--muted:#827e74;--label:#63635b;--accent:#3d8a55;--accent-rgb:61,138,85;--danger:#c0392b;
  --card-hover:#e9e5dc;
  --p1:#3d8a55;--p2:#b39609;--p3:#2b7f99;--p4:#6f4fae;--p5:#b33b3b;--p6:#b24a72;
  --cell0:#e6e2d8;--bubble-me:#dcebdc;--bubble-them:#f7f5ef;
}
:root{--font:'Inter',system-ui,sans-serif;--font-mono:'Courier Prime',monospace;--radius:4px;--radius-sm:3px}
body{background:var(--bg);color:var(--text);font-family:var(--font);font-size:14px;min-height:100vh;letter-spacing:-.01em;transition:background .2s,color .2s}
.app{max-width:1200px;margin:0 auto;padding:0 24px 80px}
@media(max-width:480px){.app{padding:0 16px 64px}}
.hidden{display:none!important}

header{display:flex;align-items:center;justify-content:space-between;padding:28px 0 20px;gap:16px;flex-wrap:wrap;border-bottom:1px solid var(--border)}
.logo-row{display:flex;align-items:center;gap:12px;min-width:0}
.logo{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle,var(--card) 0 34%,#000 35% 100%);box-shadow:0 0 0 1px var(--border);flex-shrink:0}
.logo i{color:var(--accent);font-size:17px}
.app-name{font-size:18px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;font-family:var(--font-mono)}
.chat-sub{font-size:13px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chat-sub b{color:var(--label);font-weight:500}
.header-right{display:flex;gap:8px;align-items:center;flex-wrap:wrap}

.btn{height:34px;padding:0 14px;border-radius:var(--radius-sm);font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);background:transparent;color:var(--muted);white-space:nowrap;transition:all .12s;font-family:var(--font)}
.btn:hover{border-color:var(--text);color:var(--text)}
.btn-primary{border-color:var(--accent);color:var(--accent)}
.btn-primary:hover{background:rgba(var(--accent-rgb),.08);color:var(--accent);border-color:var(--accent)}
.btn-icon{width:34px;padding:0;justify-content:center;font-size:15px}
.btn:disabled{opacity:.45;cursor:not-allowed}
.seg{display:inline-flex;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;flex-wrap:wrap}
.seg button{height:32px;padding:0 10px;background:transparent;border:none;color:var(--muted);font:500 12px var(--font);cursor:pointer;border-right:1px solid var(--border)}
.seg button:last-child{border-right:none}
.seg button.on{background:rgba(var(--accent-rgb),.1);color:var(--accent)}
.seg.sm button{height:26px;font-size:11px;padding:0 8px}
.menu{position:relative}
.menu-list{position:absolute;right:0;top:calc(100% + 4px);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);z-index:50;min-width:150px;padding:4px}
.menu-list button{display:flex;width:100%;gap:8px;align-items:center;background:none;border:none;color:var(--text);font:13px var(--font);padding:8px 10px;cursor:pointer;border-radius:2px}
.menu-list button:hover{background:var(--card-hover)}

.nav-tabs{display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:18px;overflow-x:auto}
.nav-tab{padding:12px 14px 11px;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer;border:none;border-bottom:2px solid transparent;display:flex;align-items:center;gap:7px;white-space:nowrap;background:none;font-family:var(--font)}
.nav-tab:hover{color:var(--text)}
.nav-tab.active{color:var(--text);border-bottom-color:var(--accent)}
.nav-tab.active i{color:var(--accent)}

.datebar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:24px;padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm)}
.datebar .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600;display:flex;align-items:center;gap:6px;margin-right:4px}
.datebar .lbl i{color:var(--accent);font-size:14px}
.datebar input[type=date]{height:32px;border:1px solid var(--border);border-radius:var(--radius-sm);background:transparent;color:var(--text);padding:0 8px;font:13px var(--font-mono);color-scheme:dark}
[data-theme="light"] .datebar input[type=date]{color-scheme:light}
.datebar .arrow{color:var(--muted)}
.datebar .range-info{margin-left:auto;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.datebar .range-info b{color:var(--text);font-weight:600}
.warn{color:var(--danger);font-size:12px;display:flex;align-items:center;gap:6px;width:100%}

.sec{margin-bottom:28px}
.sec-h{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.sec-h .t{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--label);display:flex;align-items:center;gap:7px}
.sec-h .t i{font-size:15px;color:var(--accent)}
.sec-h .r{margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px}
.note{font-size:11.5px;color:var(--muted);margin-top:8px;display:flex;gap:6px;align-items:flex-start;line-height:1.45}
.note i{font-size:14px;flex-shrink:0}
.empty{padding:60px 20px;text-align:center;color:var(--muted);display:flex;flex-direction:column;align-items:center;gap:10px}
.empty i{font-size:32px;color:var(--border)}
.link{color:var(--accent);text-decoration:none;cursor:pointer;background:none;border:none;font:inherit;padding:0}
.link:hover{text-decoration:underline}

.kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:28px}
@media(max-width:900px){.kpi{grid-template-columns:1fr 1fr}}
@media(max-width:480px){.kpi{grid-template-columns:1fr}}
.kpi-tile{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px 12px;position:relative;overflow:hidden;display:flex;flex-direction:column;min-height:140px}
.kpi-tile::before{content:'';position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--hue)}
.kpi-l{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600;display:flex;gap:6px;align-items:center}
.kpi-l i{font-size:13px;color:var(--hue)}
.kpi-v{font-size:30px;font-weight:800;line-height:1.05;letter-spacing:-.02em;margin-top:7px;font-variant-numeric:tabular-nums}
.kpi-v small{font-size:14px;font-weight:600;color:var(--muted);margin-left:4px}
.kpi-s{font-size:11.5px;color:var(--muted);margin-top:3px;line-height:1.45;font-variant-numeric:tabular-nums}
.kpi-foot{margin-top:auto;padding-top:12px}
.kpi-bars{display:flex;align-items:flex-end;gap:3px;height:30px}
.kpi-bars .b{flex:1;background:var(--hue);opacity:.85;border-radius:2px 2px 0 0;min-height:2px}
.kpi-days{display:flex;gap:3px;margin-top:4px}
.kpi-days span{flex:1;text-align:center;font:9px var(--font-mono);color:var(--muted)}
.kpi-spark{display:block;width:100%;height:30px;overflow:visible}

.cal-wrap{overflow-x:auto}
.cal-row{display:flex;gap:8px}
.cal{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,11px);grid-auto-columns:11px;gap:3px}
.cal .c{width:11px;height:11px;border-radius:2px;background:var(--cell0);cursor:pointer;border:none;padding:0}
.cal .c:hover{outline:1px solid var(--text)}
.cal .c.blank{visibility:hidden;cursor:default}
.cal .c.out{opacity:.25}
.cal .l1{background:rgba(var(--accent-rgb),.25)}.cal .l2{background:rgba(var(--accent-rgb),.5)}
.cal .l3{background:rgba(var(--accent-rgb),.75)}.cal .l4{background:var(--accent)}
.cal-months{display:grid;grid-auto-flow:column;grid-auto-columns:11px;gap:3px;margin-bottom:6px;font:10px var(--font-mono);color:var(--muted);height:12px}
.cal-days{display:grid;grid-template-rows:repeat(7,11px);gap:3px;font:9px var(--font-mono);color:var(--muted);padding-top:18px}
.legend{display:flex;align-items:center;gap:4px;font-size:10.5px;color:var(--muted);margin-top:10px;flex-wrap:wrap}
.legend .c{width:11px;height:11px;border-radius:2px;display:inline-block}
.legend .sp{flex:1}

.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:860px){.grid2{grid-template-columns:1fr}}
.grid3{display:grid;grid-template-columns:2fr 1fr;gap:14px}
@media(max-width:860px){.grid3{grid-template-columns:1fr}}

.share{display:flex;height:28px;border-radius:var(--radius-sm);overflow:hidden;border:1px solid var(--border)}
.share div{display:flex;align-items:center;padding:0 8px;font:700 12px var(--font);color:#0c0c0c;white-space:nowrap;overflow:hidden;min-width:0}
.who-list{margin-top:12px;display:flex;flex-direction:column;gap:8px}
.who-list.row{flex-direction:row;flex-wrap:wrap;gap:6px 18px}
.who{display:flex;align-items:center;gap:10px;font-size:13px}
.dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.who .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.who .v{font-variant-numeric:tabular-nums;color:var(--label);font-family:var(--font-mono)}

.hbars{display:flex;flex-direction:column;gap:9px}
.hbar{display:grid;grid-template-columns:96px 1fr 60px;align-items:center;gap:10px;font-size:12.5px}
.hbar .k{display:flex;align-items:center;gap:7px;color:var(--label);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.hbar .k i{font-size:15px;color:var(--muted)}
.hbar .track{height:14px;background:var(--cell0);border-radius:2px;overflow:hidden;display:flex}
.hbar .track div{height:100%}
.hbar .v{text-align:right;font:12px var(--font-mono);color:var(--label)}

.cloud{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:4px 14px;padding:18px 8px;min-height:180px;line-height:1.05}
.cloud button{font-weight:700;letter-spacing:-.02em;cursor:pointer;background:none;border:none;font-family:var(--font)}
.cloud button:hover{text-decoration:underline;text-underline-offset:4px}

.heat{display:grid;grid-template-columns:36px repeat(24,minmax(0,1fr));gap:3px;font:10px var(--font-mono);color:var(--muted);min-width:640px}
.heat-wrap{overflow-x:auto}
.heat .hc{aspect-ratio:1.25;border-radius:2px;display:grid;place-items:center;font-size:9px;cursor:pointer;border:none;font-family:var(--font-mono)}
.heat .hc:hover{outline:1px solid var(--text)}
.heat .rl{display:flex;align-items:center}
.heat .cl{text-align:center}

.hours{display:flex;align-items:flex-end;gap:4px;height:150px}
.hours .col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%}
.hours .bar{background:var(--accent);border-radius:2px 2px 0 0;opacity:.9;min-height:1px}
.hours .col:hover .bar{opacity:1;outline:1px solid var(--text)}
.sky{height:6px;border-radius:2px;margin-top:6px;background:linear-gradient(90deg,#0b1030 0%,#0b1030 18%,#5264a1 25%,#e8c858 38%,#f1c23f 55%,#ff9b4a 72%,#3a2250 80%,#0b1030 90%)}
.hlabels{display:flex;gap:4px;margin-top:5px}
.hlabels span{flex:1;text-align:center;font:9px var(--font-mono);color:var(--muted)}

svg text{font-family:var(--font-mono);font-size:10px;fill:var(--muted)}
.axis{stroke:var(--border);stroke-width:1}
.gridl{stroke:var(--border);stroke-width:1;stroke-dasharray:2 4;opacity:.6}
.cross{stroke:var(--label);stroke-width:1;stroke-dasharray:3 3}

.fl-row{display:grid;grid-template-columns:130px 1fr;align-items:center;gap:12px;margin-bottom:10px;font-size:12.5px}
.fl-row .k{color:var(--label);display:flex;align-items:center;gap:7px}
.fl-row .k i{font-size:16px}

.people{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
@media(max-width:480px){.people{grid-template-columns:1fr}}
.pcard{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;position:relative;cursor:pointer;transition:border-color .15s}
.pcard:hover{border-color:var(--hue)}
.pcard::before{content:'';position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--hue)}
.pc-head{display:flex;align-items:center;gap:12px;padding:16px 16px 12px}
.avatar{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font:700 17px var(--font);color:#0c0c0c;background:var(--hue);flex-shrink:0}
.pc-name{font-size:16px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pc-role{font-size:11.5px;color:var(--muted);margin-top:2px}
.pc-share{margin-left:auto;text-align:right}
.pc-share .v{font-size:24px;font-weight:800;color:var(--hue);font-variant-numeric:tabular-nums}
.pc-share .l,.pc-stats .l,.pc-body .l{font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600}
.pc-stats{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.pc-stats>div{padding:10px 12px;border-right:1px solid var(--border)}
.pc-stats>div:nth-child(3n){border-right:none}
.pc-stats>div:nth-child(n+4){border-top:1px solid var(--border)}
.pc-stats .v{font-size:17px;font-weight:700;margin-top:3px;font-variant-numeric:tabular-nums}
.pc-body{padding:12px 16px 16px;display:flex;flex-direction:column;gap:12px}
.pc-body .l{margin-bottom:6px}
.emojis{display:flex;gap:10px;font-size:22px;flex-wrap:wrap}
.emojis span{display:flex;flex-direction:column;align-items:center;gap:2px}
.emojis small{font:10px var(--font-mono);color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font-size:12px;padding:3px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--label);display:inline-flex;align-items:center;gap:4px}
.chip b{color:var(--text);font-weight:600;font-family:var(--font-mono);font-size:11px}
.chip button{background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px}
.minihours{display:flex;gap:2px;align-items:flex-end;height:26px}
.minihours div{flex:1;background:var(--hue);opacity:.8;border-radius:1px 1px 0 0;min-height:1px}
.dash{color:var(--muted)}

.msg-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:14px}
@media(max-width:900px){.msg-layout{grid-template-columns:1fr}}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center}
.search{flex:1 1 240px;display:flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:var(--radius-sm);padding:0 10px;height:34px}
.search input{background:transparent;border:none;outline:none;color:var(--text);font:13px var(--font);width:100%;min-width:0}
.search i{color:var(--muted);font-size:15px}
.search .cnt{font:11px var(--font-mono);color:var(--muted);white-space:nowrap;display:flex;gap:4px;align-items:center}
.search .cnt button{background:none;border:none;color:var(--accent);cursor:pointer;font-size:14px}
select{background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0 8px;height:34px;font:13px var(--font);outline:none;max-width:100%}
select:focus,.search:focus-within{border-color:var(--accent)}
.chat{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:8px 16px 16px;height:640px;overflow-y:auto;overflow-anchor:none}
@media(max-width:480px){.chat{height:70vh;padding:8px 10px}}
.daysep{position:sticky;top:0;text-align:center;margin:14px 0 10px;z-index:1}
.daysep span{font:11px var(--font-mono);color:var(--label);background:var(--card);border:1px solid var(--border);padding:3px 10px;border-radius:var(--radius-sm);text-transform:uppercase;letter-spacing:.05em}
.bub{max-width:78%;width:fit-content;margin:3px 0;padding:7px 10px 5px;border-radius:var(--radius);font-size:13.5px;line-height:1.4;border:1px solid var(--border);white-space:pre-wrap;overflow-wrap:anywhere}
.bub.me{margin-left:auto;background:var(--bubble-me);border-color:rgba(var(--accent-rgb),.25)}
.bub.them{background:var(--bubble-them)}
.bub .who{font-size:11px;font-weight:700;margin-bottom:2px;display:block;white-space:normal}
.bub .t{font:10px var(--font-mono);color:var(--muted);float:right;margin:6px 0 0 10px}
.bub mark{background:rgba(var(--accent-rgb),.35);color:inherit;border-radius:2px;padding:0 1px}
.bub.media{color:var(--label);font-style:italic}
.bub.media i{font-style:normal;color:var(--muted);margin-right:4px}
.bub.hit{box-shadow:0 0 0 1px var(--accent)}
.bub.flash{animation:flash 1.2s ease-out}
@keyframes flash{from{box-shadow:0 0 0 3px var(--accent)}to{box-shadow:0 0 0 0 transparent}}
.side-stack{display:flex;flex-direction:column;gap:14px;min-width:0}
.finder input[type=text]{width:100%;height:34px;border:1px solid var(--border);border-radius:var(--radius-sm);background:transparent;color:var(--text);padding:0 10px;font:13px var(--font);outline:none}
.finder input[type=text]:focus{border-color:var(--accent)}
.check{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--label);margin-top:10px;cursor:pointer}
.check input{accent-color:var(--accent);width:15px;height:15px}
.fres{margin-top:14px;display:flex;flex-direction:column;gap:8px}
.fres .row{display:grid;grid-template-columns:80px 1fr 48px;gap:8px;align-items:center;font-size:12.5px}
.fres .row span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fres .track{height:12px;background:var(--cell0);border-radius:2px;overflow:hidden}
.fres .track div{height:100%}
.fres .v{text-align:right;font:12px var(--font-mono)}
.fres .total{border-top:1px solid var(--border);padding-top:8px}

.wr-layout{display:grid;grid-template-columns:auto 1fr;gap:28px;align-items:start}
@media(max-width:860px){.wr-layout{grid-template-columns:1fr}}
#wrappedCanvas{width:360px;max-width:100%;height:auto;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.45),0 0 0 1px #3A2C1D;display:block}
.wr-opts{display:flex;flex-direction:column;gap:18px;max-width:440px}
.wr-opts .panel .l{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600;margin-bottom:8px}
.wr-actions{display:flex;gap:8px;flex-wrap:wrap}

.landing{max-width:820px;margin:40px auto 0}
.drop{border:1px dashed var(--accent);border-radius:var(--radius);background:rgba(var(--accent-rgb),.03);padding:56px 24px;text-align:center;cursor:pointer;transition:background .15s}
.drop:hover,.drop.over{background:rgba(var(--accent-rgb),.08)}
.drop .big{width:84px;height:84px;margin:0 auto 18px;border-radius:50%;background:radial-gradient(circle,var(--card) 0 30%,#000 31% 100%);box-shadow:0 0 0 1px var(--border);display:grid;place-items:center}
.drop .big i{font-size:30px;color:var(--accent)}
.drop.busy .big{animation:spin 1.6s linear infinite}
.drop.busy .big i{animation:spin 1.6s linear infinite reverse}
@keyframes spin{to{transform:rotate(360deg)}}
.drop h2{font-size:22px;font-weight:800;letter-spacing:-.02em}
.drop p{color:var(--muted);margin-top:6px;font-size:13.5px}
.drop .btn{margin-top:18px}
.drop-error{margin-top:14px;padding:12px 14px;border:1px solid var(--danger);border-radius:var(--radius-sm);color:var(--text);font-size:13px;line-height:1.5;text-align:left}
.drop-error b{color:var(--danger)}
.drop-error code{font-family:var(--font-mono);color:var(--label)}
.priv{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:14px;font-size:12px;color:var(--label);text-align:center}
.priv i{color:var(--accent);font-size:15px}
.steps{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:28px}
@media(max-width:700px){.steps{grid-template-columns:1fr}}
.steps ol{margin:0;padding-left:18px;font-size:13px;line-height:1.75;color:var(--label)}
.about{margin-top:28px;display:flex;gap:10px;justify-content:center;align-items:center;font-size:12px;color:var(--muted);flex-wrap:wrap}
.about a{color:var(--label);text-decoration:none;display:inline-flex;gap:5px;align-items:center;border:1px solid var(--border);padding:5px 10px;border-radius:var(--radius-sm)}
.about a:hover{color:var(--text);border-color:var(--text)}

.tip{position:fixed;pointer-events:none;background:var(--card);border:1px solid var(--border);padding:6px 9px;border-radius:var(--radius-sm);font-size:12px;z-index:999;box-shadow:0 6px 20px rgba(0,0,0,.3);white-space:nowrap}
.tip b{font-family:var(--font-mono)}
</style>
</head>
<body>
<div class="app">
  <header>
    <div class="logo-row">
      <div class="logo"><i class="ti ti-message-circle-2"></i></div>
      <div style="min-width:0">
        <div class="app-name">Chat Analyzer</div>
        <div class="chat-sub" id="chatSub"></div>
      </div>
    </div>
    <div class="header-right">
      <span class="seg" id="langSeg"><button data-lang="en">EN</button><button data-lang="pt">PT</button></span>
      <button class="btn btn-icon" id="themeBtn" data-i18n-title="theme"><i class="ti ti-sun"></i></button>
      <div class="menu chat-only hidden">
        <button class="btn" id="exportBtn"><i class="ti ti-table-export"></i><span data-i18n="export"></span></button>
        <div class="menu-list hidden" id="exportMenu">
          <button data-export="xlsx"><i class="ti ti-file-spreadsheet"></i>Excel (.xlsx)</button>
          <button data-export="csv"><i class="ti ti-file-text"></i>CSV (.csv)</button>
        </div>
      </div>
      <button class="btn btn-primary chat-only hidden" id="newChatBtn"><i class="ti ti-upload"></i><span data-i18n="new_chat"></span></button>
    </div>
  </header>

  <div id="landing" class="landing">
    <div class="drop" id="dropzone" tabindex="0" role="button">
      <div class="big"><i class="ti ti-message-circle-2"></i></div>
      <h2 id="dropTitle" data-i18n="drop_title"></h2>
      <p id="dropHint" data-i18n-html="drop_hint"></p>
      <button class="btn btn-primary" type="button"><i class="ti ti-file-upload"></i><span data-i18n="choose_file"></span></button>
      <input type="file" id="fileInput" accept=".txt,.zip" hidden>
    </div>
    <div id="dropError" class="drop-error hidden"></div>
    <div class="priv"><i class="ti ti-shield-lock"></i><span data-i18n="privacy"></span></div>
    <div class="steps">
      <div class="panel">
        <div class="sec-h"><div class="t"><i class="ti ti-brand-apple"></i>iPhone</div></div>
        <ol data-i18n-html="steps_ios"></ol>
      </div>
      <div class="panel">
        <div class="sec-h"><div class="t"><i class="ti ti-brand-android"></i>Android</div></div>
        <ol data-i18n-html="steps_android"></ol>
      </div>
    </div>
    <div class="about">
      <span data-i18n="made_by"></span>
      <a href="https://github.com/PepeZuco" target="_blank" rel="noopener"><i class="ti ti-brand-github"></i>GitHub</a>
      <a href="https://www.linkedin.com/in/jo%C3%A3o-pedro-longo-zucoloto-169638182" target="_blank" rel="noopener"><i class="ti ti-brand-linkedin"></i>LinkedIn</a>
      <a href="mailto:joaozuco@gmail.com"><i class="ti ti-mail"></i>Email</a>
    </div>
  </div>

  <div id="appView" class="hidden">
    <nav class="nav-tabs" id="tabs">
      <button class="nav-tab" data-tab="overview"><i class="ti ti-layout-dashboard"></i><span data-i18n="tab_overview"></span></button>
      <button class="nav-tab" data-tab="activity"><i class="ti ti-chart-dots-3"></i><span data-i18n="tab_activity"></span></button>
      <button class="nav-tab" data-tab="people"><i class="ti ti-users"></i><span data-i18n="tab_people"></span></button>
      <button class="nav-tab" data-tab="messages"><i class="ti ti-messages"></i><span data-i18n="tab_messages"></span></button>
      <button class="nav-tab" data-tab="wrapped"><i class="ti ti-gift"></i><span data-i18n="tab_wrapped"></span></button>
    </nav>

    <div class="datebar" id="datebar">
      <span class="lbl"><i class="ti ti-calendar"></i><span data-i18n="range"></span></span>
      <span class="seg" id="presets"></span>
      <input type="date" id="fromIn"><span class="arrow">→</span><input type="date" id="toIn">
      <span class="range-info" id="rangeInfo"></span>
      <div class="warn hidden" id="rangeWarn"><i class="ti ti-alert-triangle"></i><span data-i18n="date_conflict"></span></div>
    </div>

    <section data-pane="overview"></section>
    <section data-pane="activity" class="hidden"></section>
    <section data-pane="people" class="hidden"></section>
    <section data-pane="messages" class="hidden"></section>
    <section data-pane="wrapped" class="hidden"></section>
  </div>
</div>
<div class="tip hidden" id="tip"></div>

<script src="/static/range.js"></script>
<script src="/static/stats.js"></script>
<script src="/static/people.js"></script>
<script src="/static/words.js"></script>
<script src="/static/i18n.js"></script>
<script src="/static/wrapped.js"></script>
<script src="/static/export.js"></script>
<script src="/static/app.js"></script>
<script src="/static/view-overview.js"></script>
<script src="/static/view-activity.js"></script>
<script src="/static/view-people.js"></script>
<script src="/static/view-messages.js"></script>
<script src="/static/view-wrapped.js"></script>
<script>App.boot();</script>
</body>
</html>
```

- [ ] **Step 2: Create `static/app.js`**

```javascript
'use strict';

/* The shell: state, upload, tabs, date bar, theme, language and the URL hash.
 *
 * Each tab is a view module (static/view-*.js) that registers itself with
 * App.register(name, render). render(root) rebuilds its pane from App state.
 * Only the visible tab renders; the others are marked dirty and render when
 * opened, so a range change on a 100k chat never draws five tabs. */

const App = (function (R) {

  const TABS = ['overview', 'activity', 'people', 'messages', 'wrapped'];
  const $ = id => document.getElementById(id);

  const state = {
    chat: null,      // API response
    msgs: [],        // every prepared message
    view: [],        // messages in the date range
    first: 0, last: 0, from: 0, to: 0,
    presets: [],
    tab: 'overview',
    lang: 'en',
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

  function color(p) { return p < 0 ? 'var(--muted)' : `var(--p${(p % 6) + 1})`; }

  /* The resolved colour, for canvas and inline SVG fills. */
  function colorValue(p) {
    const v = p < 0 ? '--muted' : `--p${(p % 6) + 1}`;
    return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
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
    state.chat = chat;
    state.msgs = R.prepare(chat);
    state.first = R.dayOfIso(chat.start);
    state.last = R.dayOfIso(chat.end);
    state.presets = R.presets(state.first, state.last);
    const h = R.decodeHash(location.hash);
    state.lang = h.lang || chat.language || state.lang;
    state.tab = TABS.includes(h.tab) ? h.tab : 'overview';
    const v = R.validate(h.from ?? state.first, h.to ?? state.last, state.first, state.last);
    state.from = v.error ? state.first : v.from;
    state.to = v.error ? state.last : v.to;
    state.view = R.filter(state.msgs, state.from, state.to);
    Object.keys(views).forEach(k => views[k].reset && views[k].reset());
    $('landing').classList.add('hidden');
    $('appView').classList.remove('hidden');
    document.querySelectorAll('.chat-only').forEach(el => el.classList.remove('hidden'));
    applyI18n();
    renderHeader();
    renderDatebar();
    invalidate();
    showTab(state.tab);
  }

  function unload() {
    state.chat = null;
    state.msgs = state.view = [];
    $('appView').classList.add('hidden');
    $('landing').classList.remove('hidden');
    document.querySelectorAll('.chat-only').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('[data-pane]').forEach(p => { p.innerHTML = ''; });
    history.replaceState(null, '', location.pathname);
    renderHeader();
  }

  function renderHeader() {
    const sub = $('chatSub');
    if (!state.chat) { sub.textContent = t('tagline'); return; }
    const c = state.chat;
    const who = c.title || (c.people.length <= 3 ? c.people.join(' & ') : t('n_people', { n: c.people.length }));
    sub.innerHTML = `<b>${esc(who)}</b> · ${esc(t('n_messages', { n: num(state.msgs.length) }))} · ` +
      `${esc(t(c.platform === 'ios' ? 'iphone_export' : 'android_export'))} · ${esc(t('lang_' + c.language))}`;
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

  return { state, t, esc, num, pct, fmtDay, fmtTime, weekdayName, fmtDuration, color, colorValue, name,
           showTip, hideTip, emptyState, register, openMessages, setRange, boot, load };
})(ChatRange);
```

- [ ] **Step 3: Create `static/chat-icon.svg`**

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="31" fill="#000"/>
  <circle cx="32" cy="32" r="26" fill="none" stroke="#1b1b1b" stroke-width="1"/>
  <circle cx="32" cy="32" r="21" fill="none" stroke="#1b1b1b" stroke-width="1"/>
  <circle cx="32" cy="32" r="14" fill="#5FBF7A"/>
  <path d="M25 38.5 26.4 34.6A8 8 0 1 1 29.6 37.6Z" fill="none" stroke="#0c0c0c" stroke-width="2" stroke-linejoin="round"/>
</svg>
```

- [ ] **Step 4: Stub the view scripts so the page loads** — the page references five `view-*.js` files created in Tasks 11–15. Until then, create each as an empty file so the browser gets 200s:

```bash
for v in overview activity people messages wrapped; do : > static/view-$v.js; done
```

Tasks 11–15 overwrite them. (`App.openMessages` needs the messages view; nothing calls it before Task 14.)

- [ ] **Step 5: Run automated checks**

Run: `python -m pytest -q`
Expected: all green — `test_i18n.js` now also verifies every `data-i18n*` key in the new page and every `t('…')` in `app.js`.

- [ ] **Step 6: Manual check**

Run `python app.py`, open `http://localhost:5001/`:
1. Landing shows the drop zone, privacy line, iPhone/Android steps, footer links; EN/PT toggle switches every string; ☀/☾ toggles themes and survives reload.
2. Drop a `.pdf` → red error box "That isn't a WhatsApp export…" `(bad_type)`.
3. Generate a synthetic chat: `python -c "from tests.chats import IOS_PT; open('/tmp/c.txt','w').write(IOS_PT)"` and drop `/tmp/c.txt` → header shows "Pepe & Jenni · 7 messages · iPhone export · Portuguese", tabs and date bar appear (panes are empty until Tasks 11–15), presets switch the range and the URL hash updates.
4. "New chat" returns to the landing page and clears the hash.

- [ ] **Step 7: Commit**

```bash
git add templates/index.html static/app.js static/chat-icon.svg static/view-*.js
git commit -m "feat: page shell — landing, upload, tabs, date bar, theme, language

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Overview tab (`static/view-overview.js`)

**Files:**
- Modify: `static/view-overview.js` (replace the empty stub)

**Interfaces:**
- Consumes: `App` helpers, `ChatStats.{totals, streaks, busiestDay, weekdayCounts, weeklySeries, dailyCounts, calendarYear, share, types}`, `ChatWords.{wordCounts, top}`, `ChatRange.{yearOfDay, dayOfIso, isoOfDay}`.
- Produces: `App.register('overview', { render, reset })`. Emits `App.openMessages({day})` (busiest-day link, calendar cell) and `({search, person})` (word cloud).

- [ ] **Step 1: Implement**

```javascript
'use strict';

/* Overview tab: KPI tiles, the year calendar, share, message types, words. */

(function (App, S, W, R) {

  const TYPE_ICON = { t: 'ti-message', a: 'ti-microphone', p: 'ti-photo', s: 'ti-sticker', v: 'ti-video',
                      g: 'ti-gif', d: 'ti-file', m: 'ti-photo-video', x: 'ti-trash', l: 'ti-link' };
  const local = { year: null, cloudPerson: null };

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
    if (!years.includes(local.year)) local.year = years[years.length - 1];
    const cal = S.calendarYear(S.dailyCounts(st.view), local.year, st.from, st.to);
    const cells = [];
    for (let i = 0; i < cal.lead; i++) cells.push('<span class="c blank"></span>');
    for (const c of cal.cells) {
      const cls = `c${c.level ? ' l' + c.level : ''}${c.inRange ? '' : ' out'}`;
      cells.push(`<button class="${cls}" data-day="${c.day}" data-n="${c.count}" aria-label="${R.isoOfDay(c.day)}"></button>`);
    }
    const months = [];
    for (let m = 0; m < 12; m++) {
      const d = R.dayOfIso(`${local.year}-${String(m + 1).padStart(2, '0')}-01`);
      const col = Math.floor((d - cal.cells[0].day + cal.lead) / 7) + 1;
      months.push(`<span style="grid-column:${col}/span 4">${esc(App.fmtDay(d, { month: 'short' }))}</span>`);
    }
    const wd = [0, 1, 2, 3, 4, 5, 6].map(i => `<span>${i % 2 ? esc(App.weekdayName(i)) : ''}</span>`).join('');
    const th = cal.thresholds;
    return `<div class="sec">
      <div class="sec-h"><div class="t"><i class="ti ti-calendar-stats"></i>${esc(t('every_day'))}</div>
        <div class="r"><span class="seg sm" id="calYears">${years.map(y => `<button data-year="${y}" class="${y === local.year ? 'on' : ''}">${y}</button>`).join('')}</span></div></div>
      <div class="panel">
        <div class="cal-wrap"><div class="cal-row"><div class="cal-days">${wd}</div>
          <div><div class="cal-months">${months.join('')}</div><div class="cal" id="cal">${cells.join('')}</div></div></div></div>
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

  function render(root) {
    const st = App.state;
    if (!st.view.length) return App.emptyState(root);
    root.innerHTML = kpis(st) + calendar(st) +
      `<div class="grid2 sec">${share(st)}${types(st)}</div>` + cloud(st);

    root.querySelectorAll('[data-open-day]').forEach(b =>
      b.addEventListener('click', () => App.openMessages({ day: +b.dataset.openDay })));
    root.querySelector('#calYears').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) { local.year = +b.dataset.year; render(root); }
    });
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

  App.register('overview', { render, reset() { local.year = null; local.cloudPerson = null; } });
})(App, ChatStats, ChatWords, ChatRange);
```

- [ ] **Step 2: Automated checks**

Run: `python -m pytest -q`
Expected: green (i18n test now covers this file's keys).

- [ ] **Step 3: Manual check** (with a large synthetic chat — see Task 16's generator, or any export you own). Links into Messages (busiest day, calendar, words) only work from Task 14 on — until then they throw in the console; that is expected.

1. Four KPI tiles: messages + sparkline, active days + weekday bars, longest/current streak, busiest day with "read that day →".
2. Calendar: year buttons for each year in range; hover shows date + count; days outside the range are dimmed.
3. Share bar + ranked list; for >8 people an "Others" row.
4. Types split by person; on an Android export only one "Media" row + the note.
5. Word cloud: person switch (segmented ≤ 6 people, select above); changing the date preset changes the words.

- [ ] **Step 4: Commit**

```bash
git add static/view-overview.js
git commit -m "feat: overview tab — KPIs, calendar, share, types, word cloud

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Activity tab (`static/view-activity.js`)

**Files:**
- Modify: `static/view-activity.js`

**Interfaces:**
- Consumes: `ChatStats.{series, heatmap, hours}`, `ChatPeople.{firstLast, starters}`, `App` helpers.
- Produces: `App.register('activity', { render })`. Emits `App.openMessages({slot: {wd, h}})` from heatmap cells.

- [ ] **Step 1: Implement**

```javascript
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
```

- [ ] **Step 2: Automated checks** — `python -m pytest -q` → green.

- [ ] **Step 3: Manual check**

1. Over-time chart: Day/Week/Month; "Fill empty days" is enabled only for Day and removes zero days when unticked; hover shows a crosshair + per-person values; x labels carry the year when the range spans > 1 year.
2. Heatmap 7×24 with counts; "% of all" switches labels; hovering shows the weekday + hour.
3. By-hour bars with the day/night strip.
4. Opens & closes: three share bars; with a 1-person chat the panel says "Needs at least two people."

- [ ] **Step 4: Commit**

```bash
git add static/view-activity.js
git commit -m "feat: activity tab — over time, heatmap, hours, opens/closes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: People tab (`static/view-people.js`)

**Files:**
- Modify: `static/view-people.js`

**Interfaces:**
- Consumes: `ChatPeople.{profiles, roles, firstLast, sorted}`, `ChatWords.{signatureWords, emojiCounts, top}`.
- Produces: `App.register('people', { render })`. Emits `App.openMessages({person})` on card click.

- [ ] **Step 1: Implement**

```javascript
'use strict';

/* People tab: one card per person. Click a card → Messages for that person. */

(function (App, P, W) {

  const local = { sort: 'messages' };

  function card(o, roleKeys, emojis, sig) {
    const { t, esc, num, pct } = App;
    const maxH = Math.max(...o.hours, 1);
    const name = App.name(o.p);
    const stats = [
      [t('stat_messages'), num(o.messages)],
      [t('stat_words_msg'), num(o.wordsPerMsg, 1)],
      [t('stat_reply'), App.fmtDuration(o.medianReply)],
      [t('stat_starts'), o.startsPct == null ? '—' : pct(o.startsPct)],
      [t('stat_midnight'), pct(o.afterMidnightPct)],
      [t('stat_media'), num(o.media)],
    ];
    return `<div class="pcard" data-p="${o.p}" style="--hue:${App.color(o.p)}">
      <div class="pc-head"><div class="avatar">${esc([...name][0] || '?')}</div>
        <div style="min-width:0"><div class="pc-name">${esc(name)}</div>
          <div class="pc-role">${esc(roleKeys.map(k => t('role_' + k)).join(' · '))}</div></div>
        <div class="pc-share"><div class="v">${pct(o.share)}</div><div class="l">${esc(t('of_messages'))}</div></div></div>
      <div class="pc-stats">${stats.map(([l, v]) => `<div><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>
      <div class="pc-body">
        <div><div class="l">${esc(t('top_emojis'))}</div>${emojis.length
          ? `<div class="emojis">${emojis.map(([e, c]) => `<span>${esc(e)}<small>${num(c)}</small></span>`).join('')}</div>`
          : `<span class="dash">—</span>`}</div>
        <div><div class="l">${esc(t('signature_words'))}</div>${sig.length
          ? `<div class="chips">${sig.map(([w, c]) => `<span class="chip">${esc(w)}<b>${num(c)}</b></span>`).join('')}</div>`
          : `<span class="dash">—</span>`}</div>
        <div><div class="l">${esc(t('their_day'))}</div>
          <div class="minihours">${o.hours.map(v => `<div style="height:${v / maxH * 100}%"></div>`).join('')}</div>
          <div class="hlabels" style="gap:2px">${o.hours.map((_, h) => `<span>${h % 6 === 0 ? h : ''}</span>`).join('')}</div></div>
      </div></div>`;
  }

  function render(root) {
    const st = App.state;
    const { t, esc } = App;
    if (!st.view.length) return App.emptyState(root);
    const n = st.chat.people.length;
    const profs = P.profiles(st.view, n);
    const roles = P.roles(profs, P.firstLast(st.view, n));
    const sig = W.signatureWords(st.view, n, 5);
    const list = P.sorted(profs, local.sort);
    const sorts = ['messages', 'fastest', 'longest', 'night'];
    root.innerHTML = `<div class="sec-h"><div class="t"><i class="ti ti-users"></i>${esc(t('n_people', { n: list.length }))}</div>
      <div class="r"><select id="peopleSort">${sorts.map(s => `<option value="${s}" ${s === local.sort ? 'selected' : ''}>${esc(t('sort_' + s))}</option>`).join('')}</select></div></div>
      <div class="people">${list.map(o => card(o, roles[o.p], W.top(W.emojiCounts(st.view, o.p), 5), sig[o.p])).join('')}</div>`;
    root.querySelector('#peopleSort').addEventListener('change', e => { local.sort = e.target.value; render(root); });
    root.querySelector('.people').addEventListener('click', e => {
      const c = e.target.closest('.pcard');
      if (c) App.openMessages({ person: +c.dataset.p });
    });
  }

  App.register('people', { render });
})(App, ChatPeople, ChatWords);
```

- [ ] **Step 2: Automated checks** — `python -m pytest -q` → green.

- [ ] **Step 3: Manual check** — one card per person with share, up to two roles, the 6-stat grid (single borders, no doubled lines), top emojis, signature words, "their day" bars; the sort select reorders; at 400px width cards stack in one column.

- [ ] **Step 4: Commit**

```bash
git add static/view-people.js
git commit -m "feat: people tab — profile cards with roles, emojis, signature words

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Messages tab (`static/view-messages.js`)

**Files:**
- Modify: `static/view-messages.js`

**Interfaces:**
- Consumes: `ChatWords.{termMatcher, countTerm, linkDomains}`, `App` helpers.
- Produces: `App.register('messages', { render, focus, reset })`. `focus({day?, person?, search?, slot?})` is what `App.openMessages` calls.
- Windowing contract: at most 450 bubbles in the DOM (`MAX_WINDOW`), extended by 150 (`CHUNK`) when within 300px (`EDGE`) of either end; re-render keeps the first visible bubble at the same screen offset.

- [ ] **Step 1: Implement**

```javascript
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

  function highlight(text, re) {
    if (!re) return App.esc(text);
    let out = '', last = 0;
    for (const m of text.matchAll(re)) {
      out += App.esc(text.slice(last, m.index)) + '<mark>' + App.esc(m[0]) + '</mark>';
      last = m.index + m[0].length;
    }
    return out + App.esc(text.slice(last));
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
        html += `<div class="bub ${side}${hitSet.has(i) ? ' hit' : ''}" data-i="${i}">${who}${highlight(m.x, re)}${time}</div>`;
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
```

- [ ] **Step 2: Automated checks** — `python -m pytest -q` → green.

- [ ] **Step 3: Manual check**

1. Opens at the latest message; scrolling up keeps loading earlier days smoothly without jumps (DevTools: `document.querySelectorAll('#chatBox [data-i]').length` never exceeds 450).
2. Search highlights matches; "k/N ↑ ↓" and Enter / Shift+Enter step through hits.
3. Person / type filters; "Right side" moves whose bubbles sit on the right.
4. From Overview: busiest-day link and a calendar day land on that day (bubble flashes); a word lands with the search filled. From Activity: a heatmap cell shows the "Sat 22:00 ✕" chip and only messages from that slot. From People: a card filters to that person.
5. Word counter: default "good morning"/"bom dia"; whole-word on by default ("oi" doesn't count "noite"); per-person bars, total, per-month line; typing keeps focus and caret.
6. Links panel lists top domains.
7. Message text containing `<b>x</b>` renders literally (escaped).

- [ ] **Step 4: Commit**

```bash
git add static/view-messages.js
git commit -m "feat: messages tab — windowed bubbles, search, filters, word counter

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Wrapped tab (`static/view-wrapped.js`)

**Files:**
- Modify: `static/view-wrapped.js`

**Interfaces:**
- Consumes: `ChatWrapped.{periods, model, draw, PALETTE}`, `App` helpers (uses `App.state.msgs`, not the date-bar range).
- Produces: `App.register('wrapped', { render, reset })`.

- [ ] **Step 1: Implement**

```javascript
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
    if (m.topWord) cells.push([t('w_top_word'), `“${m.topWord}”`, '']);
    const colors = Wr.PALETTE.people;
    const split = m.split.map(s => ({ name: s.name, pct: s.pct, color: colors[s.p % 6] }));
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

  App.register('wrapped', { render, reset() { local.period = null; } });
})(App, ChatWrapped);
```

- [ ] **Step 2: Automated checks** — `python -m pytest -q` → green.

- [ ] **Step 3: Manual check**

1. Default period = latest year; "All time" shows a "Mar 2023 – Sep 2026"-style subtitle.
2. Card stays dark in light theme; rows spread down the story card (no empty hole); Square shows the top two cells.
3. "Hide names" → You/Them (or Person 1…N in groups); "Show top word" adds the cell, off by default.
4. Download PNG saves a 1080×1920 (story) / 1080×1080 (square) file identical to the preview; Copy image appears only where `ClipboardItem` exists.

- [ ] **Step 4: Commit**

```bash
git add static/view-wrapped.js
git commit -m "feat: wrapped tab — shareable canvas card with privacy toggles

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: README, synthetic chat generator, manual verification doc

**Files:**
- Create: `README.md`, `tools/gen_chat.py`, `docs/rebuild-manual-verification.md`

- [ ] **Step 1: Synthetic chat generator** — `tools/gen_chat.py` (for manual testing at scale; output goes to `chats/`, which is gitignored)

```python
"""Synthetic iPhone/Portuguese export for testing at scale — never a real chat.

Usage: python tools/gen_chat.py OUT.txt [comma,separated,people] [group title]
"""
import os
import random
import sys
from datetime import datetime, timedelta

random.seed(7)
LRM = '\u200e'
people = sys.argv[2].split(',') if len(sys.argv) > 2 else ['Pepe', 'Jenni']
title = sys.argv[3] if len(sys.argv) > 3 else None
words = ('bom dia amor saudade disco vinil hoje casa jantar filme praia café show gato domingo '
         'música sério lindo almoço viagem festa livro chuva sono kkkk trabalho chegou').split()
emojis = ['😂', '❤\ufe0f', '🥺', '😍', '🎶', '🐱', '✨', '👍🏽', '👨\u200d👩\u200d👧']
media = [f'{LRM}áudio ocultado', f'{LRM}imagem ocultada', f'{LRM}figurinha omitida', f'{LRM}vídeo omitido',
         f'{LRM}GIF omitido', f'{LRM}Mensagem apagada']
out = []
t = datetime(2023, 3, 4, 9, 0)
first = title or people[1]
out.append(f"[{t:%d/%m/%Y, %H:%M:%S}] {first}: {LRM}As mensagens e as ligações são protegidas com a criptografia de ponta a ponta.")
end = datetime(2026, 9, 14, 23, 0)
while t < end:
    if random.random() < 0.08:
        t += timedelta(days=1)
        continue
    for _ in range(random.randint(3, 40)):
        t += timedelta(minutes=random.expovariate(1 / 25))
        if t.hour < 7 and random.random() < 0.8:
            t = t.replace(hour=7 + random.randint(0, 3))
        p = random.choice(people)
        r = random.random()
        if r < 0.08:
            msg = random.choice(media)
        elif r < 0.1:
            msg = f'olha https://{random.choice(["youtube.com/watch", "open.spotify.com/album", "www.instagram.com/p", "discogs.com/r"])}/{random.randint(1, 999)}'
        else:
            msg = ' '.join(random.choices(words, k=random.randint(1, 9)))
            if random.random() < 0.25:
                msg += ' ' + random.choice(emojis)
            if random.random() < 0.03:
                msg += '\ncontinua na linha de baixo'
        out.append(f"[{t:%d/%m/%Y, %H:%M:%S}] {p}: {msg}")
    t = t.replace(hour=9, minute=0) + timedelta(days=1)
os.makedirs(os.path.dirname(sys.argv[1]) or '.', exist_ok=True)
open(sys.argv[1], 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print(len(out), 'lines')
```

- [ ] **Step 2: README** — `README.md`

````markdown
# Chat Analyzer

Flask + vanilla-JS app that visualises a WhatsApp conversation export. Part of
the same portfolio family as vinyl-collection: same design system, green accent.

Nothing is stored: `POST /api/parse` parses the upload in memory and returns
JSON; every chart is computed in the browser.

## Rodando localmente

```bash
pip install -r requirements.txt
python app.py            # http://localhost:5001
```

Testes (Python + os módulos JS via node ≥ 20):

```bash
pip install -r requirements-dev.txt
python -m pytest
```

Conversa sintética para testar em escala (nunca commite conversas reais):

```bash
python tools/gen_chat.py chats/pair.txt
python tools/gen_chat.py chats/group.txt "Ana,Pepe,Jenni,Bia,Caio" "Vinyl Club"
```

## Deploy (Railway)

Conecte o repositório; `railway.toml`/`Procfile` sobem o gunicorn. Variáveis:

- `MAX_UPLOAD_MB` — opcional, padrão `50`.

Sem banco, sem volume, sem segredos.
````

- [ ] **Step 3: Manual verification doc** — `docs/rebuild-manual-verification.md`

```markdown
# Chat Analyzer rebuild — manual verification

Run against `chats/pair.txt` and `chats/group.txt` from `tools/gen_chat.py`, plus
one real export of your own (never committed). Check each item in **dark and
light**, **EN and PT**, at **1280px and 400px** (no horizontal page scroll).

## Landing
- [ ] Drop zone accepts click, keyboard (Enter/Space) and drag-and-drop
- [ ] `.pdf` → bad_type message; `.zip` without a `.txt` → empty_zip; random `.txt` → unparseable
- [ ] Record spins and "Reading N MB…" shows while parsing

## Header / date bar
- [ ] Subtitle: names or group title · count · platform · language
- [ ] Presets All / 12 mo / 30 d / each year; date inputs; start > end shows the warning and keeps the old range
- [ ] Reload keeps tab + range + language (hash), after re-uploading
- [ ] Export → .xlsx and .csv contain only the filtered range, 5 columns, localised headers

## Tabs
- [ ] Overview, Activity, People, Messages, Wrapped — every item in Tasks 11–15's manual checks
- [ ] A range with no messages shows "No messages in this range." on every tab
- [ ] One-person chat: People shows one card with "—" for reply/starts; Activity says "Needs at least two people."
```

- [ ] **Step 4: Full run**

Run: `python -m pytest -q`
Expected: 45 passed.
Then walk `docs/rebuild-manual-verification.md` end to end with `python tools/gen_chat.py chats/pair.txt` and `chats/group.txt`.

- [ ] **Step 5: Commit**

```bash
git add README.md tools/gen_chat.py docs/rebuild-manual-verification.md
git commit -m "docs: README, synthetic chat generator, manual verification checklist

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec section | Task |
|---|---|
| Stack, deleted files, .gitignore fix, deploy | 1 |
| Parsing rules 1–8, error codes | 2 |
| API contract, 413, no logging of content | 3 |
| Date bar presets, validation, hash state | 4, 10 |
| KPIs, calendar, share, types, word cloud | 5, 11 |
| Over time (+fill), heatmap, hours, first/last/starters | 5, 6, 12 |
| People cards, roles, reply/starter rules | 6, 7, 13 |
| Messages browser, windowing, entry points, word counter, links | 7, 14 |
| Wrapped model, privacy toggles, PNG/copy | 9, 15 |
| Export CSV/XLSX of filtered rows | 9, 10 |
| i18n EN/PT + auto-detect | 8, 10 |
| Identity tokens, theme toggle, favicon | 10 |
| Error handling / empty / one-person states | 3, 10, 11–15 |
| Testing + manual verification doc | every task, 16 |

