import { cached, fetchJson, fetchText } from "./http";

/** Ilmatieteen laitoksen avoin data: meteorologien tarkastama pistekohtainen ennuste (Pohjoismaat). */
const FMI_WFS = "https://opendata.fmi.fi/wfs";
const STORED_QUERY = "fmi::forecast::edited::weather::scandinavia::point::simple";
/** Maailmanlaajuinen varalähde, kun FMI:llä ei ole dataa (Pohjoismaiden ulkopuolella tai katkos). */
const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const TTL_S = 900;
const FORECAST_HOURS = 24;

export interface CloudPoint {
  time_tag: string;
  cloud_cover: number;
}

export interface CloudCover {
  now: number;
  forecast: CloudPoint[];
  provider: string;
  source: string;
}

/** Purkaa FMI:n "simple"-muotoisen WFS-vastauksen (BsWfsElement: Time, ParameterName, ParameterValue). */
export function parseFmiSimple(xml: string, parameter: string): CloudPoint[] {
  const points: CloudPoint[] = [];
  for (const [, element] of xml.matchAll(/<BsWfs:BsWfsElement\b[^>]*>([\s\S]*?)<\/BsWfs:BsWfsElement>/g)) {
    const field = (name: string) => element.match(new RegExp(`<BsWfs:${name}>([^<]*)</BsWfs:${name}>`))?.[1].trim();
    if (field("ParameterName") !== parameter) continue;
    const time = new Date(field("Time") ?? "");
    const raw = field("ParameterValue");
    const value = raw ? Number(raw) : NaN; // FMI merkitsee puuttuvan arvon tyhjänä tai NaN:na
    if (Number.isNaN(time.getTime()) || !Number.isFinite(value)) continue;
    points.push({ time_tag: time.toISOString(), cloud_cover: value });
  }
  return points.sort((a, b) => a.time_tag.localeCompare(b.time_tag));
}

async function fmiCloudCover(la: string, lo: string, start: Date, end: Date): Promise<CloudCover> {
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "getFeature",
    storedquery_id: STORED_QUERY,
    latlon: `${la},${lo}`,
    parameters: "TotalCloudCover",
    timestep: "60",
    starttime: iso(start),
    endtime: iso(end),
  });
  const xml = await fetchText(`${FMI_WFS}?${params}`, TTL_S, "application/xml");
  const forecast = parseFmiSimple(xml, "TotalCloudCover");
  if (!forecast.length) throw new Error("FMI: pilvisyysennuste puuttuu (sijainti peittoalueen ulkopuolella?)");
  return {
    now: forecast[0].cloud_cover,
    forecast,
    provider: "Ilmatieteen laitos",
    source: "https://www.ilmatieteenlaitos.fi/avoin-data",
  };
}

async function openMeteoCloudCover(la: string, lo: string): Promise<CloudCover> {
  const params = new URLSearchParams({
    latitude: la,
    longitude: lo,
    current: "cloud_cover",
    hourly: "cloud_cover",
    forecast_hours: String(FORECAST_HOURS + 1),
    timezone: "GMT",
  });
  const body = (await fetchJson(`${OPEN_METEO}?${params}`, TTL_S)) as {
    current?: { cloud_cover?: unknown };
    hourly?: { time?: unknown[]; cloud_cover?: unknown[] };
  };
  const now = Number(body.current?.cloud_cover);
  if (body.current?.cloud_cover == null || !Number.isFinite(now)) throw new Error("Open-Meteo: pilvisyys puuttuu vastauksesta");
  const covers = body.hourly?.cloud_cover ?? [];
  const forecast = (body.hourly?.time ?? [])
    .map((t, i) => ({ time: new Date(`${String(t)}Z`), cloud_cover: covers[i] == null ? NaN : Number(covers[i]) }))
    .filter((p) => !Number.isNaN(p.time.getTime()) && Number.isFinite(p.cloud_cover))
    .map((p) => ({ time_tag: p.time.toISOString(), cloud_cover: p.cloud_cover }));
  return { now, forecast, provider: "Open-Meteo", source: "https://open-meteo.com/" };
}

/**
 * Kokonaispilvisyys (%) kuluvalle tunnille ja seuraaville tunneille käyttäjän tarkassa sijainnissa.
 * Ensisijaisesti FMI; jos sillä ei ole dataa sijainnista, käytetään Open-Meteoa.
 */
export function getCloudCover(lat: number, lon: number, now = new Date()): Promise<CloudCover> {
  // 4 desimaalia ≈ 10 m: käytännössä käyttäjän oma piste, mutta välimuistiavain pysyy järkevänä.
  const la = lat.toFixed(4), lo = lon.toFixed(4);
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + FORECAST_HOURS * 3_600_000);
  return cached(`clouds:${la}:${lo}:${start.toISOString()}`, TTL_S, () =>
    fmiCloudCover(la, lo, start, end).catch((exc) => {
      console.warn(`FMI ei antanut pilvisyyttä, käytetään Open-Meteoa: ${exc}`);
      return openMeteoCloudCover(la, lo);
    }),
  );
}
