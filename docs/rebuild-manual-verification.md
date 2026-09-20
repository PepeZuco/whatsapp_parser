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
- [ ] A range with no messages shows "No messages in this range." on Overview, Activity, People and Messages; Wrapped uses its own period selector, independent of the date bar
- [ ] One-person chat: People shows one card with "—" for reply/starts; Activity says "Needs at least two people."

## Participants modal

Run against `chats/pair.txt` and `chats/group.txt`, plus a group of **more than
six people** (the palette change below only shows there), in **dark and light**,
**EN and PT**, at **1280px and 400px**.

### Opening and the roster
- [ ] Opens automatically after every upload, over already-rendered charts (not a blank page)
- [ ] Unchecking a person dims the row and drops the footer count; after Analyse they are gone from every total, the calendar, reply medians, the word cloud, Wrapped and the .xlsx/.csv export
- [ ] Unchecking everyone disables Analyse and shows "Pick at least one person."
- [ ] Excluding whoever owns the first or last day shrinks the date bar's span, and a previously selected range outside the new span is clamped rather than left empty
- [ ] Header subtitle gains "· N excluded" whenever anyone is out
- [ ] Header "People" button reopens the modal with the applied roster
- [ ] Esc and × cancel — the previously applied roster survives untouched

### Merging
- [ ] Drag one row onto another → group with an editable name, members listed with their own counts
- [ ] `⇄` → "same person as…" produces the identical group; reachable and usable by keyboard alone; works on a phone
- [ ] **Merge two people who are far apart in the list** (not adjacent rows) and confirm the *merged* entry takes the chosen name and no other participant is renamed
- [ ] Unlink splits a group; names come back from the export, colours do not collide

### Colours
- [ ] Colour dot opens 12 swatches + a live People card; picking one updates dot, row bar and all three coloured parts of the preview at once, and the editor stays open
- [ ] Slots held by someone else are dimmed with an "already used by …" tooltip and still pickable
- [ ] The chosen colour is what People, Activity, Messages, Wrapped and the card's canvas draw, in dark and light
- [ ] **Narrow the date range, reopen the modal, open a colour editor** — the preview's percentage matches what the People tab shows after Analyse

### Duplicate banner
- [ ] Appears only when a pair is flagged, explains itself, and never applies on its own
- [ ] Both "Merge as …" buttons keep the right name
- [ ] "Different people" dismisses the card, and it stays dismissed after closing and reopening the modal
- [ ] No banner at all on a chat with nothing flagged

### Keyboard
- [ ] Tab never escapes the modal to the controls behind the dim overlay — including right after opening the `⇄` menu, after Reset, and after a banner button
- [ ] Shift+Tab from the first control wraps to the last

### The one deliberate visual change
- [ ] On a chat with **more than six people**, People cards and the Wrapped card now use twelve distinct colours instead of cycling six. This is the intended effect of the palette expansion — confirm the new colours look right, rather than confirming nothing moved. On six or fewer, nothing changes.

### Activity legend
- [ ] Every colour in the three opens/closes bars has a legend entry with the right name, "Others" is last when present, and no legend entry is missing from all three bars
- [ ] Still correct after excluding two people and reopening the tab
