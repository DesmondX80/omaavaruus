// Piirtää taivaankartan SVG:nä: atsimuuttinen projektio, zeniitti keskellä.
// Kartan alle jää rivi tilannetekstille, joten näkymä on korkeampi kuin leveä (sama kuin index.html:n viewBox).
const R = 170, CX = 200, CY = 200, WIDTH = 400, HEIGHT = 420;
/** Kuinka kaukaa (kartan yksikköinä) napautus vielä osuu kohteeseen. */
const HIT_RADIUS = 16;
const COLORS = { planet: "#ffb547", star: "#e8eefc", sun: "#ffd75e", moon: "#c9d6f0", iss: "#5ed6ff" };
const COMPASS = [["P", 0], ["KO", 45], ["I", 90], ["KA", 135], ["E", 180], ["LO", 225], ["L", 270], ["LU", 315]];

function svgEl(name, attrs, text) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Korkeus ja atsimuutti kartan koordinaateiksi. Horisontin alla oleva piste osuu ympyrän ulkopuolelle. */
function project(alt, az, radius = ((90 - alt) / 90) * R) {
  const rad = (az * Math.PI) / 180;
  return [CX + radius * Math.sin(rad), CY - radius * Math.cos(rad)];
}

function drawConstellations(svg, chart) {
  const byName = new Map(chart.objects.map((o) => [o.name, o]));
  svg.appendChild(svgEl("clipPath", { id: "sky-clip" })).appendChild(svgEl("circle", { cx: CX, cy: CY, r: R }));
  // Leikkaus katkaisee horisontin alle jatkuvat viivat kartan reunaan.
  const lines = svg.appendChild(svgEl("g", { "clip-path": "url(#sky-clip)", stroke: "#2f4474", "stroke-width": 0.8 }));

  for (const { name, lines: pairs } of chart.constellations ?? []) {
    const stars = new Set();
    for (const pair of pairs) {
      const [a, b] = pair.map((star) => byName.get(star));
      if (!a || !b || (a.alt < 0 && b.alt < 0)) continue;
      const [x1, y1] = project(a.alt, a.az), [x2, y2] = project(b.alt, b.az);
      lines.appendChild(svgEl("line", { x1, y1, x2, y2 }));
      stars.add(a).add(b);
    }
    // Nimi näytetään vain, kun kuvio on kokonaan horisontin yläpuolella.
    const all = new Set(pairs.flat());
    if (stars.size < all.size || [...stars].some((s) => s.alt < 0)) continue;
    const points = [...stars].map((s) => project(s.alt, s.az));
    const x = points.reduce((sum, p) => sum + p[0], 0) / points.length;
    // Nimi kuvion alimman tähden alle, jottei se peitä kuvion omia tähtiä.
    const y = Math.max(...points.map((p) => p[1]));
    svg.appendChild(svgEl("text", { x, y: y + 11, fill: "#566a9c", "font-size": 8.5, "text-anchor": "middle" }, name));
  }
}

function drawCompass(svg) {
  COMPASS.forEach(([label, az]) => {
    const main = az % 90 === 0;
    const [x1, y1] = project(0, az, R), [x2, y2] = project(0, az, R + (main ? 5 : 3));
    svg.appendChild(svgEl("line", { x1, y1, x2, y2, stroke: "#2a3858" }));
    const [x, y] = project(0, az, R + 15);
    svg.appendChild(svgEl("text", {
      x, y, fill: main ? "#8b9ac0" : "#5c6b90", "font-size": main ? 12 : 9, "text-anchor": "middle", "dominant-baseline": "middle",
    }, label));
  });
}

export function drawSky(svg, chart, selected) {
  svg.innerHTML = "";
  svg.appendChild(svgEl("circle", { cx: CX, cy: CY, r: R, fill: "#060a15", stroke: "#2a3858" }));

  [30, 60].forEach((alt) => {
    svg.appendChild(svgEl("circle", { cx: CX, cy: CY, r: ((90 - alt) / 90) * R, fill: "none", stroke: "#182238", "stroke-dasharray": "3 5" }));
  });

  drawConstellations(svg, chart);
  drawCompass(svg);

  chart.objects.forEach((o) => {
    if (o.alt < 0) return;
    const [x, y] = project(o.alt, o.az);
    const isStar = o.kind === "star";
    const size = isStar ? Math.max(1.2, 4.2 - (o.magnitude ?? 2) * 0.9) : 4.5;
    const color = COLORS[o.kind] || "#fff";

    if (!isStar) svg.appendChild(svgEl("circle", { cx: x, cy: y, r: size + 4, fill: color, opacity: 0.18 }));
    svg.appendChild(svgEl("circle", { cx: x, cy: y, r: size, fill: color }));
    if (o.name === selected) svg.appendChild(svgEl("circle", { cx: x, cy: y, r: size + 5, fill: "none", stroke: "#5ed6ff", "stroke-width": 1.5 }));
    if (!isStar || o.name === selected) {
      // Kartan oikeassa reunassa nimi kirjoitetaan kohteen vasemmalle puolelle, jotta se mahtuu näkyviin.
      const left = x > WIDTH - 90;
      svg.appendChild(svgEl("text", { x: x + (left ? -8 : 8), y: y - 6, fill: color, "font-size": 11, "text-anchor": left ? "end" : "start" }, o.name));
    }
  });

  svg.appendChild(svgEl("text", { x: CX, y: HEIGHT - 6, fill: "#8b9ac0", "font-size": 11, "text-anchor": "middle" },
    `Aurinko ${chart.sun_alt.toFixed(0)}° · ${chart.is_dark ? "pimeää" : "valoisaa"} · ${chart.moon_phase_name}`));
}

/** Napautuskohtaa lähin horisontin yläpuolella oleva kohde, tai null jos lähellä ei ole mitään. */
export function objectAt(svg, chart, clientX, clientY) {
  const box = svg.getBoundingClientRect();
  const x = ((clientX - box.left) / box.width) * WIDTH, y = ((clientY - box.top) / box.height) * HEIGHT;
  let best = null, bestDist = HIT_RADIUS;
  for (const o of chart.objects) {
    if (o.alt < 0) continue;
    const [ox, oy] = project(o.alt, o.az);
    // Planeetat, Aurinko ja Kuu voittavat tasatilanteessa viereisen tähden.
    const dist = Math.hypot(ox - x, oy - y) - (o.kind === "star" ? 0 : 3);
    if (dist < bestDist) [best, bestDist] = [o, dist];
  }
  return best;
}
