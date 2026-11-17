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
- **Sources:** Wikipedia (credited, CC BY-SA), CollegeFootballData, the Nebraska record book PDF. Do not scrape
  FootballDB or Sports Reference (link to them only). No custom-written bios. Don't republish the KC Star
  article; link Ian's PDF.
- **Cards shown:** hide any card whose name says "sold", and 2nd/3rd copies. Keep custom cards even when
  they're copies (they were commissions).
- **Scans are never altered.** Effects go around the card (viewer auras), not on it. Display is clean;
  only saved images get the IANBADEER.COM watermark.
- **Email:** never write Ian's address in the page or repo as plain text (it's encoded in config and
  built on click).
- **Wording:** "Super Collection" is two words everywhere. Ian likes consistency and uniformity.
- Card-back transcriptions (data/card-text.json) are for custom cards only, and Ian checks them before
  they go live.
- **Mobile:** Ian is often on his phone. Check layouts at phone width.
