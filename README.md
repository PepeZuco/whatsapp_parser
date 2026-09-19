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
