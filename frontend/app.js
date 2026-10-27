const API = location.origin.replace(/\/$/, "");
const state = { lat: null, lon: null, timeOffset: 0 };

const fmt = (d) => new Date(d).toLocaleString("fi-FI", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function countdown(target) {
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return "hetki sitten";
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h} h ${m} min` : `${m} min ${s} s`;
}

async function loadConfig() {
  const c = await (await fetch(`${API}/api/config`)).json();
  Object.assign(state, { lat: c.default_lat, lon: c.default_lon });
  geolocate();
}

function geolocate() {
  if (!navigator.geolocation) return refreshSky();
  navigator.geolocation.getCurrentPosition(
    (pos) => { state.lat = pos.coords.latitude; state.lon = pos.coords.longitude; refreshSky(); },
    () => refreshSky(),
    { timeout: 4000 }
  );
}

async function loadWeather() {
  const w = await (await fetch(`${API}/api/spaceweather?lat=${state.lat ?? ""}`)).json();
  document.getElementById("kp").textContent = w.kp_now.toFixed(1);
  document.getElementById("g-label").textContent = w.g_label;
  document.getElementById("aurora").textContent = `Revontulimahdollisuus: ${w.aurora_chance}`;
  document.getElementById("wind").textContent =
    [w.solar_wind_speed_kms ? `Aurinkotuuli ${Math.round(w.solar_wind_speed_kms)} km/s` : null,
     w.bz_nt != null ? `Bz ${w.bz_nt.toFixed(1)} nT` : null].filter(Boolean).join(" · ");
  document.getElementById("alerts").innerHTML =
    (w.alerts || []).map((a) => `<li>${a.replace(/</g, "&lt;")}</li>`).join("");

  const svg = document.getElementById("kp-chart");
  svg.innerHTML = "";
  const pts = w.kp_forecast.length ? [...w.kp_history.slice(-8), ...w.kp_forecast.slice(0, 8)] : w.kp_history;
  const n = pts.length || 1;
  const ns = "http://www.w3.org/2000/svg";
  const scale = (kp) => 100 - (kp / 9) * 90;
  const path = pts.map((p, i) => `${i ? "L" : "M"}${(i / Math.max(n - 1, 1)) * 310 + 5},${scale(p.kp)}`).join(" ");
  const line = document.createElementNS(ns, "path");
  line.setAttribute("d", path);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "#5ed6ff");
  line.setAttribute("stroke-width", "2");
  svg.appendChild(line);
  [0, 3, 5, 7, 9].forEach((kp) => {
    const t = document.createElementNS(ns, "text");
    t.setAttribute("x", 2); t.setAttribute("y", scale(kp) + 3);
    t.setAttribute("fill", "#4a5a7d"); t.setAttribute("font-size", "8");
    t.textContent = kp;
    svg.appendChild(t);
  });
}

async function refreshSky() {
  if (state.lat == null) return;
  const at = new Date(Date.now() + state.timeOffset * 60000).toISOString();
  const chart = await (await fetch(`${API}/api/sky?lat=${state.lat}&lon=${state.lon}&at=${at}`)).json();
  drawSky(document.getElementById("sky-chart"), chart);
  document.getElementById("time-label").textContent = fmt(chart.at);
  document.getElementById("sky-meta").textContent =
    `${chart.observer.place} ${chart.observer.lat.toFixed(2)}°, ${chart.observer.lon.toFixed(2)}° · Kuu ${chart.moon_phase_deg.toFixed(0)}° (${chart.moon_phase_name})`;
  document.getElementById("object-list").innerHTML = chart.objects
    .filter((o) => o.alt > 0 && o.kind !== "star")
    .map((o) => `<span>${o.name} ${o.alt.toFixed(0)}°</span>`)
    .join("");
}

function renderLaunches(board) {
  const next = board.next_launch;
  document.getElementById("next-launch").innerHTML = next
    ? `<b>${next.name}</b><span class="countdown">T-${countdown(next.net)}</span><small>${fmt(next.net)} · ${next.provider} · ${next.location}</small>`
    : "Ei tulevia laukaisuja.";
  document.getElementById("launch-list").innerHTML = board.results
    .map((l) => `<li><div><b>${l.name}</b><small>${fmt(l.net)} · ${l.rocket} · ${l.status}</small></div>
                 <div class="countdown">${countdown(l.net)}</div></li>`)
    .join("");
}

function subscribeLaunches() {
  const es = new EventSource(`${API}/api/launches/stream`);
  es.addEventListener("launches", (e) => renderLaunches(JSON.parse(e.data)));
  es.addEventListener("error", () => {
    es.close();
    fetch(`${API}/api/launches`).then((r) => r.json()).then(renderLaunches);
    setTimeout(subscribeLaunches, 30000);
  });
  setInterval(() => {
    fetch(`${API}/api/launches`).then((r) => r.json()).then(renderLaunches).catch(() => {});
  }, 60000);
}

function tickClock() {
  document.getElementById("clock").textContent =
    new Date().toLocaleString("fi-FI", { dateStyle: "full", timeStyle: "medium" });
}

document.getElementById("time-offset").addEventListener("input", (e) => {
  state.timeOffset = Number(e.target.value);
  refreshSky();
});

tickClock();
setInterval(tickClock, 1000);
loadConfig();
loadWeather();
subscribeLaunches();
setInterval(loadWeather, 300000);
setInterval(refreshSky, 60000);
