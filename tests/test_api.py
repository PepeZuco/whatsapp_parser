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
