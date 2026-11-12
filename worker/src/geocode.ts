import { fetchJson } from "./http";

/** Paikannimihaku (Open-Meteo Geocoding, GeoNames-aineisto). Ei vaadi avainta. */
const GEOCODING = "https://geocoding-api.open-meteo.com/v1/search";
const TTL_S = 86_400;
const MAX_RESULTS = 5;
/** Haetaan reilusti ehdokkaita, koska lähde ei järjestä osumia kirjoittamisen aikaisia ehdotuksia varten. */
const CANDIDATES = 30;

export interface Place {
  name: string;
  region: string | null;
  country: string | null;
  lat: number;
  lon: number;
}

/**
 * Poimii vastauksesta kelvolliset paikat ja järjestää ne ehdotuksiksi: ensin nimet, jotka alkavat
 * hakusanalla, niiden sisällä suurin asukasluku ensin ("Rova" → Rovaniemi ennen pikkukyliä).
 * Lähteen oma paras osuma pidetään aina mukana, jotta tarkalla nimellä löytyy pienikin paikka.
 */
export function parsePlaces(payload: unknown, query = ""): Place[] {
  const rows = (payload as { results?: unknown })?.results;
  if (!Array.isArray(rows)) return [];
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  const prefix = query.toLocaleLowerCase("fi");
  const candidates = rows.flatMap((row: Record<string, unknown> | null) => {
    const name = text(row?.name);
    const lat = Number(row?.latitude ?? NaN), lon = Number(row?.longitude ?? NaN);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    const place: Place = { name, region: text(row?.admin1), country: text(row?.country), lat, lon };
    return [{ place, starts: name.toLocaleLowerCase("fi").startsWith(prefix), population: Number(row?.population) || 0 }];
  });
  const ranked = [...candidates].sort((a, b) => Number(b.starts) - Number(a.starts) || b.population - a.population);
  const top = ranked.slice(0, MAX_RESULTS);
  if (candidates.length && !top.includes(candidates[0])) top[MAX_RESULTS - 1] = candidates[0];
  return top.map((c) => c.place);
}

export async function searchPlaces(query: string): Promise<{ results: Place[] }> {
  const params = new URLSearchParams({ name: query, count: String(CANDIDATES), language: "fi", format: "json" });
  return { results: parsePlaces(await fetchJson(`${GEOCODING}?${params}`, TTL_S), query) };
}
