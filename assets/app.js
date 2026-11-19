/* IanBadeer.com — reads data/catalog.json (built from the Google Drive folders) and renders the gallery. */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => n.toLocaleString("en-US");

  // Image URLs straight from Google Drive. A page can override this (used by the offline preview).
  const img = window.IMG_SRC || ((id, rk, w) => `https://lh3.googleusercontent.com/d/${id}=w${w}${rk ? `?resourcekey=${rk}` : ""}`);

  let DATA, CARDS, SECTIONS, NEW_CUTOFF;
  let PHOTOS = [], INV = {};

  /* ---------- File-name parsing ---------- */
  const RX = {
    main: /^(\d{4}(?:-\d{2})?)\s+(.*?)\s+#(\S+)\s+(.*)$/,
    serial: /#'?d\s*(?:to\s*)?(\d+)\s*(?:of\s*(\d+))?|print run of\s*(\d+)|\b(\d+)\s+of\s+(\d+)\b/i,
    grade: /\b(PSA|BGS|SGC|CGC|BVG|HGA)\b(?:\s+(?:DNA|GEM MT|GEM MINT|MINT|NM-MT|AUTH(?:ENTIC)?))*(?:\s+(\d+(?:\.\d)?))?/i,
    auto: /\b(auto(?:graph)?s?|autographed|signed|signatures?|sigs?|ink)\b/i,
    relic: /\b(fabrics?|ball hoggs|souvenirs|leather and laces|piece of action|threads|swatch(?:es)?|towels?|laces|socks?|cleats?|relics?|patch(?:es)?|jerseys?|bat|materials?|buttons?|nameplates?|dirt|game[- ]used|glove|logoman|laundry|tag|letter|memorabilia|rpm|footballs)\b/i,
    custom: /\bcustom\b/i,
    rc: /\b(RC|rookie)\b/i,
  };
  function parse(name) {
    const out = { title: name, sub: "", par: "", year: 9999, serial: 0, one: false, grade: "", tags: new Set() };
    const y = name.match(/^(\d{4})/); if (y) out.year = +y[1];
    const s = name.match(RX.serial);
    if (s) {
      const a = +(s[1] || s[3] || s[4] || 0), b = +(s[2] || s[5] || 0);
      out.serial = b || a; out.one = (b ? b === 1 : a === 1) || /\b1\s*of\s*1\b|1\/1/i.test(name);
    }
    const g = name.match(RX.grade); if (g) out.grade = (g[1].toUpperCase() + (g[2] ? " " + g[2] : "")).trim();
    // Names that look like autographs but aren't: the "Signature Rookies" brand (its real autos also say
    // "Autographs" or "Signatures"), "Auto Phonex" phone cards, and Choice Gold/Silver Signature parallels.
    // Collector's Choice (and other "Choice") Gold/Silver Signature parallels carry a printed facsimile, not an autograph.
    let autoName = name.replace(/^(\d{4}(?:-\d{2})?\s+)Signature Rookies\b/i, "$1").replace(/\bauto\s*phonex\b/i, "");
    if (/\bchoice\b/i.test(autoName)) autoName = autoName.replace(/\b(?:gold|silver)\s+signatures?\b/gi, "");
    if (RX.auto.test(autoName)) out.tags.add("auto");
    // Brand names that sound like relics but aren't (Absolute Memorabilia, Certified Materials, Throwback Threads,
    // Alternate Threads, SP Game Used): their real relics also say Materials, Fabric, Jersey, Patch and so on.
    // On photo variations (VAR), "Blue Jersey" or "Logo" describes the picture, not a swatch.
    // A jersey mentioned in a note describes the photo, e.g. "(grabbing Jersey)", so it doesn't count either,
    // nor do picture variations and inserts with relic-sounding names (Missing Nameplate, Hot Button, Glove Stories).
    // Topps Triple Threads and Donruss Threads relics say "Relics", "Materials", "Jersey" and so on.
    let relicName = name.replace(/\([^)]*jersey[^)]*\)/gi, " ")
      .replace(/\b(?:(?:playoff\s+)?absolute\s+memorabilia|(?:leaf\s+)?certified\s+materials|(?:topps\s+)?triple\s+threads|donruss\s+threads|throwback\s+threads|alternate\s+threads|sp\s+game\s+(?:used|bat)(?:\s+(?:patch|edition|milestone))?)\b/gi, "")
      .replace(/\b(?:missing\s+nameplate|hot\s+button|glove\s+stories)\b/gi, "");
    if (/\bVAR\b/.test(relicName)) relicName = relicName.replace(/\b(?:jerseys?|logo)\b/gi, "");
    // Absolute Memorabilia's Tools of the Trade inserts carry swatches; older sets with that name don't.
    if (RX.relic.test(relicName) || /absolute.*tools of the trade/i.test(name)) out.tags.add("relic");
    if (RX.custom.test(name)) out.tags.add("custom");
    if (RX.rc.test(name)) out.tags.add("rc");
    if (out.serial) out.tags.add("numbered");
    if (out.one) out.tags.add("one");
    if (out.grade) out.tags.add("graded");
    const m = name.match(RX.main);
    if (m) {
      let [, yr, set, num, rest] = m;
      let par = "";
      const dash = set.indexOf(" - ");
      if (dash > 0) { par = set.slice(dash + 3); set = set.slice(0, dash); }
      let player = rest.replace(RX.serial, "").replace(RX.grade, "").replace(/\((?:[^)]*)\)/g, "").replace(/\s+(Back|2nd|3rd|\d)$/i, "").replace(/\s{2,}/g, " ").trim();
      out.title = player || rest; out.sub = `${yr} ${set} #${num}`; out.par = par;
    }
    return out;
  }

  // A landscape card (e.g. a horizontal patch auto) gets a landscape frame instead of a tall, mostly empty one.
  window.fitFrame = (im) => { im.classList.add("ok"); if (im.naturalWidth > im.naturalHeight * 1.1) im.parentNode.classList.add("land"); };

  /* ---------- Data ---------- */
  function load(json) {
    DATA = json; SECTIONS = json.sections;
    // Not on the site: sold cards and second/third copies. Customs always stay (numbered customs are separate commissions). scripts/build_catalog.py leaves them out too.
    json.cards = json.cards.filter((c) => !/\bsold\b/i.test(c[2]) && !(/\s\(?(?:2nd|3rd|\d+th)\)?\s*(?:\([^)]*\))?\s*$/i.test(c[2]) && !/\bcustom\b/i.test(c[2])));
    CARDS = json.cards.map((c, i) => {
      const [id, rk, name, si, gi, added, backId, backRk] = c;
      const p = parse(name);
      if (backId) p.tags.add("back");
      // Customs page filters: which kind of custom it is, from the collection it lives in (or "non-sport" in the name).
      if (p.tags.has("custom")) {
        const sl = SECTIONS[si].slug;
        if (/non[- ]?sport/i.test(name + " " + sl)) p.tags.add("nonsport");
        else if (/^husker-/.test(sl)) p.tags.add("huskers");
        else if (["royals", "alex-gordon", "jermaine-dye"].includes(sl)) p.tags.add("royals");
      }
      // Hand corrections from config/site.json "tagFixes", e.g. {"auto": {"add": [card names], "remove": [card names]}}.
      for (const [tag, fix] of Object.entries(json.site.tagFixes || {})) {
        if ((fix.add || []).includes(name)) p.tags.add(tag);
        if ((fix.remove || []).includes(name)) p.tags.delete(tag);
      }
      return { i, id, rk, name, si, gi, added, backId, backRk, ...p, hay: (name + " " + SECTIONS[si].title + " " + SECTIONS[si].groups[gi].label).toLowerCase() };
    });
    // Photos of athletes with my custom cards. The file name is the caption; the part before the first
    // " - " or sentence break is the short label on the strip ("Jr." and similar don't count as a break).
    const caps = (json.site.customsPhotos || {}).captions || {};
    PHOTOS = (json.photos || []).map(([id, rk, name, added]) => {
      const caption = (caps[name] || name).trim();
      const short = caption.split(/\s+[-–—]\s+|(?<!\b(?:Jr|Sr|St|Dr|Mr|Mrs|No|vs|Jan|Feb|Aug|Sept|Oct|Nov|Dec))[.!?]\s+/)[0].replace(/[.!?]$/, "");
      // "Jerald Foster with his custom card" → "Jerald Foster" on the strip; the full caption shows when opened.
      return { photo: true, id, rk, name, added, caption, short: short.replace(/\s+with (?:his|her|their)\b.*$/i, "") || short };
    });
    // A collection's progress comes from its live "Have %" when the robot has published one.
    SECTIONS.forEach((sec) => {
      const have = (INV[sec.slug] || []).find((r) => /^have\s*%$/i.test(r[0]));
      const n = have && parseFloat(String(have[1]).replace(/[^\d.]/g, ""));
      if (n >= 0 && n <= 100) { sec.progress = n; sec.progressText = String(have[1]).trim(); }
    });
    const dates = [...new Set(CARDS.map((c) => c.added))].sort().reverse();
    NEW_CUTOFF = dates[Math.min(dates.length - 1, 1)] || ""; // cards from the two most recent "drops" count as new
    const d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    if (NEW_CUTOFF < d30) NEW_CUTOFF = dates[0];
    $("#q").placeholder = `Search ${fmt(CARDS.length)} scans… try “Triple Threads”`;
    renderNav(); renderFoot(); route();
  }

  /* ---------- Shared bits ---------- */
  // The Customs page has its own filters (all its cards are customs).
  const CUSTOM_FILTERS = [["auto", "Autographs"], ["relic", "Relics & patches"], ["royals", "Royals"], ["huskers", "Huskers"], ["nonsport", "Non-Sport"]];
  const FILTERS = [["auto", "Autographs"], ["relic", "Relics & patches"], ["numbered", "Numbered"], ["one", "1 of 1"], ["graded", "Graded"], ["rc", "Rookies"], ["custom", "Customs"], ["back", "Has back scan"]];
  const SORTS = [["new", "Newest added"], ["old", "Year: oldest first"], ["recent", "Year: newest first"], ["az", "A–Z"], ["serial", "Lowest print run"]];
  const state = { filters: new Set(), sort: "new", list: [], shown: 0, q: "", where: null };

  function sortList(list, how) {
    const by = {
      new: (a, b) => (b.added > a.added ? 1 : b.added < a.added ? -1 : a.i - b.i),
      old: (a, b) => a.year - b.year || a.i - b.i,
      recent: (a, b) => (b.year === 9999 ? 0 : b.year) - (a.year === 9999 ? 0 : a.year) || a.i - b.i,
      az: (a, b) => a.name.localeCompare(b.name),
      serial: (a, b) => (a.serial || 1e9) - (b.serial || 1e9) || a.i - b.i,
    }[how];
    return list.slice().sort(by);
  }
  function hl(text, q) {
    const t = esc(text); if (!q) return t;
    const words = q.split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return words.length ? t.replace(new RegExp(`(${words.map(esc).join("|")})`, "gi"), "<mark>$1</mark>") : t;
  }
  function badges(c) {
    let b = "";
    if (c.added >= NEW_CUTOFF) b += `<span class="bd new">NEW</span>`;
    if (c.one) b += `<span class="bd one">1/1</span>`; else if (c.serial) b += `<span class="bd">/${c.serial}</span>`;
    if (c.tags.has("auto")) b += `<span class="bd auto">AUTO</span>`;
    if (c.grade) b += `<span class="bd">${esc(c.grade)}</span>`;
    if (c.backId) b += `<span class="bd back" title="Front and back">⇆</span>`;
    return b;
  }
  function cardHTML(c, q) {
    return `<button class="cd" type="button" data-i="${c.i}" aria-label="${esc(c.name)}">
      <div class="ph"><img loading="lazy" decoding="async" alt="" src="${img(c.id, c.rk, 400)}" onload="this.classList.add('ok')"><div class="badges">${badges(c)}</div></div>
      <div class="cap"><b>${hl(c.title, q)}</b>${hl(c.sub, q)}${c.par ? `<br><span class="par">${hl(c.par, q)}</span>` : ""}</div></button>`;
  }
  const pctText = (sec) => sec.progressText || sec.progress + "%";
  // The live summary table for a collection, laid out like the Inventory Stats master:
  // a header row, then what's collected, then what's left (from "Left to Collect" on).
  function invBox(slug) {
    const rows = INV[slug]; if (!rows || rows.length < 2) return "";
    const [head, ...body] = rows, cut = body.findIndex((r) => /^left to collect/i.test(r[0]));
    const part = (list, cls) => list.length ? `<tbody class="${cls}">${list.map((r) => `<tr class="${/%$/.test(r[1]) || /^left to collect/i.test(r[0]) ? "key" : ""}"><th>${esc(r[0])}</th><td>${esc(r[1])}</td></tr>`).join("")}</tbody>` : "";
    return `<aside class="inv" aria-label="Collection stats"><table>
      <thead><tr><th>${esc(head[0])}</th><th>${esc(head[1] || "")}</th></tr></thead>
      ${part(cut < 0 ? body : body.slice(0, cut), "got")}${cut < 0 ? "" : part(body.slice(cut), "left")}</table></aside>`;
  }
  function sectionCards(si) { return CARDS.filter((c) => c.si === si); }
  // A section with no scans yet (e.g. a new folder still being filled) stays out of menus and tiles.
  function shown(s) { const si = SECTIONS.indexOf(s); return CARDS.some((c) => c.si === si); }
  /* Fuzzy search: when a word matches nothing, swap in the closest known word (one typo, or two in long words). */
  let VOCAB = null;
  function cardVocab() {
    if (VOCAB) return VOCAB;
    VOCAB = new Map();
    CARDS.forEach((c) => c.hay.split(/[^a-z0-9']+/).forEach((w) => w.length > 2 && !/^\d+$/.test(w) && VOCAB.set(w, (VOCAB.get(w) || 0) + 1)));
    return VOCAB;
  }
  // Edit distance with swapped letters counting as one typo; gives up early once it's over `max`.
  function typoDist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let p2 = null, p = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const r = [i]; let lo = i;
      for (let j = 1; j <= b.length; j++) {
        let v = Math.min(p[j] + 1, r[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (p2 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
        r.push(v); if (v < lo) lo = v;
      }
      if (lo > max) return max + 1;
      p2 = p; p = r;
    }
    return p[b.length];
  }
  function fixQuery(q, vocab, known) {
    let changed = false;
    const out = q.toLowerCase().split(/\s+/).filter(Boolean).map((w) => {
      if (w.length < 4 || /\d/.test(w) || known(w)) return w;
      const max = w.length >= 8 ? 2 : 1;
      let best = null, bd = max + 1, bn = 0;
      vocab.forEach((n, t) => { const d = typoDist(w, t, max); if (d <= max && (d < bd || (d === bd && n > bn))) { best = t; bd = d; bn = n; } });
      if (best) { changed = true; return best; }
      return w;
    });
    return changed ? out.join(" ") : null;
  }
  // Plain-English search: "Gordon autos under /50", "1/1 relics", "Dye rookies 2000s", "Huskers patches before 1990".
  // Kind words, print runs and years become filters; the other words still have to appear in the card.
  const KIND_WORDS = [[/^(autos?|autographs?|autographed|signed|signatures?)$/, "auto", "autographs"], [/^(relics?|patch(es)?|memorabilia|swatch(es)?|game-?used)$/, "relic", "relics"],
    [/^(rookies?|rcs?)$/, "rc", "rookies"], [/^(numbered|serial(ized)?)$/, "numbered", "numbered"], [/^(graded|slabbed|slabs?)$/, "graded", "graded"],
    [/^(customs?)$/, "custom", "customs"], [/^(1\/1s?|one-of-ones?|oneofones?)$/, "one", "1 of 1"]];
  const FILLER = new Set("show me my all the a an of with and cards card i have from in for by on any that are is".split(" "));
  function parseQuery(q) {
    // "=Jermaine Dye": exactly that player's own cards (used by the players ranking, so its counts match).
    if (q.startsWith("=")) { const who = q.slice(1).trim().toLowerCase(); return { words: [], tests: [(x) => plainTitle(x).toLowerCase() === who], said: [`only ${q.slice(1).trim()}`] }; }
    let t = q.toLowerCase().replace(/[“”]/g, '"').replace(/\bone of (one|1)\b|\b1 of 1\b/g, "1/1");
    const tests = [], said = [];
    // Print runs: "under /50", "/25 or less", "numbered to 10 or lower", "less than 100", "below /99"
    t = t.replace(/\b(?:under|below|less than|lower than|up to|at most)\s*\/?\s*(\d+)\b|\/(\d+)\s*(?:or\s*(?:less|lower|under|below))|(?:numbered|#'?d)\s*(?:to\s*)?\/?(\d+)\s*or\s*(?:less|lower)/g, (m, a, b, c) => {
      const n = +(a || b || c), under = /under|below|less than|lower than/.test(m); tests.push((x) => x.serial > 0 && (under ? x.serial < n : x.serial <= n)); said.push(under ? `numbered under /${n}` : `numbered /${n} or lower`); return " "; });
    t = t.replace(/\b(?:over|above|more than|higher than)\s*\/\s*(\d+)\b/g, (m, a) => { tests.push((x) => x.serial > +a); said.push(`numbered over /${a}`); return " "; });
    // Years: "2010s", "1990-1995", "before 1990", "after 2010", "since 2015"
    t = t.replace(/\b((?:19|20)\d)0'?s\b/g, (m, d) => { const a = +d * 10; tests.push((x) => x.year >= a && x.year <= a + 9); said.push(`${a}s`); return " "; });
    t = t.replace(/\b((?:19|20)\d{2})\s*(?:-|–|to)\s*((?:19|20)\d{2})\b/g, (m, a, b) => { tests.push((x) => x.year >= +a && x.year <= +b); said.push(`${a}–${b}`); return " "; });
    t = t.replace(/\b(before|pre|after|since|post)[- ]?((?:19|20)\d{2})\b/g, (m, w, y) => { const before = /before|pre/.test(w);
      tests.push((x) => x.year < 9999 && (before ? x.year < +y : w === "since" ? x.year >= +y : x.year > +y)); said.push(`${w} ${y}`); return " "; });
    const words = [];
    t.split(/\s+/).filter(Boolean).forEach((w) => {
      const k = KIND_WORDS.find(([re]) => re.test(w));
      if (k) { tests.push((x) => x.tags.has(k[1])); said.push(k[2]); }
      else if (/^(19|20)\d{2}$/.test(w)) { tests.push((x) => x.year === +w); said.push(w); }
      else if (/^(huskers?|cornhuskers?|nebraska)$/.test(w)) { tests.push((x) => /nebraska|husker/.test(x.hay)); said.push("Huskers"); }
      else if (!FILLER.has(w)) words.push(w);
    });
    return { words, tests, said: [...new Set(said)] };
  }
  function search(list, q) {
    const { words, tests } = parseQuery(q);
    if (!words.length && !tests.length) return list;
    return list.filter((c) => words.every((w) => c.hay.includes(w)) && tests.every((f) => f(c)));
  }

  /* ---------- Views ---------- */
  // One order everywhere (home tiles, sidebar): Gordon, Dye, the Nebraska sections, Customs,
  // the other collections, Detroit Lions last. "customs" stands for the Customs page.
  const LAST = ["lions"];
  function siteOrder() {
    const secs = SECTIONS.filter(shown), other = secs.filter((s) => !isNeb(s));
    const lead = other.filter((s) => !LAST.includes(s.slug)).slice(0, 2);
    return [...lead, ...secs.filter(isNeb), "customs", ...other.filter((s) => !lead.includes(s) && !LAST.includes(s.slug)), ...other.filter((s) => LAST.includes(s.slug))];
  }
  // Nebraska sections and the Husker autograph pages share one "Nebraska Cornhuskers" dropdown.
  const isNeb = (s) => /^husker-/.test(s.slug);
  function renderNav() {
    const neb = SECTIONS.filter((s) => shown(s) && isNeb(s));
    // Menu order: Alex Gordon, Jermaine Dye, Nebraska Cornhuskers ▾, Customs, the other collections, Detroit Lions last.
    const links = siteOrder().filter((s) => s === "customs" || !isNeb(s))
      .map((s) => s === "customs" ? `<a href="#/customs" data-s="customs">Customs</a>` : `<a href="#/c/${s.slug}" data-s="${s.slug}">${esc(s.title)}</a>`);
    if ((DATA.site.media?.items || []).length) links.push(`<a href="#/media" data-s="media">Media</a>`);
    links.splice(2, 0, `<button type="button" class="dd-btn" id="dd-btn" aria-expanded="false" aria-controls="dd-menu">Nebraska Cornhuskers <span aria-hidden="true">▾</span></button>`);
    $("#nav").innerHTML = links.join("");
    document.body.insertAdjacentHTML("beforeend", `<div class="dd-menu" id="dd-menu" hidden>${neb.map((s) => `<a href="#/c/${s.slug}" data-s="${s.slug}">${esc(s.title)}</a>`).join("")}</div>`);
    $("#dd-btn").addEventListener("click", (e) => { e.stopPropagation(); $("#dd-menu").hidden ? openDD() : closeDD(); });
    // The autograph pages appear once the checklist data has been published.
    fetch("data/lists/husker-pros.json", { method: "HEAD" }).then((r) => {
      if (!r.ok || $('#dd-menu a[href="#/checklist"]')) return;
      $("#dd-menu").insertAdjacentHTML("beforeend", `${CK_PAGES.map((x, k) => `<a href="#/checklist${x.path}" data-s="checklist${x.path}"${k === 0 ? ' class="sep"' : ""}>${x.label}</a>`).join("")}
        <a href="#/nfl-huskers" data-s="nfl-huskers" class="sep">NFL Huskers Player Pages</a>
        <a href="#/nfl-teams" data-s="nfl-teams">Huskers by NFL Team</a>`);
      setNav(NAV_NOW);
    }).catch(() => {});
  }
  function openDD() {
    const b = $("#dd-btn").getBoundingClientRect(), m = $("#dd-menu");
    m.hidden = false;
    const w = m.offsetWidth;
    m.style.top = b.bottom + 6 + "px";
    m.style.left = Math.max(12, Math.min(b.left, innerWidth - w - 12)) + "px";
    $("#dd-btn").setAttribute("aria-expanded", "true");
  }
  function closeDD() {
    const m = $("#dd-menu"); if (!m || m.hidden) return;
    m.hidden = true; $("#dd-btn").setAttribute("aria-expanded", "false");
  }
  document.addEventListener("click", (e) => { if (!e.target.closest("#dd-menu")) closeDD(); else if (e.target.closest("a")) closeDD(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#dd-menu") && !$("#dd-menu").hidden) { closeDD(); $("#dd-btn").focus(); } });
  addEventListener("scroll", closeDD, { passive: true }); addEventListener("resize", closeDD);
  $("#nav").addEventListener("scroll", closeDD, { passive: true });
  function renderFoot() {
    const s = DATA.site;
    $("#foot").innerHTML = `<div class="wrap"><span>Trades, questions, or a card I need? ${gform() ? `<button type="button" class="linkish" data-form data-item="" data-body="">Send me a message</button> · ` : ""}<button type="button" class="linkish" data-mail data-subject="Hello from IanBadeer.com">Email me</button> · <button type="button" class="linkish" data-copymail>Copy my address</button></span><span>${fmt(CARDS.length)} scans · updated ${esc(DATA.generated.slice(0, 10))} · All scans © Ian Badeer. Please ask before reusing them.</span></div>`;
  }
  // Each page gets its own browser-tab title, so tabs, bookmarks and shared links say where they go.
  function setTitle(t) { document.title = t ? `${t} · IanBadeer.com` : "IanBadeer.com"; }
  let NAV_NOW = null;
  function setNav(slug) {
    NAV_NOW = slug;
    document.querySelectorAll("#nav a, #dd-menu a").forEach((a) => (a.dataset.s === slug ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    const dd = $("#dd-btn"); if (dd) dd.classList.toggle("on", !!$("#dd-menu a[aria-current]"));
  }

  /* ---------- Contact: my address is only put together when someone clicks, so scrapers can't read it ---------- */
  const myEmail = () => { const c = DATA.site.contact || {}; try { return c.code ? atob(c.code).split("").reverse().join("") : ""; } catch (e) { return ""; } };
  // An email button (opens the visitor's mail app with the subject and message filled in), plus a fallback
  // for people without a mail app: copy my address, or the Google Form when one is set up.
  // A Google Form, filled in from a form on this page, delivers messages to me (config: contact.googleForm =
  // {"id": "<form id from its link>", "fields": {"name": "entry…", "email": "entry…", "item": "entry…", "message": "entry…"}}).
  const gform = () => { const g = (DATA.site.contact || {}).googleForm || {}; return g.id && g.fields && g.fields.email && g.fields.message ? g : null; };
  // A contact button: opens the form on this page when it's set up, otherwise the visitor's email app.
  // Underneath, the other ways to reach me.
  function contactHTML(label, subject, body, item) {
    const data = `data-subject="${esc(subject)}" data-body="${esc(body)}" data-item="${esc(item || "")}"`;
    if (gform()) return `<div class="cta"><button type="button" class="btn have-btn" data-form ${data}>✉ ${esc(label)}</button>
      <small class="cta-alt">Prefer email? <button type="button" class="linkish" data-mail ${data}>Email me</button> · <button type="button" class="linkish" data-copymail>Copy my address</button></small></div>`;
    return `<div class="cta"><button type="button" class="btn have-btn" data-mail ${data}>✉ ${esc(label)}</button>
      <small class="cta-alt">No email app? <button type="button" class="linkish" data-copymail>Copy my address</button></small></div>`;
  }
  function openForm(item, body) {
    const g = gform(); if (!g) return;
    let dlg = $("#cform");
    if (!dlg) {
      document.body.insertAdjacentHTML("beforeend", `<dialog id="cform" class="cform" aria-labelledby="cform-h">
        <form method="dialog" novalidate>
          <div class="cf-top"><h2 id="cform-h">Send me a message</h2><button type="button" class="cf-x" aria-label="Close">✕</button></div>
          <label>Your name<input name="name" autocomplete="name" required></label>
          <label>Your email<input name="email" type="email" autocomplete="email" required></label>
          <label>Card or player<input name="about"></label>
          <label>Message<textarea name="message" rows="5" required></textarea></label>
          <label class="cf-hp" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label>
          <p class="cf-err" hidden></p>
          <div class="cf-go"><button type="submit" class="btn have-btn">Send</button><small>I'll reply by email.</small></div>
        </form>
        <div class="cf-done" hidden><h2>Thanks!</h2><p>Your message is on its way. I'll reply by email.</p><button type="button" class="btn cf-x">Close</button></div>
      </dialog>`);
      dlg = $("#cform");
      dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest(".cf-x")) dlg.close(); });
      dlg.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.target, err = f.querySelector(".cf-err"), v = (n) => f.elements.namedItem(n).value.trim();
        if (v("website")) { dlg.querySelector(".cf-done").hidden = false; f.hidden = true; return; }   // a bot filled the trap field
        if (!v("name") || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v("email")) || !v("message")) {
          err.textContent = "Please add your name, a valid email address and a message."; err.hidden = false; return;
        }
        const g2 = gform(), fd = new FormData();
        // With no separate card/player question on the Google Form, the card or player goes at the top of the message.
        const msg = !g2.fields.item && v("about") ? `About: ${v("about")}\n\n${v("message")}` : v("message");
        [["name", v("name")], ["email", v("email")], ["item", v("about")], ["message", msg]].forEach(([k, val]) => g2.fields[k] && fd.append(g2.fields[k], val));
        f.querySelector("[type=submit]").disabled = true;
        try {
          // Google Forms doesn't let other sites read its reply, so a request that goes through counts as sent.
          await fetch(`https://docs.google.com/forms/d/e/${encodeURIComponent(g2.id)}/formResponse`, { method: "POST", mode: "no-cors", body: fd });
          f.hidden = true; dlg.querySelector(".cf-done").hidden = false;
        } catch (x) {
          err.textContent = "That didn't send. Check your connection, or use “Email me” instead."; err.hidden = false;
        } finally { f.querySelector("[type=submit]").disabled = false; }
      });
    }
    const f = dlg.querySelector("form");
    f.reset(); f.hidden = false; f.querySelector(".cf-err").hidden = true; dlg.querySelector(".cf-done").hidden = true;
    f.elements.namedItem("about").value = item || ""; f.elements.message.value = body ? body.replace(/^Hi Ian,\s*/, "") : "";
    dlg.showModal(); f.elements.name.focus();
  }
  document.addEventListener("click", async (e) => {
    const fb = e.target.closest("[data-form]");
    if (fb) { openForm(fb.dataset.item, fb.dataset.body); return; }
    const m = e.target.closest("[data-mail]");
    if (m) { location.href = `mailto:${myEmail()}?subject=${encodeURIComponent(m.dataset.subject || m.dataset.mail || "")}&body=${encodeURIComponent(m.dataset.body || "")}`; return; }
    const cp = e.target.closest("[data-copymail]"); if (!cp) return;
    const a = myEmail();
    try { await navigator.clipboard.writeText(a); cp.textContent = `Copied ${a}`; } catch (err) { cp.textContent = a; }
  });

  // Home: three quick paths for different visitors, and the Jermaine Dye career story.
  function startHere() {
    const dye = SECTIONS.find((x) => x.slug === "jermaine-dye"), st = DATA.site.dyeStory;
    const go = (h, t) => `<a href="${h}">${t} →</a>`;
    const col = (slug, t) => SECTIONS.some((x) => x.slug === slug) ? go(`#/c/${slug}`, t) : "";
    const pick = (part) => CARDS.find((c) => dye && c.si === SECTIONS.indexOf(dye) && c.name.toLowerCase().includes(part.toLowerCase()));
    const story = st && dye ? (st.highlights || []).map((h) => pick(h.card)).filter(Boolean).slice(0, 3) : [];
    return `<section class="start" aria-label="Start here">
      <div class="go-card"><h3>Royals fans</h3><p>Check out the Gordon and Dye Super Collections, or the Kansas City Royals Team Collection.</p>
        <div class="go-links">${col("alex-gordon", "Alex Gordon")}${col("jermaine-dye", "Jermaine Dye")}${col("royals", "Kansas City Royals")}</div></div>
      <div class="go-card"><h3>Husker fans</h3><p>Dig into the history of NFL Huskers, check out the autographs, and see an epic Husker card collection.</p>
        <div class="go-links">${go("#/checklist", "NFL Huskers autograph list")}${go("#/nfl-huskers", "Player pages")}${col("husker-football", "Nebraska Football cards")}</div></div>
      <div class="go-card"><h3>Collectors &amp; traders</h3><p>Interviews, my TCDb how-to videos, and the cards I'm still hunting.</p>
        <div class="go-links">${(DATA.site.media?.items || []).length ? go("#/media", "Media &amp; interviews") : ""}${col("want-list", "Want List")}${go("https://www.tcdb.com/Profile.cfm/DyeHardFan", "Trade with me on TCDb").replace("→", "↗").replace("<a ", '<a target="_blank" rel="noopener" ')}</div></div>
      ${story.length ? `<a class="go-story" href="#/dye-career"><div class="go-fan">${story.map((c) => `<img loading="lazy" alt="" src="${img(c.id, c.rk, 240)}">`).join("")}</div>
        <div><span class="kick">Featured story</span><h3>${esc(st.title)}</h3><p>Jermaine's career from the Braves to World Series MVP, told through the best cards in my collection.</p><span class="go-more">Read the story →</span></div></a>` : ""}
    </section>`;
  }

  function home() {
    setNav(null); setTitle("");
    const s = DATA.site;
    const feat = CARDS.find((c) => s.featured && c.name.includes(s.featured.match)) || CARDS.find((c) => c.one);
    const newest = sortList(CARDS, "new").slice(0, 40);
    const ones = CARDS.filter((c) => c.one).length;
    const tiles = siteOrder().map((sec) => {
      if (sec === "customs") return customsTile();
      const si = SECTIONS.indexOf(sec);
      const list = sectionCards(si);
      const pick = [...list.filter((c) => c.one || c.tags.has("relic")), ...list].filter((c, k, a) => a.indexOf(c) === k);
      const step = Math.max(1, Math.floor(pick.length / 4));
      const four = [0, 1, 2, 3].map((k) => pick[k * step]).filter(Boolean);
      return `<a class="tile c-${sec.color}" href="#/c/${sec.slug}">
        <div class="fan">${four.map((c) => `<img loading="lazy" alt="" src="${img(c.id, c.rk, 240)}">`).join("")}</div>
        <h3>${esc(sec.title)}</h3>
        ${sec.progress ? `<div class="bar"><i style="width:${sec.progress}%"></i></div>` : ""}
        <div class="tm"><span>${fmt(list.length)} scans</span><span>${sec.progress ? pctText(sec) + " complete" : sec.groups.length > 1 ? sec.groups.length + " groups" : ""}</span></div></a>`;
    }).join("");
    function customsTile() {   // Customs isn't a Drive section (cards are tagged custom), so it gets its own tile
      const list = CARDS.filter((c) => c.tags.has("custom")); if (!list.length) return "";
      const step = Math.max(1, Math.floor(list.length / 4)), four = [0, 1, 2, 3].map((k) => list[k * step]).filter(Boolean);
      return `<a class="tile c-gold" href="#/customs"><div class="fan">${four.map((c) => `<img loading="lazy" alt="" src="${img(c.id, c.rk, 240)}">`).join("")}</div>
        <h3>Custom Cards</h3><div class="tm"><span>${fmt(list.length)} scans</span><span>${PHOTOS.length ? PHOTOS.length + " photos with players" : ""}</span></div></a>`;
    }
    $("#app").innerHTML = `<div class="wrap">
      <section class="hero">
        <div>
          <div class="kick">The collection of Ian Badeer</div>
          <h1><span class="nw">Alex Gordon</span> &amp; <span class="nw">Jermaine Dye</span> <em class="nw">super collector</em></h1>
          <p>${esc(s.intro).replace("a Husker autograph I need", `<a class="inl" href="#/checklist">a Husker autograph I need</a>`)}</p>
          <div class="pills">${(() => { const f = (s.media?.items || []).find((it) => it.featured) || (s.media?.items || [])[0];
            return f ? `<a class="pill pill-feat" href="${esc(f.url)}" target="_blank" rel="noopener"><b>Featured:</b> ${esc(f.title)} ↗</a><a class="pill pill-in" href="#/media">All media &amp; interviews →</a>` : ""; })()}${s.links.map((l) => `<a class="pill" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join("")}</div>
        </div>
        ${feat ? `<button class="feat cd" type="button" data-i="${feat.i}"><div class="ph"><img alt="${esc(feat.name)}" src="${img(feat.id, feat.rk, 600)}" srcset="${img(feat.id, feat.rk, 400)} 400w, ${img(feat.id, feat.rk, 600)} 600w, ${img(feat.id, feat.rk, 800)} 800w" sizes="(max-width: 800px) 200px, 320px" onload="fitFrame(this)"></div><small>${esc(s.featured?.caption || feat.name)}</small></button>` : ""}
      </section>
      <section class="stats" aria-label="Collection stats">
        <div class="stat"><b>${fmt(CARDS.length)}</b><span>cards scanned</span></div>
        <div class="stat"><b>${fmt(ones)}</b><span>one-of-ones</span></div>
        <a class="stat link" href="#/stats"><b>📊</b><span>Scanned Collection Stats →</span></a>
        ${SECTIONS.filter((x) => x.progress).map((x) => `<a class="stat link" href="#/c/${x.slug}"><b>${pctText(x)}</b><span>${esc(x.title)} Chase →</span></a>`).join("")}
        <a class="stat link" id="stat-nfl" href="#/checklist" hidden><b></b><span>NFL Husker Chase →</span></a>
      </section>
      ${startHere()}
      <div class="band">
      <div class="sec-h"><h2>Newest additions</h2><a href="#/all">Browse everything →</a></div>
      <section class="mq" aria-label="Newest additions">
        <div class="mq-track" style="--dur:${newest.length * 4}s">${newest.map((c) => cardHTML(c)).join("")}<div class="mq-dup" aria-hidden="true">${newest.map((c) => cardHTML(c)).join("")}</div></div>
      </section>
      </div>
      <div class="sec-h"><h2>Collections</h2></div>
      <section class="tiles" style="margin-bottom:64px">${tiles}</section>
    </div>`;
    // The copy only exists so the loop looks seamless; keep it out of keyboard tab order.
    document.querySelectorAll(".mq-dup .cd").forEach((b) => (b.tabIndex = -1));
    state.list = newest;
    // Live from the checklist: share of NFL Huskers whose autograph is in the collection.
    loadCheckQuiet().then(() => {
      const t = allPlayers().filter((p) => p.listSlug === "nfl-tier-1-huskers"), el = $("#stat-nfl");
      if (!el || !t.length) return;
      el.querySelector("b").textContent = ((t.filter((p) => p.have).length / t.length) * 100).toFixed(2) + "%"; el.hidden = false;
    }).catch(() => {});
  }

  function collection(slug, gslug) {
    const virtual = slug === "customs" || slug === "all" || slug === "search";
    const si = SECTIONS.findIndex((x) => x.slug === slug);
    const sec = virtual ? null : SECTIONS[si];
    if (!virtual && !sec) return notFound();
    setNav(slug);
    let base, title, kick, blurb = "", groups = [], gi = -1, color = "royal", prog = "";
    if (sec) {
      base = sectionCards(si); title = sec.title; color = sec.color; blurb = sec.blurb || "";
      kick = { pc: "Player collection", chase: "Autograph chase", team: "Team collection", want: "Still hunting" }[sec.kind] || "Collection";
      groups = sec.groups;
      gi = groups.findIndex((g) => g.slug === gslug);
      if (gi >= 0) base = base.filter((c) => c.gi === gi);
      if (sec.progress) prog = `<div class="prog"><b>${pctText(sec)}</b><div class="bar"><i style="width:${sec.progress}%"></i></div><small>${esc(sec.progressLabel || "complete")}</small></div>`;
      // Links to pages on this site open in place (→); outside links open a new tab (↗).
      blurb = esc(blurb) + (sec.extraLinks || []).map((l) => l.url.startsWith("#")
        ? ` <a href="${esc(l.url)}" style="color:var(--acc)">${esc(l.label)} →</a>`
        : ` <a href="${esc(l.url)}" target="_blank" rel="noopener" style="color:var(--acc)">${esc(l.label)} ↗</a>`).join(" ·");
    } else if (slug === "customs") {
      base = CARDS.filter((c) => c.tags.has("custom")); title = "Custom Cards"; kick = "Made by hand"; color = "gold";
      blurb = "Custom cards are a labor of love. I make mini cardboard treasures for myself, for friends, and as keepsakes for the athletes themselves.";
    } else {
      base = CARDS; title = state.q ? (state.q.startsWith("=") ? `${esc(state.q.slice(1))}’s cards` : `Results for “${esc(state.q)}”`) : "Every card"; kick = "Whole collection";
    }
    setTitle(slug === "search" ? `Search: ${state.q}` : slug === "all" ? "Every card" : (sec ? sec.title : title) + (gi >= 0 ? ` (${groups[gi].label})` : ""));
    const side = groups.length > 1 ? `<div><h4>${esc(sec.title)}</h4><ul>
        <li><a href="#/c/${slug}" aria-current="${gi < 0}"><em style="font-style:normal">All</em><span>${fmt(sectionCards(si).length)}</span></a></li>
        ${groups.map((g, k) => `<li><a href="#/c/${slug}/${g.slug}" aria-current="${k === gi}">${esc(g.label)}<span>${fmt(g.count)}</span></a></li>`).join("")}</ul></div>` : "";
    const others = `<div><h4>Collections</h4><ul>${siteOrder().map((x) => x === "customs"
        ? `<li><a href="#/customs" aria-current="${slug === "customs"}">Customs<span>${fmt(CARDS.filter((c) => c.tags.has("custom")).length)}</span></a></li>`
        : `<li><a href="#/c/${x.slug}" aria-current="${x.slug === slug}">${esc(x.title)}<span>${fmt(sectionCards(SECTIONS.indexOf(x)).length)}</span></a></li>`).join("")}</ul></div>`;
    const mg = groups.length > 1 ? `<nav class="mgroups" aria-label="Groups"><a href="#/c/${slug}" aria-current="${gi < 0}">All</a>${groups.map((g, k) => `<a href="#/c/${slug}/${g.slug}" aria-current="${k === gi}">${esc(g.label)}</a>`).join("")}</nav>` : "";
    // A search that finds nothing tries fixing misspelled words ("gordan" → "gordon").
    let q = state.q, fixed = null;
    if (slug === "search" && q && !search(base, q).length) { const f = fixQuery(q, cardVocab(), (w) => CARDS.some((c) => c.hay.includes(w))); if (f && search(base, f).length) q = fixed = f; }
    state.hq = q;
    if (fixed) title = `Results for “${esc(fixed)}”`;
    $("#app").innerHTML = `<div class="wrap coll c-${color}">
      <aside class="side">${side}${others}</aside>
      <div style="min-width:0">
        <div class="c-top${sec && invBox(sec.slug) ? " with-inv" : ""}"><div class="c-head"><div class="kick">${kick}${gi >= 0 ? " · " + esc(groups[gi].label) : ""}</div><h1>${title}</h1>${blurb ? `<p>${blurb}</p>` : ""}${prog}</div>${sec ? invBox(sec.slug) : ""}</div>
        ${mg}
        ${slug === "search" && parseQuery(q).said.length ? `<p class="fixnote smart">Showing ${parseQuery(q).words.length ? `<b>${esc(parseQuery(q).words.join(" "))}</b> · ` : ""}${parseQuery(q).said.map((x) => `<span class="sq">${esc(x)}</span>`).join(" ")}</p>` : ""}
        ${fixed ? `<p class="fixnote">Nothing matched “${esc(state.q)}”, so these are results for <b>${esc(fixed)}</b>.</p>` : ""}
        ${slug === "search" ? `<div id="pmatch"></div>` : ""}
        ${slug === "customs" ? withPlayers() : ""}
        <div class="tools">
          <div class="chips" role="group" aria-label="Filters">${(slug === "customs" ? CUSTOM_FILTERS : FILTERS).map(([k, l]) => `<button type="button" class="chip" data-f="${k}" aria-pressed="${state.filters.has(k)}">${l}</button>`).join("")}</div>
          <div class="tools-r">${binderBtn()}<span class="count" id="count"></span><label class="sr" for="sort">Sort</label><select id="sort">${SORTS.map(([k, l]) => `<option value="${k}"${state.sort === k ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        </div>
        <div class="grid" id="grid"></div><div class="sentinel" id="sentinel"></div>
      </div></div>`;
    const apply = () => {
      let list = search(base, q);
      state.filters.forEach((f) => (list = list.filter((c) => c.tags.has(f))));
      state.list = sortList(list, state.sort); state.shown = 0;
      $("#grid").innerHTML = state.list.length ? "" : `<p class="empty">${slug === "customs" && state.filters.has("nonsport") ? "Non-sport customs, like my Sonic the Hedgehog cards, are coming soon." : state.filters.size ? "No cards match. Try removing a filter or a search word." : `No cards match “${esc(state.q)}”. Try a player (Alex Gordon), a set (Triple Threads) or a year (2013).`}</p>`;
      $("#count").textContent = `${fmt(state.list.length)} scan${state.list.length === 1 ? "" : "s"}`;
      more();
    };
    $(".chips").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      state.filters.has(b.dataset.f) ? state.filters.delete(b.dataset.f) : state.filters.add(b.dataset.f);
      b.setAttribute("aria-pressed", state.filters.has(b.dataset.f)); apply(); syncURL();
    });
    $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; apply(); syncURL(); });
    apply();
    if (state.filters.size || state.sort !== "new") syncURL();
    io.observe($("#sentinel"));
    if (slug === "search") playerMatches(q, state.q);
  }
  // Searching a name also offers that player's NFL Huskers page.
  function playerMatches(q, asked = q) {
    if (norm(q).length < 3) return;
    loadCheckQuiet().then(() => {
      const box = $("#pmatch"); if (!box || state.q !== asked) return;
      const find = (t) => { const words = norm(t).split(" ").filter(Boolean);
        return allPlayers().filter((p) => { const h = " " + norm(p.name) + " " + p.name.toLowerCase() + " "; return words.every((w) => h.includes(w)); }).slice(0, 8); };
      let hits = find(q);
      if (!hits.length) {   // a misspelled name ("ricky simons") still finds the player page
        const names = allPlayers().map((p) => norm(p.name)), V = new Map();
        names.forEach((n) => n.split(" ").forEach((w) => w.length > 2 && V.set(w, (V.get(w) || 0) + 1)));
        const f = fixQuery(norm(q), V, (w) => names.some((n) => n.includes(w)));
        if (f) hits = find(f);
      }
      if (!hits.length) return;
      box.innerHTML = `<div class="pmatch"><h4>Player pages</h4><div class="pm-list">${hits.map((p) => {
        const sc = p.have ? bestScan(p.name, p.sport) : null;
        return `<a class="pm" href="#/player/${p.slug}"><span class="pm-ph">${sc ? `<img alt="" loading="lazy" src="${img(sc.id, sc.rk, 160)}" onload="this.classList.add('ok')">` : ""}</span>
          <span class="pm-t"><b>${hl(p.name, q)}${hofMarks(p)}</b><small>${p.league} Husker${p.year ? ` · Nebraska through ${esc(p.year)}` : ""}</small></span><span class="pm-go">→</span></a>`;
      }).join("")}</div></div>`;
    }).catch(() => {});
  }
  // Customs page: a slowly rotating strip of photos with the players, then the videos.
  function withPlayers() {
    const cfg = DATA.site.customsPhotos || {}, vids = (cfg.videos || []).filter((v) => v.id);
    const tile = (p, k) => `<button type="button" class="ph-tile" data-photo="${k}" aria-label="${esc(p.caption)}">
      <img loading="lazy" decoding="async" alt="" src="${img(p.id, p.rk, 700)}" onload="this.classList.add('ok')"><span><em>${esc(p.short)}</em></span></button>`;
    const strip = PHOTOS.length ? `<h2 class="sub-h">With the players</h2>
      <section class="mq photos" aria-label="Photos with the players"><div class="mq-track" style="--dur:${Math.max(40, PHOTOS.length * 9)}s">
        ${PHOTOS.map(tile).join("")}<div class="mq-dup" aria-hidden="true">${PHOTOS.map(tile).join("")}</div></div></section>` : "";
    const videos = vids.length ? `<div class="vids">${vids.map((v) => `<figure class="vid">
        <div class="vid-frame"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}${v.start ? `?start=${+v.start}` : ""}" title="${esc(v.caption || "Video")}" loading="lazy"
          referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>
        ${v.caption ? `<figcaption>${esc(v.caption)}</figcaption>` : ""}</figure>`).join("")}</div>` : "";
    return strip || videos ? `<div class="players">${strip}${videos}<h2 class="sub-h">The cards</h2></div>` : "";
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-photo]"); if (!b) return;
    openViewer(+b.dataset.photo, PHOTOS);
  });
  function more() {
    const grid = $("#grid"); if (!grid) return;
    const next = state.list.slice(state.shown, state.shown + 72);
    grid.insertAdjacentHTML("beforeend", next.map((c) => cardHTML(c, state.hq ?? state.q)).join(""));
    state.shown += next.length;
  }
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && state.shown < state.list.length && more()), { rootMargin: "1200px" });

  /* ---------- Husker checklist (from the private master, published columns only) ---------- */
  let CHECK = null;
  const CK = { list: 0, q: "", show: "all" };
  const norm = (t) => String(t).toLowerCase().replace(/"[^"]*"/g, " ").replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  // A player's scans come only from their own sport's Nebraska section, so two Huskers with the
  // same name in different sports (e.g. Eric Johnson, football and basketball) never share cards.
  const scanIndex = {};
  const SPORT_OF_LIST = { "nfl-tier-1-huskers": "football", "nfl-tier-2-huskers": "football", "pro-football-huskers": "football", "baseball-mlb": "baseball", "basketball-nba": "basketball" };
  function scansFor(name, sport = "football") {
    if (!scanIndex[sport]) {
      const si = SECTIONS.findIndex((s) => s.slug === "husker-" + sport);
      scanIndex[sport] = si < 0 ? [] : CARDS.filter((c) => c.si === si).map((c) => [" " + norm(c.name) + " ", c]);
    }
    const n = norm(name); if (n.split(" ").length < 2) return [];
    return scanIndex[sport].filter(([t]) => t.includes(" " + n + " ")).map(([, c]) => c);
  }
  // One page per published list. #/checklist (no suffix) stays the NFL page so old links keep working.
  const CK_PAGES = [
    { path: "", slug: "nfl-tier-1-huskers", label: "NFL Tier 1 Huskers Autograph List", blurb: "One autograph of every Husker who played in at least one NFL game." },
    { path: "/tier-2", slug: "nfl-tier-2-huskers", label: "NFL Tier 2 Huskers Autograph List", blurb: "One autograph of every Husker who made an NFL active roster, preseason roster, injured reserve or practice squad without playing in a game." },
    { path: "/tier-3", slug: "pro-football-huskers", label: "NFL Tier 3 Huskers Autograph List", blurb: "One autograph of every Husker who was drafted by, went to camp with or tried out for an NFL team, or played in another pro league." },
    { path: "/mlb", slug: "baseball-mlb", label: "MLB Huskers Autograph List", blurb: "One autograph of every Husker who played in the major leagues." },
    { path: "/nba", slug: "basketball-nba", label: "NBA Huskers Autograph List", blurb: "One autograph of every Husker who played in the NBA." },
  ];
  function checklist(which) {
    const page = CK_PAGES.find((x) => x.path === (which ? "/" + which : "")) || CK_PAGES[0];
    setNav("checklist" + page.path); setTitle(page.label);
    if (!CHECK) {
      $("#app").innerHTML = `<p class="loading">Loading the checklist…</p>`;
      fetch("data/lists/husker-pros.json").then((r) => { if (!r.ok) throw 0; return r.json(); })
        .then((d) => { CHECK = d; checklist(which); })
        .catch(() => ($("#app").innerHTML = `<p class="empty">The checklist isn't available yet.</p>`));
      return;
    }
    CK.list = CHECK.lists.findIndex((x) => x.slug === page.slug);
    if (CK.list < 0) return ($("#app").innerHTML = `<p class="empty">This list isn't available yet.</p>`);
    if (CK.page !== page.path) { CK.page = page.path; CK.q = ""; CK.show = "all"; }
    const l = CHECK.lists[CK.list], ai = l.columns.indexOf("Autograph"), si = l.columns.indexOf("Signed");
    let n = 0, y = 0; const types = {};
    l.groups.forEach((g) => g.rows.forEach((r) => { n++; if (r[ai] === "Yes") y++; if (si >= 0 && r[si]) types[r[si]] = (types[r[si]] || 0) + 1; }));
    const pct = n ? (y / n) * 100 : 0;
    const typeRows = Object.entries(types).sort((a, b) => b[1] - a[1]);
    const tmax = typeRows.length ? typeRows[0][1] : 1;
    // Each autograph list: three autographed cards from players on the list, picked at random each visit.
    const sport = SPORT_OF_LIST[l.slug], showcase = [];
    {
      var pool = l.groups.flatMap((g) => g.rows).filter((r) => r[ai] === "Yes")
        .map((r) => scansFor(r[0], sport).filter((c) => c.tags.has("auto") && !/\(back\)/i.test(c.name))).filter((x) => x.length);
      const rest = pool.slice();
      while (showcase.length < 3 && rest.length) { const k = Math.floor(Math.random() * rest.length), list = rest.splice(k, 1)[0]; showcase.push(list[Math.floor(Math.random() * list.length)]); }
    }
    $("#app").innerHTML = `<div class="wrap ck c-husker">
      <div class="${showcase.length ? "ck-top" : ""}"><div class="c-head">
        <div class="kick">Autograph checklist · updated from my collection spreadsheet</div>
        <h1>${esc(page.label)}</h1>
        ${page.path === "" && DATA.site.nflListStory ? `<div class="story short">${DATA.site.nflListStory.map((t) => `<p>${esc(t)}</p>`).join("")}<button type="button" class="story-more" onclick="this.parentNode.classList.remove('short')">Read the full story</button></div>` : ""}
        <p>${esc(page.blurb)} Green means it's in my collection. If you can help with anyone marked <b>Need</b>, I'd love to hear from you.</p>
        <div class="prog"><b>${pct.toFixed(2)}%</b><div class="bar"><i style="width:${pct}%"></i></div><small>${fmt(y)} of ${fmt(n)} signed</small></div>
      </div>${showcase.length ? `<div class="ck-fan" aria-label="Autographs from this list">${showcase.map((c) => `<button type="button" class="cd" data-i="${c.i}" aria-label="${esc(c.name)}">
        <img alt="" src="${img(c.id, c.rk, 400)}" onload="this.classList.add('ok')"></button>`).join("")}</div>` : ""}</div>
      ${{ "nfl-tier-1-huskers": "tier-1", "nfl-tier-2-huskers": "tier-2", "pro-football-huskers": "tier-3" }[page.slug]
        ? `<p class="ck-plain"><a href="nfl-huskers/${{ "nfl-tier-1-huskers": "tier-1", "nfl-tier-2-huskers": "tier-2", "pro-football-huskers": "tier-3" }[page.slug]}.html">Plain version of this list to share or cite →</a></p>` : ""}
      <nav class="ck-others" aria-label="Other autograph lists">${CK_PAGES.filter((x) => x !== page && CHECK.lists.some((m) => m.slug === x.slug)).map((x) => `<a href="#/checklist${x.path}">${esc(x.label)} →</a>`).join("")}</nav>
      <div class="ck-body${typeRows.length ? "" : " solo"}">
        <div style="min-width:0">
          <div class="tools">
            <div class="chips" role="group" aria-label="Show">${[["all", "Everyone"], ["have", "Have"], ["need", "Need"]].map(([k, t]) => `<button type="button" class="chip" data-show="${k}" aria-pressed="${CK.show === k}">${t}</button>`).join("")}</div>
            <div class="tools-r"><label class="sr" for="ck-q">Search this list</label><input id="ck-q" class="ck-q" type="search" placeholder="Find a player" value="${esc(CK.q)}"><span class="count" id="ck-count"></span></div>
          </div>
          <div class="ck-table" id="ck-table"></div>
        </div>
        ${typeRows.length ? `<aside class="ck-side"><h4>What they signed</h4>${typeRows.map(([t, c]) => `<div class="ty"><span>${esc(t)}</span><span class="tn">${fmt(c)}</span><div class="bar"><i style="width:${(c / tmax) * 100}%"></i></div></div>`).join("")}</aside>` : ""}
      </div></div>`;
    $(".ck .chips").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; CK.show = b.dataset.show; document.querySelectorAll(".ck .chip").forEach((x) => x.setAttribute("aria-pressed", x === b)); table(); });
    $("#ck-q").addEventListener("input", (e) => { CK.q = e.target.value.trim(); table(); });
    state.list = showcase;
    if (showcase.length === 3 && pool.length > 3) cycleFan(pool, showcase);
    table();
  }
  // Every 5 seconds one of the three cards fades out and a different player's autograph fades in,
  // taking turns left to right. Pauses under the mouse, in a background tab, and for reduced motion.
  let fanTimer = null;
  function cycleFan(pool, shown) {
    clearInterval(fanTimer);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const fan = $(".ck-fan"); let slot = 0, busy = false;
    fanTimer = setInterval(() => {
      if (!document.body.contains(fan)) return clearInterval(fanTimer);
      if (busy || document.hidden || fan.matches(":hover") || !$("#viewer").hidden) return;
      const others = pool.filter((list) => !shown.some((c) => list.includes(c)));
      if (!others.length) return;
      const list = others[Math.floor(Math.random() * others.length)], next = list[Math.floor(Math.random() * list.length)];
      const btn = fan.children[slot], im = btn.querySelector("img"); busy = true;
      btn.classList.add("swap");
      setTimeout(() => {
        const pre = new Image();
        pre.onload = pre.onerror = () => {
          im.src = pre.src; btn.dataset.i = next.i; btn.setAttribute("aria-label", next.name);
          shown[slot] = next; btn.classList.remove("swap"); slot = (slot + 1) % 3; busy = false;
        };
        pre.src = img(next.id, next.rk, 400);
      }, 450);
    }, 5000);
  }
  function table() {
    const l = CHECK.lists[CK.list], cols = l.columns, ai = cols.indexOf("Autograph");
    const hasPages = SPORT_LISTS.some((x) => x[1] === l.slug);   // only these lists have player pages to link to
    const shown = cols.map((c, i) => i).filter((i) => i !== ai);
    const opt = (c) => /notes|games|role/i.test(c) ? " opt" : "";
    const label = (c) => (c === "Signed" ? "Signed on" : c);
    const q = CK.q.toLowerCase(); let count = 0;
    const body = l.groups.map((g) => {
      const rows = g.rows.filter((r) => (CK.show === "all" || (CK.show === "have") === (r[ai] === "Yes")) && (!q || r.join(" ").toLowerCase().includes(q)));
      count += rows.length; if (!rows.length) return "";
      return (g.title ? `<tr class="grp"><th colspan="${shown.length + 2}">${esc(g.title)}</th></tr>` : "") + rows.map((r) => {
        const have = r[ai] === "Yes", scans = have ? scansFor(r[0], SPORT_OF_LIST[l.slug]) : [];
        return `<tr class="${have ? "have" : "need"}"${scans.length ? ` data-peek="${esc(r[0])}" data-sport="${SPORT_OF_LIST[l.slug]}"` : ""}><td><span class="st ${have ? "have" : "need"}">${have ? "Have" : "Need"}</span>${(l.notes || {})[r[0]] ? `<button type="button" class="nt-btn nt-m" data-note="${esc(r[0])}" aria-expanded="false" aria-label="Why ${esc(r[0])} is on this list">i</button>` : ""}</td>
          ${shown.map((i, k) => `<td class="${k === 0 ? "nm" : ""}${opt(cols[i])}">${k === 0 ? (hasPages ? `<a class="pl-link" href="#/player/${slugFor(l.slug, r[i])}">${hl(r[i], CK.q)}</a>` : hl(r[i], CK.q)) + ((l.notes || {})[r[i]] ? ` <button type="button" class="nt-btn nt-d" data-note="${esc(r[i])}" aria-expanded="false" aria-label="Why ${esc(r[i])} is on this list" title="Why he's on this list">i</button>` : "") : esc(r[i])}</td>`).join("")}
          <td class="sc">${scans.length ? `<button type="button" class="btn sm" data-scan="${esc(r[0])}" data-sport="${SPORT_OF_LIST[l.slug]}">${scans.length === 1 ? "Scan" : scans.length + " scans"}</button>` : ""}</td></tr>`;
      }).join("");
    }).join("");
    $("#ck-count").textContent = `${fmt(count)} ${count === 1 ? "person" : "people"}`;
    $("#ck-table").innerHTML = count ? `<table><thead><tr><th>Status</th>${shown.map((i) => `<th class="${opt(cols[i]).trim()}">${esc(label(cols[i]))}</th>`).join("")}<th></th></tr></thead><tbody>${body}</tbody></table>` : `<p class="empty">Nobody matches. Try another name or switch to Everyone.</p>`;
  }
  // My research note on why a player is on the Tier 2 or Tier 3 list opens in a row under his name.
  const noteHTML = (t) => t.split(/\n\s*\n/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");
  document.addEventListener("click", (e) => {
    const b = e.target.closest("#ck-table .nt-btn"); if (!b) return;
    const tr = b.closest("tr"), open = tr.nextElementSibling && tr.nextElementSibling.classList.contains("nt-row");
    const both = tr.querySelectorAll(".nt-btn");
    if (open) { tr.nextElementSibling.remove(); both.forEach((x) => x.setAttribute("aria-expanded", "false")); return; }
    const l = CHECK.lists[CK.list], t = (l.notes || {})[b.dataset.note]; if (!t) return;
    tr.insertAdjacentHTML("afterend", `<tr class="nt-row"><td colspan="${tr.children.length}"><div class="nt">${noteHTML(t)}</div></td></tr>`);
    both.forEach((x) => x.setAttribute("aria-expanded", "true"));
  });
  // Pause the mouse on a player's name or Scan button in an autograph list to see a small preview of the card.
  const peek = document.createElement("div"); peek.className = "peek"; peek.hidden = true; document.body.appendChild(peek);
  let peekTimer = null, peekRow = null;
  const hidePeek = () => { clearTimeout(peekTimer); peekTimer = null; peekRow = null; peek.hidden = true; };
  if (matchMedia("(hover: hover)").matches) {
    document.addEventListener("mouseover", (e) => {
      const t = e.target.closest("#ck-table .pl-link, #ck-table [data-scan]"), row = t && t.closest("tr[data-peek]");
      if (!row) { if (peekRow && !e.target.closest(".peek")) hidePeek(); return; }
      if (row === peekRow) return;
      hidePeek(); peekRow = row;
      peekTimer = setTimeout(() => {
        const c = bestScan(row.dataset.peek, row.dataset.sport); if (!c || peekRow !== row) return;
        peek.innerHTML = `<img alt="" src="${img(c.id, c.rk, 400)}" onload="this.classList.add('ok')"><small>${esc(c.title || c.name)}</small>`;
        const r = t.getBoundingClientRect(), w = 190, h = 300;
        peek.style.left = Math.max(8, Math.min(r.right + 14, innerWidth - w - 8)) + "px";
        peek.style.top = Math.max(8, Math.min(r.top + r.height / 2 - h / 2, innerHeight - h - 8)) + "px";
        peek.hidden = false;
      }, 350);
    });
    addEventListener("scroll", hidePeek, { passive: true });
    addEventListener("hashchange", hidePeek);
  }
  document.addEventListener("click", (e) => {
    if (!peek.hidden) hidePeek();
    const b = e.target.closest("[data-scan]"); if (!b) return;
    const list = scansFor(b.dataset.scan, b.dataset.sport || "football"); if (list.length) openViewer(0, list);
  });

  /* ---------- NFL Tier 1 Huskers: list with autographs, and a page per player ---------- */
  let PLAYERS = null;
  const HUB = { q: "", show: "all", sort: "scans", shown: 0, rows: [] };
  // Nebraska Football Hall of Fame (data/hall-of-fame.json, from huskers.com). A player matches on his name
  // (nicknames, Jr. and punctuation aside) and, for players, Nebraska years that line up with his.
  let HOF = null, HOFN = null, PROHOF = {};
  const hofName = (n) => String(n || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/["“][^"”]*["”]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, " ").toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean);
  function hofFor(info) {
    const me = hofName(info.name); if (!me.length || !HOF) return null;
    const last = +(info.finalYear || info.year) || 0;
    HOFN = HOFN || HOF.map((h) => [hofName(h.name), h]);
    return (HOFN.find(([n, h]) => {
      const same = n.join(" ") === me.join(" ") || (n[0] === me[0] && n[n.length - 1] === me[me.length - 1]);
      if (!same) return false;
      const ys = (String(h.years || "").match(/\d{2,4}/g) || []).map(Number), a = ys[0], b = ys.length > 1 ? ys[ys.length - 1] : a;
      if (h.role || !last || !a) return n.join(" ") === me.join(" ") || !h.role;
      const end = b < 100 ? Math.floor(a / 100) * 100 + b + (b < a % 100 ? 100 : 0) : b;
      return last >= a - 1 && last <= end + 1;
    }) || [])[1] || null;
  }
  // Small Hall of Fame marks after a name in player lists: bronze for Canton, gold for Nebraska.
  const hofMarks = (x) => (PROHOF[x.slug] ? `<i class="hof-mk pro" title="Pro Football Hall of Fame">${HOF_ICON}</i>` : "")
    + (HOF && hofFor(x) ? `<i class="hof-mk" title="Nebraska Football Hall of Fame">${HOF_ICON}</i>` : "");
  function loadHub(then) {
    const need = [];
    if (!CHECK) need.push(fetch("data/lists/husker-pros.json").then((r) => { if (!r.ok) throw 0; return r.json(); }).then((d) => (CHECK = d)));
    if (!HOF) need.push(fetch("data/hall-of-fame.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((d) => ((HOF = d.members || []), (PROHOF = d.pro || {}))));
    if (!PLAYERS) need.push(fetch("data/players.json").then((r) => (r.ok ? r.json() : { players: [] })).catch(() => ({ players: [] })).then((d) => (PLAYERS = d)));
    if (!need.length) return then();
    $("#app").innerHTML = `<p class="loading">Loading…</p>`;
    Promise.all(need).then(then).catch(() => ($("#app").innerHTML = `<p class="empty">This page isn't available yet.</p>`));
  }
  // The home page stat and search's player matches only need the autograph lists, not the (larger) player info.
  function loadCheckQuiet() {
    return Promise.resolve(CHECK || fetch("data/lists/husker-pros.json").then((r) => { if (!r.ok) throw 0; return r.json(); }).then((d) => (CHECK = d)));
  }
  const pslug = (n) => norm(n).replace(/ /g, "-");
  // A player's main card: prefer a card with a picture over an index card, cut autograph or signed letter
  // (those are "YEAR Player Autograph …" with no set, or say Cut / Letter). Signed pictures first.
  const PICTURE = /\b(photo|8x10|11x14|16x20|magazine|illustrated|poster|program|schedules?|postcard|card)\b/i;
  const noPicture = (c, name) => !c.tags.has("custom") && !PICTURE.test(c.name.replace(/index card/i, "")) && (/\bcut\b|index card|\b(?:signed|autographed)\s+letter\b/i.test(c.name)
    || new RegExp(`^\\d{4}(?:-\\d{2})?\\s+${norm(name).split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^#]*?")}[^#]*?\\b(?:signed\\s+)?(?:cut\\s+)?autograph`, "i").test(c.name));
  function bestScan(name, sport = "football") {
    const all = scansFor(name, sport).filter((c) => !/\(back\)/i.test(c.name));
    const pic = all.filter((c) => !noPicture(c, name));
    // A solo card of him beats one shared with other players (two or more names from my lists, or Dual/Trio/... sets).
    const solo = pic.filter((c) => !multiPlayer(c, name));
    return solo.find((c) => c.tags.has("auto")) || solo[0] || pic.find((c) => c.tags.has("auto")) || pic[0]
      || all.find((c) => c.tags.has("auto")) || all[0] || null;
  }
  let PNAMES = null;
  function multiPlayer(c, name) {
    if (/\b(dual|duos?|trios?|triple|quad|quads|tandem|combos?|pairings|teammates|and (?:\w+ )?others)\b/i.test(c.name.replace(/triple threads/i, ""))) return true;
    if (!PNAMES) PNAMES = [...new Set((CHECK ? allPlayers() : []).map((p) => norm(p.name)).filter((n) => n.split(" ").length > 1))];
    const t = " " + norm(c.name) + " ", me = norm(name);
    return PNAMES.some((n) => n !== me && t.includes(" " + n + " ") && !me.includes(n));
  }
  // Player pages for every name on the NFL, MLB and NBA lists. Slugs match scripts/build_players.py:
  // a name already used by an earlier list gets "-baseball" or "-basketball" added.
  // [sport, list, label, back link, back label, slug suffix for a name already used by an earlier list].
  // Order matters (it decides who gets the plain slug) and must match SPORTS in scripts/build_players.py.
  const SPORT_LISTS = [["football", "nfl-tier-1-huskers", "NFL", "#/nfl-huskers", "NFL Huskers Player Pages", "football"],
    ["baseball", "baseball-mlb", "MLB", "#/checklist/mlb", "MLB Huskers Autograph List", "baseball"],
    ["basketball", "basketball-nba", "NBA", "#/checklist/nba", "NBA Huskers Autograph List", "basketball"],
    ["football", "nfl-tier-2-huskers", "NFL Tier 2", "#/checklist/tier-2", "NFL Tier 2 Huskers Autograph List", "tier-2"],
    ["football", "pro-football-huskers", "Pro Football", "#/checklist/tier-3", "NFL Tier 3 Huskers Autograph List", "tier-3"]];
  let ALL = null;
  function allPlayers() {
    if (ALL) return ALL;
    const used = new Set(); ALL = [];
    SPORT_LISTS.forEach(([sport, listSlug, league, back, backLabel, suffix]) => {
      const l = CHECK.lists.find((x) => x.slug === listSlug); if (!l) return;
      const c = Object.fromEntries(l.columns.map((k, i) => [k, i]));
      l.groups.flatMap((g) => g.rows).forEach((r) => {
        const name = r[0].trim(); let slug = pslug(name);
        if (used.has(slug)) slug += "-" + suffix;
        used.add(slug);
        ALL.push({ sport, league, listSlug, back, backLabel, name, slug, year: r[c["Last Year"]], have: r[c["Autograph"]] === "Yes",
          games: c["NFL Games Played"] >= 0 ? r[c["NFL Games Played"]] : "", notes: c["Career Notes"] >= 0 ? r[c["Career Notes"]] : "",
          signed: c["Signed"] >= 0 ? r[c["Signed"]] : "", link: (l.links || {})[r[0]] || "" });
      });
    });
    return ALL;
  }
  const slugFor = (listSlug, name) => (allPlayers().find((p) => p.listSlug === listSlug && p.name === name.trim()) || {}).slug || pslug(name);
  function tier1() {
    const l = CHECK.lists.find((x) => x.slug === "nfl-tier-1-huskers");
    const c = Object.fromEntries(l.columns.map((k, i) => [k, i]));
    const pages = new Set((PLAYERS.players || []).filter((p) => p.wiki).map((p) => p.slug));
    return l.groups.flatMap((g) => g.rows).map((r) => ({
      name: r[c["Player"]].trim(), games: r[c["NFL Games Played"]], notes: r[c["Career Notes"]], year: r[c["Last Year"]],
      signed: r[c["Signed"]], have: r[c["Autograph"]] === "Yes", slug: pslug(r[c["Player"]]), page: pages.has(pslug(r[c["Player"]])),
      link: (l.links || {})[r[c["Player"]]] || "",
    }));
  }
  // The stats page linked from each name in my checklist, labelled by site.
  const SITES = { "footballdb.com": "FootballDB", "profootballarchives.com": "Pro Football Archives", "pro-football-reference.com": "Pro Football Reference",
    "sports-reference.com": "Sports Reference", "baseball-reference.com": "Baseball Reference", "basketball-reference.com": "Basketball Reference", "wikipedia.org": "Wikipedia", "huskers.com": "Huskers.com" };
  function siteName(url) {
    let h = ""; try { h = new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
    const k = Object.keys(SITES).find((d) => h === d || h.endsWith("." + d));
    return k ? SITES[k] : h;
  }
  /* ---------- Huskers by NFL Team ---------- */
  // Each NFL Husker's teams come from his Wikipedia career history ("St. Louis Rams (2003)" counts toward today's
  // Rams; "*" marks an offseason or practice-squad stint) and from the teams named in my research notes.
  let NFLTEAMS = null, TEAMIDX = null, NFLTEAMS_LIST = null;
  const nflTeamData = () => NFLTEAMS || (NFLTEAMS = fetch("data/nfl-teams.json").then((r) => (r.ok ? r.json() : { teams: [] })).then((d) => d.teams || []).catch(() => []));
  // The year a research note gives for a team: the nearest date after the team's name in that sentence
  // ("Released by the Broncos on 8/24/94", "the Raiders in '92"), else the nearest one before it
  // ("Released 8/17/88 after the Bears"), stopping at another team's name. Two-digit years are 19xx or 20xx.
  const YEAR_RE = /\b\d{1,2}[/.-]\d{1,2}[/.-](\d{4}|\d{2})\b|['’](\d{2})\b|\b((?:19|20)\d{2})\b/g;
  function noteYear(note, i, e, nick) {
    const cut = (str) => { const k = str.search(/[.!?](\s|$)|\n/); return k < 0 ? str.length : k; };
    const startS = Math.max(note.lastIndexOf("\n", i) + 1, ...[...note.slice(0, i).matchAll(/[.!?]\s/g)].map((x) => x.index + 2));
    const endS = e + cut(note.slice(e));
    const others = [...note.slice(startS, endS).matchAll(new RegExp(nick.source, "g"))].map((x) => [startS + x.index, startS + x.index + x[0].length]).filter(([a]) => a !== i);
    const fwdEnd = Math.min(endS, ...others.filter(([a]) => a > i).map(([a]) => a)), backStart = Math.max(startS, ...others.filter(([a]) => a < i).map(([, z]) => z));
    const yearsIn = (str) => [...str.matchAll(YEAR_RE)].map((x) => { const y = x[1] || x[2] || x[3]; if (y.length === 4) return +y;
      const n = +y, cy = new Date().getFullYear() % 100; return n <= cy ? 2000 + n : 1900 + n; });
    const f = yearsIn(note.slice(e, fwdEnd)), bk = yearsIn(note.slice(backStart, i));
    return String(f.length ? f[0] : bk.length ? bk[bk.length - 1] : "");
  }
  function teamIndex(teams) {
    if (TEAMIDX) return TEAMIDX;
    const byName = teams.flatMap((t) => t.names.map((n) => [n.toLowerCase(), t])).sort((a, b) => b[0].length - a[0].length);
    const nick = new RegExp(`\\b(${teams.flatMap((t) => t.nick).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "g");
    const byNick = Object.fromEntries(teams.flatMap((t) => t.nick.map((n) => [n, t])));
    TEAMIDX = Object.fromEntries(teams.map((t) => [t.slug, []]));
    const NFL = { "nfl-tier-1-huskers": 1, "nfl-tier-2-huskers": 2, "pro-football-huskers": 3 };
    allPlayers().filter((x) => NFL[x.listSlug]).forEach((x) => {
      const p = (PLAYERS.players || []).find((q) => q.slug === x.slug) || {};
      const stints = {};
      // Playing years only: "Career history" (or its "Playing" part when Wikipedia splits playing and coaching),
      // and older pages' "Playing career" table ("1931–1936 | Portsmouth Spartans/Detroit Lions").
      const secs = (p.wiki || {}).sections || {};
      const entries = [...secs["Career history"] || [], ...secs["Playing"] || []].filter((r) => r.length === 1).map((r) => r[0])
        .concat((secs["Playing career"] || []).filter((r) => r.length === 2 && /\d{4}/.test(r[0])).flatMap(([y, t]) => t.split("/").map((n) => `${n.trim()} (${y})`)));
      for (const e of entries) {
        const hit = byName.find(([n]) => e.toLowerCase().startsWith(n)); if (!hit) continue;
        const yrs = (e.match(/\(([^)]*)\)/) || [])[1] || "", star = /\*\s*$/.test(e);
        (stints[hit[1].slug] = stints[hit[1].slug] || []).push(yrs + (star ? " (offseason / practice squad)" : ""));
      }
      const fromWiki = new Set(Object.keys(stints));
      const l = CHECK.lists.find((q) => q.slug === x.listSlug), note = l && (l.notes || {})[x.name];
      for (const m of (note || "").matchAll(nick)) {
        if (/\b(BC|B\.C\.)\s$/.test(note.slice(Math.max(0, m.index - 5), m.index))) continue;   // the CFL's BC Lions
        const t = byNick[m[1]]; if (!t || fromWiki.has(t.slug)) continue;
        const y = noteYear(note, m.index, m.index + m[0].length, nick);
        (stints[t.slug] = stints[t.slug] || []).push(y);
      }
      Object.entries(stints).forEach(([slug, yrs]) => TEAMIDX[slug].push({ x, tier: NFL[x.listSlug], yrs: [...new Set(yrs.filter(Boolean))].join(", ") }));
    });
    return TEAMIDX;
  }
  // A team's colors for its page: --tc1/--tc2 for the banner, --tca a readable accent on the dark site.
  const lum = (h) => { const n = parseInt(h.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const teamVars = (t) => { const [a, b] = t.colors || ["#3b6fd8", "#9aa4b2"]; const acc = [a, b].filter((x) => lum(x) > 0.08 && lum(x) < 0.9).sort((x, y) => lum(y) - lum(x))[0] || "#c9d1db";
    return `--tc1:${a};--tc2:${b};--tca:${acc}`; };
  const teamLogo = (t, cls) => t.logo ? `<img class="${cls}" alt="${esc(t.name)} logo" loading="lazy" src="${esc(t.logo)}" onerror="this.remove()">` : "";
  function nflTeams(slug) {
    setNav("nfl-teams");
    loadHub(() => nflTeamData().then((teams) => {
      const idx = teamIndex(teams);
      if (!slug) {
        setTitle("Huskers by NFL Team");
        const rows = teams.map((t) => ({ t, n: idx[t.slug].length, t1: idx[t.slug].filter((e) => e.tier === 1).length })).sort((a, b) => b.n - a.n || a.t.name.localeCompare(b.t.name));
        $("#app").innerHTML = `<div class="wrap tm"><div class="c-head"><div class="kick">NFL Huskers</div><h1>Huskers by NFL Team</h1>
          <p>Every Nebraska Cornhusker on my NFL lists, by the franchise he was with. Past team names count toward today's franchise (St. Louis Rams → Los Angeles Rams).</p></div>
          <div class="tm-grid">${rows.map(({ t, n, t1 }) => `<a class="tm-tile" style="${teamVars(t)}" href="#/nfl-teams/${t.slug}">${teamLogo(t, "tm-logo")}<b>${esc(t.name)}</b><span>${fmt(n)} Husker${n === 1 ? "" : "s"}${t1 ? ` · ${fmt(t1)} played in games` : ""}</span></a>`).join("")}</div></div>`;
        return;
      }
      const t = teams.find((q) => q.slug === slug); if (!t) return notFound();
      setTitle(`Huskers on the ${t.name}`);
      const list = idx[slug].slice().sort((a, b) => a.tier - b.tier || (parseInt(b.yrs) || +b.x.year || 0) - (parseInt(a.yrs) || +a.x.year || 0) || a.x.name.localeCompare(b.x.name));
      const card = (e) => { const sc = e.x.have ? bestScan(e.x.name, "football") : null;
        return `<a class="pm" href="#/player/${e.x.slug}"><span class="pm-ph">${sc ? `<img alt="" loading="lazy" src="${img(sc.id, sc.rk, 160)}" onload="this.classList.add('ok')">` : ""}</span>
          <span class="pm-t"><b>${esc(e.x.name)}${hofMarks(e.x)}</b>${e.yrs ? `<small>${esc(e.yrs)}</small>` : ""}</span><span class="pm-go">→</span></a>`; };
      const TIER = { 1: "Played in games (Tier 1)", 2: "Active roster, preseason, injured reserve or practice squad (Tier 2)", 3: "Camp, tryout or draft (Tier 3)" };
      $("#app").innerHTML = `<div class="wrap tm tm-team" style="${teamVars(t)}"><a class="back" href="#/nfl-teams">← Huskers by NFL Team</a>
        <div class="tm-banner">${teamLogo(t, "tm-blogo")}<div class="c-head"><div class="kick">Huskers by NFL Team</div><h1>Huskers on the ${esc(t.name)}</h1>
        <p>${fmt(list.length)} Nebraska Cornhuskers from my NFL lists spent time with the ${esc(t.name)}.${t.names.length > 1 ? ` Past team names count too: ${esc(t.names.slice(1).join(", "))}.` : ""}</p></div></div>
        ${[1, 2, 3].map((n) => { const g = list.filter((e) => e.tier === n); return g.length ? `<h2 class="more-h">${TIER[n]} · ${g.length}</h2><div class="pm-list">${g.map(card).join("")}</div>` : ""; }).join("")}
        ${list.length ? "" : `<p class="empty">No Huskers from my lists yet.</p>`}
        ${t.logoPage ? `<p class="tm-credit">Logo: <a href="${esc(t.logoPage)}" target="_blank" rel="noopener">Wikipedia</a>. Team names and logos are trademarks of their teams.</p>` : ""}</div>`;
    }));
  }

  function hub() {
    setNav("nfl-huskers"); setTitle("NFL Huskers Player Pages");
    loadHub(() => {
      const all = tier1(), have = all.filter((p) => p.have).length;
      $("#app").innerHTML = `<div class="wrap hub c-husker">
        <div class="c-head"><div class="kick">Autograph collection</div><h1>NFL Huskers Player Pages</h1>
          <p>Every Nebraska Cornhusker who played in at least one NFL game. Pick a name for that player's page, with the autograph I have when I have one.</p>
          <div class="prog"><b>${((have / all.length) * 100).toFixed(2)}%</b><div class="bar"><i style="width:${(have / all.length) * 100}%"></i></div><small>${fmt(have)} of ${fmt(all.length)} signed</small></div></div>
        <div class="tools">
          <div class="chips" role="group" aria-label="Show">${[["all", "Everyone"], ["have", "Have"], ["need", "Need"], ["pages", "Has a bio"]].map(([k, t]) => `<button type="button" class="chip" data-show="${k}" aria-pressed="${HUB.show === k}">${t}</button>`).join("")}</div>
          <div class="tools-r"><label class="sr" for="hub-q">Find a player</label><input id="hub-q" class="ck-q" type="search" placeholder="Find a player" value="${esc(HUB.q)}">
            <label class="sr" for="hub-sort">Sort</label><select id="hub-sort">${[["scans", "With autographs first"], ["new", "Newest first"], ["old", "Oldest first"], ["most", "Most NFL games"], ["fewest", "Fewest NFL games"], ["az", "A–Z"]].map(([k, t]) => `<option value="${k}"${HUB.sort === k ? " selected" : ""}>${t}</option>`).join("")}</select>
            <span class="count" id="hub-count"></span></div>
        </div>
        <ol class="hub-list" id="hub-list"></ol><div class="sentinel" id="hub-more"></div></div>`;
      const apply = () => {
        const q = HUB.q.toLowerCase();
        HUB.rows = all.filter((p) => (HUB.show === "all" || (HUB.show === "have" && p.have) || (HUB.show === "need" && !p.have) || (HUB.show === "pages" && p.page)) && (!q || p.name.toLowerCase().includes(q)));
        // The checklist is newest first; "with autographs first" keeps that order within each group.
        const scanned = (p) => (p.have && bestScan(p.name) ? 0 : 1), yr = (p) => parseInt(p.year) || 0;
        // Games like "1*" count as 1; players with no games listed go last either way.
        const gm = (p) => { const n = parseInt(p.games); return isNaN(n) ? null : n; };
        const byGames = (dir) => (a, b) => (gm(a) === null) - (gm(b) === null) || dir * ((gm(a) || 0) - (gm(b) || 0));
        const by = { scans: (a, b) => scanned(a) - scanned(b), new: () => 0, old: (a, b) => yr(a) - yr(b), most: byGames(-1), fewest: byGames(1), az: (a, b) => a.name.localeCompare(b.name) }[HUB.sort];
        HUB.rows = HUB.rows.map((p, i) => [p, i]).sort((a, b) => by(a[0], b[0]) || a[1] - b[1]).map(([p]) => p);
        HUB.shown = 0; $("#hub-list").innerHTML = HUB.rows.length ? "" : `<li class="empty">Nobody matches.</li>`;
        $("#hub-count").textContent = `${fmt(HUB.rows.length)} players`; hubMore();
      };
      $(".hub .chips").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; HUB.show = b.dataset.show; document.querySelectorAll(".hub .chip").forEach((x) => x.setAttribute("aria-pressed", x === b)); apply(); });
      $("#hub-q").addEventListener("input", (e) => { HUB.q = e.target.value.trim(); apply(); });
      $("#hub-sort").addEventListener("change", (e) => { HUB.sort = e.target.value; apply(); });
      apply(); hubIO.observe($("#hub-more"));
    });
  }
  function hubMore() {
    const list = $("#hub-list"); if (!list) return;
    const next = HUB.rows.slice(HUB.shown, HUB.shown + 60); HUB.shown += next.length;
    list.insertAdjacentHTML("beforeend", next.map((p) => {
      const sc = p.have ? bestScan(p.name) : null;
      const nm = `<a class="hub-name${p.page ? "" : " nobio"}" href="#/player/${p.slug}">${hl(p.name, HUB.q)}${hofMarks(p)}</a>`;
      return `<li class="hub-row ${p.have ? "have" : "need"}">
        ${sc ? `<button type="button" class="hub-ph" data-scan="${esc(p.name)}" aria-label="View ${esc(p.name)}'s autograph"><img loading="lazy" alt="" src="${img(sc.id, sc.rk, 240)}" onload="this.classList.add('ok')"></button>`
             : `<div class="hub-ph none">${p.have ? esc(p.signed || "Signed") : "Need"}</div>`}
        <div class="hub-info">${nm}<div class="hub-meta">Final Nebraska season ${esc(p.year)}${p.games ? ` · ${esc(p.games)} NFL game${parseInt(p.games) === 1 ? "" : "s"}` : ""}${p.notes ? ` · ${esc(p.notes)}` : ""}</div>
          <div class="hub-meta2"><span class="st ${p.have ? "have" : "need"}">${p.have ? "Have" : "Need"}</span>${p.have && p.signed ? `<span>Signed ${esc(p.signed.toLowerCase())}</span>` : ""}</div></div></li>`;
    }).join(""));
  }
  const hubIO = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && HUB.shown < HUB.rows.length && hubMore()), { rootMargin: "1000px" });

  // Videos that feature a player: Media items and Customs videos with "players": [player page slugs].
  function playerMedia(slug) {
    const s = DATA.site, yt = (v) => v.url || `https://www.youtube.com/watch?v=${encodeURIComponent(v.youtube || v.id)}${v.start ? `&t=${+v.start}s` : ""}`;
    return [...(s.media?.items || []), ...(s.customsPhotos?.videos || [])]
      .filter((v) => (v.players || []).includes(slug)).map((v) => ({ title: v.title || v.caption, url: yt(v) }));
  }
  // Bottom of a player page: previous / next player on the same list, and Huskers like him
  // (same list, same position when known, closest final Nebraska seasons).
  function moreHuskers(slug, info, p) {
    const list = allPlayers().filter((x) => x.listSlug === info.listSlug);
    const at = list.findIndex((x) => x.slug === slug); if (at < 0) return "";
    const pos = (x) => ((PLAYERS.players || []).find((q) => q.slug === x.slug) || {}).position || "";
    const group = (t) => { t = (t || "").toLowerCase(); const G = [["qb", /quarterback/], ["db", /cornerback|safety|defensive back|\bcb\b|\bdb\b/],
        ["dl", /defensive (end|tackle|line)|nose|\bdt\b|\bde\b/], ["lb", /linebacker/], ["rb", /running back|fullback|halfback|tailback|i-?back|wingback/],
        ["wr", /receiver|split end|flanker/], ["te", /tight end/], ["ol", /tackle|guard|center|offensive line/], ["k", /kicker|punter/],
        ["p", /pitcher/], ["c", /catcher/], ["if", /infield|shortstop|base/], ["of", /outfield|fielder/], ["bb", /forward|guard|center/]];
      const g = G.find(([, r]) => r.test(t)); return g ? g[0] : ""; };
    const mine = group((p && p.position) || ""), yr = +info.year || 0;
    const like = list.filter((x) => x.slug !== slug)
      .map((x) => ({ x, sameGroup: mine && group(pos(x)) === mine, gap: Math.abs((+x.year || 0) - yr) }))
      .sort((a, b) => (b.sameGroup - a.sameGroup) || (a.gap - b.gap)).slice(0, 6).map((o) => o.x);
    const card = (x) => { const sc = x.have ? bestScan(x.name, x.sport) : null;
      return `<a class="pm" href="#/player/${x.slug}"><span class="pm-ph">${sc ? `<img alt="" loading="lazy" src="${img(sc.id, sc.rk, 160)}" onload="this.classList.add('ok')">` : ""}</span>
        <span class="pm-t"><b>${esc(x.name)}${hofMarks(x)}</b><small>${esc(pos(x) || x.league + " Husker")}${x.year ? ` · Nebraska through ${esc(x.year)}` : ""}</small></span><span class="pm-go">→</span></a>`; };
    const prev = list[at - 1], next = list[at + 1];
    return `<section class="more-huskers"><h2 class="more-h">More Huskers like ${esc(info.name)}</h2><div class="pm-list">${like.map(card).join("")}</div>
      <nav class="pl-nav" aria-label="Previous and next player">${prev ? `<a href="#/player/${prev.slug}">← ${esc(prev.name)}</a>` : "<span></span>"}${next ? `<a href="#/player/${next.slug}">${esc(next.name)} →</a>` : ""}</nav></section>`;
  }

  // Every card I have of a player, from every collection on the site (not the Want List, not back scans).
  function playerCards(name) {
    const n = norm(name); if (n.split(" ").length < 2) return [];
    return CARDS.filter((c) => SECTIONS[c.si].kind !== "want" && !/\((back|inside)\)/i.test(c.name) && (" " + norm(c.name) + " ").includes(" " + n + " "))
      .sort((p, q) => (p.year || 0) - (q.year || 0) || p.name.localeCompare(q.name));
  }
  function playerCardsPage(slug) {
    loadHub(() => {
      const p = (PLAYERS.players || []).find((x) => x.slug === slug), row = allPlayers().find((x) => x.slug === slug);
      if (!p && !row) return notFound();
      const info = { ...(row || {}), ...(p || {}) }, all = playerCards(info.name); if (!all.length) return notFound();
      setNav(info.back && info.back.startsWith("#/checklist/") ? info.back.slice(2) : "nfl-huskers"); setTitle(`${info.name} cards`);
      const where = [...new Set(all.map((c) => SECTIONS[c.si].title))];
      $("#app").innerHTML = `<div class="wrap coll c-husker"><div style="grid-column:1/-1;min-width:0">
        <a class="back" href="#/player/${esc(slug)}">← ${esc(info.name)}</a>
        <div class="c-head"><div class="kick">Every card I have</div><h1>${esc(info.name)}</h1>
        <p>${fmt(all.length)} scan${all.length === 1 ? "" : "s"} in my collection, oldest first${where.length > 1 ? `, from ${where.map(esc).join(", ")}` : ""}.</p></div>
        <div class="grid" id="grid">${all.map((c) => cardHTML(c)).join("")}</div></div></div>`;
      state.list = all;
    });
  }
  /* ---------- Career timeline (player pages): college and pro stops as bars, events as marks, left to right ---------- */
  const EVENT_WORDS = [[/\bsigned\b/i, "Signed"], [/\bdrafted\b/i, "Drafted"], [/\b(released|cut)\b/i, "Released"], [/\bwaived\b/i, "Waived"], [/\bclaimed\b/i, "Claimed"],
    [/\btraded\b/i, "Traded"], [/practice squad/i, "Practice squad"], [/active roster/i, "Active roster"], [/injured reserve|\bIR\b/, "Injured reserve"], [/preseason/i, "Preseason"], [/\bretired\b/i, "Retired"]];
  function careerTimeline({ info, schools, careerLines, draft, note, hof, pro }) {
    const NOW = new Date().getFullYear(), spans = [], marks = [];
    const yrs = (str) => (String(str).match(/(?:19|20)\d{2}|present/g) || []).map((y) => (y === "present" ? NOW : +y));
    // College: Nebraska and any other school, else his final Nebraska season.
    schools.forEach(([n, y]) => { const v = yrs(y); if (v.length) spans.push({ lane: "c", a: v[0], b: v[v.length - 1], label: n, neb: /nebraska/i.test(n) }); });
    (info.playingCollege || []).forEach(([y, n]) => { const v = yrs(y); if (v.length && !spans.some((x) => x.lane === "c" && x.label === n)) spans.push({ lane: "c", a: v[0], b: v[v.length - 1], label: n, neb: /nebraska/i.test(n) }); });
    if (!spans.some((x) => x.neb) && +(info.year || info.finalYear)) marks.push({ y: +(info.year || info.finalYear), label: "Final Nebraska season", kind: "c" });
    // Pro stops from Wikipedia ("Detroit Lions (2001–2014)", "*" = offseason / practice squad).
    careerLines.forEach((e) => {
      const m = e.match(/^(.*?)\s*\(([^)]*)\)\s*(\*?)/); if (!m) return;
      m[2].split(/,\s*/).forEach((part) => { const v = yrs(part); if (v.length) spans.push({ lane: "p", a: v[0], b: v[v.length - 1], label: m[1].trim(), soft: !!m[3] }); });
    });
    const d = String(draft || "").match(/((?:19|20)\d{2})\s*[:/]?\s*(.*)/);
    if (d) marks.push({ y: +d[1], label: "NFL draft", sub: d[2].replace(/(\d+)(?:st|nd|rd|th) round,?\s*/i, "Rd $1, ").replace(/(\d+)(?:st|nd|rd|th) overall pick/i, "#$1").replace(/,\s*$/, ""), kind: "d" });
    // Dated moments from my research notes ("Released by the Broncos on 8/24/94"), one per sentence.
    if (note && TEAMIDX_NICK) {
      note.split(/(?<=[.!?])\s+|\n+/).forEach((sent) => {
        const ym = [...sent.matchAll(YEAR_RE)][0]; if (!ym) return;
        const yv = ym[1] || ym[2] || ym[3], y = yv.length === 4 ? +yv : (+yv <= NOW % 100 ? 2000 : 1900) + +yv;
        const w = EVENT_WORDS.find(([re]) => re.test(sent)); if (!w) return;
        const team = (sent.match(TEAMIDX_NICK) || [])[0] || "";
        marks.push({ y, label: w[1], sub: team, full: sent.trim(), kind: "n" });
      });
    }
    if (hof) marks.push({ y: +hof.class, label: "Nebraska Hall of Fame", kind: "h" });
    if (pro) marks.push({ y: +pro, label: "Pro Football Hall of Fame", kind: "hp" });
    if (spans.length + marks.length < 2) return "";
    const all = [...spans.flatMap((x) => [x.a, x.b]), ...marks.map((x) => x.y)].filter((y) => y > 1850 && y <= NOW + 1);
    if (!all.length) return "";
    // Positions are percentages, so a short career fills the width; long careers get a minimum spacing and scroll.
    const lo = Math.min(...all), hi = Math.max(...all), n = hi - lo + 1, px = (y) => ((y - lo) / n) * 100, step = n > 30 ? 10 : n > 14 ? 5 : n > 8 ? 2 : 1;
    // Bars that would overlap go on another row.
    const rowsFor = (items, a, b) => { const ends = []; return items.map((it) => { let r = ends.findIndex((e) => e < a(it)); if (r < 0) r = ends.length; ends[r] = b(it); return r; }); };
    const bars = (lane) => { const it = spans.filter((x) => x.lane === lane).sort((x, y) => x.a - y.a), rows = rowsFor(it, (x) => x.a, (x) => x.b);
      return it.map((x, k) => `<div class="tl-bar ${lane}${x.neb ? " neb" : ""}${x.soft ? " soft" : ""}" style="left:${px(x.a)}%;width:calc(${px(x.b + 1) - px(x.a)}% - 3px);top:${rows[k] * 30}px" title="${esc(x.label)} (${x.a}${x.b > x.a ? "–" + x.b : ""})${x.soft ? ", offseason / practice squad" : ""}">${esc(x.label)}</div>`).join("")
        + `<i class="tl-h" style="height:${(Math.max(-1, ...rows) + 1) * 30}px"></i>`; };
    const gap = Math.max(2, Math.ceil(n / 6)), ms = marks.slice().sort((x, y) => x.y - y.y), mrows = rowsFor(ms, (x) => x.y, (x) => x.y + gap);
    const cap = mrows.length ? Math.max(...mrows) + 1 : 0;
    return `<section class="wide-sec tl-sec"><h2>Career timeline</h2><div class="tl-scroll"><div class="tl" style="min-width:${n * 12 + 60}px">
      <div class="tl-years">${Array.from({ length: n }, (_, k) => lo + k).filter((y) => y % step === 0 || (y === lo && (Math.ceil(lo / step) * step - lo) * 2 >= step)).map((y) => `<span style="left:${px(y)}%">${y}</span>`).join("")}</div>
      ${spans.some((x) => x.lane === "c") ? `<div class="tl-lane"><b class="tl-k">College</b><div class="tl-track">${bars("c")}</div></div>` : ""}
      ${spans.some((x) => x.lane === "p") ? `<div class="tl-lane"><b class="tl-k">Pro</b><div class="tl-track">${bars("p")}</div></div>` : ""}
      ${ms.length ? `<div class="tl-marks" style="height:${cap * 46}px">${ms.map((x, k) => `<div class="tl-m ${x.kind}${px(x.y) > 62 ? " r" : ""}" style="left:calc(${px(x.y) + 50 / n}% - 6px);top:${mrows[k] * 46}px"${x.full ? ` title="${esc(x.full)}"` : ""}><i></i><span><b>${esc(x.label)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ""}<small>${x.y}</small></span></div>`).join("")}</div>` : ""}
    </div></div><p class="note">From Wikipedia, my research notes and the Hall of Fame lists. Swipe sideways for more years.</p></section>`;
  }
  let TEAMIDX_NICK = null;
  const HOF_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v3a5 5 0 0 1-10 0V4zM7 5H4v1a3 3 0 0 0 3 3M17 5h3v1a3 3 0 0 1-3 3M12 12v4M8 20h8M9 20l1-4h4l1 4"/></svg>`;
  function player(slug) {
    setNav("nfl-huskers");
    loadHub(() => Promise.all([backText(), nflTeamData().then((t) => (NFLTEAMS_LIST = t))]).then(([CB]) => {
      const p = (PLAYERS.players || []).find((x) => x.slug === slug);
      const row = allPlayers().find((x) => x.slug === slug);
      if (!p && !row) return notFound();
      const info = { ...(row || {}), ...(p || {}) }, w = (p && p.wiki) || null, hof = hofFor(info), pro = PROHOF[slug];
      if (!TEAMIDX_NICK && NFLTEAMS_LIST) TEAMIDX_NICK = new RegExp(`\\b(${NFLTEAMS_LIST.flatMap((t) => t.nick).join("|")})\\b`);
      const football = (info.sport || "football") === "football";
      setTitle(info.name);
      if (info.back && info.back.startsWith("#/checklist/")) setNav(info.back.slice(2));
      const back = info.back || "#/nfl-huskers", backLabel = info.backLabel || "NFL Huskers Player Pages";
      const sport = info.sport || "football";
      const scans = scansFor(info.name, sport).filter((c) => !/\(back\)/i.test(c.name));
      // A Husker with his own collection on the site (Alex Gordon): show one of those autographs and link to it.
      const pcIdx = SECTIONS.findIndex((x) => norm(x.title) === norm(info.name));
      const pc = pcIdx >= 0 ? sectionCards(pcIdx) : [];
      const hero = info.have ? bestScan(info.name, sport) || pc.find((c) => c.tags.has("auto")) || null : null;
      const sec = (w && w.sections) || {};
      const pick = (label) => Object.values(sec).flat().find((r) => r.length === 2 && r[0] === label);
      // Baseball infoboxes put position, birth and bats/throws in single lines under the team heading.
      const lines = [...((w && w.facts) || []), ...Object.values(sec).flat()].filter((r) => r.length === 1).map((r) => r[0]);
      const line = (re) => (lines.find((t) => re.test(t)) || "").replace(re, "").trim();
      // Active players' first heading is their team, with the position as its first line; retired players' isn't.
      const [firstKey, firstSec = []] = Object.entries(sec)[0] || [];
      const looksLikePos = (t) => t && !/[:\d]/.test(t) && t.length < 60;
      const bbPos = football ? "" : (firstKey && !/debut|statistics|teams|appearance/i.test(firstKey) && firstSec[0] && firstSec[0].length === 1 && looksLikePos(firstSec[0][0]) ? firstSec[0][0]
        : (((w && w.facts) || []).find((r) => r.length === 1 && looksLikePos(r[0])) || [""])[0]);
      const debut = Object.entries(sec).find(([k]) => /debut$/i.test(k));
      // The College line can list several schools, e.g. "LSU (2019–2021)Nebraska (2022)".
      const schools = [...((pick("College") || [])[1] || "").matchAll(/([^()\n]+?)\s*\(([^)]*)\)/g)].map((m) => [m[1].trim(), m[2].trim()]);
      // Nebraska years: Wikipedia's range when its last year agrees with my final season; otherwise (or with no range) my final season only.
      const myFinal = info.year || info.finalYear, wikiNeb = (schools.find(([n]) => /nebraska/i.test(n)) || [])[1] || "";
      const wikiLast = Math.max(0, ...(wikiNeb.match(/(?:19|20)\d{2}/g) || []).map(Number)), useWiki = wikiLast && (!myFinal || +myFinal === wikiLast);
      const facts = [["Position", info.position || (pick("Position") || [])[1] || bbPos], ["Final season at Nebraska", useWiki ? "" : myFinal],
        ["Nebraska years", useWiki ? wikiNeb : ""],
        ["Also played at", schools.filter(([n]) => !/nebraska/i.test(n)).map(([n, y]) => `${n} (${y})`).join(", ")],
        ["NFL draft", (pick("NFL draft") || [])[1]], ["NBA draft", (pick("NBA draft") || [])[1]], ["MLB draft", (pick("MLB draft") || [])[1]],
        [debut ? debut[0] : "", debut ? (debut[1][0] || [])[0] : ""],
        ["NFL games", football ? info.games || info.nflGames : ""], ["Born", (pick("Born") || [])[1] || line(/^Born:\s*/)],
        ["Bats / throws", line(/^(?=Bat(?:s|ted):)/).replace(/Bat(?:s|ted):\s*/, "").replace(/\s*Thr(?:ows|ew):\s*/, " / ")],
        ...Object.entries(sec).filter(([k]) => /^Last .*appearance$/i.test(k)).map(([k, v]) => [k, (v[0] || [])[0]]),
        ["High school", (pick("High school") || [])[1]], ["Height / weight", [(pick("Listed height") || [])[1], (pick("Listed weight") || [])[1]].filter(Boolean).join(" · ")]]
        .filter(([, v]) => v && String(v).trim());
      // What Ian's custom card backs add (data/card-text.json, "player": this page): facts join the facts grid,
      // stats get a box next to the other stats, and his write-up leads the bio. Marked ★ so sources stay clear.
      const mine = Object.values(CB || {}).filter((e) => e && e.player === slug);
      mine.forEach((e) => (e.facts || []).filter((r) => r.length === 2).forEach(([k, v]) => facts.push([k, v, true])));
      const cardStats = mine.map((e) => e.stats).filter((st) => st && (st.rows || []).length > 1);
      const ianBio = mine.map((e) => e.story || e.text).filter(Boolean).join("\n\n");
      const statKey = Object.keys(sec).find((k) => /statistics/i.test(k));
      // A list section, in whichever name this sport's infobox uses; "2022–2024 | Team" rows read as "Team (2022–2024)".
      const list = (...ks) => { const k = ks.find((x) => sec[x] && sec[x].length); return k ? sec[k].map((r) => `<li>${esc(r.length === 2 ? `${r[1].replace(/^→\s*/, "↳ ")} (${r[0]})` : r[0])}</li>`).join("") : ""; };
      const teams = list("Career history", "Playing", "Teams"), awards = list("Awards and highlights", "Career highlights and awards", "Career highlights");
      const statsLink = football && /^https?:\/\//i.test(info.link || "") ? info.link : w && w.statsLink ? w.statsLink.url : "";
      const college = p && p.college;
      const DEF = /defensive|linebacker|cornerback|safety|end\b|tackle/i;
      const CATS = [["passing", "Passing", ["COMPLETIONS", "ATT", "PCT", "YDS", "YPA", "TD", "INT"]], ["rushing", "Rushing", ["CAR", "YDS", "YPC", "LONG", "TD"]],
        ["receiving", "Receiving", ["REC", "YDS", "YPR", "LONG", "TD"]], ["defensive", "Defense", ["TOT", "SOLO", "TFL", "SACKS", "QB HUR", "PD", "TD"]],
        ["interceptions", "Interceptions", ["INT", "YDS", "AVG", "TD"]], ["kickReturns", "Kick returns", ["NO", "YDS", "AVG", "LONG", "TD"]],
        ["puntReturns", "Punt returns", ["NO", "YDS", "AVG", "LONG", "TD"]], ["kicking", "Kicking", ["FGM", "FGA", "PCT", "LONG", "XPM", "XPA", "PTS"]],
        ["punting", "Punting", ["NO", "YDS", "YPP", "LONG", "IN 20", "TB"]], ["scoring", "Scoring", ["TD", "XP1", "XP2", "FG", "TP"]]];
      const LABEL = { COMPLETIONS: "CMP", "QB HUR": "QBH", XP1: "XP", XP2: "2PT", TP: "PTS" };
      const collegeHTML = college ? CATS.map(([key, title, order]) => {
        const yrs = Object.keys(college).filter((y) => college[y][key]); if (!yrs.length) return "";
        const cols = order.filter((k) => yrs.some((y) => college[y][key][k] !== undefined));
        return `<div class="ct-wrap"><table class="ct"><thead><tr><th rowspan="2">Season</th><th colspan="${cols.length}">${title}</th></tr><tr>${cols.map((k) => `<th>${esc(LABEL[k] || k)}</th>`).join("")}</tr></thead>
          <tbody>${yrs.map((y) => `<tr><td>${y}</td>${cols.map((k) => `<td>${esc(college[y][key][k] ?? "–")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      }).join("") : "";
      const isData = (r) => /^(\d{4}|career|total)/i.test((r[0] || [""])[0]);
      const wtables = ((p && p.collegeTables) || []).map((t) => {
        const first = t.rows.findIndex(isData), head = first > 0 ? t.rows.slice(0, first) : t.rows.slice(0, 1), body = t.rows.slice(first > 0 ? first : 1);
        const cell = (tag, rs) => ([v, n]) => `<${tag}${n > 1 ? ` colspan="${n}"` : ""}${rs && n === 1 ? ` rowspan="${rs}"` : ""}>${esc(v)}</${tag}>`;
        // With two heading rows, single-column headings in the first row (Season, Team) span both rows.
        return `<div class="ct-wrap"><table class="ct"><thead>${head.map((r, i) => `<tr>${r.map(cell("th", head.length === 2 && i === 0 ? 2 : 0)).join("")}</tr>`).join("")}</thead><tbody>${body.map((r) => `<tr class="${/^(career|total)/i.test(r[0][0]) ? "tot" : ""}">${r.map(cell("td")).join("")}</tr>`).join("")}</tbody></table></div>`;
      }).join("");
      $("#app").innerHTML = `<div class="wrap pl c-husker">
        <a class="back" href="${back}">← ${esc(backLabel)}</a>
        <div class="pl-top">
          <div class="pl-card">${hero ? `<button type="button" class="pl-ph${scans.includes(hero) ? "" : " cd"}" ${scans.includes(hero) ? `data-scan="${esc(info.name)}" data-sport="${sport}"` : `data-i="${hero.i}"`}><img alt="${esc(hero.name)}" src="${img(hero.id, hero.rk, 900)}" onload="fitFrame(this)"></button><small>${esc(hero.name)}</small>`
            : `<div class="pl-ph none"><span class="st ${info.have ? "have" : "need"}">${info.have ? "Have" : "Need"}</span><p>${info.have ? `${info.signed ? `Signed ${esc(info.signed.toLowerCase())}. ` : ""}Scan coming soon.` : "I'm still looking for this autograph. Can you help?"}</p>${info.have ? "" : contactHTML("I can help with this autograph", `${info.name} autograph`, `Hi Ian,\n\nI saw you're looking for a ${info.name} autograph. I might be able to help:\n\n`, info.name)}</div>`}</div>
          <div class="pl-main">
            <div class="kick">${esc(info.position || bbPos || (football ? "Nebraska Cornhusker" : `Nebraska Cornhuskers ${info.sport}`))}</div>
            <h1>${esc(info.name)}</h1>
            <div class="pl-badges">${pro ? `<span class="hof-badge pro">${HOF_ICON} Pro Football Hall of Fame</span>` : ""}${hof ? `<span class="hof-badge">${HOF_ICON} Nebraska Hall of Fame</span>` : ""}<span class="st ${info.have ? "have" : "need"}">${info.have ? "In my collection" : "Need"}</span>${info.have && info.signed ? `<span class="pill">Signed ${esc(info.signed.toLowerCase())}</span>` : ""}</div>
            ${statsLink ? `<a class="statlink" href="${esc(statsLink)}" target="_blank" rel="noopener">Career stats at ${esc(siteName(statsLink))} ↗</a>` : ""}
            ${((DATA.site.playerExtras || {})[slug] || {}).about ? `<p class="pl-about">${esc(DATA.site.playerExtras[slug].about)}</p>` : ""}
            ${playerMedia(slug).map((m) => `<a class="statlink watch" href="${esc(m.url)}" target="_blank" rel="noopener">▶ Watch: ${esc(m.title)} ↗</a>`).join("")}
            ${(() => { const l = row && CHECK.lists.find((x) => x.slug === row.listSlug), t = l && (l.notes || {})[row.name];
              return t ? `<section class="why"><h2>Why he's on the ${esc((row.backLabel || "").replace(/ Huskers Autograph List$/, ""))} list</h2>${noteHTML(t)}</section>` : ""; })()}
            ${pro ? `<section class="hof pro"><div class="hof-ic">${HOF_ICON}</div><div><div class="hof-k">Pro Football Hall of Fame</div>
              <b>${pro >= new Date().getFullYear() ? "Class of" : "Inducted"} ${esc(String(pro))}</b><span>Canton, Ohio</span>
              <a href="https://www.profootballhof.com/" target="_blank" rel="noopener">Pro Football Hall of Fame ↗</a></div></section>` : ""}
            ${hof ? `<section class="hof"><div class="hof-ic">${HOF_ICON}</div><div><div class="hof-k">Nebraska Football Hall of Fame</div>
              <b>Class of ${esc(String(hof.class))}</b><span>${hof.role ? esc(hof.role === "Coach" ? "Inducted as a coach" : hof.role) + " · " : ""}${hof.years ? "Nebraska " + esc(String(hof.years).replace(/-/g, "–")) : "Nebraska"}</span>
              <a href="https://huskers.com/nebraska-football-hall-of-fame" target="_blank" rel="noopener">Full Hall of Fame at huskers.com ↗</a></div></section>` : ""}
            <dl class="facts">${facts.map(([k, v, star]) => `<div><dt>${esc(k)}${star ? ' <span class="star" title="From my custom card">★</span>' : ""}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
            ${ianBio ? `<div class="bio ian">${textHTML(ianBio)}<p class="note">★ From my custom card, written by me.</p></div>` : ""}
            ${w && w.intro ? `<div class="bio">${w.intro.split("\n\n").map((t) => `<p>${esc(t)}</p>`).join("")}</div>` : `<p class="muted">${p && p.checked ? "No biography available for this player yet." : "Biography coming soon."}</p>`}
          </div>
        </div>
        ${football ? careerTimeline({ info: { ...info, playingCollege: useWiki || !myFinal ? (sec["Playing career"] || []).filter((r) => r.length === 2 && /\d{4}/.test(r[0]) && /nebraska/i.test(r[1])) : [] },
          schools: schools.filter(([n]) => useWiki || !/nebraska/i.test(n)), careerLines: [...sec["Career history"] || [], ...sec["Playing"] || []].filter((r) => r.length === 1).map((r) => r[0])
            .concat((sec["Playing career"] || []).filter((r) => r.length === 2 && /\d{4}/.test(r[0]) && !/nebraska/i.test(r[1])).map(([y, t]) => `${t.trim()} (${y})`)),
          draft: (pick("NFL draft") || [])[1], note: (() => { const l = row && CHECK.lists.find((x) => x.slug === row.listSlug); return l && (l.notes || {})[row.name]; })(), hof, pro }) : ""}
        <div class="pl-grid">

          ${statKey ? `<section><h2>${esc(statKey.replace(/\s*\n.*$/s, "").replace(/\s+as of.*$/i, ""))}</h2><table class="kv">${sec[statKey].filter((r) => r.length === 2).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table></section>` : ""}
          ${cardStats.map((st) => { const [h, ...rows] = st.rows;
            // One row (career totals): a simple list; first column is just the row's label. Several rows (seasons): a table.
            const body = rows.length === 1
              ? `<table class="kv"><tbody>${h.map((k, n) => (n === 0 && h.length > 2 ? "" : `<tr><th>${esc(k)}</th><td>${esc(rows[0][n] ?? "")}</td></tr>`)).join("")}</tbody></table>`
              : `<div class="vt-tbl"><table><thead><tr>${h.map((k) => `<th>${esc(k)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
            return `<section><h2>${esc(st.title || "Stats")} <span class="star" title="From my custom card">★</span></h2>${body}<p class="note">From my custom card.</p></section>`; }).join("")}
          ${!football && !wtables ? "" : `<section class="wide-sec"><h2>College stats</h2>${wtables ? `${wtables}<p class="note">From <a href="${esc(w.url)}" target="_blank" rel="noopener">Wikipedia</a>, CC BY-SA 4.0.</p>` : collegeHTML ? `${collegeHTML}<p class="note">${p.collegeSource === "recordbook"
              ? `Seasons he led Nebraska in a category, from the <a href="https://huskers.com/football-history-and-records" target="_blank" rel="noopener">Nebraska Football Record Book</a> (huskers.com). Full stats for this era aren't in my data source yet.`
              : p.collegeSource === "games" ? "From CollegeFootballData.com (season totals added up from game box scores)." : "From CollegeFootballData.com."}</p>`
            : `<p class="muted">Not available yet.</p>`}</section>`}
          ${teams ? `<section><h2>Pro teams</h2><ul class="plain">${teams}</ul></section>` : ""}
          ${awards ? `<section><h2>Awards and highlights</h2><ul class="plain">${awards}</ul></section>` : ""}
        </div>
        ${moreHuskers(slug, info, p)}
        ${pc.length ? `<p class="pc-link"><a href="#/c/${SECTIONS[pcIdx].slug}">See all ${fmt(pc.length)} scans in my ${esc(SECTIONS[pcIdx].title)} collection →</a></p>` : ""}
        ${scans.length > 1 ? `<h2 class="more-h">More of ${esc(info.name)} in my collection</h2><div class="grid small">${scans.map((c) => cardHTML(c)).join("")}</div>` : ""}
        ${(() => { const n = playerCards(info.name).length; return n ? `<p class="pc-link"><a href="#/player-cards/${esc(slug)}">See ${n === 1 ? "the 1 scan" : `all ${fmt(n)} scans`} of ${esc(info.name)} in my collection →</a></p>` : ""; })()}
        <p class="ck-plain"><a href="${/^(nfl-tier-|pro-football)/.test(info.listSlug || p?.list || "") ? "nfl-huskers" : "players"}/${esc(slug)}.html">Plain version of this page to share or cite →</a></p>
        <p class="credit">${w ? `Biography and facts adapted from <a href="${esc(w.url)}" target="_blank" rel="noopener">Wikipedia</a>, licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.` : ""}${w && w.pfr && w.pfr !== statsLink ? ` Full pro stats at <a href="${esc(w.pfr)}" target="_blank" rel="noopener">Pro Football Reference</a>.` : ""} Autograph status from my collection records.</p>
      </div>`;
      state.list = scans;
    }));
  }



  /* ---------- Media: articles, videos and podcasts (config/site.json "media") ---------- */
  function media() {
    setNav("media"); setTitle("Media");
    const m = DATA.site.media || {}, items = m.items || [];
    const when = (it) => it.date ? `<span>${esc(it.date)}</span>` : "";
    const meta = (it) => `<div class="md-meta"><b>${esc(it.outlet || "")}</b>${when(it)}</div>`;
    const watch = items.filter((it) => it.type === "video"), listen = items.filter((it) => it.type === "podcast"), read = items.filter((it) => it.type === "article");
    const vid = (it) => `<figure class="vid md-card">
        ${it.youtube ? `<div class="vid-frame"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(it.youtube)}${it.start ? `?start=${+it.start}` : ""}" title="${esc(it.title)}" loading="lazy"
          referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>` : ""}
        ${/^https:\/\/(creators|open)\.spotify\.com\//.test(it.spotify || "") ? `<iframe class="md-pod" src="${esc(it.spotify)}" title="${esc(it.title)}" loading="lazy" allow="encrypted-media"></iframe>` : ""}
        <figcaption>${meta(it)}<h3>${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)} ↗</a>` : esc(it.title)}</h3>${it.note ? `<p>${esc(it.note)}</p>` : ""}</figcaption></figure>`;
    const art = (it) => `<a class="md-art md-card" href="${esc(it.url)}" target="_blank" rel="noopener">${meta(it)}<h3>${esc(it.title)} ↗</h3>${it.note ? `<p>${esc(it.note)}</p>` : ""}</a>`;
    $("#app").innerHTML = `<div class="wrap ck md"><div class="c-head">
      <div class="kick">In the media</div><h1>Media</h1></div>
      ${m.intro ? `<p class="md-intro">${esc(m.intro)}</p>` : ""}
      ${watch.length ? `<h2 class="sub-h">Video</h2><div class="vids">${watch.map(vid).join("")}</div>` : ""}
      ${listen.length ? `<h2 class="sub-h">Podcasts</h2><div class="vids">${listen.map(vid).join("")}</div>` : ""}
      ${read.length ? `<h2 class="sub-h">Articles</h2><div class="md-arts">${read.map(art).join("")}</div>` : ""}
      ${items.length ? "" : `<p class="empty">Nothing here yet.</p>`}
    </div>`;
  }


  /* ---------- Jermaine Dye career story: my write-up with my best cards from each team ---------- */
  function dyeCareer() {
    const st = DATA.site.dyeStory, si = SECTIONS.findIndex((x) => x.slug === "jermaine-dye");
    if (!st || si < 0) return notFound();
    setNav("jermaine-dye"); setTitle(st.title);
    const sec = SECTIONS[si], mine = sectionCards(si).filter((c) => !/\(back\)|\(inside\)/i.test(c.name));
    const find = (part) => mine.find((c) => c.name.toLowerCase().includes(part.toLowerCase()));
    const score = (c) => (c.one ? (c.tags.has("auto") || c.tags.has("relic") ? 60 : 15) : 0) + (c.tags.has("auto") ? 30 : 0) + (c.tags.has("relic") ? 25 : 0)
      + (/patch|knob|logoman|nameplate|button|laundry tag/i.test(c.name) ? 15 : 0)
      + (c.serial ? Math.max(0, 30 - Math.log10(c.serial) * 10) : 0) + (c.grade ? 3 : 0);
    const used = new Set(), shownCards = [];
    const pick = (ch, n) => {
      const gi = sec.groups.findIndex((g) => g.label === ch.group);
      const pinned = (ch.cards || []).map(find).filter(Boolean);
      // Cards issued while he played there come first; later retro cards still compete if they're special.
      const [y0, y1] = (ch.years.match(/\d{4}/g) || []).map(Number), era = (c) => (y0 && c.year >= y0 && c.year <= (y1 || y0) + 1 ? 40 : 0);
      const setKey = (c) => c.name.toLowerCase().replace(/\b(donruss|topps|upper deck|fleer|panini|leaf|playoff)\b/g, " ").split(/[^a-z0-9]+/).filter(Boolean).slice(0, 3).join(" ");
      const sets = new Set();
      const auto = mine.filter((c) => c.gi === gi && !c.tags.has("custom") && !/printing plate/i.test(c.name) && !used.has(c.i)).sort((a, b) => score(b) + era(b) - score(a) - era(a) || a.i - b.i)
        .filter((c) => { const k = setKey(c); if (sets.has(k)) return false; sets.add(k); return true; });
      const out = [...pinned, ...auto.filter((c) => !pinned.includes(c))].slice(0, n);
      out.forEach((c) => used.add(c.i));
      return out;
    };
    const card = (c) => { shownCards.push(c); return cardHTML(c); };
    const hi = (st.highlights || []).map((h) => ({ c: find(h.card), cap: h.caption })).filter((h) => h.c);
    hi.forEach((h) => used.add(h.c.i));
    const chapters = st.chapters.map((ch, n) => {
      const cards = pick(ch, ch.paragraphs.length * 2), gi = sec.groups.findIndex((g) => g.label === ch.group);
      return `<section class="ds-ch">
        <div class="ds-ch-h"><span class="ds-num">${String(n + 1).padStart(2, "0")}</span><div><h2>${esc(ch.team)}</h2><span class="ds-yrs">${esc(ch.years)}</span></div></div>
        ${ch.paragraphs.map((p, k) => { const two = cards.slice(k * 2, k * 2 + 2);
          return `<div class="ds-row${k % 2 ? " flip" : ""}"><p>${esc(p)}</p>${two.length ? `<div class="ds-cards">${two.map(card).join("")}</div>` : ""}</div>`; }).join("")}
        ${gi >= 0 ? `<a class="ds-all" href="#/c/${sec.slug}/${sec.groups[gi].slug}">See all ${fmt(sec.groups[gi].count)} scans of my ${esc(ch.group)} cards →</a>` : ""}
      </section>`;
    }).join("");
    $("#app").innerHTML = `<div class="wrap ds c-royal">
      <a class="back" href="#/c/${sec.slug}">← Jermaine Dye collection</a>
      <div class="kick">Player collection · Career story</div>
      <h1>${esc(st.title)}</h1>
      <div class="ds-intro">${(st.intro || []).map((p) => `<p>${esc(p)}</p>`).join("")}</div>
      ${hi.length ? `<section class="ds-hi"><h2 class="sub-h">Favorite pieces</h2><div class="ds-hi-grid">${hi.map((h) => `<figure>${card(h.c)}<figcaption>${esc(h.cap)}</figcaption></figure>`).join("")}</div></section>` : ""}
      ${chapters}
      <p class="ds-end"><a href="#/c/${sec.slug}">Browse all ${fmt(mine.length)} scans of my Jermaine Dye cards →</a></p>
    </div>`;
    state.list = shownCards;   // the card viewer steps through the cards on this page
  }

  /* ---------- Rainbows: every version (parallel) I have of one card ---------- */
  // Same year, set, card number and player = one rainbow, whatever the color. A color or parallel word at the end of
  // the set name ("Signature Materials Black") is ignored; "Set - Parallel" names already keep the parallel apart.
  // A card's player without a letterman code ("Brandon Jackson 2A" → "Brandon Jackson").
  const plainTitle = (x) => (x.title || "").replace(/\bLetter\s+0?\d{1,2}\s+[A-Z]\b/g, " ").replace(/(?:^|\s)0?\d{1,2}\s?[A-Z](?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
  const PARALLEL_WORDS = /(?:\s+(?:gold(?:en)?|silver|black|red|blue|green|orange|purple|pink|platinum|bronze|copper|emerald|sapphire|ruby|white|yellow|aqua|teal|magenta|holo(?:foil)?|refractors?|prizms?|parallel|foil|rainbow|mojo|wave|shimmer|atomic|x-?fractors?|superfractors?|printing plates?|press proofs?|proofs?|framed|vintage stock|independence day|camo|tie-?dye|cracked ice|mirror|spectrum|chrome|prime|limited))+$/i;
  // A second or third copy of a card ("... 2nd (Sold to ...)") is the same card for rainbows and sets.
  const copyKey = (x) => x.name.toLowerCase().replace(/\s+(?:2nd|3rd|\d+th)\b(?:\s*\([^)]*\))?\s*$/, "").trim();
  let RAINBOWS = null;
  /* ---------- Binder view: any card list as 9-pocket binder pages (two pages side by side on wide screens) ----------
     Pockets frame the card; nothing is drawn on the scan. Letterman pages add empty "Need" pockets for missing letters. */
  const BINDER = { items: [], k: 0, title: "" };
  const binderBtn = () => `<button type="button" class="btn binder-btn" data-binder>${BINDER_ICON} Binder view</button>`;
  const BINDER_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5zM5 3v18M9 7h6M9 11h6"/></svg>`;
  function binderEl() {
    let b = $("#binder"); if (b) return b;
    document.body.insertAdjacentHTML("beforeend", `<div class="binder" id="binder" hidden role="dialog" aria-modal="true" aria-label="Binder view">
      <div class="v-top"><button type="button" class="v-ic" id="b-back" aria-label="Close binder"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
        <div class="v-mid"><b id="b-title"></b><span id="b-pos"></span></div>
        <div class="v-tools"><button type="button" class="v-ic" id="b-prev" aria-label="Previous page"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button><button type="button" class="v-ic" id="b-next" aria-label="Next page"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button></div></div>
      <div class="b-stage" id="b-stage"></div></div>`);
    b = $("#binder");
    $("#b-back").onclick = () => closeBinder();
    $("#b-prev").onclick = () => turn(-1); $("#b-next").onclick = () => turn(1);
    let sx = null;
    $("#b-stage").addEventListener("touchstart", (e) => (sx = e.touches[0].clientX), { passive: true });
    $("#b-stage").addEventListener("touchend", (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 50) turn(dx < 0 ? 1 : -1); });
    $("#b-stage").addEventListener("click", (e) => {
      const p = e.target.closest("[data-bk]"); if (!p) return;
      const cards = BINDER.items.filter((x) => !x.empty), c = BINDER.items[+p.dataset.bk];
      openViewer(cards.indexOf(c), cards);
    });
    addEventListener("keydown", (e) => { if (b.hidden || !$("#viewer").hidden) return; if (e.key === "ArrowLeft") turn(-1); else if (e.key === "ArrowRight") turn(1); else if (e.key === "Escape") closeBinder(); });
    addEventListener("popstate", () => { if (!b.hidden && !(history.state && (history.state.binder || history.state.v))) hideBinder(); });
    return b;
  }
  const perView = () => (window.matchMedia("(min-width: 900px)").matches ? 2 : 1);
  function openBinder(items, title) {
    const b = binderEl(); BINDER.items = items; BINDER.k = 0; BINDER.title = title;
    b.hidden = false; document.body.style.overflow = "hidden"; drawBinder(0);
    if (!(history.state && history.state.binder)) history.pushState({ binder: 1 }, "", location.href);
  }
  function hideBinder() { const b = $("#binder"); if (!b || b.hidden) return; b.hidden = true; document.body.style.overflow = ""; $("#b-stage").innerHTML = ""; }
  function closeBinder() { if (history.state && history.state.binder) history.back(); else hideBinder(); }
  function turn(d) {
    const pages = Math.ceil(BINDER.items.length / 9), step = perView(), k = BINDER.k + d * step;
    if (k < 0 || k >= pages) return;
    BINDER.k = k; drawBinder(d);
  }
  function drawBinder(dir) {
    const pages = Math.max(1, Math.ceil(BINDER.items.length / 9)), n = perView();
    BINDER.k -= BINDER.k % n;
    const pocket = (x, i) => !x ? `<div class="b-pk empty"></div>`
      : x.empty ? `<div class="b-pk need"><div class="b-need"><b>${esc(x.label || "?")}</b><small>Need</small></div></div>`
      : `<button type="button" class="b-pk" data-bk="${i}" aria-label="${esc(x.name || x.caption || "")}"><img alt="" src="${img(x.id, x.rk, 400)}" onload="this.classList.add('ok')"></button>`;
    const page = (p) => p >= pages ? "" : `<div class="b-page${p % 2 ? " right" : ""}">${Array.from({ length: 9 }, (_, j) => pocket(BINDER.items[p * 9 + j], p * 9 + j)).join("")}<span class="b-num">${p + 1}</span></div>`;
    $("#b-stage").innerHTML = `<div class="b-spread${dir > 0 ? " in-next" : dir < 0 ? " in-prev" : ""}${n === 2 ? " two" : ""}">${page(BINDER.k)}${n === 2 ? page(BINDER.k + 1) : ""}</div>`;
    $("#b-title").textContent = BINDER.title;
    const last = Math.min(pages, BINDER.k + n);
    $("#b-pos").textContent = `${n === 2 && last > BINDER.k + 1 ? `Pages ${BINDER.k + 1}–${last}` : `Page ${BINDER.k + 1}`} of ${pages} · ${fmt(BINDER.items.filter((x) => !x.empty).length)} scans`;
    $("#b-prev").disabled = BINDER.k === 0; $("#b-next").disabled = BINDER.k + n >= pages;
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-binder]")) return;
    const items = state.binderItems && state.binderItems.length ? state.binderItems : state.list;
    if (items.length) openBinder(items, ($("#app h1") || {}).textContent || "Binder");
  });

  /* Best of the Best: the standout cards (1/1s, bat knobs, laundry tags, nameplates, buttons, shields, SSPs, low-numbered
     prime patches and autographs), cycling in and out on the stats page. */
  const BEST_RULES = [[/\bknob/i, 9], [/laundry|\btag\b|logo ?man/i, 8], [/nameplate|shield|button|barrel/i, 7], [/\bssp\b|super short|image variation|\bvariation\b/i, 6],
    [/\bprime\b|jumbo/i, 4], [/booklet|dual auto|triple auto|quad auto|cut auto/i, 3]];
  function bestScore(c) {
    let n = BEST_RULES.reduce((t, [re, v]) => t + (re.test(c.name) ? v : 0), 0);
    if (c.one) n += 10; else if (c.serial && c.serial <= 5) n += 7; else if (c.serial && c.serial <= 10) n += 5; else if (c.serial && c.serial <= 25) n += 2;
    if (c.tags.has("auto") && c.tags.has("relic")) n += 3; else if (c.tags.has("auto")) n += 1;
    return n;
  }
  let BEST_TIMER = 0;
  function bestShow(cards) {
    clearInterval(BEST_TIMER);
    const pool = cards.map((c) => [bestScore(c), c]).filter(([n]) => n >= 9).sort((a, b) => b[0] - a[0]).map((x) => x[1])
      .filter((c, k, a) => a.findIndex((x) => x.name === c.name) === k).slice(0, 80);   // a card filed in two collections counts once
    for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
    // As many cards as fit: two full rows on wide screens (three on phones), from the grid's column count.
    const box = () => $("#best");
    let N = 6, next = 0;
    const fit = () => { const b = box(); if (!b) return;
      b.innerHTML = '<div class="best-slot"></div>';
      const cols = getComputedStyle(b).gridTemplateColumns.split(" ").filter(Boolean).length || 2;
      N = Math.min(pool.length, cols * (cols <= 2 ? 3 : 2));
      b.innerHTML = pool.slice(next % pool.length).concat(pool).slice(0, N).map((c) => `<div class="best-slot">${cardHTML(c)}</div>`).join("");
      next += N; };
    setTimeout(fit, 0);
    let rt = 0; const onResize = () => { if (!box()) return removeEventListener("resize", onResize); clearTimeout(rt); rt = setTimeout(fit, 250); };
    addEventListener("resize", onResize);
    state.list = pool;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || pool.length <= 6) return pool;
    let slot = 0;
    BEST_TIMER = setInterval(() => {
      const b = box(); if (!b) return clearInterval(BEST_TIMER);
      if (!$("#viewer").hidden || document.hidden) return;
      if (pool.length <= N) return;
      const el = b.children[slot % N]; slot += 1 + Math.floor(Math.random() * Math.max(1, N - 1));
      const onScreen = new Set([...b.querySelectorAll(".cd[data-i]")].map((x) => +x.dataset.i));
      let c = pool[next++ % pool.length], tries = 0;
      while (onScreen.has(c.i) && tries++ < pool.length) c = pool[next++ % pool.length];
      el.classList.add("out");
      setTimeout(() => { el.innerHTML = cardHTML(c); el.classList.remove("out"); el.classList.add("in"); setTimeout(() => el.classList.remove("in"), 700); }, 600);
    }, 2600);
    return pool;
  }

  // Every player in the scans, most cards first (#/stats/players). Each row opens a search for that player.
  function statsPlayers() {
    setNav(""); setTitle("Players by number of scans");
    const m = new Map(); CARDS.forEach((c) => { if (c.photo || !c.title) return; const n = plainTitle(c); if (n) m.set(n, (m.get(n) || 0) + 1); });
    const rows = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), max = rows.length ? rows[0][1] : 1;
    $("#app").innerHTML = `<div class="wrap stp"><a class="back" href="#/stats">← Scanned Collection Stats</a>
      <div class="c-head"><div class="kick">Scanned Collection Stats</div><h1>Players by number of scans</h1><p>${fmt(rows.length)} players, most scans first. These are the cards scanned into the site, not every card I own. Tap a player to see his scans.</p></div>
      <section class="st-box"><ol class="st-bars st-rank">${rows.map(([n, k], i) => `<li><a href="#/search/${encodeURIComponent("=" + n)}"><b><span class="st-r">${i + 1}</span>${esc(n)}</b><i style="--w:${(k / max) * 100}%"></i><em>${fmt(k)}</em></a></li>`).join("")}</ol></section></div>`;
  }

  /* ---------- Collection stats (#/stats) ---------- */
  function statsPage() {
    setNav(""); setTitle("Scanned Collection Stats");
    const cards = CARDS.filter((c) => !c.photo), N = cards.length, pct = (n) => (N ? (n / N) * 100 : 0);
    const bar = (label, n, max, href) => `<li>${href ? `<a href="${href}">` : "<span>"}<b>${esc(label)}</b><i style="--w:${max ? (n / max) * 100 : 0}%"></i><em>${fmt(n)}</em>${href ? "</a>" : "</span>"}</li>`;
    // By card year
    const byYear = new Map(); cards.forEach((c) => c.year < 9999 && byYear.set(c.year, (byYear.get(c.year) || 0) + 1));
    const years = [...byYear.keys()].sort((a, b) => a - b), ymax = Math.max(1, ...byYear.values());
    const yearCols = years.length ? Array.from({ length: years[years.length - 1] - years[0] + 1 }, (_, k) => years[0] + k)
      .map((y) => `<a class="st-col" href="#/search/${y}" title="${y}: ${fmt(byYear.get(y) || 0)} scans"><i style="--h:${((byYear.get(y) || 0) / ymax) * 100}%"></i>${y % (years[years.length - 1] - years[0] > 40 ? 20 : 5) === 0 ? `<span>${y}</span>` : ""}</a>`).join("") : "";
    // What kind of card
    const has = (t) => cards.filter((c) => c.tags.has(t)).length;
    const both = cards.filter((c) => c.tags.has("auto") && c.tags.has("relic")).length;
    const kinds = [["Autographs", has("auto"), "#/search/autos"], ["Relics & patches", has("relic"), "#/search/relics"], ["Autograph + relic", both, "#/search/autos relics"],
      ["Numbered", has("numbered"), "#/search/numbered"], ["Rookie cards", has("rc"), "#/search/rookies"], ["Customs", has("custom"), "#/customs"], ["Graded", has("graded"), "#/search/graded"]];
    const kmax = Math.max(...kinds.map((k) => k[1]));
    // Print runs
    const tiers = [["1 of 1", (c) => c.one, "1/1"], ["/2 – /5", (c) => !c.one && c.serial && c.serial <= 5, "over /1 /5 or less"], ["/6 – /10", (c) => c.serial > 5 && c.serial <= 10, "over /5 /10 or less"], ["/11 – /25", (c) => c.serial > 10 && c.serial <= 25, "over /10 /25 or less"],
      ["/26 – /50", (c) => c.serial > 25 && c.serial <= 50, "over /25 /50 or less"], ["/51 – /99", (c) => c.serial > 50 && c.serial <= 99, "over /50 /99 or less"], ["/100 – /250", (c) => c.serial > 99 && c.serial <= 250, "over /99 /250 or less"], ["/251 and up", (c) => c.serial > 250, "over /250"]]
      .map(([l, f, q]) => [l, cards.filter(f).length, "#/search/" + q]);
    const tmax = Math.max(1, ...tiers.map((t) => t[1]));
    // By collection
    const secs = SECTIONS.map((x, i) => [x, sectionCards(i).length]).filter(([x, n]) => n && shown(x)).sort((a, b) => b[1] - a[1]), smax = Math.max(1, ...secs.map((x) => x[1]));
    // Leaderboards
    const rb = new Map(); cards.forEach((c) => { const k = rainbowKey(c); if (k) (rb.get(k) || rb.set(k, []).get(k)).push(c); });
    const rainbows = [...rb.values()].filter((l) => l.length > 2).sort((a, b) => b.length - a.length).slice(0, 10);
    const players = new Map(); cards.forEach((c) => c.title && players.set(plainTitle(c), (players.get(plainTitle(c)) || 0) + 1));
    const top = [...players.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10), pmax = Math.max(1, ...top.map((x) => x[1]));
    $("#app").innerHTML = `<div class="wrap stp">
      <div class="c-head"><div class="kick">Whole collection</div><h1>Scanned Collection Stats</h1><p>${fmt(N)} scans, by the numbers. These count the cards scanned into the site, not every card I own. Tap a number or bar to see those scans.</p></div>
      <div class="st-tiles"><a href="#/all"><b>${fmt(N)}</b><span>scans →</span></a><a href="#/search/1/1"><b>${fmt(has("one"))}</b><span>one-of-ones →</span></a>
        <a href="#/search/autos"><b>${fmt(has("auto"))}</b><span>autographs (${pct(has("auto")).toFixed(0)}%) →</span></a><a href="#/stats/players"><b>${fmt(players.size)}</b><span>players →</span></a>
        <a href="#/all?sort=old"><b>${years.length ? years[0] : "–"}</b><span>oldest card year →</span></a></div>
      <section class="st-box"><h2>Scans by card year</h2><div class="st-years">${yearCols}</div></section>
      <div class="st-two">
        <section class="st-box"><h2>What kind of card</h2><ul class="st-bars">${kinds.map(([l, n, h]) => bar(l, n, kmax, h)).join("")}</ul></section>
        <section class="st-box"><h2>Print runs</h2><ul class="st-bars">${tiers.map(([l, n, h]) => bar(l, n, tmax, h)).join("")}</ul></section>
        <section class="st-box"><h2>By collection</h2><ul class="st-bars">${secs.map(([x, n]) => bar(x.title, n, smax, "#/c/" + x.slug)).join("")}</ul></section>
        <section class="st-box"><h2>Most scans of one player <a class="st-more" href="#/stats/players">All ${fmt(players.size)} →</a></h2><ul class="st-bars">${top.map(([n, k]) => bar(n, k, pmax, "#/search/" + encodeURIComponent("=" + n))).join("")}</ul></section>
      </div>
      <section class="st-box best"><h2>🔥 Best of the Best</h2><p class="best-sub">1/1s, bat knobs, laundry tags, nameplates, buttons, SSPs and the best patches, rotating through.</p><div class="grid small best-grid" id="best"></div></section>
      <section class="st-box"><h2>Biggest rainbows</h2><ol class="st-rb">${rainbows.map((l) => `<li><a href="#/rainbow/${encodeURIComponent(l[0].id)}"><b>${esc(l[0].title)}</b><span>${esc(l[0].sub.replace(/\s+#\S+$/, "").replace(PARALLEL_WORDS, "").trim())}</span><em>${l.length} versions scanned</em></a></li>`).join("")}</ol></section>
    </div>`;
    bestShow(cards);
  }
  function rainbowKey(c) {
    const m = (c.sub || "").match(/^(\S+)\s+(.*?)\s+#(\S+)$/); if (!m || !c.title) return null;
    // Autographed and relic versions are their own rainbows (same card number, different card).
    const kind = (c.tags.has("auto") ? "a" : "") + (c.tags.has("relic") ? "r" : "");
    return [m[1], m[2].replace(PARALLEL_WORDS, "").toLowerCase(), m[3].toLowerCase(), norm(c.title), kind].join("|");
  }
  function rainbowOf(c) {
    if (!RAINBOWS) {
      RAINBOWS = new Map();
      const seen = new Set();   // a card uploaded twice counts once
      CARDS.forEach((x) => {
        if (/\((back|inside)\)/i.test(x.name) || seen.has(copyKey(x))) return; seen.add(copyKey(x));
        const k = rainbowKey(x); if (k) RAINBOWS.set(k, [...(RAINBOWS.get(k) || []), x]);
      });
    }
    const k = rainbowKey(c); let all = (k && RAINBOWS.get(k)) || [];
    if (!all.includes(c)) all = all.map((x) => (copyKey(x) === copyKey(c) ? c : x));   // opened the duplicate copy
    // 1/1 first, then lowest print run to highest, then unnumbered versions.
    return all.slice().sort((a, b) => (a.serial || 1e9) - (b.serial || 1e9) || a.name.localeCompare(b.name));
  }
  /* Set rainbows: one set or insert across players (e.g. 2008 TK Legacy Signature Series). Cards with a letter prefix
     in their number (#C1, #QB4) group by year, brand and prefix, so differently written set names still match;
     plain numbers (#97) group by year and set name. Shown when the set has two or more players. */
  const SET_NOISE = new Set(["nebraska", "cornhuskers", "huskers", "autographs", "autograph", "signature", "signatures", "series", "insert", "inserts"]);
  let SETS = null;
  function setKey(c) {
    const m = (c.sub || "").match(/^(\S+)\s+(.*?)\s+#(\S+)$/); if (!m) return null;
    const pre = (m[3].match(/^[A-Za-z]+/) || [""])[0].toLowerCase();
    const words = norm(`${m[2]} ${(c.par || "").replace(PARALLEL_WORDS, "")}`).split(" ").filter((w) => w && !SET_NOISE.has(w));
    if (!words.length) return null;
    return pre ? `${m[1]}|${words[0]}|${pre}` : `${m[1]}|${words.join(" ")}`;
  }
  function setOf(c) {
    if (!SETS) {
      SETS = new Map(); const seen = new Set();
      CARDS.forEach((x) => {
        if (/\((back|inside)\)/i.test(x.name) || seen.has(copyKey(x))) return; seen.add(copyKey(x));
        const k = setKey(x); if (k) SETS.set(k, [...(SETS.get(k) || []), x]);
      });
    }
    const all = SETS.get(setKey(c)) || [];
    if (new Set(all.map((x) => norm(x.title))).size < 2) return [];
    const num = (x) => { const n = (x.sub.match(/#(\S+)$/) || ["", ""])[1]; return [n.replace(/[^A-Za-z]/g, "").toLowerCase(), parseFloat(n.replace(/^[^0-9]*/, "")) || 0]; };
    return all.slice().sort((a, b) => { const [p, n] = num(a), [q, m] = num(b); return p.localeCompare(q) || n - m || (a.serial || 1e9) - (b.serial || 1e9) || a.name.localeCompare(b.name); });
  }
  function setPage(id) {
    const c = CARDS.find((x) => x.id === id); if (!c) return notFound();
    const all = setOf(c); if (!all.length) return notFound();
    const sec = SECTIONS[c.si], players = new Set(all.map((x) => norm(x.title))).size;
    const title = c.sub.replace(/\s+#\S+$/, "") + (c.par ? ` - ${c.par.replace(PARALLEL_WORDS, "")}` : "");
    setNav(sec.slug); setTitle(title);
    $("#app").innerHTML = `<div class="wrap coll c-${sec.color || "royal"}"><div style="grid-column:1/-1;min-width:0">
      <a class="back" href="#/c/${sec.slug}">← ${esc(sec.title)}</a>
      <div class="c-head"><div class="kick">Set rainbow</div><h1>${esc(title)}</h1><p>${fmt(players)} players, ${fmt(all.length)} scans, in card-number order.</p></div><div class="b-row">${binderBtn()}</div>
      <div class="grid" id="grid">${all.map((x) => cardHTML(x)).join("")}</div></div></div>`;
    state.list = all;
  }
  /* Letterman sets: each card is one letter (e.g. "4N", "Letter 03 R", "#AP 1P"). The page spells the word in order,
     with a blank spot for each letter I'm missing. The word is the one that fits every letter I have: the player's
     last or full name, CORNHUSKERS, HUSKERS or NEBRASKA, or one set in config/site.json "letterWords". */
  const letterOf = (c) => {
    const n = c.name.replace(/#'d.*$|\b1 of 1\b.*$/i, " ");
    const m = n.match(/\bLetter\s+0?(\d{1,2})\s+([A-Z])\b/) || n.match(/(?:^|\s)0?(\d{1,2})\s?([A-Z])(?=\s|$|\))/);
    return m && +m[1] > 0 ? { pos: +m[1], letter: m[2] } : null;
  };
  const isLetterSet = (c) => /\blett(?:er|erman|ermen)\b|by the letter/i.test(c.name) && !/(?:signed|autographed)\s+letter\b/i.test(c.name);
  const letterGroupKey = (c) => {
    const m = (c.sub || "").match(/^(\S+)\s+(.*?)\s+#(\S+)$/); if (!m) return null;
    const pre = m[3].replace(/[^A-Za-z]/g, "").toLowerCase();
    // The player, without the letter code that sits in the name ("Niles Paul 4N", "1P Aaron Pribanic", "Letter 03 R").
    const who = c.title.replace(/\b(?:creased|damaged|miscut|off-?center|dirty)\b/gi, " ").replace(/\bLetter\s+0?\d{1,2}\s+[A-Z]\b/g, " ").replace(/(?:^|\s)0?\d{1,2}\s?[A-Z](?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
    return [m[1], norm(who), pre || norm(m[2])].join("|");
  };
  let LETTERS = null;
  function lettersOf(c) {
    if (!isLetterSet(c) || !letterOf(c)) return null;
    if (!LETTERS) {
      LETTERS = new Map(); const seen = new Set();
      CARDS.forEach((x) => {
        if (!isLetterSet(x) || !letterOf(x) || /\((back|inside)\)/i.test(x.name)) return;
        const k = letterGroupKey(x), l = letterOf(x); if (!k) return;
        const id = k + "|" + l.pos + l.letter + "|" + (x.par || "") + "|" + (x.serial || ""); if (seen.has(id)) return; seen.add(id);
        LETTERS.set(k, [...(LETTERS.get(k) || []), x]);
      });
    }
    const k = letterGroupKey(c), cards = (k && LETTERS.get(k)) || [];
    const have = cards.map((x) => ({ x, ...letterOf(x) }));
    const custom = ((DATA.site.letterWords || {})[k] || "").toUpperCase().replace(/[^A-Z]/g, "");
    const name = c.title.replace(/\b(?:creased|damaged|miscut|off-?center|dirty)\b/gi, " ").replace(/\bLetter\s+0?\d{1,2}\s+[A-Z]\b/g, " ").replace(/(?:^|\s)0?\d{1,2}\s?[A-Z](?=\s|$)/g, " ")
      .replace(/\b(jr|sr|ii|iii|iv)\.?\s*$/i, "").replace(/\s+/g, " ").trim().toUpperCase();
    const last = name.split(/\s+/).pop().replace(/[^A-Z]/g, "");
    // Words as shown (with spaces); matching ignores the spaces.
    const shows = [custom, last, name.replace(/[^A-Z ]/g, ""), "CORNHUSKERS", "HUSKERS", "NEBRASKA", "ROOKIE " + last, last + " KANSAS CITY ROYALS", last + " ROYALS"].filter(Boolean);
    const tries = shows.map((w) => w.replace(/[^A-Z]/g, ""));
    // The word that fits the most letters I have (a mistyped letter in a file name shouldn't hide the whole word),
    // as long as at most two don't fit. A word set in config always wins.
    const fit = (w) => have.filter((h) => w[h.pos - 1] === h.letter).length;
    const best = custom || tries.slice().sort((p, q) => fit(q) - fit(p) || tries.indexOf(p) - tries.indexOf(q))[0] || "";
    const word = custom || (best && fit(best) >= Math.min(2, have.length) && have.length - fit(best) <= 2 && Math.max(...have.map((h) => h.pos)) <= best.length ? best : "");
    const shown = word ? (shows[tries.indexOf(word)] || word) : "";
    const len = word.length || Math.max(...have.map((h) => h.pos));
    const slots = Array.from({ length: len }, (_, i) => ({ pos: i + 1, letter: word ? word[i] : (have.find((h) => h.pos === i + 1) || {}).letter || "", cards: have.filter((h) => h.pos === i + 1).map((h) => h.x) }));
    return { key: k, word, shown, who: name.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()), slots, count: slots.filter((s) => s.cards.length).length };
  }
  // One column per letter; a second copy of a letter (another parallel) stacks under the first.
  const letterSlot = (s, shown) => s.cards.length
    ? `<div class="lt-slot"><span class="lt-l">${esc(s.letter)}</span>${s.cards.map((x) => { shown.push(x); return cardHTML(x); }).join("")}</div>`
    : `<div class="lt-slot lt-miss" aria-label="Missing ${esc(s.letter || "letter " + s.pos)}"><span class="lt-l">${esc(s.letter || "?")}</span><div class="lt-blank"><b>${esc(s.letter || "?")}</b><small>Need</small></div></div>`;
  // Every letterman set that spells one word (e.g. all the CORNHUSKERS sets), oldest first.
  function letterSets(word) {
    const first = CARDS.find((x) => isLetterSet(x) && letterOf(x)); if (!first) return [];
    lettersOf(first);   // builds LETTERS
    const out = [];
    (LETTERS ? [...LETTERS.values()] : []).forEach((cards) => { const L = lettersOf(cards[0]); if (L && L.word === word) out.push({ L, c: cards[0] }); });
    return out.sort((p, q) => (p.c.year || 0) - (q.c.year || 0) || p.L.who.localeCompare(q.L.who));
  }
  function wordPage(word) {
    word = (word || "").toUpperCase().replace(/[^A-Z]/g, "");
    const sets = letterSets(word); if (!sets.length) return notFound();
    const sec = SECTIONS[sets[0].c.si]; setNav(sec.slug); setTitle(`${word} letterman sets`);
    const shown = [], have = sets.reduce((n, x) => n + x.L.count, 0), done = sets.filter((x) => x.L.count === x.L.slots.length).length;
    const rows = sets.map(({ L, c }) => {
      const title = c.sub.replace(/\s+#\S+$/, "") + (c.par ? ` - ${c.par}` : "");
      return `<section class="lt-set"><h2><a href="#/letters/${encodeURIComponent(c.id)}">${esc(L.who)}</a></h2>
        <p>${esc(title)} · ${fmt(L.count)} of ${fmt(L.slots.length)}${L.count === L.slots.length ? " · complete ✓" : ""}</p>
        <div class="lt-word" style="--n:${word.length}">${L.slots.map((x) => letterSlot(x, shown)).join("")}</div></section>`;
    }).join("");
    $("#app").innerHTML = `<div class="wrap coll c-${sec.color || "royal"}"><div style="grid-column:1/-1;min-width:0">
      <a class="back" href="#/c/${sec.slug}">← ${esc(sec.title)}</a>
      <div class="c-head"><div class="kick">Letterman sets</div><h1>All my ${esc(word)} sets</h1>
      <p>${fmt(sets.length)} sets, ${fmt(have)} of ${fmt(sets.length * word.length)} letters scanned${done ? `, ${fmt(done)} complete` : ""}. Tap a name for that set's page.</p></div>
      <div class="b-row">${binderBtn()}</div><div class="lt-words">${rows}</div><p class="lt-tip">Tap a card for its details.</p></div></div>`;
    state.list = shown;
  }
  function lettersPage(id) {
    const c = CARDS.find((x) => x.id === id); if (!c) return notFound();
    const L = lettersOf(c); if (!L) return notFound();
    const sec = SECTIONS[c.si], title = c.sub.replace(/\s+#\S+$/, "") + (c.par ? ` - ${c.par}` : "");
    setNav(sec.slug); setTitle(`${c.title} letters`);
    const shown = [];
    const slot = (x) => letterSlot(x, shown);
    // Each word on its own line ("GORDON" / "KANSAS" / "CITY" / "ROYALS"), its letters side by side.
    const lens = L.word ? (L.shown || L.word).split(/\s+/).map((w) => w.replace(/[^A-Z]/g, "").length).filter(Boolean) : [L.slots.length];
    // Every word uses the longest word's column size, so all the cards are the same size.
    let at = 0; const cols = Math.max(...lens);
    const rows = lens.map((n) => { const part = L.slots.slice(at, at + n); at += n;
      return `<div class="lt-word" style="--n:${cols}">${part.map(slot).join("")}</div>`; }).join("");
    $("#app").innerHTML = `<div class="wrap coll c-${sec.color || "royal"}"><div style="grid-column:1/-1;min-width:0">
      <a class="back" href="#/c/${sec.slug}">← ${esc(sec.title)}</a>
      <div class="c-head"><div class="kick">Letterman set</div><h1>${esc(L.shown || L.slots.map((x) => x.letter || "·").join(""))}</h1>
      <p>${esc(L.who)} · ${esc(title)}: ${fmt(L.count)} of ${fmt(L.slots.length)} letters scanned${L.word ? "" : " (the full word isn't known, so missing letters past the last one I have aren't shown)"}.</p></div>
      <div class="b-row">${binderBtn()}</div><div class="lt-words">${rows}</div><p class="lt-tip">Tap a card for its details.${L.word && letterSets(L.word).length > 1 ? ` <a href="#/word/${L.word.toLowerCase()}">See all my ${esc(L.word)} sets →</a>` : ""}</p></div></div>`;
    state.list = shown;
    state.binderItems = L.slots.flatMap((x) => (x.cards.length ? x.cards : [{ empty: true, label: x.letter || "?" }]));
  }
  // Rainbow pages: a soft glow of each parallel's color behind its card (around it, never on the scan).
  // An American flag (stripes, blue canton with star dots) for Independence Day and other stars-and-stripes parallels.
  const FLAG = (() => { const h = 100 / 13; let svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 190 100' preserveAspectRatio='none'>`;
    for (let k = 0; k < 13; k++) svg += `<rect y='${(k * h).toFixed(2)}' width='190' height='${(h + 0.2).toFixed(2)}' fill='${k % 2 ? "#fff" : "#b22234"}'/>`;
    svg += `<rect width='76' height='${(7 * h).toFixed(2)}' fill='#3c3b6e'/>`;
    for (let r = 0; r < 9; r++) for (let c = 0; c < (r % 2 ? 5 : 6); c++) svg += `<circle cx='${(6.3 + c * 12.6 + (r % 2 ? 6.3 : 0)).toFixed(1)}' cy='${(5.4 + r * 5.4).toFixed(1)}' r='1.7' fill='#fff'/>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg + "</svg>")}") center/cover no-repeat`; })();
  const PAR_COLORS = [[/independence day|stars (and|&) stripes|red,? white,? (and|&) blue|\bpatriotic\b/i, FLAG], [/superfractor|rainbow|tie[- ]?dye|mojo|prismatic|kaleidoscope|disco|camo/i, "conic-gradient(from 0deg,#ff5f6d,#ffc371,#5ee7a0,#5aa9ff,#b07cff,#ff5f6d)"],
    [/printing plates?\b.*\bcyan|\bcyan\b/i, "#22c4e0"], [/\bmagenta\b/i, "#d6339a"], [/printing plates?\b.*\byellow|\byellow\b/i, "#f2d33a"],
    [/\bgold(en)?\b/i, "#e0b13a"], [/\borange\b/i, "#f28c28"], [/\bruby\b/i, "#c4123c"], [/\bred\b/i, "#e0453a"], [/\bpink\b/i, "#f06aa8"],
    [/\bsapphire\b/i, "#2a5fd6"], [/\b(light|sky) blue\b|\baqua\b|\bteal\b/i, "#3cc8d8"], [/\bblue\b/i, "#3b74e0"], [/\bemerald\b|\bgreen\b/i, "#2ea85a"],
    [/\bpurple\b|\bviolet\b/i, "#9a62e0"], [/\bbronze\b|\bcopper\b/i, "#c07a3c"], [/\bplatinum\b/i, "#dfe3ea"], [/\bblack\b/i, "#5d6470"],
    [/\bwhite\b/i, "#eef1f5"], [/\bsilver\b|\bchrome\b|refractor|prizm|holo|foil/i, "#c3cad4"]];
  const parColor = (c) => { const t = (c.par || "") + " " + c.name; const hit = PAR_COLORS.find(([re]) => re.test(t)); return hit ? hit[1] : ""; };
  function rainbow(id) {
    const c = CARDS.find((x) => x.id === id); if (!c) return notFound();
    const all = rainbowOf(c); if (all.length < 2) return notFound();
    // The rainbow's name: the set, plus its insert name with the colors taken off ("Five Star - Golden Graphs").
    // Only when every version shares it (no plain base card among them).
    const pars = all.map((x) => (x.par || "").replace(PARALLEL_WORDS, "").trim());
    const common = pars.every(Boolean) ? pars.slice().sort((p, q) => p.length - q.length).find((p) => pars.every((q) => q.toLowerCase().startsWith(p.toLowerCase()))) : "";
    const sec = SECTIONS[c.si], base = c.sub.replace(/\s+#\S+$/, "").replace(PARALLEL_WORDS, "") + (common ? ` - ${common}` : "");
    setNav(sec.slug); setTitle(`${c.title} rainbow`);
    $("#app").innerHTML = `<div class="wrap coll c-${sec.color || "royal"}"><div style="grid-column:1/-1;min-width:0">
      <a class="back" href="#/c/${sec.slug}">← ${esc(sec.title)}</a>
      <div class="c-head"><div class="kick">Rainbow</div><h1>${esc(c.title)}</h1><p>${esc(base)} #${esc(c.sub.match(/#(\S+)$/)[1])}: ${fmt(all.length)} versions scanned, from the rarest down.</p></div><div class="b-row">${binderBtn()}</div>
      <div class="grid rb-grid" id="grid">${all.map((x) => cardHTML(x)).join("")}</div></div></div>`;
    document.querySelectorAll("#grid .cd[data-i]").forEach((el) => { const col = parColor(CARDS[+el.dataset.i]);
      if (col) { el.classList.add("par-bg"); el.style.setProperty(col.startsWith("#") ? "--pc" : "--pg", col); if (col === FLAG) el.classList.add("flag"); } });
    state.list = all;
  }
  function notFound() {
    setTitle("Page not found");
    $("#app").innerHTML = `<div class="wrap nf"><h1>That page isn't here</h1><p>It may have moved when the site was rebuilt. Try searching above, or:</p>
      <div class="go-links"><a href="#/">Home →</a><a href="#/random">Show me a random card →</a><a href="#/checklist">NFL Huskers autograph list →</a><a href="#/media">Media &amp; interviews →</a></div></div>`;
  }

  /* ---------- Router ---------- */
  function route() {
    closeViewer(true); hideBinder(); state.binderItems = null;
    const [path, qs = ""] = location.hash.replace(/^#\/?/, "").split("?");
    const h = decodeURIComponent(path).split("/");
    const [a, b, c] = h;
    const key = a === "c" ? "c/" + b : a;
    // Filters and sort come from the address (?f=auto,relic&sort=old), so a filtered view can be shared or reloaded.
    // Moving between groups of the same collection keeps them.
    const prm = new URLSearchParams(qs), fs = (prm.get("f") || "").split(",").filter((k) => [...FILTERS, ...CUSTOM_FILTERS].some(([x]) => x === k));
    const so = SORTS.some(([k]) => k === prm.get("sort")) ? prm.get("sort") : null;
    if (qs || key !== state.where) { state.filters = new Set(fs); state.sort = so || "new"; }
    state.where = key;
    if (a !== "search") { state.q = ""; $("#q").value = ""; }
    if (!a) home();
    else if (a === "c") collection(b, c);
    else if (a === "customs") collection("customs");
    else if (a === "all") collection("all");
    else if (a === "checklist") checklist(b);
    else if (a === "nfl-huskers") hub();
    else if (a === "nfl-teams") nflTeams(b);
    else if (a === "media") media();
    else if (a === "stats") (b === "players" ? statsPlayers() : statsPage());
    else if (a === "rainbow") rainbow(b);
    else if (a === "set") setPage(b);
    else if (a === "letters") lettersPage(b);
    else if (a === "word") wordPage(b);
    else if (a === "random") { home(); history.replaceState(null, "", "#/"); setTimeout(() => $("#dice").click(), 50); }
    else if (a === "dye-career") dyeCareer();
    else if (a === "player") player(b);
    else if (a === "player-cards") playerCardsPage(b);
    else if (a === "search") { state.q = h.slice(1).join("/"); $("#q").value = state.q; collection("search"); }
    else if (a === "card") {   // a shared card link opens the card over its own collection
      const k = CARDS.findIndex((x) => x.id === b); if (k < 0) return notFound();
      const card = CARDS[k], slug = SECTIONS[card.si].slug;
      history.replaceState(null, "", "#/c/" + slug); state.where = "c/" + slug; state.filters.clear(); state.sort = "new";
      collection(slug); window.scrollTo(0, 0);
      const j = state.list.findIndex((x) => x.i === card.i);
      return openViewer(j >= 0 ? j : 0, j >= 0 ? state.list : [card]);
    }
    else notFound();
    window.scrollTo(0, 0);
    track();
  }
  /* ---------- Analytics: GoatCounter (no cookies), when config analytics.goatcounter has my site code ---------- */
  // Each #/ page counts as its own page, e.g. /cardcollection-site/#/player/ricky-simmons.
  function track() {
    const code = (DATA && DATA.site.analytics || {}).goatcounter; if (!code) return;
    const path = location.pathname + (location.hash.split("?")[0] || "#/");
    if (window.goatcounter && window.goatcounter.count) return void setTimeout(() => window.goatcounter.count({ path, title: document.title }), 300);
    if (document.getElementById("gc-js")) return;
    window.goatcounter = { no_onload: true };
    const sc = document.createElement("script");
    sc.id = "gc-js"; sc.async = true; sc.src = "https://gc.zgo.at/count.js";
    sc.dataset.goatcounter = `https://${encodeURIComponent(code)}.goatcounter.com/count`;
    sc.onload = () => track();
    document.head.appendChild(sc);
  }
  function syncURL() {
    const p = [];
    if (state.filters.size) p.push("f=" + [...state.filters].join(","));
    if (state.sort !== "new") p.push("sort=" + state.sort);
    history.replaceState(history.state, "", location.hash.split("?")[0] + (p.length ? "?" + p.join("&") : ""));
  }
  window.addEventListener("hashchange", route);

  /* ---------- Search box ---------- */
  let t;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      const q = e.target.value.trim();
      if (q) history.replaceState(null, "", "#/search/" + encodeURIComponent(q)), (state.q = q), collection("search");
      else location.hash = "#/";
    }, 160);
  });
  $("#search-form").addEventListener("submit", (e) => e.preventDefault());
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== $("#q") && $("#viewer").hidden) { e.preventDefault(); $("#q").focus(); }
  });

  /* ---------- Viewer ---------- */
  const V = { list: [], k: 0, back: false };
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".cd[data-i]"); if (!b) return;
    // From the home page's Newest strip, open the card over its own collection, so closing it leaves you browsing.
    if (b.closest(".mq")) { location.hash = "#/card/" + CARDS[+b.dataset.i].id; return; }
    const i = +b.dataset.i, list = state.list.length && state.list.some((c) => c.i === i) ? state.list : [CARDS[i]];
    openViewer(list.findIndex((c) => c.i === i), list);
  });
  // Desktop shows a card's front and back side by side; phones flip between them with a tap.
  const wide = window.matchMedia("(min-width: 900px)");
  function openViewer(k, list, random) {
    V.list = list; V.k = k; V.back = false; V.zoom = false; V.random = !!random;
    $("#viewer").hidden = false; document.body.style.overflow = "hidden"; showCard(); $("#v-close").focus();
    // An extra history step, so the phone's Back button closes the card instead of leaving the page.
    // The step remembers which list and card were open, so coming Back to it reopens the same card.
    if (!(history.state && history.state.v)) { const t = ++VSEQ; VIEWS.set(t, { list: V.list, k: V.k, random: V.random }); history.pushState({ v: 1, t }, "", location.href); }
  }
  const VIEWS = new Map(); let VSEQ = 0, FROM_CARD = null;
  // Back onto a step where a card was open (e.g. from a rainbow or set page opened in the viewer): reopen that card.
  // And the page's own "← back" link goes back to the card too.
  addEventListener("hashchange", () => {
    const st = history.state, saved = st && st.v && VIEWS.get(st.t);
    if (saved && $("#viewer").hidden) {
      V.list = saved.list; V.k = saved.k; V.back = false; V.zoom = false; V.random = saved.random;
      $("#viewer").hidden = false; document.body.style.overflow = "hidden"; showCard();
    }
    if (FROM_CARD !== location.hash) { FROM_CARD = null; return; }
    // Reached from a card: a bar like the viewer's (round back button, page name), and the page slides in,
    // so it reads as a step forward, not as leaving.
    requestAnimationFrame(() => {
      const b = $("#app a.back"); if (!b) return;
      const kind = ($("#app .kick") || {}).textContent || "", name = ($("#app h1") || {}).textContent || "";
      b.outerHTML = `<div class="fc-bar"><a class="back v-ic" href="${esc(FROM_CARD)}" aria-label="Back to card"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></a>
        <div class="v-mid"><b>${esc(kind)}${kind && name ? " · " : ""}${esc(name)}</b><span>Back to card</span></div><span></span></div>`;
      $("#app").classList.remove("slide-in"); void $("#app").offsetWidth; $("#app").classList.add("slide-in");
    });
  });
  $("#viewer").addEventListener("click", (e) => { const a = e.target.closest("a[href^='#/']"); if (a) FROM_CARD = a.getAttribute("href"); });
  document.addEventListener("click", (e) => {
    const a = e.target.closest("#app a.back");
    if (a && FROM_CARD && FROM_CARD === location.hash) { e.preventDefault(); history.back(); }
  });
  function closeViewer(silent) {
    if ($("#viewer").hidden) return;
    $("#viewer").hidden = true; document.body.style.overflow = ""; $("#v-stage").classList.remove("zoom", "pair"); $("#viewer").classList.remove("focus"); ["#v-img", "#v-img2"].forEach((q) => { const e = $(q); e.removeAttribute("src"); e.classList.remove("wm"); e.dataset.id = ""; }); $("#v-aura").className = "v-aura";
    if (!silent && history.state && history.state.v) history.back();
  }
  window.addEventListener("popstate", () => { if (!$("#viewer").hidden && !(history.state && history.state.v)) closeViewer(true); });
  /* Watermark: anything saved from the card viewer carries "IANBADEER.COM" in the lower part of the card,
     centered, like COMC, while visitors see the clean card. The viewer's <img> holds the marked copy (so
     right-click / long-press "Save image" gets it) but hides it, and shows the clean copy as its background. */
  const MARKED = new Map();   // file id -> {plain, marked} object URLs (kept for this visit)
  function marked(id, rk) {
    if (MARKED.has(id)) return MARKED.get(id);
    const p = new Promise((ok, no) => {
      const im = new Image(); im.crossOrigin = "anonymous";
      im.onload = () => {
        try {
          const cv = document.createElement("canvas"); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
          const g = cv.getContext("2d"); g.drawImage(im, 0, 0);
          // Small blob URLs (not huge data: URLs): phones redraw them without a blink.
          const plainP = new Promise((r) => cv.toBlob((b) => r(b && URL.createObjectURL(b)), "image/jpeg", 0.92));
          // Like COMC: centered, about 80% of the way down the card, spanning ~60% of its width;
          // see-through gray letters with a light edge so it reads on light and dark cards.
          const word = "IANBADEER.COM";
          g.textAlign = "center"; g.textBaseline = "middle";
          g.font = `800 100px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
          const per = g.measureText(word).width / 100;
          const size = Math.max(14, Math.min((cv.width * 0.6) / per, cv.height * 0.085));
          g.font = `800 ${size}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
          const x = cv.width / 2, y = cv.height * 0.8;
          g.lineJoin = "round"; g.lineWidth = Math.max(1.5, size * 0.05);
          g.strokeStyle = "rgba(255,255,255,.42)"; g.strokeText(word, x, y);
          g.fillStyle = "rgba(60,60,60,.40)"; g.fillText(word, x, y);
          plainP.then((plain) => cv.toBlob((b) => (b && plain ? ok({ plain, marked: URL.createObjectURL(b) }) : no(new Error("no image"))), "image/jpeg", 0.9));
        } catch (e) { no(e); }
      };
      im.onerror = () => no(new Error("image failed"));
      im.src = img(id, rk, 1600);
    });
    p.catch(() => MARKED.delete(id));
    MARKED.set(id, p);
    return p;
  }
  // Both versions decoded and kept in memory, so swapping them in never blinks.
  const READY = new Map();
  const ready = (id, rk) => marked(id, rk).then((u) => u.keep ? u : Promise.all((u.keep = [u.plain, u.marked].map((s) => { const i = new Image(); i.src = s; return i; })).map((i) => i.decode().catch(() => {}))).then(() => (READY.set(id, u), u)));
  // Show a card in one step: the old card (and its aura, via `done`) stays until the new picture is decoded,
  // then picture and effects change together. The large clean/marked pair replaces the preview when it's ready.
  function loadInto(el, c, id, rk, alt, done) {
    el.dataset.id = id; el.alt = alt;
    let big = false;
    const live = () => el.dataset.id === id && V.list[V.k] === c;
    const showBig = (u) => { big = true; el.style.setProperty("--plain", `url("${u.plain}")`); el.classList.add("wm"); el.src = u.marked; };
    if (READY.has(id)) { showBig(READY.get(id)); if (done) done(); return; }
    const t = new Image(); t.src = img(id, rk, 400);
    t.decode().catch(() => {}).then(() => {
      if (!live() || big) return;
      el.classList.remove("wm"); el.style.removeProperty("--plain"); el.src = t.src;
      if (done) done();
    });
    ready(id, rk).then((u) => { if (live()) requestAnimationFrame(() => { if (live()) showBig(u); }); })
      .catch(() => { if (live()) el.src = img(id, rk, 1600); });   // no mark possible: plain large image
  }
  // Get the next card ready while this one is looked at.
  const prefetch = () => { const n = V.list[V.k + 1]; if (n && n.id && !n.photo && !READY.has(n.id)) setTimeout(() => ready(n.id, n.rk).catch(() => {}), 600); };
  // "Save image": the marked image, named after the card.
  async function saveCard() {
    const c = V.list[V.k]; if (!c) return;
    const back = !isPair(c) && V.back && c.backId, id = back ? c.backId : c.id, rk = back ? c.backRk : c.rk;
    const b = $("#v-save"); b.dataset.tip = "Saving…";
    try {
      const u = (await marked(id, rk)).marked, a = document.createElement("a");
      a.href = u; a.download = (String(c.name || c.caption || "card").replace(/[\\/:*?"<>|#]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) + (back ? " (back)" : "")) + ".jpg";
      document.body.appendChild(a); a.click(); a.remove();
      b.dataset.tip = "Saved";
    } catch (e) { b.dataset.tip = "Couldn't save"; }
    setTimeout(() => delete b.dataset.tip, 1600);
  }
  const isPair = (c) => wide.matches && !!c.backId && !V.zoom;
  function showCard() {
    const c = V.list[V.k]; if (!c) return;
    $("#v-copy").hidden = !!c.photo;
    if (c.photo) {   // a photo with a player: caption instead of card details
      const stage = $("#v-stage"); stage.classList.remove("pair"); stage.classList.toggle("zoom", V.zoom && wide.matches);
      loadInto($("#v-img"), c, c.id, c.rk, c.caption, () => aura(c)); $("#v-img2").hidden = true;
      $("#v-title").innerHTML = `${esc(c.short)}${c.caption !== c.short ? `<small>${esc(c.caption)}</small>` : ""}`;
      $("#v-have").hidden = true; $("#v-dice").hidden = true; $("#v-more").innerHTML = ""; showBackText(null);
      $("#v-flip").hidden = true;
      $("#v-meta").innerHTML = `<span>With the players</span><span>·</span><span>${V.k + 1} of ${fmt(V.list.length)}</span>`;
      navState();
      return;
    }
    const pair = isPair(c), stage = $("#v-stage"), im = $("#v-img"), im2 = $("#v-img2");
    const back = !pair && V.back;
    const id = back ? c.backId : c.id, rk = back ? c.backRk : c.rk;
    loadInto(im, c, id, rk, c.name + (back ? " (back)" : ""), () => aura(c));
    im2.hidden = !pair;
    if (pair) loadInto(im2, c, c.backId, c.backRk, c.name + " (back)");
    stage.classList.toggle("pair", pair);
    stage.classList.toggle("zoom", V.zoom && wide.matches);
    $("#v-title").innerHTML = `${esc(c.title)}<small>${esc(c.sub || "")}${c.par ? " · " + esc(c.par) : ""}</small>`;
    $("#v-flip").hidden = !c.backId || pair; $("#v-flip").textContent = V.back ? "Show front" : "Show back";
    delete $("#v-save").dataset.tip;
    const sec = SECTIONS[c.si];
    // Want List cards get a button that starts an email to me with the card already named.
    $("#v-have").hidden = !(sec.kind === "want" && (DATA.site.contact || {}).code);
    if (!$("#v-have").hidden) $("#v-have").innerHTML = contactHTML("I have this card", "I have a card from your Want List: " + c.name,
      `Hi Ian,\n\nI have this card from your Want List:\n${c.name}\n${location.href.split("#")[0]}#/card/${c.id}\n\n`, c.name);
    $("#v-dice").hidden = !V.random;
    prefetch();
    showBackText(c);
    const setKey = (x) => x.sub.replace(/\s+#\S+$/, ""), same = (f) => CARDS.filter((x) => x !== c && f(x) && !/\((back|inside)\)/i.test(x.name));
    const bySet = c.sub ? same((x) => x.sub && setKey(x) === setKey(c)) : [], byPlayer = c.title ? same((x) => plainTitle(x) === plainTitle(c)) : [];
    $("#v-more").innerHTML = (bySet.length ? `<button type="button" class="btn" data-more="set">More from ${esc(setKey(c))} (${fmt(bySet.length)} scan${bySet.length === 1 ? "" : "s"})</button>` : "")
      + (byPlayer.length && byPlayer.length < CARDS.length ? `<button type="button" class="btn" data-more="player">More of ${esc(plainTitle(c))} (${fmt(byPlayer.length)} scan${byPlayer.length === 1 ? "" : "s"})</button>` : "");
    V.more = { set: [c, ...bySet], player: [c, ...byPlayer] };
    const rb = rainbowOf(c);
    const lt = lettersOf(c);
    if (lt && lt.count >= 1 && (lt.word || lt.count > 1)) $("#v-more").insertAdjacentHTML("afterbegin", `<a class="btn rb-btn" href="#/letters/${encodeURIComponent(c.id)}">🔤 View letters (${lt.count} of ${lt.slots.length})</a>`);
    const st = setOf(c);
    if (st.length) $("#v-more").insertAdjacentHTML("afterbegin", `<a class="btn rb-btn" href="#/set/${encodeURIComponent(c.id)}">📚 View set (${new Set(st.map((x) => norm(x.title))).size} players)</a>`);
    if (rb.length > 1) $("#v-more").insertAdjacentHTML("afterbegin", `<a class="btn rb-btn" href="#/rainbow/${encodeURIComponent(c.id)}">🌈 View rainbow (${rb.length})</a>`);
    $("#v-meta").innerHTML = `${badges(c)}<span>${esc(sec.title)} · ${esc(sec.groups[c.gi].label)}</span><span>·</span><span>${V.random ? "Random card" : `${V.k + 1} of ${fmt(V.list.length)}`}</span><span>·</span><span style="font-family:var(--f-m)">${esc(c.name)}</span>`;
    navState();
  }
  /* Card back text: transcriptions of custom card backs (data/card-text.json, keyed by Drive file ID),
     readable under "Read the back" and linked to the image for screen readers. Loaded the first time it's needed. */
  let BACKTEXT = null;
  const backText = () => BACKTEXT || (BACKTEXT = fetch("data/card-text.json").then((r) => (r.ok ? r.json() : {})).then((d) => d.cards || {}).catch(() => ({})));
  function textHTML(t) {
    const out = [];
    for (const block of String(t || "").split(/\n\s*\n/)) {
      const lines = block.split("\n").map((x) => x.trim()).filter(Boolean); if (!lines.length) continue;
      if (lines.every((l) => l.includes(" | "))) {
        const rows = lines.map((l) => l.split(" | ").map((x) => x.trim()));
        out.push(`<div class="vt-tbl"><table><thead><tr>${rows[0].map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      } else if (lines[0].startsWith("## ")) {
        out.push(`<h3>${esc(lines[0].slice(3))}</h3>` + (lines.length > 1 ? `<p>${lines.slice(1).map(esc).join("<br>")}</p>` : ""));
      } else out.push(`<p>${lines.map(esc).join("<br>")}</p>`);
    }
    return out.join("");
  }
  function showBackText(c) {
    // Only for card backs: the text is keyed to the back scan, and the button shows only while the back is on screen
    // (flipped to the back on a phone, or front and back side by side on a wide screen).
    const btn = $("#v-read"), box = $("#v-text");
    btn.hidden = true; box.hidden = true; box.innerHTML = ""; btn.setAttribute("aria-expanded", "false");
    ["#v-img", "#v-img2"].forEach((q) => $(q).removeAttribute("aria-describedby"));
    if (!c || c.photo || !c.backId || !c.tags.has("custom")) return;   // customs only: Ian's own writing
    const pair = isPair(c); if (!pair && !V.back) return;
    backText().then((all) => {
      if (V.list[V.k] !== c || (!isPair(c) && !V.back)) return;
      const e = all[c.backId]; if (!e || !e.text) return;
      box.innerHTML = `<div class="vt-in"><h2>Card back</h2>${textHTML(e.text)}<button type="button" class="btn vt-close">Close</button></div>`;
      btn.hidden = false; $(pair ? "#v-img2" : "#v-img").setAttribute("aria-describedby", "v-text");
    });
  }
  $("#v-read").addEventListener("click", () => { const box = $("#v-text"), open = box.hidden; box.hidden = !open; $("#v-read").setAttribute("aria-expanded", String(open)); if (open) box.scrollTop = 0; });
  $("#v-text").addEventListener("click", (e) => { if (e.target.closest(".vt-close")) { $("#v-text").hidden = true; $("#v-read").setAttribute("aria-expanded", "false"); } });
  const step = (d) => { const n = V.k + d; if (n >= 0 && n < V.list.length) { V.k = n; V.back = false; V.zoom = false; showCard(); } };
  $("#v-prev").onclick = () => step(-1); $("#v-next").onclick = () => step(1);
  $("#v-close").onclick = $("#v-back").onclick = () => closeViewer();
  // Top bar (always shown; the main way around on phones): back, "3 of 24", and previous/next.
  function navState() {
    const st = history.state; if (st && st.v && VIEWS.has(st.t)) VIEWS.set(st.t, { list: V.list, k: V.k, random: V.random });
    const first = V.k <= 0, last = V.k >= V.list.length - 1;
    $("#v-prev").style.visibility = first ? "hidden" : "visible"; $("#v-next").style.visibility = last ? "hidden" : "visible";
    $("#v-name").textContent = (V.list[V.k] || {}).title || (V.list[V.k] || {}).short || "";
    $("#viewer").classList.toggle("focus", V.zoom && !wide.matches);
    $("#v-pos").textContent = V.random ? "Random card" : `${V.k + 1} of ${fmt(V.list.length)}`;
  }
  // Keep exploring inside the viewer: swap in the cards from the same set, or of the same player.
  $("#v-more").addEventListener("click", (e) => {
    const b = e.target.closest("[data-more]"); if (!b || !V.more) return;
    const list = V.more[b.dataset.more]; if (!list || list.length < 2) return;
    V.list = list; V.k = Math.min(1, list.length - 1); V.back = false; V.zoom = false; V.random = false; showCard();
  });
  $("#v-save").onclick = saveCard;
  $("#v-flip").onclick = () => { V.back = !V.back; V.zoom = false; showCard(); };
  // Click an image: on desktop, zoom into that side (click again to go back);
  // on a phone, the page around the card hides so the whole card fills the screen (tap again to bring it back).
  function imageClick(side) {
    const c = V.list[V.k];
    if (V.zoom) V.zoom = false;
    else { V.zoom = true; if (c.backId) V.back = side === "back"; }
    showCard();
  }
  $("#v-img").onclick = () => imageClick(isPair(V.list[V.k]) ? "front" : V.back ? "back" : "front");
  $("#v-img2").onclick = () => imageClick("back");
  wide.addEventListener("change", () => { if (!$("#viewer").hidden) { V.zoom = false; showCard(); } });
  $("#v-copy").onclick = async () => {
    const c = V.list[V.k], url = location.href.split("#")[0] + "#/card/" + c.id;
    try { await navigator.clipboard.writeText(url); $("#v-copy").dataset.tip = "Link copied"; }
    catch { $("#v-copy").dataset.tip = "Copy failed"; }
    setTimeout(() => delete $("#v-copy").dataset.tip, 1600);
  };
  document.addEventListener("keydown", (e) => {
    if ($("#viewer").hidden) return;
    if (e.key === "Escape") closeViewer(); else if (e.key === "ArrowLeft") step(-1); else if (e.key === "ArrowRight") step(1);
    else if (e.key.toLowerCase() === "f" && !$("#v-flip").hidden) $("#v-flip").click();
  });
  let tx = null;
  $("#v-stage").addEventListener("touchstart", (e) => (tx = e.touches[0].clientX), { passive: true });
  $("#v-stage").addEventListener("touchend", (e) => { if (tx == null) return; const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); tx = null; });
  $("#viewer").addEventListener("click", (e) => { if (e.target.id === "v-stage" || e.target.id === "viewer") closeViewer(); });

  /* ---------- Card auras: effects around special cards in the viewer, never on the scan itself ---------- */
  // 1/1: gold glow, light rays and sparkles. Numbered /25 or lower: a soft pulsing glow. Autographs: a faint ink-blue
  // glow. Refractors, Prizms, chrome and foil: a rainbow halo circling the card's edge. The rarest one wins.
  const HOLO = /\b(refractors?|prizms?|chrome|foil|holo(?:foil|graphic)?|x-?fractors?|superfractors?|diffractors?|shimmer|mojo|cracked ice|mirror|atomic|spectrum|sapphire|optic|finest|wave|rainbow|galactic|lava|hyper|disco|scope)\b/i;
  // Dirt relics (the Dirt Relics group, or "Dirt"/"(Dirty" in the name): a dusty brown haze with kicked-up specks.
  // Same card filed in another collection too (e.g. Alex Gordon) gets it as well.
  let DIRT;
  const isDirt = (c) => {
    DIRT ||= new Set(CARDS.filter((x) => SECTIONS[x.si]?.groups[x.gi]?.slug === "dirt").map((x) => x.name));
    return DIRT.has(c.name) || /\bdirt\b|\(dirty\b/i.test(c.name);
  };
  const auraTier = (c) => !c || c.photo ? "" : c.one ? "one" : c.serial && c.serial <= 25 ? "low" : isDirt(c) ? "dirt" : c.tags.has("auto") ? "auto" : HOLO.test(c.name) ? "holo" : "";
  function placeAura() {
    const a = $("#v-aura"), im = $("#v-img"), st = $("#v-stage");
    if (!a.className.match(/\bt-/) || st.classList.contains("zoom") || !im.offsetWidth) { a.hidden = true; return; }
    a.hidden = false;
    Object.assign(a.style, { left: im.offsetLeft + "px", top: im.offsetTop + "px", width: im.offsetWidth + "px", height: im.offsetHeight + "px" });
    if (a.classList.contains("t-dirt")) dirt(a, im.offsetWidth, im.offsetHeight);
  }
  // Dirt: crumbly clumps and fine powder drawn on a canvas around the card (behind it; the scan stays clean).
  // Seeded by the card, so the same card always gets the same pile.
  function dirt(a, w, h) {
    let cv = a.querySelector("canvas");
    const key = a.dataset.seed + "|" + w + "x" + h;
    if (cv && cv.dataset.key === key) return;
    if (!cv) { cv = document.createElement("canvas"); cv.className = "v-dirt"; a.append(cv); }
    cv.dataset.key = key;
    const m = Math.round(Math.min(w, h) * 0.22), W = w + 2 * m, H = h + 2 * m, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; Object.assign(cv.style, { left: -m + "px", top: -m + "px", width: W + "px", height: H + "px" });
    const g = cv.getContext("2d"); g.scale(dpr, dpr);
    let sd = [...String(a.dataset.seed)].reduce((x, ch) => (x * 31 + ch.charCodeAt(0)) >>> 0, 7) || 1;
    const R = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
    // A point outside the card, mostly close to its edge, with more at the bottom (a little pile).
    const spot = (spread) => {
      for (;;) {
        const side = R(), d = Math.pow(R(), 1.8) * m * spread, t = R();
        let x, y;
        if (side < 0.4) { x = m + t * w; y = m + h - 4 + d; }
        else if (side < 0.6) { x = m + t * w; y = m + 4 - d; }
        else if (side < 0.8) { x = m + 4 - d; y = m + t * h; }
        else { x = m + w - 4 + d; y = m + t * h; }
        if (x > 0 && y > 0 && x < W && y < H) return [x, y];
      }
    };
    const browns = [[78, 48, 26], [98, 62, 34], [120, 80, 44], [64, 38, 20], [138, 94, 54]];
    // Fine powder first, then crumbs, then clumps on top.
    for (let i = 0; i < 6000; i++) {
      const [x, y] = spot(1), c = browns[(R() * browns.length) | 0];
      g.fillStyle = `rgba(${c},${0.25 + R() * 0.5})`; g.beginPath(); g.arc(x, y, 0.4 + R() * 1.3, 0, 7); g.fill();
    }
    const chunk = (x, y, r) => {
      const n = 6 + ((R() * 6) | 0), pts = [];
      for (let k = 0; k < n; k++) { const an = (k / n) * 6.283 + R() * 0.5, rr = r * (0.6 + R() * 0.55); pts.push([x + Math.cos(an) * rr, y + Math.sin(an) * rr * (0.75 + R() * 0.3)]); }
      const c = browns[(R() * browns.length) | 0];
      const gr = g.createLinearGradient(x - r, y - r, x + r, y + r);
      gr.addColorStop(0, `rgb(${c.map((v) => Math.min(255, v + 38))})`); gr.addColorStop(0.55, `rgb(${c})`); gr.addColorStop(1, `rgb(${c.map((v) => v * 0.55)})`);
      g.fillStyle = gr; g.beginPath(); pts.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); g.fill();
      if (r > 3) { g.strokeStyle = "rgba(160,115,70,.35)"; g.lineWidth = 0.8; g.stroke(); }
    };
    const sc = Math.min(w, h) / 400;
    for (let i = 0; i < 900; i++) { const [x, y] = spot(0.9); chunk(x, y, (1 + R() * 2.5) * Math.max(0.7, sc)); }
    for (let i = 0; i < 160; i++) { const [x, y] = spot(0.6); chunk(x, y, (3 + R() * 7) * Math.max(0.7, sc)); }
    for (let i = 0; i < 26; i++) { const [x, y] = spot(0.4); chunk(x, y, (8 + R() * 9) * Math.max(0.7, sc)); }
  }
  function aura(c) {
    const a = $("#v-aura"), front = !(V.back && !isPair(c));
    a.className = "v-aura" + (front && auraTier(c) ? " t-" + auraTier(c) : "");
    a.dataset.seed = c ? c.id : "";
    requestAnimationFrame(placeAura);
  }
  // Keep the aura on the front card: it moves when either image loads or changes size (e.g. the back arriving).
  ["#v-img", "#v-img2"].forEach((q) => $(q).addEventListener("load", () => requestAnimationFrame(placeAura)));
  if (window.ResizeObserver) { const ro = new ResizeObserver(() => { if (!$("#viewer").hidden) placeAura(); }); ro.observe($("#v-img")); ro.observe($("#v-img2")); ro.observe($("#v-stage")); }
  window.addEventListener("resize", () => { if (!$("#viewer").hidden) placeAura(); });

  /* ---------- Random card: the dice in the header ---------- */
  // On a collection page it picks from that page's cards (with any filters on); anywhere else, from every card.
  let lastRandom = -1;
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  function randomCard() {
    const here = /^(c\/|customs$|all$|search$)/.test(state.where || "") && state.list.length ? state.list : CARDS;
    const pool = here.filter((c) => !/\((back|inside)\)/i.test(c.name));
    if (!pool.length) return null;
    let c;
    for (let n = 0; n < 6; n++) { c = pool[Math.floor(Math.random() * pool.length)]; if (c.i !== lastRandom || pool.length === 1) break; }
    lastRandom = c.i; return c;
  }
  function roll(el) { if (!el || calm.matches) return; el.classList.remove("roll"); void el.offsetWidth; el.classList.add("roll"); }
  $("#dice").addEventListener("click", () => {
    if (!CARDS || !CARDS.length) return;
    const c = randomCard(); if (!c) return;
    roll($("#dice"));
    setTimeout(() => openViewer(0, [c], true), calm.matches ? 0 : 260);
  });
  $("#v-dice").addEventListener("click", () => {
    const c = randomCard(); if (!c) return;
    roll($("#v-dice"));
    const show = () => { V.list = [c]; V.k = 0; V.back = false; V.zoom = false; showCard(); };
    if (calm.matches) return show();
    const st = $("#v-stage"); st.classList.remove("shuffle"); void st.offsetWidth; st.classList.add("shuffle");
    setTimeout(show, 190);
    setTimeout(() => st.classList.remove("shuffle"), 420);
  });

  /* ---------- Boot ---------- */
  // The live Gordon and Dye numbers from the Inventory Stats master (published by the robot) load alongside the cards.
  const statsReady = fetch("data/lists/inventory-stats.json").then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => (INV = (d && d.tables) || {}));
  if (window.CATALOG) statsReady.then(() => load(window.CATALOG));
  else Promise.all([fetch("data/catalog.json").then((r) => r.json()), statsReady]).then(([cat]) => load(cat))
    .catch(() => ($("#app").innerHTML = `<p class="empty">The card list didn't load. Refresh the page to try again.</p>`));
})();
