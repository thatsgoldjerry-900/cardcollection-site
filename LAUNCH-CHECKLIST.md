# Launch checklist

Housekeeping to do just before or after the new site replaces the Google Site at ianbadeer.com.
Claude: bring this list up when Ian says he is ready to publish or switch the domain, and remind Ian of
"Ian's to-dos" when a session starts or he asks what's left.

## Ian's to-dos
- [ ] **Turn off downloads in the shared Drive folders.** In each folder's Share settings (gear icon), untick
  "Viewers and commenters can see the option to download, print, and copy", then open one card file to check
  the download option is gone there too. The site keeps working; this removes Drive's "Download all" zip.
- [ ] **Set up GoatCounter analytics** (free, no cookies, no cookie banner needed).
  1. Sign up at goatcounter.com.
  2. Pick a site code, e.g. "ianbadeer" (the dashboard becomes ianbadeer.goatcounter.com).
  3. Send Claude the code. Claude puts it in `analytics.goatcounter` in `config/site.json`; every page then
     counts on its own (e.g. `#/player/ricky-simmons`), and visits show up in the GoatCounter dashboard.

## Before the switch
- [ ] **Image renames finished.** Ian is renaming card images in his database and Drive.
- [ ] **Read straight from the main Drive folder** (`driveRoot` in `config/site.json`, parent folder `18u_eEO7u8WP7Db8Hyo5VypOwIQTWTqWV`).
  - [ ] Make the Drive folder names match the site section titles, or map them. Today "Lions", "Royals" and "Nebraska Baseball & Softball" differ.
  - [ ] Check the new card names: count, auto and relic tags, and that every section still fills.
- [ ] **Real page addresses** (`/player/ricky-simmons` instead of `#/player/ricky-simmons`), so each page can have its own link preview and Google can index it.
  - [ ] Keep old `#/` links working.
- [ ] **Link previews.** Site-wide preview image, title and description; per-page previews for player pages, collections, lists and Media.
- [ ] **A 404 page** that sends people to the right place.

## The switch
- [ ] Point ianbadeer.com at GitHub Pages (Ian changes the DNS records at the registrar; add a `CNAME` file and turn on HTTPS in the repo settings).
- [ ] Send old Google Sites page addresses to their new pages:
  - home, alex-gordon-pc and its year pages, jermaine-dye-pc, nebraska-cornhuskers, custom-cards, kc-royals, detroit-lions, want-list, friends-of-interest.
- [ ] Update any links that still use `thatsgoldjerry-900.github.io` (README, Instagram bios, TCDb profile).
- [ ] Check `robots.txt` is served at ianbadeer.com/robots.txt (it only counts at a domain's root, so the AI-crawler opt-out starts with the switch).

## After the switch
- [ ] Add the site to Google Search Console and submit a sitemap. Include the plain NFL Husker pages (`/nfl-huskers/`, tier-1/2/3.html).
- [ ] Test shared links in a text message, Facebook and Instagram.
- [ ] Unpublish or archive the old Google Site once the new one is confirmed working.

## Open odds and ends (no rush)
- [x] Kansas City Star article: dated June 2020 on the Media page, linked to the PDF in Drive (done). A summary page or asking the Star for permission is on hold.
- [ ] Short huskers.com-sourced summaries for Tier 2 and Tier 3 players with no Wikipedia article (305 players).
- [x] Delete the unused Apps Script files in `tools/` (done).
