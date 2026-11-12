/**
 * NOAA SWPC:n OVATION Prime -revontulimalli: revontulien todennäköisyys (0–100 %) yhden asteen ruudukossa
 * noin 30–90 minuutin päähän. Malli laskee aurinkotuulen mittauksista, missä revontuliovaali on,
 * joten se on Kp-heuristiikkaa tarkempi nykyhetken arvio. Taivaan valoisuutta ja pilvisyyttä se ei huomioi.
 */
import { cached, fetchJson, type Codec } from "./http";

export const OVATION_URL = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";
const TTL_S = 300;
const LATS = 181;
/** Malliajo päivittyy noin viiden minuutin välein; tätä vanhempaa ennustetta ei käytetä. */
const MAX_AGE_MS = 2 * 3_600_000;
/**
 * Noin 100 km korkeudella olevat revontulet näkyvät horisontin yläpuolella vielä noin 500 km päästä
 * (korkeuskulma noin 10°). Lähistön todennäköisyys lasketaan tältä säteeltä.
 */
export const NEARBY_KM = 500;
const EARTH_KM = 6371;

export interface OvationGrid {
  observed: string;
  forecast: string;
  /** Todennäköisyys indeksissä lon * 181 + (lat + 90), lon 0…359 ja lat −90…90. */
  values: Uint8Array;
}

export interface OvationPoint {
  observed: string;
  forecast: string;
  /** Todennäköisyys suoraan paikan yläpuolella. */
  probability: number;
  /** Suurin todennäköisyys NEARBY_KM säteellä: revontulet voivat näkyä horisontin yläpuolella. */
  nearby: number;
}

/** Purkaa syötteen [[lon, lat, aurora], ...] tiiviiksi ruudukoksi. */
export function parseOvation(payload: unknown): OvationGrid {
  const data = payload as { "Observation Time"?: unknown; "Forecast Time"?: unknown; coordinates?: unknown };
  const observed = new Date(String(data?.["Observation Time"]));
  const forecast = new Date(String(data?.["Forecast Time"]));
  if (!Array.isArray(data?.coordinates) || Number.isNaN(observed.getTime()) || Number.isNaN(forecast.getTime())) {
    throw new Error("OVATION-syötteen muoto on tuntematon");
  }
  const values = new Uint8Array(360 * LATS);
  for (const row of data.coordinates) {
    if (!Array.isArray(row)) continue;
    const [lon, lat, aurora] = row.map(Number);
    if (!Number.isInteger(lon) || !Number.isInteger(lat) || lon < 0 || lon > 359 || Math.abs(lat) > 90) continue;
    values[lon * LATS + lat + 90] = Math.max(0, Math.min(100, Math.round(aurora) || 0));
  }
  return { observed: observed.toISOString(), forecast: forecast.toISOString(), values };
}

const valueAt = (grid: OvationGrid, lat: number, lon: number) =>
  grid.values[(((Math.round(lon) % 360) + 360) % 360) * LATS + Math.round(lat) + 90];

const rad = (deg: number) => (deg * Math.PI) / 180;

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Todennäköisyys paikan kohdalla ja suurin todennäköisyys lähistöllä. */
export function ovationAt(grid: OvationGrid, lat: number, lon: number): OvationPoint {
  const dLat = (NEARBY_KM / EARTH_KM) * (180 / Math.PI);
  const dLon = Math.min(180, dLat / Math.max(0.05, Math.cos(rad(Math.min(89, Math.abs(lat) + dLat)))));
  let nearby = 0;
  for (let la = Math.ceil(Math.max(-90, lat - dLat)); la <= Math.min(90, lat + dLat); la++) {
    for (let lo = Math.ceil(lon - dLon); lo <= lon + dLon; lo++) {
      if (distanceKm(lat, lon, la, lo) <= NEARBY_KM) nearby = Math.max(nearby, valueAt(grid, la, lo));
    }
  }
  const probability = valueAt(grid, lat, lon);
  return { observed: grid.observed, forecast: grid.forecast, probability, nearby: Math.max(nearby, probability) };
}

/**
 * Todennäköisyyden rajat portaille Mahdollinen, Hyvä ja Erittäin hyvä. Mallin arvot jäävät pieniksi:
 * rauhallisena yönä Lapissa noin 5–10 %, voimakkaassa myrskyssä ovaalin kohdalla 50–90 %.
 */
const STEPS = [5, 15, 35];
const step = (p: number) => STEPS.filter((limit) => p >= limit).length;

/**
 * Geomagneettinen arvio portaina 0–3 (CHANCE_LEVELS): paikan yläpuolinen todennäköisyys tai, porrasta
 * heikompana, lähistön todennäköisyys, koska horisontin tuntumassa revontulet ovat matalalla ja himmeämpiä.
 */
export function ovationLevel(point: Pick<OvationPoint, "probability" | "nearby">): number {
  return Math.max(step(point.probability), step(point.nearby) - 1);
}

/** Kartan reunan leveysaste: tätä lähempänä päiväntasaajaa revontulia näkyy vain poikkeuksellisissa myrskyissä. */
export const MAP_LAT_MIN = 40;

/**
 * Havaitsijan pallonpuoliskon ruudukko kartalle: rivi kutakin leveysastetta kohden reunalta (MAP_LAT_MIN) navalle,
 * rivissä todennäköisyys pituusasteille 0…359.
 */
export function ovationMap(grid: OvationGrid, south: boolean) {
  const rows = Array.from({ length: 91 - MAP_LAT_MIN }, (_, i) => {
    const lat = south ? -(MAP_LAT_MIN + i) : MAP_LAT_MIN + i;
    return Array.from({ length: 360 }, (_, lon) => grid.values[lon * LATS + lat + 90]);
  });
  return { observed: grid.observed, forecast: grid.forecast, hemisphere: south ? "south" : "north", lat_min: MAP_LAT_MIN, rows };
}

/** Ruudukko jaettuun välimuistiin base64-merkkijonona: noin 87 kt JSONia jäsennetyn syötteen 0,9 Mt:n sijaan. */
export const GRID_CODEC: Codec<OvationGrid> = {
  encode: (grid) => {
    // Paloissa: koko taulukko yhden kutsun argumentteina ylittäisi argumenttien enimmäismäärän.
    let binary = "";
    for (let i = 0; i < grid.values.length; i += 8192) binary += String.fromCharCode(...grid.values.subarray(i, i + 8192));
    return { ...grid, values: btoa(binary) };
  },
  decode: (stored) => {
    const raw = stored as Omit<OvationGrid, "values"> & { values: string };
    return { ...raw, values: Uint8Array.from(atob(raw.values), (c) => c.charCodeAt(0)) };
  },
};

/** Viimeisin malliajo ruudukkona. Heittää virheen, jos syöte puuttuu tai on vanhentunut. */
export async function getOvation(now = new Date()): Promise<OvationGrid> {
  const grid = await cached("ovation", TTL_S, async () => parseOvation(await fetchJson(OVATION_URL, TTL_S)), GRID_CODEC);
  if (now.getTime() - Date.parse(grid.forecast) > MAX_AGE_MS) throw new Error(`OVATION-ennuste on vanhentunut (${grid.forecast})`);
  return grid;
}
