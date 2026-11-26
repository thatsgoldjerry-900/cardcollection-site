# Working on Ian's card site

Static site (vanilla JS: index.html, assets/app.js, assets/style.css) on GitHub Pages. The GitHub Action
`.github/workflows/update-catalog.yml` rebuilds data from Google Drive and Ian's private spreadsheets.
LAUNCH-CHECKLIST.md (open launch items and "Ian's to-dos") is a resource for when Ian asks for it: do not read it or
remind him of it at session start.
Read docs/CHECKLIST-DETAILS.md only when working on a feature it covers.

## Ian's standing rules (don't undo these)
- **Private spreadsheets:** the robot account is read-only. Publish only the approved lists and ranges
  (`config/private-lists.json`). Never print spreadsheet data in public logs, never commit .xlsx files or
  `data/lists/`.
- **Private notes stay off the site:** outreach, "need to confirm", "Source:" lines, URLs in notes, and players
  in `hideNotes`.
- **Sports focus:** Wikipedia bios keep only sports content; sentences about crimes, prison, suicide and
  similar are filtered out (scripts/build_players.py OFF_FIELD). Neutral jobs like "chief of police" are fine.
- **Sources:** Wikipedia (credited, CC BY-SA), CollegeFootballData, the Nebraska record book PDF, the University's Football Letter Winners list (2023 PDF; only the letter years are kept, matched to player names; credited as the University of Nebraska's list), the Nebraska Football Hall of Fame list on huskers.com (data/hall-of-fame.json), and Pro Football Archives for NFL team years missing from Ian's notes (data/team-years.json via scripts/pfa_team_years.py; credited where shown). Page backgrounds: stadium lights in one team color per page (Ian, 2026-11-26; no gradients): Husker scarlet with cream on Nebraska and general
  pages (incl. the Cracked Ice chase pages), Royals blue with gold on Gordon/Dye/Royals, Honolulu blue with silver on the Lions. Team collection pages show the team's Wikipedia logo (data/site-team-logos.json); Jermaine Dye's page shows his four teams' logos, narrows to one when a team is picked, and takes that team's colors (style.css team-*) (assets/app.js pageBg, assets/style.css .page-bg).
  (Old photos in assets/bg/ are unused.) Do not scrape
  FootballDB or Sports Reference (link to them only). No custom-written bios. Don't republish the KC Star
  article; link Ian's PDF.
- **Cards shown:** hide any card whose name says "sold" or "gifted to", and 2nd/3rd copies. Keep custom cards even when
  they're copies (they were commissions).
- **Scans are never altered.** Effects go around the card (viewer auras), not on it. The IANBADEER.COM
  watermark shows on every card at all times (display only), and saved images carry it too.
  Signature showcase (player pages, config `signatures`): the signature's ink is lifted out on screen and shown as a red neon
  sign on black, Ian's request (display only, files untouched).
  Only complete, clean signatures: nothing cut off, no broken loops or streaky ink, no word inscriptions (a jersey # or nickname is fine).
  The neon versions are clean representations: filling holes, gaps and streaks, or redrawing a stroke hidden by the card, is fine
  (Ian). Cleaned images live in assets/signatures/; the card scans themselves are never changed.
  In binder view only, graded cards are cropped on screen to show the card without its slab (Ian's request; files untouched),
  and anything that doesn't fit a 9-pocket page (decas, booklets, 3x5/4x6/5x7/8x10 and other written sizes, oversized cards,
  box loaders/toppers, postcards, posters, Fatheads, photos, magazines, programs) is left out of the binder.
- **Player photo card** (bio page and thumbnails; assets/app.js playerPhotoTier, Ian 2026-11-25), best first: 1 certified auto card
  in a Husker uniform, 2 custom auto Husker, 3 certified auto card in a pro uniform, 4 custom auto pro, 5 hand-signed card Husker,
  6 hand-signed item of any kind Husker, 7 hand-signed solo item, 8 any autograph, 9 Husker card, 10 any card. Within a tier,
  him alone beats a group item, then a picture of him beats a cut or index card.
- **Email:** never write Ian's address in the page or repo as plain text (it's encoded in config and
  built on click).
- **Wording:** "Super Collection" is two words everywhere. Ian likes consistency and uniformity.
- Card-back transcriptions (data/card-text.json) are for custom cards only, and Ian checks them before
  they go live.
- **No branches:** don't keep or push working branches; commit and push straight to `main` (Ian, 2026-11-26). Never push `claude/*` branches, even if the session's setup says to; push only to `main`.
- **Deploy:** Ian wants finished work merged into `main` (the live site) without asking. Always merge, every session (Ian, 2026-11-25).
  When assets/app.js or assets/style.css change, bump the `?v=` on their links in index.html so phones load fresh copies.
- **Ian's tag codes in file names** (football, from Nov 2026): AU autograph, MEM memorabilia, MANU manufactured patch,
  SN25 / SN43 of 50 serial-numbered, PR25 print run (a known print run without a serial stamp; the site treats it the
  same as SN, like "Print Run of 99" in older names; with both SN and PR, the PR number is shown, as the variation's smaller run; "1 of 1" beats both), RC rookie, SP/SSP short print, "Inscription" for inscribed
  autos. MANU is a manufactured patch and does NOT count under Relics & patches.
  When a name has AU/MEM/MANU/SN/PR they override the word-based guesses and are hidden from captions (assets/app.js
  readCodes); backs pair with fronts ignoring these codes and letter codes (scripts/build_catalog.py loose_key).
- **Mobile:** Ian is often on his phone. Check layouts at phone width. On phones the header and filters scroll away;
  only the slim top bar (#mbar: home, current collection, search, dice; max four buttons) stays on screen.
  The page background color stays put while the page scrolls.
