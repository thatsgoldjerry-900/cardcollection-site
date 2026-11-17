# IanBadeer.com

> **Before going live at ianbadeer.com, work through [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md).**


A fast, searchable gallery of Ian Badeer's card scans. The scans stay in Google Drive.
This site reads the Drive folders and shows whatever is in them.

## Adding new cards

1. Drop the scan into the right Google Drive folder, the same way you do now.
2. Name it the way you already do, e.g. `2015 Bowman - Gold #3 Alex Gordon #'d to 50.jpg`.
   - A back scan with the same name plus `(Back)` is shown as the back of that card.
   - `(Custom)` in the name puts the card on the Customs page too.
3. Wait. The site checks Drive every 6 hours. To update right away, open the repository on GitHub,
   go to **Actions → Update cards and publish → Run workflow**.

New cards get a green **NEW** badge and appear under "Newest additions" on the home page.

## Changing the site

Everything you might want to change lives in `config/site.json`:

- **Intro text, email, links and the featured card** are at the top.
- **Progress percentages** (`"progress": 93`) are the numbers on the bars.
- **Sections and groups**: each group lists one or more Drive folder IDs. To add a folder, copy its ID
  from the Drive URL (`drive.google.com/drive/folders/<ID>`) and add `["<ID>", ""]` to a group's `folders`.
  Older folders also need their resource key, which is the second value.

Folders must be shared as **Anyone with the link → Viewer**.

## Hosting (free)

- **GitHub Pages**: push this folder to a GitHub repository, then go to **Settings → Pages** and set the
  Source to **GitHub Actions**. The workflow in `.github/workflows` builds and publishes the site.
- **Custom domain**: in Settings → Pages, enter `ianbadeer.com`, then add the DNS records GitHub shows
  at your domain registrar.

## Running it on your computer

```bash
python3 scripts/build_catalog.py   # refresh the card list from Drive
python3 -m http.server 8000         # then open http://localhost:8000
```

## How it works

- `scripts/build_catalog.py` reads each Drive folder's public listing (no API key) and writes
  `data/catalog.json`: file ID, name, folder and the date it was first seen.
- `index.html` + `assets/app.js` load that list. Card details (year, set, parallel, print run,
  autograph, relic, grading) come from the file names.
- Images load straight from Google Drive at the size needed: small for the grid, large for the viewer,
  with a link to the original full-resolution file.
