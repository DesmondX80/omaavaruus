const API = location.origin.replace(/\/$/, "");
const state = { lat: null, lon: null, place: "", timeOffset: 0 };

const $ = (id) => document.getElementById(id);
const fmt = (d) => new Date(d).toLocaleString("fi-FI", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function countdown(target) {
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return "hetki sitten";
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h} h ${m} min` : `${m} min ${s} s`;
}

async function getJSON(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return res.json();
}

async function loadWeather() {
  try {
    const q = state.lat == null ? "" : `?lat=${state.lat}`;
    const w = await getJSON(`/api/spaceweather${q}`);
    $("kp").textContent = w.kp_now.toFixed(1);
    $("g-label").textContent = w.g_label;
    $("aurora").textContent = `Revontulimahdollisuus: ${w.aurora_chance}`;
    $("wind").textContent =
      [w.solar_wind_speed_kms ? `Aurinkotuuli ${Math.round(w.solar_wind_speed_kms)} km/s` : null,
       w.bz_nt != null ? `Bz ${w.bz_nt.toFixed(1)} nT` : null].filter(Boolean).join(" · ");
    $("alerts").innerHTML = (w.alerts || []).map((a) => `<li>${a.replace(/</g, "&lt;")}</li>`).join("");
    drawKpLine(w);
  } catch (err) {
    $("g-label").textContent = `Avaruussään lataus epäonnistui (${err.message})`;
  }
}

function drawKpLine(w) {
  const svg = $("kp-chart");
  svg.innerHTML = "";
  const pts = w.kp_forecast.length ? [...w.kp_history.slice(-8), ...w.kp_forecast.slice(0, 8)] : w.kp_history;
  if (!pts.length) return;
  const n = pts.length;
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
  try {
    const at = new Date(Date.now() + state.timeOffset * 60000).toISOString();
    const chart = await getJSON(`/api/sky?lat=${state.lat}&lon=${state.lon}&at=${at}`);
    drawSky($("sky-chart"), chart);
    $("time-label").textContent = fmt(chart.at);
    $("sky-meta").textContent =
      `${chart.observer.place} ${chart.observer.lat.toFixed(2)}°, ${chart.observer.lon.toFixed(2)}° · Kuu ${chart.moon_phase_deg.toFixed(0)}° (${chart.moon_phase_name})`;
    $("object-list").innerHTML = chart.objects
      .filter((o) => o.alt > 0 && o.kind !== "star")
      .map((o) => `<span>${o.name} ${o.alt.toFixed(0)}°</span>`)
      .join("");
  } catch (err) {
    $("sky-meta").textContent = `Taivaankartan lataus epäonnistui (${err.message})`;
  }
}

function renderLaunches(board) {
  try {
    const next = board.next_launch;
    $("next-launch").innerHTML = next
      ? `<b>${next.name}</b><span class="countdown">T-${countdown(next.net)}</span><small>${fmt(next.net)} · ${next.provider} · ${next.location}</small>`
      : "Ei tulevia laukaisuja.";
    $("launch-list").innerHTML = board.results
      .map((l) => `<li><div><b>${l.name}</b><small>${fmt(l.net)} · ${l.rocket} · ${l.status}</small></div>
                   <div class="countdown">${countdown(l.net)}</div></li>`)
      .join("");
  } catch (err) {
    $("next-launch").textContent = `Laukaisujen näyttö epäonnistui (${err.message})`;
  }
}

function subscribeLaunches() {
  if (!("EventSource" in window)) return pollLaunches();
  const es = new EventSource(`${API}/api/launches/stream`);
  es.addEventListener("launches", (e) => renderLaunches(JSON.parse(e.data)));
  es.addEventListener("error", () => {
    es.close();
    pollLaunches();
    setTimeout(subscribeLaunches, 30000);
  });
}

async function pollLaunches() {
  try {
    renderLaunches(await getJSON("/api/launches"));
  } catch (err) {
    $("next-launch").textContent = `Laukaisujen lataus epäonnistui (${err.message})`;
  }
}

function tickClock() {
  $("clock").textContent = new Date().toLocaleString("fi-FI", { dateStyle: "full", timeStyle: "medium" });
}

function tryGeolocate() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.lat = pos.coords.latitude;
      state.lon = pos.coords.longitude;
      loadWeather();
      refreshSky();
    },
    () => {},
    { timeout: 4000 }
  );
}

(async function init() {
  tickClock();
  setInterval(tickClock, 1000);
  $("time-offset").addEventListener("input", (e) => {
    state.timeOffset = Number(e.target.value);
    refreshSky();
  });
  try {
    const c = await getJSON("/api/config");
    Object.assign(state, { lat: c.default_lat, lon: c.default_lon, place: c.default_place });
  } catch (err) {
    $("g-label").textContent = `Konfiguraation lataus epäonnistui (${err.message})`;
  }
  await loadWeather();
  await refreshSky();
  pollLaunches();
  subscribeLaunches();
  tryGeolocate();
  setInterval(loadWeather, 300000);
  setInterval(refreshSky, 60000);
})();
