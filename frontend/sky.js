// Piirtää taivaankartan SVG:nä: atsimuuttinen projektio, zeniitti keskellä.
const R = 170, CX = 200, CY = 200;

function svgEl(name, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function drawSky(svg, chart) {
  svg.innerHTML = "";
  svg.appendChild(svgEl("circle", { cx: CX, cy: CY, r: R, fill: "#060a15", stroke: "#2a3858" }));

  [0, 30, 60].forEach((alt) => {
    const r = ((90 - alt) / 90) * R;
    svg.appendChild(svgEl("circle", { cx: CX, cy: CY, r, fill: "none", stroke: "#182238", "stroke-dasharray": alt === 0 ? "none" : "3 5" }));
  });

  [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(([label, az]) => {
    const rad = (az * Math.PI) / 180;
    const t = svgEl("text", {
      x: CX + (R + 14) * Math.sin(rad),
      y: CY - (R + 14) * Math.cos(rad),
      fill: "#8b9ac0", "font-size": 12, "text-anchor": "middle", "dominant-baseline": "middle",
    });
    t.textContent = label;
    svg.appendChild(t);
  });

  const colors = { planet: "#ffb547", star: "#e8eefc", sun: "#ffd75e", moon: "#c9d6f0" };

  chart.objects.forEach((o) => {
    if (o.alt < 0) return;
    const r = ((90 - o.alt) / 90) * R;
    const rad = (o.az * Math.PI) / 180;
    const x = CX + r * Math.sin(rad);
    const y = CY - r * Math.cos(rad);
    const isStar = o.kind === "star";
    const size = isStar ? Math.max(1.6, 4.2 - (o.magnitude ?? 2) * 0.9) : 4.5;

    if (!isStar) {
      svg.appendChild(svgEl("circle", { cx: x, cy: y, r: size + 4, fill: colors[o.kind], opacity: 0.18 }));
    }
    svg.appendChild(svgEl("circle", { cx: x, cy: y, r: size, fill: colors[o.kind] || "#fff" }));

    if (!isStar) {
      const t = svgEl("text", { x: x + 8, y: y - 6, fill: colors[o.kind], "font-size": 11 });
      t.textContent = o.name;
      svg.appendChild(t);
    }
  });

  const info = svgEl("text", { x: CX, y: CY + R + 30, fill: "#8b9ac0", "font-size": 11, "text-anchor": "middle" });
  info.textContent = `Aurinko ${chart.sun_alt.toFixed(0)}° · ${chart.is_dark ? "pimeää" : "valoisaa"} · ${chart.moon_phase_name}`;
  svg.appendChild(info);
}

window.drawSky = drawSky;
