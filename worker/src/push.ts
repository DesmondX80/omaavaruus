/** Revontuli- ja laukaisuilmoitukset: tilausten tallennus Workers KV:hen ja ajastettu tarkistus, joka lähettää push-viestit. */
import { HttpError } from "./http";
import { findPasses, getTle, type Pass } from "./iss";
import { getLaunches, type Launch } from "./launches";
import { cloudAt, cloudCoverOrNull } from "./clouds";
import { CHANCE_LEVELS, cloudLabel, getSpaceWeather } from "./spaceweather";
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
  /** Suosikkitoimijat, joiden laukaisuista ilmoitetaan. Tyhjä tai puuttuva: ei laukaisuilmoituksia. */
  launch_providers?: string[];
  /** Laukaisut, joista on jo ilmoitettu (ks. launchKey). */
  launches_notified?: string[];
  /** Ilmoitetaanko näkyvistä ISS-ylilennoista tilauksen paikassa. */
  iss?: boolean;
  /** Ylilennot, joista on jo ilmoitettu (näkyvän osuuden alku). */
  iss_notified?: string[];
}

/** Sallitut push-palvelut: Worker ei lähetä pyyntöjä mielivaltaisiin osoitteisiin. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /\.push\.apple\.com$/];
const VAPID_KEY = "vapid";
const SUB_PREFIX = "sub:";
/** Samasta tai heikommasta tilanteesta ei ilmoiteta uudelleen tämän ajan sisällä. */
const COOLDOWN_MS = 6 * 3_600_000;
/** Suosikkitoimijan laukaisusta ilmoitetaan, kun siihen on enintään tämän verran aikaa. */
const LAUNCH_LEAD_MS = 3_600_000;
const MAX_PROVIDERS = 20;
/** Kuinka monta ilmoitettua laukaisua tilaus muistaa; lista seuraavista laukaisuista on tätä lyhyempi. */
const MAX_NOTIFIED = 20;
/** Näkyvästä ISS-ylilennosta ilmoitetaan, kun sen alkuun on enintään tämän verran (cron ajetaan 15 minuutin välein). */
const ISS_LEAD_MS = 20 * 60_000;
/** Pilvisyys (%), josta alkaen ISS-ilmoitukseen lisätään maininta: asema näkyy ohuen pilviverhon läpi, mutta ei paksun. */
const CLOUDY_PCT = 70;
const ISS_DIRECTIONS = ["pohjoisesta", "koillisesta", "idästä", "kaakosta", "etelästä", "lounaasta", "lännestä", "luoteesta"];
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
  const providers = body.launch_providers ?? [];
  if (!Array.isArray(providers) || providers.length > MAX_PROVIDERS || providers.some((p) => typeof p !== "string" || !p || p.length > 80)) {
    throw invalid("Suosikkitoimijoiden lista on virheellinen.");
  }
  const place = typeof body.place === "string" ? body.place.trim().slice(0, 80) : "";
  // Sijainti tallennetaan 0,1 asteen (noin 10 km) tarkkuudella: riittää pilvisyysennusteeseen, mutta ei paljasta tarkkaa paikkaa.
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    endpoint,
    keys: { p256dh, auth },
    lat: round(lat),
    lon: round(lon),
    place: place || "valittu paikka",
    threshold,
    launch_providers: [...new Set(providers as string[])],
    iss: body.iss === true,
  };
}

/** Tallentaa tilauksen tai päivittää sen paikan, rajan ja suosikkitoimijat. */
export async function subscribe(env: PushEnv, body: Record<string, unknown>) {
  const sub = parseSubscription(body);
  const key = await subscriptionKey(sub.endpoint);
  // Jo ilmoitetut laukaisut ja ylilennot säilyvät, jottei asetusten muutos toista ilmoitusta.
  const previous = await env.SUBSCRIPTIONS.get<Subscription>(key, "json");
  await env.SUBSCRIPTIONS.put(key, JSON.stringify({ ...sub, launches_notified: previous?.launches_notified, iss_notified: previous?.iss_notified }));
  return { ok: true, place: sub.place, lat: sub.lat, lon: sub.lon, threshold: sub.threshold, launch_providers: sub.launch_providers, iss: sub.iss };
}

export async function unsubscribe(env: PushEnv, body: Record<string, unknown>) {
  await env.SUBSCRIPTIONS.delete(await subscriptionKey(parseEndpoint(body.endpoint)));
  return { ok: true };
}

/** Lähettää viestin ja poistaa tilauksen, jos push-palvelu kertoo sen lakanneen (404/410). Palauttaa, menikö viesti perille palveluun. */
/**
 * Ilmoituksen sisältö. `view` on sovelluksen näkymä (osoitteen #-osa), joka avautuu ilmoitusta napautettaessa,
 * ja `tag` korvaa samalla tunnisteella aiemmin näytetyn ilmoituksen.
 */
export interface Notice {
  title: string;
  body: string;
  tag?: string;
  view: "nyt" | "revontulet" | "iss" | "kalenteri";
}

async function deliver(env: PushEnv, key: string, sub: Subscription, payload: Notice): Promise<boolean> {
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
    view: "nyt",
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

/** Laukaisun tunniste ilmoituksia varten. Päivämäärä on mukana, jotta toiselle päivälle siirtyneestä laukaisusta ilmoitetaan uudelleen. */
const launchKey = (launch: Launch) => `${launch.id}@${launch.net?.slice(0, 10)}`;

/** Suosikkitoimijoiden laukaisut, jotka ovat alkamassa ja joista ei ole vielä ilmoitettu. */
export function launchesToNotify(sub: Pick<Subscription, "launch_providers" | "launches_notified">, launches: Launch[], now: number): Launch[] {
  return launches.filter((launch) => {
    const lead = launch.net ? Date.parse(launch.net) - now : NaN;
    return lead > 0 && lead <= LAUNCH_LEAD_MS && !!sub.launch_providers?.includes(launch.provider) && !sub.launches_notified?.includes(launchKey(launch));
  });
}

/** Näkyvät ylilennot, joiden näkyvä osuus alkaa ISS_LEAD_MS kuluessa ja joista ei ole vielä ilmoitettu. */
export function passesToNotify(sub: Pick<Subscription, "iss_notified">, passes: Pass[], now: number): Pass[] {
  return passes.filter((pass) => {
    const lead = pass.visible_start ? Date.parse(pass.visible_start) - now : NaN;
    return lead > 0 && lead <= ISS_LEAD_MS && !sub.iss_notified?.includes(pass.visible_start!);
  });
}

/** Ajastettu tarkistus: laskee arvion kunkin tilauksen paikalle, käy läpi suosikkitoimijoiden laukaisut ja lähettää ilmoitukset. */
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
        view: "revontulet",
      });
      if (ok) {
        sent++;
        sub.last = { at: now.toISOString(), level };
        await env.SUBSCRIPTIONS.put(key, JSON.stringify(sub));
      }
    } catch (exc) {
      // Yhden paikan tai tilauksen virhe ei saa estää muiden ilmoituksia.
      console.warn(`Ilmoituksen tarkistus epäonnistui (${place}): ${exc}`);
    }
  }

  let launchesSent = 0;
  const followers = subs.filter(([, sub]) => sub.launch_providers?.length);
  // Laukaisulistan haun virhe ei saa kaataa tarkistusta: ilmoitus ehtii vielä seuraavalla kierroksella.
  const launches = followers.length ? await getLaunches().then((board) => board.results, () => []) : [];
  for (const [key, sub] of followers) {
    for (const launch of launchesToNotify(sub, launches, now.getTime())) {
      try {
        const minutes = Math.round((Date.parse(launch.net!) - now.getTime()) / 60_000);
        const ok = await deliver(env, key, sub, {
          title: `Laukaisu pian: ${launch.name}`,
          body: `${[launch.provider, launch.rocket, launch.location].filter(Boolean).join(" · ")}. Laukaisuun noin ${minutes} min.`,
          tag: `launch-${launch.id}`,
          view: "kalenteri",
        });
        if (!ok) continue;
        launchesSent++;
        sub.launches_notified = [...(sub.launches_notified ?? []), launchKey(launch)].slice(-MAX_NOTIFIED);
        await env.SUBSCRIPTIONS.put(key, JSON.stringify(sub));
      } catch (exc) {
        console.warn(`Laukaisuilmoitus epäonnistui (${launch.name}): ${exc}`);
      }
    }
  }

  let issSent = 0;
  const watchers = subs.filter(([, sub]) => sub.iss);
  const tle = watchers.length ? await getTle(now).catch((exc) => console.warn(`ISS:n ratatiedot puuttuvat: ${exc}`)) : undefined;
  // Samassa paikassa olevat tilaukset jakavat ylilentolaskennan.
  const passesAt = new Map<string, Pass[]>();
  for (const [key, sub] of tle ? watchers : []) {
    const place = `${sub.lat},${sub.lon}`;
    try {
      // Haku alkaa vähän ennen nykyhetkeä: ylilento voi tulla näkyväksi vasta, kun se on jo käynnissä.
      if (!passesAt.has(place)) passesAt.set(place, findPasses(tle!, sub.lat, sub.lon, new Date(now.getTime() - 15 * 60_000), 1.25 / 24));
      for (const pass of passesToNotify(sub, passesAt.get(place)!, now.getTime())) {
        const minutes = Math.round((Date.parse(pass.visible_start!) - now.getTime()) / 60_000);
        const from = ISS_DIRECTIONS[Math.round(pass.start_az / 45) % 8];
        // Pilvisyysennuste on jo haettu revontuliarviota varten, joten se tulee välimuistista.
        const cloud = cloudAt(await cloudCoverOrNull(sub.lat, sub.lon, now), pass.visible_start!);
        const ok = await deliver(env, key, sub, {
          title: `ISS näkyy noin ${minutes} min kuluttua – ${sub.place}`,
          body: [
            `Asema nousee ${from} ja käy ${pass.max_alt}° korkeudella.`,
            pass.magnitude === null ? "" : `Kirkkaus noin ${pass.magnitude.toLocaleString("fi-FI")} mag.`,
            cloud !== null && cloud >= CLOUDY_PCT ? `Ennuste: ${cloudLabel(cloud).toLowerCase()} (${Math.round(cloud)} %).` : "",
          ].filter(Boolean).join(" "),
          tag: `iss-${pass.visible_start}`,
          view: "iss",
        });
        if (!ok) continue;
        issSent++;
        sub.iss_notified = [...(sub.iss_notified ?? []), pass.visible_start!].slice(-MAX_NOTIFIED);
        await env.SUBSCRIPTIONS.put(key, JSON.stringify(sub));
      }
    } catch (exc) {
      console.warn(`ISS-ilmoituksen tarkistus epäonnistui (${place}): ${exc}`);
    }
  }
  return { subscriptions: subs.length, sent, launches_sent: launchesSent, iss_sent: issSent };
}
