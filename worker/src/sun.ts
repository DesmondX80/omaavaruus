/**
 * Auringon tilanne revontulien ennakointiin: viimeaikaiset röntgenpurkaukset (NOAA SWPC, GOES) ja Maahan
 * suuntautuvien koronan massapurkausten (CME) arvioidut saapumisajat NASA:n DONKI-palvelusta (WSA-Enlil-malli).
 * Tiedot ovat maailmanlaajuisia, joten sama välimuistissa oleva vastaus kelpaa kaikille paikoille.
 */
import { cached, fetchJson } from "./http";

const FLARES_URL = "https://services.swpc.noaa.gov/json/goes/primary/xray-flares-7-day.json";
const DONKI = "https://api.nasa.gov/DONKI/WSAEnlilSimulations";
/** Purkauslista päivittyy minuuttien välein; puolen tunnin välimuisti riittää. */
const FLARES_TTL_S = 1800;
/**
 * WSA-Enlil-mallia ajetaan muutaman kerran vuorokaudessa. Kolmen tunnin välimuisti pitää NASA:n API-kutsut
 * vähäisinä (julkisella DEMO_KEY-avaimella raja on noin 10 kutsua tunnissa).
 */
const CME_TTL_S = 3 * 3600;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Kuinka vanhat purkaukset näytetään: CME saapuu Maahan tavallisesti 1–3 vuorokaudessa. */
const FLARE_DAYS = 3;
/** NOAA:n arvio WSA-Enlil-mallin saapumisajan tavallisesta virheestä. */
export const ARRIVAL_UNCERTAINTY_H = 7;

export interface Flare {
  /** Purkauksen luokka huipussa (esim. "M2.1"). Vain M- ja X-luokan purkaukset vaikuttavat avaruussäähän. */
  class: string;
  begin: string;
  peak: string;
}

export interface CmeArrival {
  /** WSA-Enlil-mallin arvio iskuaallon saapumisesta Maahan. */
  arrival: string;
  /** Sivuosuma: CME:n reuna osuu Maahan, vaikutus on tavallisesti pienempi. */
  glancing: boolean;
  /** Mallin Kp-arvio eri magneettikentän suunnille (pienin ja suurin), null jos mallissa ei ole arviota. */
  kp_min: number | null;
  kp_max: number | null;
  /** CME:n lähtöhetki Auringosta ja nopeus km/s. */
  start: string | null;
  speed: number | null;
}

const isoZ = (value: unknown) => {
  const date = new Date(/[zZ]$/.test(String(value)) ? String(value) : `${String(value)}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** Viimeisten FLARE_DAYS vuorokauden M- ja X-luokan purkaukset uusin ensin. */
export function parseFlares(rows: unknown, now: Date): Flare[] {
  if (!Array.isArray(rows)) throw new Error("Purkauslistan muoto on tuntematon");
  const since = now.getTime() - FLARE_DAYS * DAY_MS;
  return rows
    .filter((r) => /^[MX]/.test(String(r?.max_class ?? "")))
    .map((r) => ({ class: String(r.max_class), begin: isoZ(r.begin_time), peak: isoZ(r.max_time) }))
    .filter((f): f is Flare => !!f.begin && !!f.peak && Date.parse(f.peak) >= since)
    .sort((a, b) => b.peak.localeCompare(a.peak));
}

/**
 * Maahan osuvat CME:t WSA-Enlil-simulaatioista. Samasta CME:stä voi olla useita ajoja; kustakin otetaan uusin.
 * Mukaan tulevat ennusteet, joiden saapuminen on enintään 12 tuntia mennyttä (osuma voi viivästyä).
 */
export function parseCmeArrivals(simulations: unknown, now: Date): CmeArrival[] {
  if (!Array.isArray(simulations)) throw new Error("DONKI-vastauksen muoto on tuntematon");
  const byCme = new Map<string, { completed: string; arrival: CmeArrival }>();
  for (const sim of simulations) {
    const arrival = sim?.estimatedShockArrivalTime ? isoZ(sim.estimatedShockArrivalTime) : null;
    if (!arrival || Date.parse(arrival) < now.getTime() - 12 * HOUR_MS) continue;
    const input = (sim.cmeInputs ?? []).find((c: { isMostAccurate?: boolean }) => c.isMostAccurate) ?? sim.cmeInputs?.[0];
    const kps = [sim.kp_18, sim.kp_90, sim.kp_135, sim.kp_180].filter((k): k is number => typeof k === "number");
    const entry = {
      completed: String(sim.modelCompletionTime ?? ""),
      arrival: {
        arrival,
        glancing: sim.isEarthGB === true,
        kp_min: kps.length ? Math.min(...kps) : null,
        kp_max: kps.length ? Math.max(...kps) : null,
        start: input?.cmeStartTime ? isoZ(input.cmeStartTime) : null,
        speed: typeof input?.speed === "number" ? input.speed : null,
      },
    };
    const key = String(input?.cmeid ?? input?.cmeStartTime ?? sim.simulationID);
    const previous = byCme.get(key);
    if (!previous || entry.completed > previous.completed) byCme.set(key, entry);
  }
  return [...byCme.values()].map((e) => e.arrival).sort((a, b) => a.arrival.localeCompare(b.arrival));
}

/** Auringon tilanne. Kumpikin lähde voi puuttua: virhe kerrotaan vastauksessa, eikä se estä toista. */
export async function getSun(apiKey: string | undefined, now = new Date()) {
  const day = (offset: number) => new Date(now.getTime() + offset * DAY_MS).toISOString().slice(0, 10);
  const [flares, cmes] = await Promise.allSettled([
    cached("sun-flares", FLARES_TTL_S, async () => parseFlares(await fetchJson(FLARES_URL, FLARES_TTL_S), now), true),
    // Hakujakso alkaa viikko taaksepäin: hidas CME voi olla matkalla kolmekin vuorokautta.
    cached(`sun-cmes:${day(0)}`, CME_TTL_S, async () => {
      const params = new URLSearchParams({ startDate: day(-7), endDate: day(0), api_key: apiKey || "DEMO_KEY" });
      return parseCmeArrivals(await fetchJson(`${DONKI}?${params}`, CME_TTL_S), now);
    }, true),
  ]);
  const error = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? String(r.reason?.detail ?? r.reason) : null);
  return {
    flares: flares.status === "fulfilled" ? flares.value : null,
    flares_error: error(flares),
    cmes: cmes.status === "fulfilled" ? cmes.value.filter((c) => Date.parse(c.arrival) >= now.getTime() - 12 * HOUR_MS) : null,
    cmes_error: error(cmes),
    arrival_uncertainty_h: ARRIVAL_UNCERTAINTY_H,
  };
}
