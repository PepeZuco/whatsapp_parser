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

# Cap on a zip entry's decompressed size, checked before AND during the read
# (a zip's declared uncompressed size can be spoofed, so both matter).
MAX_DECOMPRESSED = 80 * 1024 * 1024

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
    any_dated = False  # did any header at least have a decodable date?
    for i, (fields, rest) in enumerate(headers):
        sender, sep, body = rest.partition(': ')
        if not sep:
            sender, body = None, rest
        if i == 0:
            first_sender = sender
        try:
            ts = _epoch(fields, day_first)
        except ValueError:
            # Out-of-range month/day (e.g. day/month swapped past 12/31) — the
            # header simply didn't encode a valid date; drop it like any other
            # unparseable line instead of letting the exception escape.
            continue
        any_dated = True
        if _is_system(platform, sender, body, i):
            continue
        kept.append((ts, sender, body.strip()))

    if not kept:
        # Headers matched the timestamp shape but none had a real date and a
        # real message: no real date at all means the file wasn't parseable;
        # a real date with only system lines means there were no messages.
        raise ParseError('unparseable' if not any_dated else 'no_messages')

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
                info = z.getinfo(pick)
                if info.file_size > MAX_DECOMPRESSED:
                    raise ParseError('too_large')
                with z.open(pick) as member:
                    data = member.read(MAX_DECOMPRESSED + 1)
                if len(data) > MAX_DECOMPRESSED:
                    raise ParseError('too_large')
        except zipfile.BadZipFile:
            raise ParseError('bad_type')
    elif not name.endswith('.txt'):
        raise ParseError('bad_type')
    return parse_text(data.decode('utf-8-sig', errors='replace'))
