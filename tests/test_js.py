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
