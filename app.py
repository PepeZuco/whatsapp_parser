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
