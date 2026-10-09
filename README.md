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
- `UMAMI_WEBSITE_ID` — opcional; liga o Umami (visitas sem cookie + eventos).
  Sem ela a página nem carrega o script.
- `UMAMI_SCRIPT_URL` — opcional, padrão `https://cloud.umami.is/script.js`
  (troque se o Umami for self-hosted).

Sem banco, sem volume, sem segredos.

## Analytics (Umami)

Com `UMAMI_WEBSITE_ID` configurada, além das visitas o app manda eventos do
que a pessoa faz na página. Ficam em **Events** no painel do Umami.
**Nada de dentro da conversa sai do navegador**: nem nomes, nem título, nem
palavras, nem o nome do arquivo. Da conversa só vai o formato do export, com
contagens arredondadas em faixas (`chatSummary` em `static/analytics.js`).
O hash da URL (`#tab=…&from=…`) também não entra nas visitas
(`data-exclude-hash`). Abrir a tela de pessoas automaticamente ao carregar e
a rolagem entre seções não contam, só cliques.

| Evento | Dados | Quando |
|---|---|---|
| `chat-load` | `platform`, `language`, `kind` (`pair`/`group`), `people`, `size` (`<1k`…`100k+` mensagens), `source` (`zip`/`txt`) | uma conversa foi lida |
| `parse-error` | `code` | upload recusado (`bad_type`, `too_large`, `network`…) |
| `tab` | `tab` | clica numa aba |
| `range` | `via` (`preset`/`slider`/`date`), `preset` | muda o período |
| `lang` / `theme` | `lang` / `theme` | troca idioma / claro-escuro |
| `roster-open` / `roster-apply` | — | abre a tela de pessoas pelo botão / aplica |
| `export` | `format` (`xlsx`/`csv`) | exporta as mensagens |
| `wrapped-download` / `wrapped-copy` | `period`, `format`, `hide_names`, `top_word` | baixa / copia o card do Wrapped |
| `new-chat` | — | volta para enviar outra conversa |

Para não contar as próprias visitas, rode no console do navegador:
`localStorage.setItem('umami.disabled', 1)`.
