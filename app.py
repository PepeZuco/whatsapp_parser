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
