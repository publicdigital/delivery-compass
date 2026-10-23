/**
 * The public /trial page: the copy button and the corpus charts.
 *
 * Reads window.SHELF (trial/shelf-data.js, a dated snapshot) and draws with d3
 * (trial/vendor/d3.min.js). The site CSP forbids inline style attributes, so markup
 * built here never carries style="..."; widths and colours are set afterwards through
 * element.style, which the CSP allows. test/csp.test.ts checks this file for that.
 */
(() => {
  // --- copy the connector address ---------------------------------------------------
  for (const button of document.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", async () => {
      const source = document.getElementById(button.dataset.copy);
      const status = document.getElementById("copy-status");
      try {
        await navigator.clipboard.writeText(source.textContent.trim());
        status.textContent = "Address copied.";
      } catch {
        const range = document.createRange();
        range.selectNodeContents(source);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        status.textContent = "Your browser blocked copying. The address is selected: press Ctrl+C or Cmd+C.";
      }
    });
  }

  if (!window.d3 || !window.SHELF) return;
  const DATA = window.SHELF;

  const SPINES = [
    ["assurance", "Assurance & project delivery"],
    ["digital", "Digital & technology"],
    ["funding", "Funding & business cases"],
    ["evaluation", "Evaluation & analysis"],
    ["commercial", "Commercial"],
    ["risk", "Risk"],
    ["oversight", "Oversight & scrutiny"],
  ];
  const SPINE_NAME = Object.fromEntries(SPINES);
  // Light fills that need dark text to meet contrast; the rest take white.
  const DARK_INK = new Set(["digital", "funding", "oversight"]);
  const SHORT = {
    "teal-book": "Teal Book", "magenta-book": "Magenta Book", "service-manual": "Service Manual",
    "sourcing-playbook": "Sourcing Playbook", "ddat-playbook": "DDaT Playbook", "rose-book": "Rose Book",
    "ai-playbook": "AI Playbook", "green-book": "Green Book", "business-cases": "Business case guidance",
    "data-ethics": "Data and AI Ethics Framework", "ai-evaluation": "AI impact evaluation", "orange-book": "Orange Book",
    "govs-005": "GovS 005 Digital", "aqua-book": "Aqua Book", "govs-002": "GovS 002 Project Delivery",
    "govs-002-ciaf": "GovS 002 assessment framework", "gate-review-0": "Gate 0", "gate-review-1": "Gate 1",
    "gate-review-2": "Gate 2", "gate-review-3": "Gate 3", "gate-review-4": "Gate 4", "gate-review-5": "Gate 5",
    "digital-data-benefits": "Digital & data benefits", "tap": "Treasury Approvals Process",
    "consultancy-playbook": "Consultancy Playbook", "agile-assurance": "Agile assurance", "benefits-assurance": "Benefits assurance",
    "service-standard": "Service Standard", "atrs": "Algorithmic transparency", "nista-annual-report": "NISTA annual report",
    "managing-public-money": "Managing Public Money", "green-book-mcda": "Green Book MCDA", "integrated-assurance": "Integrated assurance",
    "accessibility-regs": "Accessibility regulations", "publishing-business-cases": "Publishing business cases",
    "agile-business-case": "Agile business cases", "green-book-environment": "Green Book environment",
    "better-regulation": "Better Regulation", "gmpp": "GMPP", "tcop": "Technology Code of Practice",
    "project-routemap": "Project Routemap", "spend-controls": "Spend controls", "nista-assurance-toolkit": "NISTA assurance toolkit",
    "green-book-collection": "Green Book collection", "nista-par": "Project assessment review", "nista-action-plan": "NISTA action plan",
    "secure-by-design": "Secure by Design", "green-book-health": "Green Book health", "nao-reports": "NAO reports",
    "uc-lessons-learned": "Universal Credit lessons", "portfolio-risk-annex": "Portfolio risk annex", "risk-reporting-guide": "Risk reporting guide",
  };
  const spineColor = (s) => `var(--sp-${s})`;
  const fmt = d3.format(",");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const S = DATA.sources;
  const indexed = S.filter((s) => s.w > 0);
  const short = (s) => SHORT[s.id] || s.t;
  const prettyDate = (d) => d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "–";
  const spineIdx = Object.fromEntries(SPINES.map(([k], i) => [k, i]));

  /** Markup here carries data-w (a width in %), data-bg and data-bc (a spine or token); this applies them. */
  function applyStyles(root) {
    for (const el of root.querySelectorAll("[data-w]")) el.style.width = el.dataset.w + "%";
    for (const el of root.querySelectorAll("[data-flex]")) el.style.flex = el.dataset.flex;
    for (const el of root.querySelectorAll("[data-bg]")) el.style.background = `var(--${el.dataset.bg})`;
    for (const el of root.querySelectorAll("[data-bc]")) el.style.borderTopColor = `var(--${el.dataset.bc})`;
  }
  function fill(id, html) {
    const el = document.getElementById(id);
    el.innerHTML = html;
    applyStyles(el);
  }

  // --- tooltip ------------------------------------------------------------------------
  const tip = document.getElementById("tip");
  function showTip(ev, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = ev.pageX + pad, y = ev.pageY + pad;
    if (x + w > window.scrollX + document.documentElement.clientWidth - 8) x = ev.pageX - w - pad;
    if (x < window.scrollX + 8) x = window.scrollX + 8;
    if (y + h > window.scrollY + window.innerHeight - 8) y = ev.pageY - h - pad;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  const hideTip = () => { tip.hidden = true; };
  function sourceTip(s) {
    const status = s.wd ? "Withdrawn " + prettyDate(s.wd) : "Linked, not reproduced";
    return `<b>${esc(s.t)}</b>${esc(s.b)} · ${SPINE_NAME[s.sp]}<br>` +
      (s.w ? `${fmt(s.w)} words · ${fmt(s.s)} sections · ${fmt(s.m)} “must” statements<br>Last updated ${s.id === "teal-book" ? "not published" : prettyDate(s.d1)}` : status) +
      (s.au === "mandatory" ? "<br>Registered as mandatory guidance" : "");
  }
  const hover = (sel, get) => sel
    .on("mousemove", (ev, d) => showTip(ev, sourceTip(get(d))))
    .on("mouseleave", hideTip)
    .on("click", (ev, d) => showTip(ev, sourceTip(get(d))));

  // --- headline numbers ---------------------------------------------------------------
  const totalWords = d3.sum(S, (s) => s.w);
  const totalMust = d3.sum(S, (s) => s.m);
  const bodies = d3.rollups(S, (v) => ({ n: v.length, w: d3.sum(v, (s) => s.w) }), (s) => s.b)
    .sort((a, b) => b[1].w - a[1].w || b[1].n - a[1].n);
  document.getElementById("hero-words").textContent = fmt(totalWords);
  document.getElementById("hours").textContent = Math.round(totalWords / 250 / 60) + " hours";
  document.getElementById("obl-total").textContent = fmt(d3.sum(S, (s) => s.o));
  document.getElementById("obl-must").textContent = fmt(totalMust);
  document.getElementById("rel-n").textContent = DATA.rel.length;
  document.getElementById("fresh-n").textContent = indexed.filter((s) => s.id !== "teal-book" && s.d1 && s.d1.startsWith("2026")).length;
  fill("stats", [
    [S.length, "documents and collections registered"],
    [bodies.length, "separate publishers"],
    [fmt(d3.sum(S, (s) => s.s)), "headed sections, each citable on its own"],
    [fmt(totalMust), "statements that say you must or shall"],
    [DATA.rel.length, "hand-mapped links between documents"],
  ].map(([b, t]) => `<div class="stat"><b>${b}</b><small>${t}</small></div>`).join(""));

  fill("spine-legend", SPINES.map(([k, n]) => {
    const w = d3.sum(S.filter((s) => s.sp === k), (s) => s.w);
    return `<span><i data-bg="sp-${k}"></i>${n} <span class="num">${Math.round(w / totalWords * 100)}%</span></span>`;
  }).join(""));

  // --- 01 the shelf -------------------------------------------------------------------
  function drawTreemap() {
    const svg = d3.select("#treemap");
    const W = svg.node().getBoundingClientRect().width;
    const H = W < 600 ? 760 : Math.round(W * 0.56);
    svg.attr("viewBox", `0 0 ${W} ${H}`).attr("height", H);
    svg.selectAll("*").remove();
    const root = d3.hierarchy({ children: SPINES.map(([k]) => ({ k, children: indexed.filter((s) => s.sp === k) })) })
      .sum((d) => d.w || 0).sort((a, b) => b.value - a.value);
    d3.treemap().size([W, H]).paddingInner(2).tile(d3.treemapSquarify.ratio(1.2)).round(true)(root);
    const leaf = svg.selectAll("g").data(root.leaves()).join("g").attr("transform", (d) => `translate(${d.x0},${d.y0})`);
    hover(leaf.append("rect")
      .attr("width", (d) => Math.max(0, d.x1 - d.x0)).attr("height", (d) => Math.max(0, d.y1 - d.y0))
      .style("fill", (d) => spineColor(d.data.sp)), (d) => d.data);
    leaf.each(function (d) {
      const w = d.x1 - d.x0, h = d.y1 - d.y0, g = d3.select(this);
      if (w < 54 || h < 30) return;
      const big = w > 170 && h > 90;
      const ink = DARK_INK.has(d.data.sp) ? "#0b0c0c" : "#ffffff";
      const fs = big ? Math.min(30, Math.max(16, w / 10)) : 12.5;
      const name = short(d.data);
      const t = g.append("text").attr("x", 8).attr("y", fs + 6).style("fill", ink)
        .style("font-weight", big ? 700 : 600).style("font-size", fs + "px").style("pointer-events", "none").text(name);
      let txt = name;
      while (t.node().getComputedTextLength() > w - 14 && txt.length > 3) { txt = txt.slice(0, -2); t.text(txt + "…"); }
      if (h > fs + 30 && w > 80) {
        g.append("text").attr("x", 8).attr("y", fs + 24).style("fill", ink).style("font-size", "12px")
          .style("pointer-events", "none").text(`${d3.format(".2~s")(d.data.w)} words`);
      }
    });
  }

  // --- 02 publishers ------------------------------------------------------------------
  const maxBW = d3.max(bodies, (b) => b[1].w) || 1;
  fill("publishers", bodies.map(([b, v]) => `
    <div class="lab">${esc(b)}<small>${v.n} source${v.n > 1 ? "s" : ""}</small></div>
    <div class="track"><div class="bar" data-w="${Math.max(0.4, v.w / maxBW * 82)}"></div><span class="val">${v.w ? fmt(v.w) + " words" : "linked only"}</span></div>`).join(""));

  // --- 03 strength of the rules -------------------------------------------------------
  const STRENGTH = [
    ["mandatory", "Must / shall", "st-1", "The mandatory lines. Quoted word for word, never paraphrased."],
    ["recommended", "Should", "st-2", "Expected practice. Departing from it usually needs a reason."],
    ["permitted", "May", "st-3", "Options you are allowed to take."],
    ["possible", "Could / can", "st-4", "Possibilities and suggestions."],
  ];
  const counts = DATA.strength;
  const strTotal = d3.sum(Object.values(counts));
  fill("strength", STRENGTH.map(([k, , c]) => `<div data-flex="${counts[k]}" data-bg="${c}" title="${fmt(counts[k])}"></div>`).join(""));
  fill("s-key", STRENGTH.map(([k, l, c, d]) =>
    `<div data-bc="${c}"><em>${l}</em><b>${fmt(counts[k])}</b><small>${Math.round(counts[k] / strTotal * 100)}% · ${d}</small></div>`).join(""));
  const topMust = [...indexed].sort((a, b) => b.m - a.m).slice(0, 10);
  fill("musts", topMust.map((s) => `
    <div class="lab">${esc(short(s))}<small>${esc(s.b)}</small></div>
    <div class="track"><div class="bar" data-w="${s.m / topMust[0].m * 82}" data-bg="sp-${s.sp}"></div><span class="val">${s.m}</span></div>`).join(""));

  // --- 04 how it fits together ----------------------------------------------------------
  const linked = new Set(DATA.rel.flatMap((r) => [r.f, r.t]));
  const netNodes = S.filter((s) => linked.has(s.id)).map((s) => ({ ...s }));
  const netLinks = DATA.rel.map((r) => ({ source: r.f, target: r.t, ty: r.ty }));
  const NW = 1000, NH = 680;
  const rScale = d3.scaleSqrt().domain([0, d3.max(netNodes, (n) => n.w)]).range([5, 34]);
  // Each area gets a home on the canvas, so the layout reads the same on every load.
  const cx = { assurance: 0.32, digital: 0.72, funding: 0.5, evaluation: 0.2, commercial: 0.85, risk: 0.15, oversight: 0.6 };
  const cy = { assurance: 0.42, digital: 0.38, funding: 0.66, evaluation: 0.78, commercial: 0.72, risk: 0.2, oversight: 0.15 };
  const sim = d3.forceSimulation(netNodes)
    .force("link", d3.forceLink(netLinks).id((d) => d.id).distance(70).strength(0.35))
    .force("charge", d3.forceManyBody().strength(-260))
    .force("x", d3.forceX((d) => cx[d.sp] * NW).strength(0.09))
    .force("y", d3.forceY((d) => cy[d.sp] * NH).strength(0.11))
    .force("collide", d3.forceCollide((d) => rScale(d.w) + 9))
    .stop();
  for (let i = 0; i < 400; i++) sim.tick();
  netNodes.forEach((n) => {
    const r = rScale(n.w) + 4, lx = Math.max(r, 80); // room for a centred label either side
    n.x = Math.max(lx, Math.min(NW - lx, n.x));
    n.y = Math.max(r + 4, Math.min(NH - r - 16, n.y));
  });
  const LABELLED = new Set(["spend-controls", "tcop", "agile-business-case", "portfolio-risk-annex", "risk-reporting-guide", "gate-review-4", "tap", "managing-public-money", "govs-002", "orange-book"]);
  function drawNetwork() {
    const svg = d3.select("#network").attr("viewBox", `0 0 ${NW} ${NH}`);
    svg.selectAll("*").remove();
    const alarm = (l) => l.ty === "supersedes" || l.ty === "conflicts";
    svg.append("g").selectAll("line").data([...netLinks].sort((a, b) => alarm(a) - alarm(b))).join("line")
      .attr("x1", (l) => l.source.x).attr("y1", (l) => l.source.y).attr("x2", (l) => l.target.x).attr("y2", (l) => l.target.y)
      .style("stroke", (l) => alarm(l) ? "var(--alarm)" : l.ty === "elaborates" ? "var(--axis)" : "var(--ink-2)")
      .style("stroke-width", (l) => alarm(l) ? 3 : 1.5)
      .style("stroke-dasharray", (l) => (l.ty === "gates" || l.ty === "assured_by") ? "5 4" : null);
    const g = svg.append("g").selectAll("g").data(netNodes).join("g").attr("transform", (d) => `translate(${d.x},${d.y})`);
    hover(g.append("circle").attr("r", (d) => rScale(d.w))
      .style("fill", (d) => d.w ? spineColor(d.sp) : "var(--surface)")
      .style("stroke", (d) => d.w ? "var(--surface)" : "var(--alarm)").style("stroke-width", 2)
      .style("stroke-dasharray", (d) => d.w ? null : "3 2"), (d) => d);
    g.filter((d) => rScale(d.w) > 11 || LABELLED.has(d.id))
      .append("text").attr("y", (d) => rScale(d.w) + 15).attr("text-anchor", "middle")
      .style("font-size", "14px").style("font-weight", 700).style("fill", "var(--ink)")
      .style("paint-order", "stroke").style("stroke", "var(--surface)").style("stroke-width", 4).style("pointer-events", "none")
      .text((d) => short(d));
  }

  // --- 05 how current it is -------------------------------------------------------------
  function drawFresh() {
    const svg = d3.select("#fresh");
    const W = Math.max(300, svg.node().getBoundingClientRect().width);
    const narrow = W < 600;
    const left = narrow ? 92 : 200, right = 20, top = 12, row = narrow ? 44 : 52;
    const H = top + row * SPINES.length + 34;
    svg.attr("viewBox", `0 0 ${W} ${H}`).attr("height", H);
    svg.selectAll("*").remove();
    const pts = indexed.filter((s) => s.id !== "teal-book" && s.d1);
    const x = d3.scaleUtc().domain([new Date("2022-01-01"), new Date("2026-12-31")]).range([left, W - right]);
    const y = (k) => top + spineIdx[k] * row + row / 2;
    const r = d3.scaleSqrt().domain([0, d3.max(pts, (p) => p.w)]).range([4, narrow ? 14 : 20]);
    const years = [2022, 2023, 2024, 2025, 2026];
    svg.append("rect").attr("x", x(new Date("2026-01-01"))).attr("y", top)
      .attr("width", x(new Date("2026-12-31")) - x(new Date("2026-01-01"))).attr("height", H - 26 - top)
      .style("fill", "#e8f1f8");
    svg.append("g").selectAll("line").data(years).join("line")
      .attr("x1", (d) => x(new Date(`${d}-01-01`))).attr("x2", (d) => x(new Date(`${d}-01-01`)))
      .attr("y1", top).attr("y2", H - 26).style("stroke", "var(--rule)");
    svg.append("g").selectAll("text").data(years).join("text")
      .attr("x", (d) => x(new Date(`${d}-07-01`))).attr("y", H - 8).attr("text-anchor", "middle")
      .style("font-size", "14px").style("fill", "var(--ink-2)").text((d) => d);
    svg.append("g").selectAll("text").data(SPINES).join("text")
      .attr("x", 0).attr("y", (d) => y(d[0]) + 5).style("font-size", narrow ? "12px" : "14px").style("fill", "var(--ink)")
      .text((d) => narrow ? d[1].split(" &")[0] : d[1]);
    svg.append("g").selectAll("line").data(SPINES).join("line")
      .attr("x1", left).attr("x2", W - right).attr("y1", (d) => y(d[0])).attr("y2", (d) => y(d[0])).style("stroke", "var(--rule)");
    hover(svg.append("g").selectAll("circle").data([...pts].sort((a, b) => b.w - a.w)).join("circle")
      .attr("cx", (d) => x(new Date(d.d1))).attr("cy", (d) => y(d.sp)).attr("r", (d) => r(d.w))
      .style("fill", (d) => spineColor(d.sp)).style("fill-opacity", 0.85)
      .style("stroke", "var(--surface)").style("stroke-width", 2), (d) => d);
    const wd = S.filter((s) => s.wd);
    hover(svg.append("g").selectAll("path").data(wd).join("path")
      .attr("d", d3.symbol(d3.symbolCross, 90))
      .attr("transform", (d, i) => `translate(${x(new Date(d.wd)) + i * 12},${y(d.sp) - 16}) rotate(45)`)
      .style("fill", "var(--alarm)"), (d) => d);
    if (!narrow && wd.length) {
      svg.append("text").attr("x", x(new Date(wd[0].wd)) - 10).attr("y", y("risk") - 12).attr("text-anchor", "end")
        .style("font-size", "13px").style("fill", "var(--alarm)").text(`${wd.length} deleted from GOV.UK, ${prettyDate(wd[0].wd)}`);
    }
  }

  // --- 06 the edges ---------------------------------------------------------------------
  fill("gaps", S.filter((s) => !s.w).map((s) => {
    const why = s.wd ? `Deleted from GOV.UK on ${prettyDate(s.wd)}. Kept so the library can warn anyone still holding a copy.`
      : s.why || (s.id === "nao-reports" ? "Not under the Open Government Licence, so linked rather than copied." : "Linked for reference; not indexed.");
    return `<div class="gap-item">${s.wd ? '<strong class="govuk-tag govuk-tag--red govuk-!-margin-bottom-1">Withdrawn</strong><br>' : ""}` +
      `<p class="govuk-body govuk-!-font-weight-bold govuk-!-margin-bottom-1">${esc(s.t)}</p>` +
      `<p class="govuk-body-s govuk-!-margin-bottom-0">${esc(s.b)}. ${esc(why)}</p></div>`;
  }).join(""));

  const ordered = [...S].sort((a, b) => spineIdx[a.sp] - spineIdx[b.sp] || b.w - a.w);
  const tbody = document.querySelector("#table tbody");
  tbody.innerHTML = ordered.map((s) => `<tr class="govuk-table__row">
    <td class="govuk-table__cell">${s.url ? `<a class="govuk-link" href="${esc(s.url)}" rel="noopener">${esc(s.t)}</a>` : esc(s.t)}</td>
    <td class="govuk-table__cell">${esc(s.b)}</td>
    <td class="govuk-table__cell"><span class="sw" data-bg="sp-${s.sp}"></span>${SPINE_NAME[s.sp]}</td>
    <td class="govuk-table__cell govuk-table__cell--numeric">${s.w ? fmt(s.w) : "–"}</td>
    <td class="govuk-table__cell govuk-table__cell--numeric">${s.s || "–"}</td>
    <td class="govuk-table__cell govuk-table__cell--numeric">${s.m || "–"}</td>
    <td class="govuk-table__cell">${s.wd ? "Withdrawn " + prettyDate(s.wd) : s.w ? (s.id === "teal-book" ? "Not published" : prettyDate(s.d1)) : "Linked only"}</td></tr>`).join("");
  applyStyles(tbody);

  function drawAll() { hideTip(); drawTreemap(); drawNetwork(); drawFresh(); }
  drawAll();
  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawAll, 150); });
})();
