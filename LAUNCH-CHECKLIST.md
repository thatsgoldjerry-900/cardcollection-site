# Launch checklist

Housekeeping to do just before or after the new site replaces the Google Site at ianbadeer.com.
Claude: bring this list up when Ian says he is ready to publish or switch the domain, and remind Ian of
"Ian's to-dos" when a session starts or he asks what's left.

## Ian's to-dos
- [x] **Fix the letter codes in letterman card names** (the number is the letter's spot in the word). Ian fixed these 2026-11-18; Claude checks the new names after Ian uploads the files:
  - [x] 2009 Bowman Draft College Letter Patch Autographs #ML Marlon Lucky **3U** → likely **2U** (LUCKY: L1 U2 C3 K4 Y5)
  - [x] 2013 Upper Deck - Rookie Lettermen Autographs #RL-RB Rex Burkhead **9R** → likely **10R** (CORNHUSKERS: E is 9, R is 10)
  - [x] 2013 Upper Deck Rookie Lettermen Autographs #RLRB7 Rex Burkhead **6S** → **7S** if it's an S card, or **6U** if it's a U
  - [x] 2012 Upper Deck Rookie Lettermen Signatures #RLAD Alfonzo Dennard **8S** → likely **7S** (8 is the K)
  - [x] Check for a double upload: Jared Crick **2O** appears twice ("#'d 8 of 25" and "#'d to 25"), and
    Rex Burkhead **11S** appears twice ("#'d 24 of 50" and "#'d to 50"). If each is one card, keep one file.
- [x] **Add the non-sport customs (e.g. Sonic the Hedgehog).** Ian made the "Customs - Non-Sport" Drive folder (2026-11-22);
  connected as a hidden section in config/site.json ("customs": true, "hidden": true): its scans show only under the Customs
  page's Non-Sport filter.
- [ ] **Turn off downloads in the shared Drive folders.** In each folder's Share settings (gear icon), untick
  "Viewers and commenters can see the option to download, print, and copy", then open one card file to check
  the download option is gone there too. The site keeps working; this removes Drive's "Download all" zip.
- [ ] **Set up GoatCounter analytics** (free, no cookies, no cookie banner needed).
  1. Sign up at goatcounter.com.
  2. Pick a site code, e.g. "ianbadeer" (the dashboard becomes ianbadeer.goatcounter.com).
  3. Send Claude the code. Claude puts it in `analytics.goatcounter` in `config/site.json`; every page then
     counts on its own (e.g. `#/player/ricky-simmons`), and visits show up in the GoatCounter dashboard.
- [ ] **Add years for Huskers by NFL Team** (108 players; 40 now show a year from Pro Football Archives, marked "PFA").
  For those, the site already shows PFA's year; copy it into your research note when convenient. For the rest, put a date
  or year in the same sentence as the team in the note, e.g. "Released by the Broncos on 8/24/94" or "the Raiders in '92", or a line per stint like "04 - Chiefs (Preseason)" (Aaron Golliday's note, done 2026-11-24).
  Team pages and career timelines pick it up after the next data update. Cross a player off once his year is in your note.
  - [ ] Arizona Cardinals: Chris Spachman, Jeff Lake, Jon Zatechka
  - [ ] Atlanta Falcons: Corey Dixon (PFA: 1994–1995), Pat Ricketts
  - [ ] Baltimore Ravens: Terrence Moore (PFA: 2012)
  - [ ] Carolina Panthers: Adi Kunalic, Brian Schuster
  - [ ] Chicago Bears: Bert Gissler, Dana Stephenson (PFA: 1970), George Abel, Kenny Wilhite (PFA: 1993), Lynn Senkbeil (PFA: 1966–1967)
  - [ ] Cincinnati Bengals: Jack Gangwish, Kenny Brown (PFA: 1981), Paul Rogers
  - [ ] Cleveland Browns: Dedrick Young, Randy Poeschl (PFA: 1979)
  - [ ] Dallas Cowboys: Bob Taucher (PFA: 1968), Dave Volk, Glenn Patterson (PFA: 1970), Larry Mushinskie (PFA: 1976), Ola Dagunduro, P.J. Mangieri
  - [ ] Denver Broncos: John Havekost (PFA: 1980–1981)
  - [ ] Detroit Lions: Loran Kaiser, Patrick Kabongo (PFA: 2004), Phil Bates (PFA: 1982), Preston Love (PFA: 1965), Ray Novak (PFA: 1954)
  - [ ] Green Bay Packers: Al Grubaugh (PFA: 1944), Bert Gissler, Charles Bryant (PFA: 1955), Curenski Gilleylen, Fred Preston (PFA: 1942), Terrell Farley (PFA: 1998), Terry Connealy, Tony Jeter (PFA: 1966), Wilson Thomas
  - [ ] Houston Texans: Damion Daniels, Pheldarious Payne
  - [ ] Indianapolis Colts: Ron Kirkland (PFA: 1967), Van Brownson (PFA: 1972)
  - [ ] Jacksonville Jaguars: Benard Thomas, Kevin Maurice, Kyler Reed, Oliver Martin, Todd Peterson
  - [ ] Kansas City Chiefs: Brandon Kinnie, Guy Ingles, Jake Andersen, Ray Novak
  - [ ] Las Vegas Raiders: Phalen Sanford
  - [ ] Los Angeles Chargers: Barry Cryer, Ben Cotton, Mike Green (PFA: 1970)
  - [ ] Los Angeles Rams: Bobby Reynolds, Clarence Cook (PFA: 1957), Cortney Grixby, Dave Theisen (PFA: 1963–1964), Pat Tyrance (PFA: 1991), Walter "Butch" Luther (PFA: 1941)
  - [ ] Minnesota Vikings: Ira Cooper, Mike Caputo, Terrell Newby, Tyler Hoppes
  - [ ] New England Patriots: Chris Spachman, Dan Hadenfeldt, Eric Alford, Jerry Murtaugh, Sam Cotton
  - [ ] New Orleans Saints: Bob Taucher (PFA: 1968–1969), Jermarcus Hardrick
  - [ ] New York Giants: Bert Gissler, Bob Mills (PFA: 1939), Greg Jorgensen (PFA: 1978), Matt O'Hanlon
  - [ ] New York Jets: Dave Butterfield (PFA: 1977), George Mills, Jamie Burrow, Josh Davis (PFA: 2004–2005), Mike Anderson, Scott Raridon
  - [ ] Philadelphia Eagles: Ted Connor (PFA: 1954), Ty Steinkuhler
  - [ ] Pittsburgh Steelers: Byron McCane (PFA: 1968), Tamon Lynum, Tony Jeter (PFA: 1966–1969)
  - [ ] San Francisco 49ers: Anthony West
  - [ ] Seattle Seahawks: Austin Cassidy, Deontai Williams, Kevin Dixon, Rickey Thenarse
  - [ ] Tampa Bay Buccaneers: Ben Scott, Daniel Davie, Jermarcus Hardrick, Keven Lightner (PFA: 1988), Matt Herian, Nash Hutmacher, Steve Kriewald, Tracey Wistrom (PFA: 2002)
  - [ ] Tennessee Titans: Jon Clanton, Mike Erickson
  - [ ] Washington Commanders: Ardell Johnson (PFA: 1975), Elmer Dohrmann (PFA: 1938), Jason Schwab, Jerald Foster, Jerry Minnick (PFA: 1954)
- [x] **More team logos on career timelines** (done 2026-11-22): the script now reads each team article's infobox logo, so
  98 of 156 team names have one (was 63). Still none for ~49 teams, mostly early NFL clubs (Canton Bulldogs, Frankford Yellow
  Jackets), NFL Europe and 1980s USFL teams whose Wikipedia names are shared by later teams; ~9 entries aren't team names
  ("Los Angeles", "Oklahoma State"). Could be finished later with hand-picked Wikipedia pages per team.
- [ ] **Neon signatures: 108 live.** Automatic searching costs too many tokens for what it finds (Ian, 2026-11-23): stopped after
  168 of the 253 Tier 1 players without one (85 unchecked). Add more only from signatures Ian cleans up and sends, or cards he
  names. Standard: clean version (fill holes/streaks, keep the pen's stroke width, no card design or extra words; jersey # or
  nickname OK), saved in assets/signatures/ and set in config "signatures" with "src". Don't over-thicken (Adduci looked blobby).
- [x] **Wikipedia bios (and college stats) for the card-only bios** (done 2026-11-22, run from Claude's machine; Wikipedia
  answered again). scripts/build_players.py now also reads config/site.json `cardPlayers` (same sports filters) and saves them as
  `cardPlayers` in data/players.json; the page shows the bio under Ian's write-up, plus a Coaching career list for coaches.
  Found: Osborne, Devaney, Pete Elliott (override "card:Pete Elliot"), Dana X. Bible, Biff Jones, Pelini, Mike Riley, Brewer Hicklen
  (override; he didn't play at Nebraska). No Wikipedia article: Larry Frost, Whaley, Bomberger, Reeves, Hubka, Omar Manning,
  Maurice Washington, Stoltenberg, Foltz, Ron Brown (coach). College stats (CFBD) added for Whaley, Washington, Stoltenberg, Foltz.
- [ ] **Team logos: hand-match the ~49 teams still without one** (USFL 1980s, NFL Europe, early NFL; data/team-logos.json "tried").
  Give exact Wikipedia article names per team; ~9 "tried" entries aren't teams ("Los Angeles", "Oklahoma State"…). Runs in the Action.
- [ ] **Card picks (stars) and the Duplicates page are live** (2026-11-22/23). Picks: up to 50, saved on the visitor's device,
  shared as /picks/<ids>/ (ids = last 8 characters of the scan's Drive ID). Duplicates: 2nd/3rd… copies plus "SN23 of 50" copies
  of a card also listed as "SN50" (scripts/build_catalog.py). Nothing pending; noted so a new chat knows they exist.
- [x] **Neon signatures for Tier 2/3 from the Fan Day sheets** (done 2026-11-22: 23 players, Ian approved; red Sharpie ink mode added).
  Tier 2/3 card batch (10) and Tier 1 black/red-ink batch (9) done too. The rest of that batch came from signatures Ian
  cleaned up himself (assets/signatures/, config "src"); send more the same way anytime. The rest of Tier 2/3 (and Tier 1) need hand-picked cards (black ink, busy labels).
- [ ] **More Fan Day sheets:** the 2022–2025 sheets are matched (the newest box is the main picture for players with no signed trading card scan; config "fanDay"). The 2015
  "Signed Page", the 2009/2010 Fan Day sheets and the 2023 roster card have no name boxes, so they aren't matched yet.
- [ ] **Scan these certified autograph cards** (listed as "Certified Card" in my lists, but no autograph scan on the site yet; checked 2026-11-22):
  - NFL Tier 1: John Bullock, Omar Brown, Wan'Dale Robinson, Chris Payton-Jones, Eric Hagg, Zack Bowman
  - NFL Tier 2: Dane Key, DeShon Singleton, Isaac Gifford, Ben Scott, Quinton Newsome, Oliver Martin
  - NFL Tier 3: Bryce Benhart, Alex Bullock, Tommi Hill
  (If one is scanned but named differently, e.g. without "AU", tell Claude the file name.)
- [ ] **Scan the front of the 2008 TK Legacy All-American Autographs #AA4 Johnny Rodgers (AU, SN100)** and upload it;
  its back is already in the football folder and will pair with it automatically.
- [x] **After the football re-upload is live:** (done 2026-11-20) tell Claude, who checks the new names on the site and turns off
  "freshUpload" in config/site.json (it keeps the big batch from all showing as NEW).

- [ ] **TCDb want list and collection on rainbow pages are live** (2026-11-21, football: want list 28,357 cards (TCDb's want list export included the collection; taken out),
  collection 21,937). To refresh: export from TCDb as CSV and send it to Claude, who runs
  `scripts/tcdb_import.py <csv> football collection`, then `... wantlist` (it leaves out cards in the collection) to make data/tcdb/football-<kind>.json: card names
  and TCDb links only, with TCDb's extra tags (RC, ROO, CO, SR, UER…) dropped so names read like Ian's file names. Each Drive
  update matches them to the scans (scripts/build_rainbow_wants.py). On a rainbow page, a want list card is a red "Need it"
  (never 1/1s: Ian doesn't chase them), a collection card without a scan is a green "Have it"; a scan replaces either.
  Collection exports for baseball (43,186), basketball (1,329), multi-sport (1,407) and misc sports (187) imported 2026-11-23
  (`... baseball collection` etc.); want lists next, imported with the same sport names (combined exports are fine: the
  collection is taken out). Collection cards that match a scan exactly are left out of data/rainbow-wants.json (smaller file).

- [ ] **Player reference images are live** (2026-11-22): Drive folder "Nebraska Player Reference Images" (read by name each update,
  scripts/build_catalog.py "refs"). The file name names the player (e.g. "John Howell"); the image shows in a column on the right of
  his page (below the bio on phones) and opens in the viewer. Extra words are fine ("John Howell Compilation"). Nothing pending.

- [ ] **Jermaine Dye re-upload** (2026-11-23): the section now reads the Drive folder "Jermaine Dye" by name (team subfolders =
  groups); the old per-team folder IDs are gone from config. ~900 renamed scans the robot couldn't match got "freshUploadDate":
  "2025-01-01" (section setting) instead of showing as NEW. Remove that setting once the re-upload is finished.
  Same for Nebraska Baseball ("Nebraska Baseball Cards & Autos") and the Royals ("Kansas City Royals", now one list, no groups),
  switched 2026-11-23. The Royals' old "Dirt Relics" group is gone: the dirt glow now goes only to cards with "Dirt" in the name.

- [ ] **Chase pages are live** (2026-11-23): Nebraska Cracked Ice and Nebraska Precious Metal Gems (#/chase/<slug>, config
  "chases": match / exclude; scripts/build_chases.py makes data/chases.json from data/tcdb). Huskers only (scans in the Nebraska
  collections or Alex Gordon's, or on Ian's lists). Oldest first; filters for sport, College/Pro (config "chaseCollege", by set
  name) and Autographs, all updating the progress. Cracked Ice leaves out colored versions (incl. Prizm Green Crystals).
  Jordan Burroughs (wrestling) isn't counted: not on a list, no scans. Add more chases with a name and a match phrase.
- [x] **Alex Gordon re-upload done** (Ian, 2026-11-24): the section reads the Drive folder "Alex Gordon" by name; the 8 old
  per-year folder IDs are gone from config. Groups are year ranges from the year at the start of each file name ("maxYear",
  same groups as before). Its "Duplicates" subfolder goes to the Duplicates page (scripts/build_catalog.py DUP_FOLDER; works in
  any collection's folder). Still to do (Claude): check button/nameplate tags and run a missing-card check by player + set.
  After all re-uploads: remove "freshUploadDate" from the jermaine-dye, royals and husker-baseball sections in config/site.json.
- Session notes 2026-11-23 (also live): Huskers by NFL Team pages end with Ian's cards of that team (Drive team folders);
  Nebraska Basketball Cards & Autos page; letterman pages are Huskers only, split by parallel and autograph, ignore letter codes
  in set names / card numbers, and Own The Name cards count as nameplate relics; filters Button / Nameplate / Dirt relics (config
  "dirtRelics" for names with no room); TCDb collections + want lists for all five sports imported.

## Before the switch
- [ ] **Image renames finished.** Ian is renaming card images in his database and Drive.
  - [ ] Make set names consistent (e.g. the two TK Legacy styles) and drop private notes from file names, like
    "2nd (Sold to … for $15 on 4-22)": file names show on the site as captions and in search.
- [ ] **Read straight from the main Drive folder** (`driveRoot` in `config/site.json`, parent folder `18u_eEO7u8WP7Db8Hyo5VypOwIQTWTqWV`).
  - [ ] Make the Drive folder names match the site section titles, or map them. Today "Royals" and "Nebraska Baseball & Softball" differ. (The Lions page has no folder of its own since 2026-11-21: it shows every card tagged "Detroit Lions", i.e. in a Detroit Lions subfolder.)
  - [ ] Check the new card names: count, auto and relic tags, and that every section still fills.
  - [ ] **Don't double uploads.** A scan copied into two folders counts as two cards (today ~147 names appear twice,
    mostly Gordon cards also in the Royals Button Relics / Nameplates / Dirt Relics groups).
  - [ ] **Consider tagging instead of copies** for groups like Dirt Relics, Button Relics and Nameplates: add a tag in
    parentheses at the end of the file name, leaving the TCDb name itself as is: "(Dirty)" for Dirt Relics,
    "(Button)" for Button Relics, "(Nameplate)" for Nameplates, e.g. "… Alex Gordon (Dirty)". The site
    reads the tag to place the card in that group, so one file shows in its home collection and the group; the tag can
    be hidden from the displayed name. (Alternatives: Drive shortcuts, or a list of card IDs in the site settings.)
- [ ] **A plain, crawlable page for every player** (like `/nfl-huskers/`), so searches for a player's name can land on Ian's page about him.
- [x] **Real page addresses** (done 2026-11-22): /player/ricky-simmons/, /c/royals/, /customs/, /checklist/tier-2/… (the Husker
  Bios hub is /husker-bios/, since /nfl-huskers/ holds the plain list pages). Each main page has its own file with its own
  title, description and link-preview picture (scripts/build_route_pages.py, run by the Action; also added to sitemap.xml).
  Other addresses (searches, cards) go through 404.html to the site. Old #/ links still work.
  - [ ] Keep old `#/` links working.
- [x] **Link previews** (2026-11-22): site-wide preview image (assets/preview.jpg), title and description in index.html; the plain
  player and list pages have their own title, description and card picture. Collections have their own previews too (2026-11-22):
  the Share button on a collection gives a c/<slug>/ link with that collection's picture (assets/previews/, remake with
  scripts/make_preview_images.py). Media and player pages share the site preview until pages have real addresses. At the switch, update the addresses in index.html's preview tags.
- [x] **A 404 page** that sends people to the right place (done: 404.html with search, random card and main links). At the switch, old Google Sites addresses can be added to it as redirects.

## The switch
- [ ] Point ianbadeer.com at GitHub Pages (Ian changes the DNS records at the registrar; add a `CNAME` file and turn on HTTPS in the repo settings).
- [ ] Send old Google Sites page addresses to their new pages:
  - home, alex-gordon-pc and its year pages, jermaine-dye-pc, nebraska-cornhuskers, custom-cards, kc-royals, detroit-lions, want-list, friends-of-interest.
- [ ] Update any links that still use `thatsgoldjerry-900.github.io` (README, Instagram bios, TCDb profile).
- [ ] Change `siteUrl` in `config/site.json` to `https://ianbadeer.com/` so the sitemap lists the new addresses.
- [ ] Check `robots.txt` is served at ianbadeer.com/robots.txt (it only counts at a domain's root, so the AI-crawler opt-out starts with the switch).

## After the switch
- [ ] Add the site to Google Search Console and submit a sitemap. Include the plain NFL Husker pages (`/nfl-huskers/`, tier-1/2/3.html).
- [ ] Add the site to **Bing Webmaster Tools** too (it feeds ChatGPT search, Copilot and DuckDuckGo) and submit the same sitemap.
- [ ] Have the robot ping **IndexNow** (Bing and others) when pages change, so updates get picked up quickly.
- [ ] Get linked: ask podcast and video hosts to add the site to episode descriptions; add it to Instagram bios and the TCDb profile; share the NFL Husker lists in Husker communities; reach out to nflhuskers.com about linking each other.
- [ ] Test shared links in a text message, Facebook and Instagram.
- [ ] Unpublish or archive the old Google Site once the new one is confirmed working.

## Open odds and ends (no rush)
- [x] Kansas City Star article: dated June 2020 on the Media page, linked to the PDF in Drive (done). A summary page or asking the Star for permission is on hold.
- [ ] Short huskers.com-sourced summaries for Tier 2 and Tier 3 players with no Wikipedia article (305 players).
- [x] Delete the unused Apps Script files in `tools/` (done).
- [x] (done 2026-11-20: 113 backs, reviewed by Ian) Transcribe the custom card backs (89 customs have a back scan) into `data/card-text.json`: the full text for
  "Read the back", plus the player, new facts and new stats for the player page's "From my custom card" section.
  Only facts/stats the player page doesn't already show. Ian checks them before they go live.
