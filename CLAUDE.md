# Working on Ian's card site

Static site (vanilla JS: index.html, assets/app.js, assets/style.css) on GitHub Pages. The GitHub Action
`.github/workflows/update-catalog.yml` rebuilds data from Google Drive and Ian's private spreadsheets.
At the start of a session, read LAUNCH-CHECKLIST.md and remind Ian of "Ian's to-dos".

## Ian's standing rules (don't undo these)
- **Private spreadsheets:** the robot account is read-only. Publish only the approved lists and ranges
  (`config/private-lists.json`). Never print spreadsheet data in public logs, never commit .xlsx files or
  `data/lists/`.
- **Private notes stay off the site:** outreach, "need to confirm", "Source:" lines, URLs in notes, and players
  in `hideNotes`.
- **Sports focus:** Wikipedia bios keep only sports content; sentences about crimes, prison, suicide and
  similar are filtered out (scripts/build_players.py OFF_FIELD). Neutral jobs like "chief of police" are fine.
- **Sources:** Wikipedia (credited, CC BY-SA), CollegeFootballData, the Nebraska record book PDF, the Nebraska Football Hall of Fame list on huskers.com (data/hall-of-fame.json), and Pro Football Archives for NFL team years missing from Ian's notes (data/team-years.json via scripts/pfa_team_years.py; credited where shown). Do not scrape
  FootballDB or Sports Reference (link to them only). No custom-written bios. Don't republish the KC Star
  article; link Ian's PDF.
- **Cards shown:** hide any card whose name says "sold", and 2nd/3rd copies. Keep custom cards even when
  they're copies (they were commissions).
- **Scans are never altered.** Effects go around the card (viewer auras), not on it. Display is clean;
  only saved images get the IANBADEER.COM watermark.
  In binder view only, graded cards are cropped on screen to show the card without its slab (Ian's request; files untouched),
  and anything that doesn't fit a 9-pocket page (decas, booklets, 3x5/4x6/5x7/8x10 and other written sizes, oversized cards,
  box loaders/toppers, postcards, posters, Fatheads, photos, magazines, programs) is left out of the binder.
- **Email:** never write Ian's address in the page or repo as plain text (it's encoded in config and
  built on click).
- **Wording:** "Super Collection" is two words everywhere. Ian likes consistency and uniformity.
- Card-back transcriptions (data/card-text.json) are for custom cards only, and Ian checks them before
  they go live.
- **Deploy:** Ian wants finished work merged into `main` (the live site) without asking.
  When assets/app.js or assets/style.css change, bump the `?v=` on their links in index.html so phones load fresh copies.
- **Ian's tag codes in file names** (football, from Nov 2026): AU autograph, MEM memorabilia, MANU manufactured patch,
  SN25 / SN43 of 50 serial-numbered, PR25 print run (a known print run without a serial stamp; the site treats it the
  same as SN, like "Print Run of 99" in older names; with both SN and PR, the PR number is shown, as the variation's smaller run; "1 of 1" beats both), RC rookie, SP/SSP short print, "Inscription" for inscribed
  autos. MANU is a manufactured patch and does NOT count under Relics & patches.
  When a name has AU/MEM/MANU/SN/PR they override the word-based guesses and are hidden from captions (assets/app.js
  readCodes); backs pair with fronts ignoring these codes and letter codes (scripts/build_catalog.py loose_key).
- **Mobile:** Ian is often on his phone. Check layouts at phone width.
