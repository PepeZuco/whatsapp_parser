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
    f"[3/12/23, 9:15:02{NNBSP}AM] Vinyl Club: {LRM}Pepe created group \u201cVinyl Club\u201d\n"
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
