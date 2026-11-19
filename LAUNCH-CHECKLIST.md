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
- [ ] **Add the non-sport customs (e.g. Sonic the Hedgehog).** Make a folder "Customs - Non-Sport" in the main
  shared Drive folder and put the scans in it, then tell Claude, who connects it to the Customs page's Non-Sport filter.
- [ ] **Turn off downloads in the shared Drive folders.** In each folder's Share settings (gear icon), untick
  "Viewers and commenters can see the option to download, print, and copy", then open one card file to check
  the download option is gone there too. The site keeps working; this removes Drive's "Download all" zip.
- [ ] **Set up GoatCounter analytics** (free, no cookies, no cookie banner needed).
  1. Sign up at goatcounter.com.
  2. Pick a site code, e.g. "ianbadeer" (the dashboard becomes ianbadeer.goatcounter.com).
  3. Send Claude the code. Claude puts it in `analytics.goatcounter` in `config/site.json`; every page then
     counts on its own (e.g. `#/player/ricky-simmons`), and visits show up in the GoatCounter dashboard.
- [ ] **Add years for Huskers by NFL Team** (110 players; 40 now show a year from Pro Football Archives, marked "PFA").
  For those, the site already shows PFA's year; copy it into your research note when convenient. For the rest, put a date
  or year in the same sentence as the team in the note, e.g. "Released by the Broncos on 8/24/94" or "the Raiders in '92".
  Team pages and career timelines pick it up after the next data update. Cross a player off once his year is in your note.
  - [ ] Arizona Cardinals: Aaron Golliday, Chris Spachman, Jeff Lake, Jon Zatechka
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
  - [ ] Kansas City Chiefs: Aaron Golliday, Brandon Kinnie, Guy Ingles, Jake Andersen, Ray Novak
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
- [ ] **Next week (after the usage reset): the rest of the team logos on career timelines.** 63 teams have logos
  (scripts/build_team_logos.py, run by the GitHub Action). 93 still don't, e.g. BC Lions, Birmingham Stallions, Canton
  Bulldogs, Frankford Yellow Jackets: the Wikipedia summary it reads only shows freely licensed pictures. Plan: have the
  script read each article's infobox logo instead, keep the football-only checks, and retry the names in data/team-logos.json
  "tried". (Lions-style redesigns within one city still use the current logo.) Nothing for Ian to do but say go.

## Before the switch
- [ ] **Image renames finished.** Ian is renaming card images in his database and Drive.
  - [ ] Make set names consistent (e.g. the two TK Legacy styles) and drop private notes from file names, like
    "2nd (Sold to … for $15 on 4-22)": file names show on the site as captions and in search.
- [ ] **Read straight from the main Drive folder** (`driveRoot` in `config/site.json`, parent folder `18u_eEO7u8WP7Db8Hyo5VypOwIQTWTqWV`).
  - [ ] Make the Drive folder names match the site section titles, or map them. Today "Lions", "Royals" and "Nebraska Baseball & Softball" differ.
  - [ ] Check the new card names: count, auto and relic tags, and that every section still fills.
  - [ ] **Don't double uploads.** A scan copied into two folders counts as two cards (today ~147 names appear twice,
    mostly Gordon cards also in the Royals Button Relics / Nameplates / Dirt Relics groups).
  - [ ] **Consider tagging instead of copies** for groups like Dirt Relics, Button Relics and Nameplates: add a tag in
    parentheses at the end of the file name, leaving the TCDb name itself as is: "(Dirty)" for Dirt Relics,
    "(Button)" for Button Relics, "(Nameplate)" for Nameplates, e.g. "… Alex Gordon (Dirty)". The site
    reads the tag to place the card in that group, so one file shows in its home collection and the group; the tag can
    be hidden from the displayed name. (Alternatives: Drive shortcuts, or a list of card IDs in the site settings.)
- [ ] **A plain, crawlable page for every player** (like `/nfl-huskers/`), so searches for a player's name can land on Ian's page about him.
- [ ] **Real page addresses** (`/player/ricky-simmons` instead of `#/player/ricky-simmons`), so each page can have its own link preview and Google can index it.
  - [ ] Keep old `#/` links working.
- [ ] **Link previews.** Site-wide preview image, title and description; per-page previews for player pages, collections, lists and Media.
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
- [ ] Transcribe the custom card backs (89 customs have a back scan) into `data/card-text.json`: the full text for
  "Read the back", plus the player, new facts and new stats for the player page's "From my custom card" section.
  Only facts/stats the player page doesn't already show. Ian checks them before they go live.
