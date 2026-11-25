# Launch checklist (open items only)

Claude: remind Ian of "Ian's to-dos" at session start; bring up the switch lists when he's ready to publish.
Full details, finished items and feature notes: docs/CHECKLIST-DETAILS.md (read only when working on that feature).

## Ian's to-dos
- [ ] Turn off downloads in the shared Drive folders (Share settings, untick "Viewers and commenters can see the option to download, print, and copy").
- [ ] Set up GoatCounter (goatcounter.com), then send Claude the site code for `analytics.goatcounter` in config/site.json.
- [ ] Decide: build the watermark into the grid pictures? (Review before launch; extra load on phones.)
- [ ] Finish the image renames (consistent set names; drop private notes like "Sold to…" from file names).
- [ ] Scan certified autograph cards with no scan yet (names in details file), and the front of 2008 TK Legacy #AA4 Johnny Rodgers.
- [ ] Add years for Huskers by NFL Team (108 players; 40 show a PFA year). Team/player list in details file.
- [ ] Check the new Detroit Lions and Nebraska Other Sports pages after the next update.
- [ ] Hand-match the ~49 teams without a logo (exact Wikipedia article names).
- [ ] More Fan Day sheets (2015 Signed Page, 2009/2010 sheets, 2023 roster card).
- [ ] When all re-uploads are done, remove "freshUploadDate" from alex-gordon, jermaine-dye, royals, husker-baseball in config/site.json.

## Before the switch
- [ ] Read straight from the main Drive folder (`driveRoot`): match folder names to section titles, check new names/tags, no double uploads, consider "(Dirty)/(Button)/(Nameplate)" tags instead of copies.
- [ ] A plain crawlable page for every player; keep old `#/` links working.

## The switch
- [ ] Point ianbadeer.com at GitHub Pages (DNS, `CNAME` file, HTTPS).
- [ ] Redirect old Google Sites addresses (list in details file).
- [ ] Update links using thatsgoldjerry-900.github.io (README, Instagram, TCDb).
- [ ] Set `siteUrl` in config/site.json to https://ianbadeer.com/; check robots.txt at the domain root.

## After the switch
- [ ] Google Search Console + Bing Webmaster Tools: submit sitemap (incl. /nfl-huskers/ pages).
- [ ] IndexNow ping when pages change.
- [ ] Get linked (podcasts, Instagram, TCDb, Husker communities, nflhuskers.com); test shared links (text, Facebook, Instagram).
- [ ] Archive the old Google Site.

## No rush
- [ ] Short huskers.com summaries for Tier 2/3 players with no Wikipedia article (305).
- [ ] Neon signatures (108 live): add only from signatures Ian cleans up or cards he names.
