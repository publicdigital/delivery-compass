/**
 * The guidance landscape, drawn.
 *
 * The point this picture has to make is that nobody coordinates this: eleven bodies
 * publish guidance one delivery team is expected to follow, and the relationships
 * between their documents cross organisational lines constantly. A list says that;
 * a drawing shows it.
 *
 * Plain inline SVG and a small force simulation, no library — the CSP forbids
 * third-party scripts and the deploy has no build step, so a dependency would mean
 * vendoring one. At 41 nodes a few hundred iterations take a couple of milliseconds.
 *
 * The drawing is decorative in the accessibility sense: everything in it is also in
 * the grouped lists underneath, which remain the accessible path through the same
 * data. The SVG is marked up accordingly rather than pretending otherwise.
 */

/** One hue per spine. Distinguishable in the palette already used by the cards. */
const SPINE_COLOUR = {
  funding: "#2b5f8f",
  assurance: "#584594",
  digital: "#1e6b3a",
  risk: "#a8271b",
  evaluation: "#8a5200",
  oversight: "#5c666d",
  commercial: "#9c2f6b",
};

/** Edges that mean "this one is out of date" are the ones worth seeing first. */
const CONFLICT_TYPES = new Set(["supersedes", "conflicts"]);

const WIDTH = 1180;
const HEIGHT = 860;

/** Deterministic PRNG, so the same corpus always draws the same map. */
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Lay the graph out: spines get their own region of the canvas, then a short force
 * simulation separates nodes within and lets related documents pull together across
 * regions. Clustering first is what makes a cross-spine edge read as a crossing.
 */
function layout(nodes, edges) {
  const rand = seeded(20261007);
  const spines = [...new Set(nodes.map((n) => n.spine))].sort();
  const centres = new Map();
  const ringR = Math.min(WIDTH, HEIGHT) * 0.38;

  spines.forEach((spine, i) => {
    const a = (i / spines.length) * Math.PI * 2 - Math.PI / 2;
    centres.set(spine, { x: WIDTH / 2 + Math.cos(a) * ringR, y: HEIGHT / 2 + Math.sin(a) * ringR * 0.82 });
  });

  const pos = new Map();
  for (const n of nodes) {
    const c = centres.get(n.spine);
    pos.set(n.id, { x: c.x + (rand() - 0.5) * 120, y: c.y + (rand() - 0.5) * 120, vx: 0, vy: 0 });
  }

  const linked = edges.filter((e) => pos.has(e.from) && pos.has(e.to));

  for (let step = 0; step < 600; step++) {
    const cool = 1 - step / 600;

    // Repulsion, so labels have room.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = pos.get(nodes[i].id);
        const b = pos.get(nodes[j].id);
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = rand() - 0.5; dy = rand() - 0.5; d2 = 1; }
        const f = 6400 / d2;
        const d = Math.sqrt(d2);
        a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
        b.vx += (dx / d) * f; b.vy += (dy / d) * f;
      }
    }

    // Attraction along curated relationships.
    for (const e of linked) {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 190) * 0.010;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }

    // Gravity towards the node's own spine region.
    for (const n of nodes) {
      const p = pos.get(n.id);
      const c = centres.get(n.spine);
      p.vx += (c.x - p.x) * 0.016;
      p.vy += (c.y - p.y) * 0.016;
    }

    for (const n of nodes) {
      const p = pos.get(n.id);
      p.x += Math.max(-18, Math.min(18, p.vx)) * cool;
      p.y += Math.max(-18, Math.min(18, p.vy)) * cool;
      p.vx *= 0.82; p.vy *= 0.82;
      p.x = Math.max(80, Math.min(WIDTH - 80, p.x));
      p.y = Math.max(54, Math.min(HEIGHT - 44, p.y));
    }
  }
  return { pos, centres, spines };
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Node radius from how much of the document is actually indexed. */
function radius(n) {
  if (n.contentStatus !== "full") return 5;
  return Math.max(6, Math.min(22, 5 + Math.sqrt(n.sections) * 1.1));
}

function shortLabel(title) {
  const t = title.replace(/^(The|Government Functional Standard )/i, "").trim();
  return t.length > 26 ? t.slice(0, 25) + "…" : t;
}

/**
 * Render the graph.
 * @returns {string} SVG markup
 */
export function renderGraph(nodes, edges) {
  const { pos, centres, spines } = layout(nodes, edges);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const spineLabels = spines.map((s) => {
    const c = centres.get(s);
    return `<text class="g-spine" x="${c.x.toFixed(1)}" y="${(c.y - 128).toFixed(1)}" fill="${SPINE_COLOUR[s] ?? "#5c666d"}">${esc(s)}</text>`;
  }).join("");

  const lines = edges.map((e) => {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) return "";
    const conflict = CONFLICT_TYPES.has(e.type);
    const crossSpine = byId.get(e.from)?.spine !== byId.get(e.to)?.spine;
    // Curve them: 26 straight lines through a crowded middle are unreadable.
    const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.14;
    const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.14;
    return `<path class="g-edge${conflict ? " conflict" : ""}${crossSpine ? " cross" : ""}"
      d="M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}"
      data-from="${esc(e.from)}" data-to="${esc(e.to)}"><title>${esc(e.from)} ${esc(e.type)} ${esc(e.to)}${e.scope ? ` — ${esc(e.scope)}` : ""}</title></path>`;
  }).join("");

  const circles = nodes.map((n) => {
    const p = pos.get(n.id);
    const r = radius(n);
    const colour = SPINE_COLOUR[n.spine] ?? "#5c666d";
    const dim = n.contentStatus !== "full";
    return `<g class="g-node${dim ? " dim" : ""}" data-id="${esc(n.id)}" tabindex="0" role="listitem"
        aria-label="${esc(n.title)}, ${esc(n.body)}, ${esc(n.authority)}">
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${colour}"
        ${n.authority === "mandatory" ? 'stroke="#14171a" stroke-width="2.5"' : `stroke="${colour}" stroke-width="1"`}
        ${dim ? 'fill-opacity="0.25"' : 'fill-opacity="0.82"'} />
      <text class="g-label${r < 8 ? " small" : ""}" x="${p.x.toFixed(1)}" y="${(p.y + r + 12).toFixed(1)}"
        stroke="#fcfcfc" stroke-width="3.2" paint-order="stroke">${esc(shortLabel(n.title))}</text>
      <title>${esc(n.title)} — ${esc(n.body)}${n.contentStatus === "full" ? ` — ${n.sections} sections` : " — not indexed"}</title>
    </g>`;
  }).join("");

  // A class per spine, not style="--c:…". The CSP forbids inline style attributes and
  // a nonce cannot whitelist one, so the swatches silently rendered grey in production
  // while looking right locally. This is the second time that trap has been sprung
  // here; see the rule in CLAUDE.md.
  const legend = spines.map((s) =>
    `<span class="g-key"><i class="spine-${esc(s)}"></i>${esc(s)}</span>`).join("");

  const conflicts = edges.filter((e) => CONFLICT_TYPES.has(e.type)).length;
  const orphans = nodes.filter((n) => !edges.some((e) => e.from === n.id || e.to === n.id)).length;
  const crossing = edges.filter((e) => byId.get(e.from)?.spine !== byId.get(e.to)?.spine).length;

  return `
  <figure class="graph">
    <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img"
         aria-label="Network diagram of ${nodes.length} guidance documents from ${new Set(nodes.map((n) => n.body)).size} bodies, with ${edges.length} curated relationships between them. The same information is listed below.">
      <g class="g-edges">${lines}</g>
      <g class="g-spines">${spineLabels}</g>
      <g class="g-nodes" role="list">${circles}</g>
    </svg>
    <figcaption>
      <div class="g-legend">${legend}
        <span class="g-key"><i class="ring"></i>thick outline = mandatory</span>
        <span class="g-key"><i class="faded"></i>faded = not indexed</span>
        <span class="g-key"><i class="line conflict"></i>red = supersedes or conflicts</span>
      </div>
      <p class="meta">Circle size is how much of the document is indexed.
      ${crossing} of ${edges.length} relationships cross between spines, ${conflicts} of them mean one document is out of date,
      and ${orphans} documents have no curated relationship at all &mdash; which is a gap in the curation, not evidence of independence.</p>
    </figcaption>
  </figure>`;
}

export { SPINE_COLOUR };
