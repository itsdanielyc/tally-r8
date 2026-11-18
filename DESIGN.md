# Design

A short decision log for Tally's interface. Product register: a tool used
for a few minutes at a time, again and again, where speed of entry and
trust in the numbers matter more than character.

## Direction

- Concept: a quiet ledger book. The numbers are the content; chrome
  recedes; every action is reachable from the keyboard.
- Surface: Electron (Chromium on all three OSes), one window, 1024 x 700 by
  default. Light theme only in 0.1.0 (Ruling: one theme to prove on three
  OSes first — cost if wrong: a dark palette later, tokens are ready for it).
- Typography: the system UI font (Segoe UI, San Francisco, the Linux
  default sans) at 14 px with 20 px lines; headings 18 px semibold;
  secondary text 12 px. Amounts use tabular numerals, right-aligned, so
  columns of money line up digit by digit.
- Color: warm off-white canvas, white surfaces, one ink-green accent kept
  for primary actions, the current navigation item and focus rings.
  Income is green with a plus sign; spending is ink with a minus sign; over
  budget is red. Color never carries meaning alone: signs and words do too.
- Geometry: 1 px borders, 6 px radius on controls, 8 px on panels, no drop
  shadows; controls 32 px tall; spacing steps 4, 8, 12, 16, 24.
- Layout: a left sidebar (navigation), a main pane that scrolls, and a
  status bar at the bottom that names the ledger file and the backend.
  Each screen has a title row, then its form, then its table.
- Interaction: forms submit with Enter; Escape cancels an edit; the
  navigation is a list of buttons with `aria-current`. Destructive actions
  ask inline, in the row, never in a modal.
- Motion: none beyond a 120 ms background change on hover. Nothing moves
  on its own.

## Decisions

- The add form sits above the list so the newest entry appears right
  under where it was typed.
- The amount is typed unsigned with a Spending or Income choice; the list
  shows it signed.
- Undo is a bar above the current screen, on every screen, naming what it
  would take back; it goes away after use or after any other change. The
  inline delete confirmation stays, because undo lives in memory only.
- The filter bar sits between the entry form and the list; typing redraws
  only the list so the field keeps its focus. Its labels (Search, In, From,
  To, At least, At most) avoid the entry form's words so each label names
  one control.
- Text sizes of layout containers are fixed by CSS (control heights, row
  heights, sidebar width) so the shared geometry baseline holds across the
  three system fonts.
