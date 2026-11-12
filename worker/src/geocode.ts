import { fetchJson } from "./http";

/** Paikannimihaku (Open-Meteo Geocoding, GeoNames-aineisto). Ei vaadi avainta. */
const GEOCODING = "https://geocoding-api.open-meteo.com/v1/search";
const TTL_S = 86_400;
const MAX_RESULTS = 5;

export interface Place {
  name: string;
  region: string | null;
  country: string | null;
  lat: number;
  lon: number;
}

/** Poimii vastauksesta kelvolliset paikat; puutteelliset rivit ohitetaan. */
export function parsePlaces(payload: unknown): Place[] {
  const rows = (payload as { results?: unknown })?.results;
  if (!Array.isArray(rows)) return [];
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  return rows.flatMap((row: Record<string, unknown> | null) => {
    const name = text(row?.name);
    const lat = Number(row?.latitude ?? NaN), lon = Number(row?.longitude ?? NaN);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    return [{ name, region: text(row?.admin1), country: text(row?.country), lat, lon }];
  });
}

export async function searchPlaces(query: string): Promise<{ results: Place[] }> {
  const params = new URLSearchParams({ name: query, count: String(MAX_RESULTS), language: "fi", format: "json" });
  return { results: parsePlaces(await fetchJson(`${GEOCODING}?${params}`, TTL_S)) };
}
