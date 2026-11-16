/* IanBadeer.com — reads data/catalog.json (built from the Google Drive folders) and renders the gallery. */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => n.toLocaleString("en-US");

  // Image URLs straight from Google Drive. A page can override this (used by the offline preview).
  const img = window.IMG_SRC || ((id, rk, w) => `https://lh3.googleusercontent.com/d/${id}=w${w}${rk ? `?resourcekey=${rk}` : ""}`);
  const driveUrl = (id, rk) => `https://drive.google.com/file/d/${id}/view${rk ? `?resourcekey=${rk}` : ""}`;

  let DATA, CARDS, SECTIONS, NEW_CUTOFF;

  /* ---------- File-name parsing ---------- */
  const RX = {
    main: /^(\d{4}(?:-\d{2})?)\s+(.*?)\s+#(\S+)\s+(.*)$/,
    serial: /#'?d\s*(?:to\s*)?(\d+)\s*(?:of\s*(\d+))?|print run of\s*(\d+)|\b(\d+)\s+of\s+(\d+)\b/i,
    grade: /\b(PSA|BGS|SGC|CGC|BVG|HGA)\b(?:\s+(?:DNA|GEM MT|GEM MINT|MINT|NM-MT|AUTH(?:ENTIC)?))*(?:\s+(\d+(?:\.\d)?))?/i,
    auto: /\b(auto(?:graph)?s?|autographed|signed|signatures?|sigs?|ink)\b/i,
    relic: /\b(relics?|patch(?:es)?|jerseys?|bat|materials?|buttons?|nameplates?|dirt|swatch|game[- ]used|threads|glove|logo(?:man)?|laundry|tag|letter|memorabilia|rpm|jumbo)\b/i,
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
    if (RX.auto.test(name)) out.tags.add("auto");
    if (RX.relic.test(name)) out.tags.add("relic");
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

  /* ---------- Data ---------- */
  function load(json) {
    DATA = json; SECTIONS = json.sections;
    CARDS = json.cards.map((c, i) => {
      const [id, rk, name, si, gi, added, backId, backRk] = c;
      const p = parse(name);
      if (backId) p.tags.add("back");
      return { i, id, rk, name, si, gi, added, backId, backRk, ...p, hay: (name + " " + SECTIONS[si].title + " " + SECTIONS[si].groups[gi].label).toLowerCase() };
    });
    const dates = [...new Set(CARDS.map((c) => c.added))].sort().reverse();
    NEW_CUTOFF = dates[Math.min(dates.length - 1, 1)] || ""; // cards from the two most recent "drops" count as new
    const d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    if (NEW_CUTOFF < d30) NEW_CUTOFF = dates[0];
    $("#q").placeholder = `Search ${fmt(CARDS.length)} cards… try “Triple Threads”`;
    renderNav(); renderFoot(); route();
  }

  /* ---------- Shared bits ---------- */
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
  function sectionCards(si) { return CARDS.filter((c) => c.si === si); }
  // A section with no scans yet (e.g. a new folder still being filled) stays out of menus and tiles.
  function shown(s) { const si = SECTIONS.indexOf(s); return CARDS.some((c) => c.si === si); }
  function search(list, q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? list.filter((c) => words.every((w) => c.hay.includes(w))) : list;
  }

  /* ---------- Views ---------- */
  // Nebraska sections and the Husker autograph pages share one "Nebraska Cornhuskers" dropdown.
  const isNeb = (s) => /^husker-/.test(s.slug);
  function renderNav() {
    const neb = SECTIONS.filter((s) => shown(s) && isNeb(s));
    $("#nav").innerHTML = SECTIONS.filter((s) => shown(s) && !isNeb(s)).map((s) => `<a href="#/c/${s.slug}" data-s="${s.slug}">${esc(s.title)}</a>`).join("") + `<a href="#/customs" data-s="customs">Customs</a>`
      + `<button type="button" class="dd-btn" id="dd-btn" aria-expanded="false" aria-controls="dd-menu">Nebraska Cornhuskers <span aria-hidden="true">▾</span></button>`;
    document.body.insertAdjacentHTML("beforeend", `<div class="dd-menu" id="dd-menu" hidden>${neb.map((s) => `<a href="#/c/${s.slug}" data-s="${s.slug}">${esc(s.title)}</a>`).join("")}</div>`);
    $("#dd-btn").addEventListener("click", (e) => { e.stopPropagation(); $("#dd-menu").hidden ? openDD() : closeDD(); });
    // The autograph pages appear once the checklist data has been published.
    fetch("data/lists/husker-pros.json", { method: "HEAD" }).then((r) => {
      if (!r.ok || $('#dd-menu a[href="#/checklist"]')) return;
      $("#dd-menu").insertAdjacentHTML("beforeend", `${CK_PAGES.map((x, k) => `<a href="#/checklist${x.path}" data-s="checklist${x.path}"${k === 0 ? ' class="sep"' : ""}>${x.label}</a>`).join("")}
        <a href="#/nfl-huskers" data-s="nfl-huskers" class="sep">NFL Huskers Player Pages</a>`);
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
    $("#foot").innerHTML = `<div class="wrap"><span>Trades, questions, or a card I need? Email <span class="email">${esc(s.email)}</span></span><span>${fmt(CARDS.length)} scans · updated ${esc(DATA.generated.slice(0, 10))}</span></div>`;
  }
  let NAV_NOW = null;
  function setNav(slug) {
    NAV_NOW = slug;
    document.querySelectorAll("#nav a, #dd-menu a").forEach((a) => (a.dataset.s === slug ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    const dd = $("#dd-btn"); if (dd) dd.classList.toggle("on", !!$("#dd-menu a[aria-current]"));
  }

  function home() {
    setNav(null);
    const s = DATA.site;
    const feat = CARDS.find((c) => s.featured && c.name.includes(s.featured.match)) || CARDS.find((c) => c.one);
    const newest = sortList(CARDS, "new").slice(0, 40);
    const autos = CARDS.filter((c) => c.tags.has("auto")).length, ones = CARDS.filter((c) => c.one).length;
    const tiles = SECTIONS.map((sec, si) => {
      if (!shown(sec)) return "";
      const list = sectionCards(si);
      const pick = [...list.filter((c) => c.one || c.tags.has("relic")), ...list].filter((c, k, a) => a.indexOf(c) === k);
      const step = Math.max(1, Math.floor(pick.length / 4));
      const four = [0, 1, 2, 3].map((k) => pick[k * step]).filter(Boolean);
      return `<a class="tile c-${sec.color}" href="#/c/${sec.slug}">
        <div class="fan">${four.map((c) => `<img loading="lazy" alt="" src="${img(c.id, c.rk, 240)}">`).join("")}</div>
        <h3>${esc(sec.title)}</h3>
        ${sec.progress ? `<div class="bar"><i style="width:${sec.progress}%"></i></div>` : ""}
        <div class="tm"><span>${fmt(list.length)} cards</span><span>${sec.progress ? sec.progress + "% complete" : sec.groups.length > 1 ? sec.groups.length + " groups" : ""}</span></div></a>`;
    }).join("");
    $("#app").innerHTML = `<div class="wrap">
      <section class="hero">
        <div>
          <div class="kick">The collection of Ian Badeer</div>
          <h1>Alex Gordon & Jermaine Dye <em>super collector</em></h1>
          <p>${esc(s.intro).replace("a Husker autograph I need", `<a class="inl" href="#/checklist">a Husker autograph I need</a>`)}</p>
          <div class="pills">${s.links.map((l) => `<a class="pill" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join("")}</div>
        </div>
        ${feat ? `<button class="feat cd" type="button" data-i="${feat.i}"><div class="ph"><img alt="${esc(feat.name)}" src="${img(feat.id, feat.rk, 800)}" onload="this.classList.add('ok')"></div><small>${esc(s.featured?.caption || feat.name)}</small></button>` : ""}
      </section>
      <section class="stats" aria-label="Collection stats">
        <div class="stat"><b>${fmt(CARDS.length)}</b><span>cards scanned</span></div>
        <div class="stat"><b>${fmt(autos)}</b><span>autographs</span></div>
        <div class="stat"><b>${fmt(ones)}</b><span>one-of-ones</span></div>
        ${SECTIONS.filter((x) => x.progress).map((x) => `<div class="stat"><b>${x.progress}%</b><span>${esc(x.title)}</span></div>`).join("")}
      </section>
      <div class="sec-h"><h2>Newest additions</h2><a href="#/all">Browse everything →</a></div>
      <section class="mq" aria-label="Newest additions">
        <div class="mq-track" style="--dur:${newest.length * 4}s">${newest.map((c) => cardHTML(c)).join("")}<div class="mq-dup" aria-hidden="true">${newest.map((c) => cardHTML(c)).join("")}</div></div>
      </section>
      <div class="sec-h"><h2>Collections</h2></div>
      <section class="tiles" style="margin-bottom:64px">${tiles}</section>
    </div>`;
    // The copy only exists so the loop looks seamless; keep it out of keyboard tab order.
    document.querySelectorAll(".mq-dup .cd").forEach((b) => (b.tabIndex = -1));
    state.list = newest;
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
      if (sec.progress) prog = `<div class="prog"><b>${sec.progress}%</b><div class="bar"><i style="width:${sec.progress}%"></i></div><small>${esc(sec.progressLabel || "complete")}</small></div>`;
      blurb = esc(blurb) + (sec.extraLinks || []).map((l) => ` <a href="${esc(l.url)}" target="_blank" rel="noopener" style="color:var(--acc)">${esc(l.label)} ↗</a>`).join(" ·");
    } else if (slug === "customs") {
      base = CARDS.filter((c) => c.tags.has("custom")); title = "Custom Cards"; kick = "Made by hand"; color = "gold";
      blurb = "Custom cards are a labor of love. I make mini cardboard treasures for myself, for friends, and as keepsakes for the athletes themselves.";
    } else {
      base = CARDS; title = state.q ? `Results for “${esc(state.q)}”` : "Every card"; kick = "Whole collection";
    }
    const side = groups.length > 1 ? `<div><h4>${esc(sec.title)}</h4><ul>
        <li><a href="#/c/${slug}" aria-current="${gi < 0}"><em style="font-style:normal">All</em><span>${fmt(sectionCards(si).length)}</span></a></li>
        ${groups.map((g, k) => `<li><a href="#/c/${slug}/${g.slug}" aria-current="${k === gi}">${esc(g.label)}<span>${fmt(g.count)}</span></a></li>`).join("")}</ul></div>` : "";
    const others = `<div><h4>Collections</h4><ul>${SECTIONS.filter(shown).map((x) => `<li><a href="#/c/${x.slug}" aria-current="${x.slug === slug}">${esc(x.title)}<span>${fmt(sectionCards(SECTIONS.indexOf(x)).length)}</span></a></li>`).join("")}
        <li><a href="#/customs" aria-current="${slug === "customs"}">Customs<span>${fmt(CARDS.filter((c) => c.tags.has("custom")).length)}</span></a></li></ul></div>`;
    const mg = groups.length > 1 ? `<nav class="mgroups" aria-label="Groups"><a href="#/c/${slug}" aria-current="${gi < 0}">All</a>${groups.map((g, k) => `<a href="#/c/${slug}/${g.slug}" aria-current="${k === gi}">${esc(g.label)}</a>`).join("")}</nav>` : "";
    $("#app").innerHTML = `<div class="wrap coll c-${color}">
      <aside class="side">${side}${others}</aside>
      <div style="min-width:0">
        <div class="c-head"><div class="kick">${kick}${gi >= 0 ? " · " + esc(groups[gi].label) : ""}</div><h1>${title}</h1>${blurb ? `<p>${blurb}</p>` : ""}${prog}</div>
        ${mg}
        ${slug === "search" ? `<div id="pmatch"></div>` : ""}
        <div class="tools">
          <div class="chips" role="group" aria-label="Filters">${FILTERS.map(([k, l]) => `<button type="button" class="chip" data-f="${k}" aria-pressed="${state.filters.has(k)}">${l}</button>`).join("")}</div>
          <div class="tools-r"><span class="count" id="count"></span><label class="sr" for="sort">Sort</label><select id="sort">${SORTS.map(([k, l]) => `<option value="${k}"${state.sort === k ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        </div>
        <div class="grid" id="grid"></div><div class="sentinel" id="sentinel"></div>
      </div></div>`;
    const apply = () => {
      let list = search(base, state.q);
      state.filters.forEach((f) => (list = list.filter((c) => c.tags.has(f))));
      state.list = sortList(list, state.sort); state.shown = 0;
      $("#grid").innerHTML = state.list.length ? "" : `<p class="empty">No cards match. Try removing a filter or a search word.</p>`;
      $("#count").textContent = `${fmt(state.list.length)} card${state.list.length === 1 ? "" : "s"}`;
      more();
    };
    $(".chips").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      state.filters.has(b.dataset.f) ? state.filters.delete(b.dataset.f) : state.filters.add(b.dataset.f);
      b.setAttribute("aria-pressed", state.filters.has(b.dataset.f)); apply();
    });
    $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; apply(); });
    apply();
    io.observe($("#sentinel"));
    if (slug === "search") playerMatches(state.q);
  }
  // Searching a name also offers that player's NFL Huskers page.
  function playerMatches(q) {
    const words = norm(q).split(" ").filter(Boolean);
    if (!words.length || norm(q).length < 3) return;
    loadHubQuiet().then(() => {
      const box = $("#pmatch"); if (!box || state.q !== q) return;
      const hits = tier1().filter((p) => { const h = " " + norm(p.name) + " " + p.name.toLowerCase() + " "; return words.every((w) => h.includes(w)); }).slice(0, 8);
      if (!hits.length) return;
      box.innerHTML = `<div class="pmatch"><h4>Player pages</h4><div class="pm-list">${hits.map((p) => {
        const sc = p.have ? bestScan(p.name) : null;
        return `<a class="pm" href="#/player/${p.slug}"><span class="pm-ph">${sc ? `<img alt="" loading="lazy" src="${img(sc.id, sc.rk, 160)}" onload="this.classList.add('ok')">` : ""}</span>
          <span class="pm-t"><b>${hl(p.name, q)}</b><small>NFL Husker${p.year ? ` · Nebraska through ${esc(p.year)}` : ""}</small></span><span class="pm-go">→</span></a>`;
      }).join("")}</div></div>`;
    }).catch(() => {});
  }
  function more() {
    const grid = $("#grid"); if (!grid) return;
    const next = state.list.slice(state.shown, state.shown + 72);
    grid.insertAdjacentHTML("beforeend", next.map((c) => cardHTML(c, state.q)).join(""));
    state.shown += next.length;
  }
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && state.shown < state.list.length && more()), { rootMargin: "1200px" });

  /* ---------- Husker checklist (from the private master, published columns only) ---------- */
  let CHECK = null;
  const CK = { list: 0, q: "", show: "all" };
  const norm = (t) => String(t).toLowerCase().replace(/"[^"]*"/g, " ").replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  let scanIndex = null;
  function scansFor(name) {
    if (!scanIndex) {
      const want = new Set(SECTIONS.map((s, i) => (/husker/i.test(s.slug) ? i : -1)).filter((i) => i >= 0));
      scanIndex = CARDS.filter((c) => want.has(c.si)).map((c) => [" " + norm(c.name) + " ", c]);
    }
    const n = norm(name); if (n.split(" ").length < 2) return [];
    return scanIndex.filter(([t]) => t.includes(" " + n + " ")).map(([, c]) => c);
  }
  // One page per published list. #/checklist (no suffix) stays the NFL page so old links keep working.
  const CK_PAGES = [
    { path: "", slug: "nfl-tier-1-huskers", label: "NFL Huskers Autograph List", blurb: "One autograph of every Husker who played in at least one NFL game." },
    { path: "/mlb", slug: "baseball-mlb", label: "MLB Huskers Autograph List", blurb: "One autograph of every Husker who played in the major leagues." },
    { path: "/nba", slug: "basketball-nba", label: "NBA Huskers Autograph List", blurb: "One autograph of every Husker who played in the NBA." },
  ];
  function checklist(which) {
    const page = CK_PAGES.find((x) => x.path === (which ? "/" + which : "")) || CK_PAGES[0];
    setNav("checklist" + page.path);
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
    $("#app").innerHTML = `<div class="wrap ck c-husker">
      <div class="c-head">
        <div class="kick">Autograph checklist · updated from my collection spreadsheet</div>
        <h1>${esc(page.label)}</h1>
        <p>${esc(page.blurb)} Green means it's in my collection. If you can help with anyone marked <b>Need</b>, I'd love to hear from you.</p>
        <div class="prog"><b>${Math.round(pct)}%</b><div class="bar"><i style="width:${pct}%"></i></div><small>${fmt(y)} of ${fmt(n)} signed</small></div>
      </div>
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
    table();
  }
  function table() {
    const l = CHECK.lists[CK.list], cols = l.columns, ai = cols.indexOf("Autograph");
    const shown = cols.map((c, i) => i).filter((i) => i !== ai);
    const opt = (c) => /notes|games|role/i.test(c) ? " opt" : "";
    const label = (c) => (c === "Signed" ? "Signed on" : c);
    const q = CK.q.toLowerCase(); let count = 0;
    const body = l.groups.map((g) => {
      const rows = g.rows.filter((r) => (CK.show === "all" || (CK.show === "have") === (r[ai] === "Yes")) && (!q || r.join(" ").toLowerCase().includes(q)));
      count += rows.length; if (!rows.length) return "";
      return (g.title ? `<tr class="grp"><th colspan="${shown.length + 2}">${esc(g.title)}</th></tr>` : "") + rows.map((r) => {
        const have = r[ai] === "Yes", scans = have ? scansFor(r[0]) : [];
        return `<tr class="${have ? "have" : "need"}"><td><span class="st ${have ? "have" : "need"}">${have ? "Have" : "Need"}</span></td>
          ${shown.map((i, k) => `<td class="${k === 0 ? "nm" : ""}${opt(cols[i])}">${k === 0 ? hl(r[i], CK.q) : esc(r[i])}</td>`).join("")}
          <td class="sc">${scans.length ? `<button type="button" class="btn sm" data-scan="${esc(r[0])}">${scans.length === 1 ? "Scan" : scans.length + " scans"}</button>` : ""}</td></tr>`;
      }).join("");
    }).join("");
    $("#ck-count").textContent = `${fmt(count)} ${count === 1 ? "person" : "people"}`;
    $("#ck-table").innerHTML = count ? `<table><thead><tr><th>Status</th>${shown.map((i) => `<th class="${opt(cols[i]).trim()}">${esc(label(cols[i]))}</th>`).join("")}<th></th></tr></thead><tbody>${body}</tbody></table>` : `<p class="empty">Nobody matches. Try another name or switch to Everyone.</p>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-scan]"); if (!b) return;
    const list = scansFor(b.dataset.scan); if (list.length) openViewer(0, list);
  });

  /* ---------- NFL Tier 1 Huskers: list with autographs, and a page per player ---------- */
  let PLAYERS = null;
  const HUB = { q: "", show: "all", shown: 0, rows: [] };
  function loadHub(then) {
    const need = [];
    if (!CHECK) need.push(fetch("data/lists/husker-pros.json").then((r) => { if (!r.ok) throw 0; return r.json(); }).then((d) => (CHECK = d)));
    if (!PLAYERS) need.push(fetch("data/players.json").then((r) => (r.ok ? r.json() : { players: [] })).catch(() => ({ players: [] })).then((d) => (PLAYERS = d)));
    if (!need.length) return then();
    $("#app").innerHTML = `<p class="loading">Loading…</p>`;
    Promise.all(need).then(then).catch(() => ($("#app").innerHTML = `<p class="empty">This page isn't available yet.</p>`));
  }
  function loadHubQuiet() {
    return Promise.all([
      CHECK || fetch("data/lists/husker-pros.json").then((r) => { if (!r.ok) throw 0; return r.json(); }).then((d) => (CHECK = d)),
      PLAYERS || fetch("data/players.json").then((r) => (r.ok ? r.json() : { players: [] })).catch(() => ({ players: [] })).then((d) => (PLAYERS = d)),
    ]);
  }
  const pslug = (n) => norm(n).replace(/ /g, "-");
  function bestScan(name) {
    const all = scansFor(name).filter((c) => !/\(back\)/i.test(c.name));
    return all.find((c) => c.tags.has("auto")) || all[0] || null;
  }
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
    "sports-reference.com": "Sports Reference", "wikipedia.org": "Wikipedia", "huskers.com": "Huskers.com" };
  function siteName(url) {
    let h = ""; try { h = new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
    const k = Object.keys(SITES).find((d) => h === d || h.endsWith("." + d));
    return k ? SITES[k] : h;
  }
  function hub() {
    setNav("nfl-huskers");
    loadHub(() => {
      const all = tier1(), have = all.filter((p) => p.have).length;
      $("#app").innerHTML = `<div class="wrap hub c-husker">
        <div class="c-head"><div class="kick">Autograph collection</div><h1>NFL Huskers Player Pages</h1>
          <p>Every Nebraska Cornhusker who played in at least one NFL game. Pick a name for that player's page, with the autograph I have when I have one.</p>
          <div class="prog"><b>${Math.round((have / all.length) * 100)}%</b><div class="bar"><i style="width:${(have / all.length) * 100}%"></i></div><small>${fmt(have)} of ${fmt(all.length)} signed</small></div></div>
        <div class="tools">
          <div class="chips" role="group" aria-label="Show">${[["all", "Everyone"], ["have", "Have"], ["need", "Need"], ["pages", "Has a bio"]].map(([k, t]) => `<button type="button" class="chip" data-show="${k}" aria-pressed="${HUB.show === k}">${t}</button>`).join("")}</div>
          <div class="tools-r"><label class="sr" for="hub-q">Find a player</label><input id="hub-q" class="ck-q" type="search" placeholder="Find a player" value="${esc(HUB.q)}"><span class="count" id="hub-count"></span></div>
        </div>
        <ol class="hub-list" id="hub-list"></ol><div class="sentinel" id="hub-more"></div></div>`;
      const apply = () => {
        const q = HUB.q.toLowerCase();
        HUB.rows = all.filter((p) => (HUB.show === "all" || (HUB.show === "have" && p.have) || (HUB.show === "need" && !p.have) || (HUB.show === "pages" && p.page)) && (!q || p.name.toLowerCase().includes(q)));
        HUB.shown = 0; $("#hub-list").innerHTML = HUB.rows.length ? "" : `<li class="empty">Nobody matches.</li>`;
        $("#hub-count").textContent = `${fmt(HUB.rows.length)} players`; hubMore();
      };
      $(".hub .chips").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; HUB.show = b.dataset.show; document.querySelectorAll(".hub .chip").forEach((x) => x.setAttribute("aria-pressed", x === b)); apply(); });
      $("#hub-q").addEventListener("input", (e) => { HUB.q = e.target.value.trim(); apply(); });
      apply(); hubIO.observe($("#hub-more"));
    });
  }
  function hubMore() {
    const list = $("#hub-list"); if (!list) return;
    const next = HUB.rows.slice(HUB.shown, HUB.shown + 60); HUB.shown += next.length;
    list.insertAdjacentHTML("beforeend", next.map((p) => {
      const sc = p.have ? bestScan(p.name) : null;
      const nm = `<a class="hub-name${p.page ? "" : " nobio"}" href="#/player/${p.slug}">${hl(p.name, HUB.q)}</a>`;
      return `<li class="hub-row ${p.have ? "have" : "need"}">
        ${sc ? `<button type="button" class="hub-ph" data-scan="${esc(p.name)}" aria-label="View ${esc(p.name)}'s autograph"><img loading="lazy" alt="" src="${img(sc.id, sc.rk, 240)}" onload="this.classList.add('ok')"></button>`
             : `<div class="hub-ph none">${p.have ? esc(p.signed || "Signed") : "Need"}</div>`}
        <div class="hub-info">${nm}<div class="hub-meta">Final Nebraska season ${esc(p.year)}${p.games ? ` · ${esc(p.games)} NFL games` : ""}${p.notes ? ` · ${esc(p.notes)}` : ""}</div>
          <div class="hub-meta2"><span class="st ${p.have ? "have" : "need"}">${p.have ? "Have" : "Need"}</span>${p.have && p.signed ? `<span>Signed ${esc(p.signed.toLowerCase())}</span>` : ""}</div></div></li>`;
    }).join(""));
  }
  const hubIO = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && HUB.shown < HUB.rows.length && hubMore()), { rootMargin: "1000px" });

  function player(slug) {
    setNav("nfl-huskers");
    loadHub(() => {
      const p = (PLAYERS.players || []).find((x) => x.slug === slug);
      const row = tier1().find((x) => x.slug === slug);
      if (!p && !row) return notFound();
      const info = { ...(row || {}), ...(p || {}) }, w = (p && p.wiki) || null;
      const scans = scansFor(info.name).filter((c) => !/\(back\)/i.test(c.name));
      const hero = info.have ? bestScan(info.name) : null;
      const sec = (w && w.sections) || {};
      const pick = (label) => Object.values(sec).flat().find((r) => r.length === 2 && r[0] === label);
      // The College line can list several schools, e.g. "LSU (2019–2021)Nebraska (2022)".
      const schools = [...((pick("College") || [])[1] || "").matchAll(/([^()\n]+?)\s*\(([^)]*)\)/g)].map((m) => [m[1].trim(), m[2].trim()]);
      const facts = [["Position", info.position || (pick("Position") || [])[1]], ["Final season at Nebraska", info.year || info.finalYear],
        ["Nebraska years", (schools.find(([n]) => /nebraska/i.test(n)) || [])[1]],
        ["Also played at", schools.filter(([n]) => !/nebraska/i.test(n)).map(([n, y]) => `${n} (${y})`).join(", ")],
        ["NFL draft", (pick("NFL draft") || [])[1]], ["NFL games", info.games || info.nflGames], ["Born", (pick("Born") || [])[1]],
        ["High school", (pick("High school") || [])[1]], ["Height / weight", [(pick("Listed height") || [])[1], (pick("Listed weight") || [])[1]].filter(Boolean).join(" · ")]]
        .filter(([, v]) => v && String(v).trim());
      const statKey = Object.keys(sec).find((k) => /^Career .*statistics/i.test(k));
      const list = (k) => (sec[k] || []).filter((r) => r.length === 1).map((r) => `<li>${esc(r[0])}</li>`).join("");
      const college = p && p.college;
      const DEF = /defensive|linebacker|cornerback|safety|end\b|tackle/i;
      const CATS = [["passing", "Passing", ["COMPLETIONS", "ATT", "PCT", "YDS", "YPA", "TD", "INT"]], ["rushing", "Rushing", ["CAR", "YDS", "YPC", "LONG", "TD"]],
        ["receiving", "Receiving", ["REC", "YDS", "YPR", "LONG", "TD"]], ["defensive", "Defense", ["TOT", "SOLO", "TFL", "SACKS", "QB HUR", "PD", "TD"]],
        ["interceptions", "Interceptions", ["INT", "YDS", "AVG", "TD"]], ["kickReturns", "Kick returns", ["NO", "YDS", "AVG", "LONG", "TD"]],
        ["puntReturns", "Punt returns", ["NO", "YDS", "AVG", "LONG", "TD"]], ["kicking", "Kicking", ["FGM", "FGA", "PCT", "LONG", "XPM", "XPA", "PTS"]],
        ["punting", "Punting", ["NO", "YDS", "YPP", "LONG", "IN 20", "TB"]]];
      const LABEL = { COMPLETIONS: "CMP", "QB HUR": "QBH" };
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
        <a class="back" href="#/nfl-huskers">← NFL Huskers Player Pages</a>
        <div class="pl-top">
          <div class="pl-card">${hero ? `<button type="button" class="pl-ph" data-scan="${esc(info.name)}"><img alt="${esc(hero.name)}" src="${img(hero.id, hero.rk, 900)}" onload="this.classList.add('ok')"></button><small>${esc(hero.name)}</small>`
            : `<div class="pl-ph none"><span class="st ${info.have ? "have" : "need"}">${info.have ? "Have" : "Need"}</span><p>${info.have ? `Signed ${esc((info.signed || "").toLowerCase())}. Scan coming soon.` : "I'm still looking for this autograph. Can you help?"}</p></div>`}</div>
          <div class="pl-main">
            <div class="kick">${esc(info.position || "Nebraska Cornhusker")}</div>
            <h1>${esc(info.name)}</h1>
            <div class="pl-badges"><span class="st ${info.have ? "have" : "need"}">${info.have ? "In my collection" : "Need"}</span>${info.have && info.signed ? `<span class="pill">Signed ${esc(info.signed.toLowerCase())}</span>` : ""}</div>
            ${/^https?:\/\//i.test(info.link || "") ? `<a class="statlink" href="${esc(info.link)}" target="_blank" rel="noopener">Career stats at ${esc(siteName(info.link))} ↗</a>` : ""}
            <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
            ${w && w.intro ? `<div class="bio">${w.intro.split("\n\n").map((t) => `<p>${esc(t)}</p>`).join("")}</div>` : `<p class="muted">${p && p.checked ? "No biography available for this player yet." : "Biography coming soon."}</p>`}
          </div>
        </div>
        <div class="pl-grid">
          ${statKey ? `<section><h2>${esc(statKey.replace(/\s+as of.*$/i, ""))}</h2><table class="kv">${sec[statKey].filter((r) => r.length === 2).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table></section>` : ""}
          <section class="wide-sec"><h2>College stats</h2>${wtables ? `${wtables}<p class="note">From <a href="${esc(w.url)}" target="_blank" rel="noopener">Wikipedia</a>, CC BY-SA 4.0.</p>` : collegeHTML ? `${collegeHTML}<p class="note">From CollegeFootballData.com.</p>`
            : `<p class="muted">${!(p && (p.checked || p.wiki)) ? "Stats coming soon." : DEF.test(info.position || "") ? "Defensive stats from this era aren't in my data source yet." : (info.year || info.finalYear) < 2005 ? "Stats from this era are coming later." : "No individual college stats recorded."}</p>`}</section>
          ${list("Career history") ? `<section><h2>Pro teams</h2><ul class="plain">${list("Career history")}</ul></section>` : ""}
          ${list("Awards and highlights") ? `<section><h2>Awards and highlights</h2><ul class="plain">${list("Awards and highlights")}</ul></section>` : ""}
        </div>
        ${scans.length > 1 ? `<h2 class="more-h">More of ${esc(info.name)} in my collection</h2><div class="grid small">${scans.map((c) => cardHTML(c)).join("")}</div>` : ""}
        <p class="credit">${w ? `Biography and facts from <a href="${esc(w.url)}" target="_blank" rel="noopener">Wikipedia</a>, licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.` : ""}${w && w.pfr ? ` Full pro stats at <a href="${esc(w.pfr)}" target="_blank" rel="noopener">Pro Football Reference</a>.` : ""} Autograph status from my collection records.</p>
      </div>`;
      state.list = scans;
    });
  }

  function notFound() { $("#app").innerHTML = `<p class="empty">That page doesn't exist. <a href="#/">Go home</a></p>`; }

  /* ---------- Router ---------- */
  function route() {
    closeViewer(true);
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("/");
    const [a, b, c] = h;
    const key = a === "c" ? "c/" + b : a;
    if (key !== state.where) { state.filters.clear(); state.where = key; }
    if (a !== "search") { state.q = ""; $("#q").value = ""; }
    if (!a) home();
    else if (a === "c") collection(b, c);
    else if (a === "customs") collection("customs");
    else if (a === "all") collection("all");
    else if (a === "checklist") checklist(b);
    else if (a === "nfl-huskers") hub();
    else if (a === "player") player(b);
    else if (a === "search") { state.q = h.slice(1).join("/"); $("#q").value = state.q; collection("search"); }
    else if (a === "card") { home(); const k = CARDS.findIndex((x) => x.id === b); if (k >= 0) openViewer(k, [CARDS[k]]); }
    else notFound();
    if (a !== "card") window.scrollTo(0, 0);
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
    const i = +b.dataset.i, list = state.list.length && state.list.some((c) => c.i === i) ? state.list : [CARDS[i]];
    openViewer(list.findIndex((c) => c.i === i), list);
  });
  // Desktop shows a card's front and back side by side; phones flip between them with a tap.
  const wide = window.matchMedia("(min-width: 900px)");
  function openViewer(k, list) {
    V.list = list; V.k = k; V.back = false; V.zoom = false;
    $("#viewer").hidden = false; document.body.style.overflow = "hidden"; showCard(); $("#v-close").focus();
  }
  function closeViewer(silent) {
    if ($("#viewer").hidden) return;
    $("#viewer").hidden = true; document.body.style.overflow = ""; $("#v-stage").classList.remove("zoom", "pair");
    if (!silent && location.hash.startsWith("#/card/")) history.back();
  }
  function loadInto(el, c, id, rk, alt) {
    el.src = img(id, rk, 400); el.alt = alt;
    const big = new Image(); big.onload = () => { if (V.list[V.k] === c && el.dataset.id === id) el.src = big.src; };
    el.dataset.id = id; big.src = img(id, rk, 1600);
  }
  const isPair = (c) => wide.matches && !!c.backId && !V.zoom;
  function showCard() {
    const c = V.list[V.k]; if (!c) return;
    const pair = isPair(c), stage = $("#v-stage"), im = $("#v-img"), im2 = $("#v-img2");
    const back = !pair && V.back;
    const id = back ? c.backId : c.id, rk = back ? c.backRk : c.rk;
    loadInto(im, c, id, rk, c.name + (back ? " (back)" : ""));
    im2.hidden = !pair;
    if (pair) loadInto(im2, c, c.backId, c.backRk, c.name + " (back)");
    stage.classList.toggle("pair", pair);
    stage.classList.toggle("zoom", V.zoom);
    $("#v-title").innerHTML = `${esc(c.title)}<small>${esc(c.sub || "")}${c.par ? " · " + esc(c.par) : ""}</small>`;
    $("#v-flip").hidden = !c.backId || pair; $("#v-flip").textContent = V.back ? "Show front" : "Show back";
    $("#v-drive").href = driveUrl(id, rk);
    $("#v-drive").textContent = pair ? "Front full-res ↗" : "Full-res in Drive ↗";
    $("#v-drive2").hidden = !pair;
    if (pair) $("#v-drive2").href = driveUrl(c.backId, c.backRk);
    const sec = SECTIONS[c.si];
    $("#v-meta").innerHTML = `${badges(c)}<span>${esc(sec.title)} · ${esc(sec.groups[c.gi].label)}</span><span>·</span><span>${V.k + 1} of ${fmt(V.list.length)}</span><span>·</span><span style="font-family:var(--f-m)">${esc(c.name)}</span>`;
    $("#v-prev").style.visibility = V.k > 0 ? "visible" : "hidden";
    $("#v-next").style.visibility = V.k < V.list.length - 1 ? "visible" : "hidden";
  }
  const step = (d) => { const n = V.k + d; if (n >= 0 && n < V.list.length) { V.k = n; V.back = false; V.zoom = false; showCard(); } };
  $("#v-prev").onclick = () => step(-1); $("#v-next").onclick = () => step(1);
  $("#v-close").onclick = () => closeViewer();
  $("#v-flip").onclick = () => { V.back = !V.back; V.zoom = false; showCard(); };
  // Click an image: on desktop, zoom into that side (click again to go back);
  // on a phone, a card with a back flips, and one without zooms.
  function imageClick(side) {
    const c = V.list[V.k];
    if (!wide.matches && c.backId) { V.back = !V.back; V.zoom = false; }
    else if (V.zoom) V.zoom = false;
    else { V.zoom = true; if (c.backId) V.back = side === "back"; }
    showCard();
  }
  $("#v-img").onclick = () => imageClick(isPair(V.list[V.k]) ? "front" : V.back ? "back" : "front");
  $("#v-img2").onclick = () => imageClick("back");
  wide.addEventListener("change", () => { if (!$("#viewer").hidden) { V.zoom = false; showCard(); } });
  $("#v-copy").onclick = async () => {
    const c = V.list[V.k], url = location.href.split("#")[0] + "#/card/" + c.id;
    try { await navigator.clipboard.writeText(url); $("#v-copy").textContent = "Link copied"; }
    catch { $("#v-copy").textContent = "Copy failed"; }
    setTimeout(() => ($("#v-copy").textContent = "Copy link"), 1600);
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

  /* ---------- Boot ---------- */
  if (window.CATALOG) load(window.CATALOG);
  else fetch("data/catalog.json").then((r) => r.json()).then(load).catch(() => ($("#app").innerHTML = `<p class="empty">The card list didn't load. Refresh the page to try again.</p>`));
})();
