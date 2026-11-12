/** Revontuli-ilmoitukset: tilausten tallennus Workers KV:hen ja ajastettu tarkistus, joka lähettää push-viestit. */
import { HttpError } from "./http";
import { CHANCE_LEVELS, getSpaceWeather } from "./spaceweather";
import { generateVapidKeys, sendPush, type PushTarget, type VapidKeys } from "./webpush";

export interface PushEnv {
  SUBSCRIPTIONS: KVNamespace;
  /** VAPID-yhteystieto push-palvelulle (https- tai mailto-osoite). */
  PUSH_SUBJECT: string;
}

export interface Subscription extends PushTarget {
  lat: number;
  lon: number;
  place: string;
  /** Alin arvio, josta ilmoitetaan. */
  threshold: string;
  /** Viimeisin lähetetty ilmoitus: estää saman tilanteen toistuvat ilmoitukset. */
  last?: { at: string; level: number };
}

/** Sallitut push-palvelut: Worker ei lähetä pyyntöjä mielivaltaisiin osoitteisiin. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /\.push\.apple\.com$/];
const VAPID_KEY = "vapid";
const SUB_PREFIX = "sub:";
/** Samasta tai heikommasta tilanteesta ei ilmoiteta uudelleen tämän ajan sisällä. */
const COOLDOWN_MS = 6 * 3_600_000;
/** Revontulitilanne vanhenee nopeasti: push-palvelu saa yrittää toimitusta tunnin. */
const TTL_S = 3600;

/**
 * VAPID-avainpari luodaan ensimmäisellä käyttökerralla ja säilytetään KV:ssä, jotta käyttöönotto ei vaadi
 * salaisuuksien asettamista käsin. Avaimen vaihtuminen mitätöisi kaikki tilaukset.
 */
async function vapidKeys(env: PushEnv): Promise<VapidKeys> {
  const stored = await env.SUBSCRIPTIONS.get<VapidKeys>(VAPID_KEY, "json");
  if (stored) return stored;
  const created = await generateVapidKeys();
  await env.SUBSCRIPTIONS.put(VAPID_KEY, JSON.stringify(created));
  return created;
}

export async function pushPublicKey(env: PushEnv) {
  return { publicKey: (await vapidKeys(env)).publicKey };
}

async function subscriptionKey(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return SUB_PREFIX + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const invalid = (detail: string) => new HttpError(422, detail);

function parseEndpoint(value: unknown): string {
  if (typeof value !== "string" || value.length > 1000) throw invalid("Tilauksen endpoint puuttuu tai on virheellinen.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid("Tilauksen endpoint ei ole kelvollinen osoite.");
  }
  if (url.protocol !== "https:" || !PUSH_HOSTS.some((host) => host.test(url.hostname))) {
    throw invalid(`Tuntematon push-palvelu: ${url.hostname}`);
  }
  return value;
}

function parseSubscription(body: Record<string, unknown>): Subscription {
  const sub = (body.subscription ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = parseEndpoint(sub.endpoint);
  const { p256dh, auth } = sub.keys ?? {};
  if (typeof p256dh !== "string" || typeof auth !== "string" || p256dh.length > 200 || auth.length > 100) {
    throw invalid("Tilauksen avaimet puuttuvat.");
  }
  const lat = Number(body.lat), lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw invalid("Sijainti puuttuu tai on virheellinen.");
  }
  const threshold = String(body.threshold);
  if (CHANCE_LEVELS.indexOf(threshold) < 1) throw invalid("Ilmoitusraja on virheellinen.");
  const place = typeof body.place === "string" ? body.place.trim().slice(0, 80) : "";
  // Sijainti tallennetaan 0,1 asteen (noin 10 km) tarkkuudella: riittää pilvisyysennusteeseen, mutta ei paljasta tarkkaa paikkaa.
  const round = (value: number) => Math.round(value * 10) / 10;
  return { endpoint, keys: { p256dh, auth }, lat: round(lat), lon: round(lon), place: place || "valittu paikka", threshold };
}

/** Tallentaa tilauksen tai päivittää sen paikan ja rajan. */
export async function subscribe(env: PushEnv, body: Record<string, unknown>) {
  const sub = parseSubscription(body);
  await env.SUBSCRIPTIONS.put(await subscriptionKey(sub.endpoint), JSON.stringify(sub));
  return { ok: true, place: sub.place, lat: sub.lat, lon: sub.lon, threshold: sub.threshold };
}

export async function unsubscribe(env: PushEnv, body: Record<string, unknown>) {
  await env.SUBSCRIPTIONS.delete(await subscriptionKey(parseEndpoint(body.endpoint)));
  return { ok: true };
}

/** Lähettää viestin ja poistaa tilauksen, jos push-palvelu kertoo sen lakanneen (404/410). Palauttaa, menikö viesti perille palveluun. */
async function deliver(env: PushEnv, key: string, sub: Subscription, payload: unknown): Promise<boolean> {
  const status = await sendPush(sub, payload, await vapidKeys(env), env.PUSH_SUBJECT, TTL_S);
  if (status === 404 || status === 410) await env.SUBSCRIPTIONS.delete(key);
  if (status < 200 || status >= 300) console.warn(`Push-palvelu vastasi ${status} (${new URL(sub.endpoint).hostname})`);
  return status >= 200 && status < 300;
}

/** Testi-ilmoitus: lähetetään vain tallennettuun tilaukseen, joten reittiä ei voi käyttää viestien lähettämiseen muualle. */
export async function sendTest(env: PushEnv, body: Record<string, unknown>) {
  const key = await subscriptionKey(parseEndpoint(body.endpoint));
  const sub = await env.SUBSCRIPTIONS.get<Subscription>(key, "json");
  if (!sub) throw new HttpError(404, "Tilausta ei löytynyt. Ota ilmoitukset käyttöön uudelleen.");
  const ok = await deliver(env, key, sub, {
    title: "OmaAvaruus: testi-ilmoitus",
    body: `Ilmoitukset toimivat. Saat viestin, kun revontuliarvio on vähintään ${sub.threshold.toLowerCase()} (${sub.place}).`,
  });
  if (!ok) throw new HttpError(502, "Push-palvelu ei hyväksynyt viestiä. Ota ilmoitukset käyttöön uudelleen.");
  return { ok: true };
}

/** Ilmoitetaan, kun arvio on vähintään rajalla eikä samasta tai heikommasta tilanteesta ole juuri ilmoitettu. */
export function shouldNotify(sub: Pick<Subscription, "threshold" | "last">, level: number, now: number): boolean {
  if (level < CHANCE_LEVELS.indexOf(sub.threshold)) return false;
  if (!sub.last) return true;
  return level > sub.last.level || now - Date.parse(sub.last.at) >= COOLDOWN_MS;
}

/** Ajastettu tarkistus: laskee arvion kunkin tilauksen paikalle ja lähettää ilmoitukset. */
export async function checkSubscriptions(env: PushEnv, now = new Date()) {
  const subs: [string, Subscription][] = [];
  let cursor: string | undefined;
  do {
    const page = await env.SUBSCRIPTIONS.list({ prefix: SUB_PREFIX, cursor });
    for (const { name } of page.keys) {
      const sub = await env.SUBSCRIPTIONS.get<Subscription>(name, "json");
      if (sub) subs.push([name, sub]);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  let sent = 0;
  // Samassa paikassa olevat tilaukset jakavat yhden avaruussäähaun (ja getSpaceWeatherin välimuistin).
  const weatherAt = new Map<string, ReturnType<typeof getSpaceWeather>>();
  for (const [key, sub] of subs) {
    const place = `${sub.lat},${sub.lon}`;
    if (!weatherAt.has(place)) weatherAt.set(place, getSpaceWeather(sub.lat, sub.lon));
    try {
      const weather = await weatherAt.get(place)!;
      const level = CHANCE_LEVELS.indexOf(weather.aurora_chance);
      if (!shouldNotify(sub, level, now.getTime())) continue;
      const details = [
        ...(weather.ovation ? [`OVATION ${weather.ovation.probability} % (lähistöllä ${weather.ovation.nearby} %)`] : []),
        `Kp ${weather.kp_now.toLocaleString("fi-FI", { maximumFractionDigits: 1 })}`,
        ...(weather.cloud_cover_pct === null ? [] : [`pilvisyys ${Math.round(weather.cloud_cover_pct)} %`]),
      ];
      const ok = await deliver(env, key, sub, {
        title: `Revontulia voi näkyä nyt – ${sub.place}`,
        body: `Arvio: ${weather.aurora_chance}. ${details.join(", ")}.`,
      });
      if (ok) {
        sent++;
        await env.SUBSCRIPTIONS.put(key, JSON.stringify({ ...sub, last: { at: now.toISOString(), level } }));
      }
    } catch (exc) {
      // Yhden paikan tai tilauksen virhe ei saa estää muiden ilmoituksia.
      console.warn(`Ilmoituksen tarkistus epäonnistui (${place}): ${exc}`);
    }
  }
  return { subscriptions: subs.length, sent };
}
