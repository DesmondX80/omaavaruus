// Piirtää taivaankartan SVG:nä: atsimuuttinen projektio, zeniitti keskellä.
// Kartan alle jää rivi tilannetekstille, joten näkymä on korkeampi kuin leveä (sama kuin index.html:n viewBox).
const R = 170, CX = 200, CY = 200, WIDTH = 400, HEIGHT = 420;
/** Kuinka kaukaa (kartan yksikköinä) napautus vielä osuu kohteeseen. */
const HIT_RADIUS = 16;
const COLORS = { planet: "#ffb547", star: "#e8eefc", sun: "#ffd75e", moon: "#c9d6f0", iss: "#5ed6ff", pass: "#ffb547" };
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

const clock = (time) => new Date(time).toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" });

/**
 * Ylilennon taivaan radan osuus aikaväliltä [from, to] pisteinä [korkeus, atsimuutti] (ks. worker/src/iss.ts, sky_track).
 * Välin päätepisteet interpoloidaan näytteiden välistä; atsimuutti kulkee lyhyintä tietä pohjoisen yli.
 */
export function arcPoints(pass, from = -Infinity, to = Infinity) {
  const start = Date.parse(pass.start), samples = pass.sky_track.map(([s, alt, az]) => [start + s * 1000, alt, az]);
  const at = (time) => {
    const i = samples.findIndex((p) => p[0] >= time);
    if (i <= 0) return samples[Math.max(i, 0)].slice(1);
    const [t0, alt0, az0] = samples[i - 1], [t1, alt1, az1] = samples[i], f = (time - t0) / (t1 - t0);
    const daz = ((az1 - az0 + 540) % 360) - 180;
    return [alt0 + (alt1 - alt0) * f, (az0 + daz * f + 360) % 360];
  };
  const first = samples[0][0], last = samples.at(-1)[0];
  from = Math.max(from, first); to = Math.min(to, last);
  if (from > to) return [];
  return [at(from), ...samples.filter((p) => p[0] > from && p[0] < to).map((p) => p.slice(1)), at(to)];
}

// Ylilennon kaari: koko ylilento ohuena, näkyvä osuus paksuna, nuoli kulkusuuntaan ja näkyvän osuuden alku- ja loppuaika.
function drawPass(svg, pass) {
  const path = (points) => points.map(([alt, az], i) => `${i ? "L" : "M"}${project(alt, az).map((v) => v.toFixed(1)).join(",")}`).join("");
  const from = Date.parse(pass.visible_start), to = Date.parse(pass.visible_end);
  const all = arcPoints(pass), visible = arcPoints(pass, from, to);
  const g = svg.appendChild(svgEl("g", { "pointer-events": "none" }));
  g.appendChild(svgEl("path", { d: path(all), fill: "none", stroke: "#8b9ac0", "stroke-width": 1.2, "stroke-dasharray": "3 3" }));
  g.appendChild(svgEl("path", { d: path(visible), fill: "none", stroke: COLORS.pass, "stroke-width": 3, "stroke-linecap": "round" }));
  const [tip, back] = [all.at(-1), all.at(-2)].map(([alt, az]) => project(alt, az));
  const a = Math.atan2(tip[1] - back[1], tip[0] - back[0]);
  const corner = (side) => `${(tip[0] + 7 * Math.cos(a + side)).toFixed(1)},${(tip[1] + 7 * Math.sin(a + side)).toFixed(1)}`;
  g.appendChild(svgEl("path", { d: `M${(tip[0] + 6 * Math.cos(a)).toFixed(1)},${(tip[1] + 6 * Math.sin(a)).toFixed(1)}L${corner(2.6)}L${corner(-2.6)}Z`, fill: "#8b9ac0" }));
  const label = ([alt, az], text) => {
    const [x, y] = project(alt, az);
    // Teksti kartan keskustaa kohti, jottei se jää horisontin ulkopuolelle.
    const inward = Math.atan2(CY - y, CX - x);
    g.appendChild(svgEl("text", { x: x + 14 * Math.cos(inward), y: y + 14 * Math.sin(inward) + 4, fill: COLORS.pass, "font-size": 10, "text-anchor": "middle" }, text));
  };
  label(visible[0], clock(from));
  if (clock(from) !== clock(to)) label(visible.at(-1), clock(to));
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
  // Valittu tai seuraava näkyvä ISS-ylilento (sky.js liittää sen karttaan).
  if (chart.iss_pass?.sky_track) drawPass(svg, chart.iss_pass);

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
