# Chat Analyzer rebuild — manual verification

Run against `chats/pair.txt` and `chats/group.txt` from `tools/gen_chat.py`, plus
one real export of your own (never committed). Check each item in **dark and
light**, **EN and PT**, at **1280px and 400px** (no horizontal page scroll).

## Landing
- [ ] Drop zone accepts click, keyboard (Enter/Space) and drag-and-drop
- [ ] `.pdf` → bad_type message; `.zip` without a `.txt` → empty_zip; random `.txt` → unparseable
- [ ] Record spins and "Reading N MB…" shows while parsing

## Header / date bar
- [ ] Subtitle: names or group title · count · platform · language
- [ ] Presets All / 12 mo / 30 d / each year; date inputs; start > end shows the warning and keeps the old range
- [ ] Reload keeps tab + range + language (hash), after re-uploading
- [ ] Export → .xlsx and .csv contain only the filtered range, 5 columns, localised headers

## Tabs
- [ ] Overview, Activity, People, Messages, Wrapped — every item in Tasks 11–15's manual checks
- [ ] A range with no messages shows "No messages in this range." on every tab
- [ ] One-person chat: People shows one card with "—" for reply/starts; Activity says "Needs at least two people."
