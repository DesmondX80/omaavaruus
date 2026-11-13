// Service worker: tekee sovelluksesta asennettavan ja toimivan ilman verkkoa.
// Kaikki haetaan ensin verkosta; välimuistiin turvaudutaan vain, kun verkko ei vastaa.
// Julkaisu korvaa VERSION-arvon commitin tunnisteella, jolloin selain asentaa uuden workerin.
const VERSION = "dev";
const SHELL_CACHE = `shell-${VERSION}`;
const DATA_CACHE = "data-v1";
const DATA_MAX_ENTRIES = 30;
// Sovelluksen näkymät (js/nav.js), joihin ilmoitus voi viedä.
const VIEWS = ["nyt", "revontulet", "taivas", "iss", "kalenteri"];

// Sovelluksen tiedostot, jotka haetaan talteen heti asennuksessa (testi varmistaa, että lista kattaa frontend-hakemiston).
const SHELL = [
  "./",
  "styles.css",
  "config.js",
  "manifest.webmanifest",
  "js/main.js",
  "js/calendar.js",
  "js/cameras.js",
  "js/core.js",
  "js/events.js",
  "js/info.js",
  "js/iss.js",
  "js/issmap.js",
  "js/land.js",
  "js/launches.js",
  "js/nav.js",
  "js/night.js",
  "js/now.js",
  "js/outlook.js",
  "js/places.js",
  "js/push.js",
  "js/sheets.js",
  "js/sky.js",
  "js/skychart.js",
  "js/skyview.js",
  "js/solarwind.js",
  "js/weather.js",
  "icons/icon.svg",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // cache: "reload" ohittaa selaimen HTTP-välimuistin, jotta talteen ei jää vanhaa versiota.
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith("shell-") && n !== SHELL_CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    // Paikkahaku vaatii verkon; muiden reittien viimeisin vastaus pidetään tallessa.
    if (url.pathname !== "/api/geocode") event.respondWith(apiResponse(request, url));
  } else if (url.origin === self.location.origin) {
    event.respondWith(shellResponse(request));
  }
});

// Revontuli- tai laukaisuilmoitus palvelimelta (ks. worker/src/push.ts). Ilmoitus näytetään aina, vaikka sisältöä ei saataisi luettua.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    // Näytetään oletusteksti
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? "OmaAvaruus", {
      body: data.body ?? "Revontulia voi olla näkyvissä.",
      icon: "icons/icon-192.png",
      // Sama tunniste korvaa aiemman ilmoituksen: revontulista näkyy vain tuorein, kustakin laukaisusta omansa.
      tag: data.tag ?? "aurora",
      renotify: true,
      // Näkymä, joka avataan napautuksesta. Vanhassa viestissä sitä ei ole, jolloin avautuu etusivu.
      data: { view: VIEWS.includes(data.view) ? data.view : null },
    }),
  );
});

// Ilmoituksen napautus tuo avoimen sovelluksen esiin ja vaihtaa sen ilmoituksen näkymään, tai avaa sovelluksen siihen näkymään.
// Avoin ikkuna vaihtaa näkymän itse viestin perusteella (js/main.js), jolloin sivua ei ladata uudelleen.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const view = event.notification.data?.view ?? null;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => "focus" in client);
      if (!open) return self.clients.openWindow(view ? `./#${view}` : "./");
      if (view) open.postMessage({ view });
      return open.focus();
    }),
  );
});

/** Sovelluksen tiedostot: tuore versio verkosta (HTTP-välimuisti tarkistetaan palvelimelta), ilman verkkoa talletettu. */
async function shellResponse(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (err) {
    // ignoreSearch: julkaisu lisää osoitteisiin ?v=<versio>, talletetut ovat ilman sitä.
    const hit = (await cache.match(request, { ignoreSearch: true })) ?? (request.mode === "navigate" ? await cache.match("./") : undefined);
    if (hit) return hit;
    throw err;
  }
}

/**
 * Välimuistin avain: reitti ja sijainti 0,1 asteen (noin 10 km) tarkkuudella. Muut parametrit (esim. taivaankartan
 * kellonaika) jätetään pois, jotta ilman verkkoa löytyy aina paikan viimeisin vastaus eikä välimuisti kasva rajatta.
 */
function dataKey(url) {
  const coord = (name) => {
    const value = Number(url.searchParams.get(name) ?? NaN);
    return Number.isFinite(value) ? value.toFixed(1) : "";
  };
  // Taivaankartan kohteen tiedot ovat kohdekohtaisia, joten nimi kuuluu avaimeen.
  const name = url.searchParams.get("name");
  return `${url.origin}${url.pathname}?lat=${coord("lat")}&lon=${coord("lon")}${name ? `&name=${encodeURIComponent(name)}` : ""}`;
}

async function apiResponse(request, url) {
  const cache = await caches.open(DATA_CACHE);
  const key = dataKey(url);
  try {
    const response = await fetch(request);
    if (response.ok) await storeData(cache, key, response.clone());
    return response;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

/** Tallettaa vastauksen hakuajalla merkittynä: sivu näyttää X-Cached-At-otsakkeesta, että tiedot eivät ole tuoreita. */
async function storeData(cache, key, response) {
  const headers = new Headers(response.headers);
  headers.set("X-Cached-At", new Date().toISOString());
  await cache.delete(key); // uusin viimeiseksi, jotta vanhimmat karsiutuvat ensin
  await cache.put(key, new Response(await response.blob(), { status: response.status, headers }));
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - DATA_MAX_ENTRIES)).map((k) => cache.delete(k)));
}
