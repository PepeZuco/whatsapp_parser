"""Synthetic iPhone/Portuguese export for testing at scale — never a real chat.

Usage: python tools/gen_chat.py OUT.txt [comma,separated,people] [group title]
"""
import os
import random
import sys
from datetime import datetime, timedelta

random.seed(7)
LRM = '\u200e'
people = sys.argv[2].split(',') if len(sys.argv) > 2 else ['Pepe', 'Jenni']
title = sys.argv[3] if len(sys.argv) > 3 else None
words = ('bom dia amor saudade disco vinil hoje casa jantar filme praia café show gato domingo '
         'música sério lindo almoço viagem festa livro chuva sono kkkk trabalho chegou').split()
emojis = ['😂', '❤\ufe0f', '🥺', '😍', '🎶', '🐱', '✨', '👍🏽', '👨\u200d👩\u200d👧']
media = [f'{LRM}áudio ocultado', f'{LRM}imagem ocultada', f'{LRM}figurinha omitida', f'{LRM}vídeo omitido',
         f'{LRM}GIF omitido', f'{LRM}Mensagem apagada']
out = []
t = datetime(2023, 3, 4, 9, 0)
first = title or people[1]
out.append(f"[{t:%d/%m/%Y, %H:%M:%S}] {first}: {LRM}As mensagens e as ligações são protegidas com a criptografia de ponta a ponta.")
end = datetime(2026, 9, 14, 23, 0)
while t < end:
    if random.random() < 0.08:
        t += timedelta(days=1)
        continue
    for _ in range(random.randint(3, 40)):
        t += timedelta(minutes=random.expovariate(1 / 25))
        if t.hour < 7 and random.random() < 0.8:
            t = t.replace(hour=7 + random.randint(0, 3))
        p = random.choice(people)
        r = random.random()
        if r < 0.08:
            msg = random.choice(media)
        elif r < 0.1:
            msg = f'olha https://{random.choice(["youtube.com/watch", "open.spotify.com/album", "www.instagram.com/p", "discogs.com/r"])}/{random.randint(1, 999)}'
        else:
            msg = ' '.join(random.choices(words, k=random.randint(1, 9)))
            if random.random() < 0.25:
                msg += ' ' + random.choice(emojis)
            if random.random() < 0.03:
                msg += '\ncontinua na linha de baixo'
        out.append(f"[{t:%d/%m/%Y, %H:%M:%S}] {p}: {msg}")
    t = t.replace(hour=9, minute=0) + timedelta(days=1)
os.makedirs(os.path.dirname(sys.argv[1]) or '.', exist_ok=True)
open(sys.argv[1], 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print(len(out), 'lines')
