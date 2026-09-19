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
