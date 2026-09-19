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
