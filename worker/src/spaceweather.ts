import { getCloudCover, type CloudCover } from "./clouds";
import { asRecords, cached, fetchJson } from "./http";

const SWPC = "https://services.swpc.noaa.gov";
const TTL_S = 300;

const G_LABELS = [
  "Rauhallinen",
  "G1 – heikko myrsky",
  "G2 – kohtalainen myrsky",
  "G3 – voimakas myrsky",
  "G4 – vakava myrsky",
  "G5 – äärimmäinen myrsky",
];

interface KpPoint {
  time_tag: string;
  kp: number;
  kind: string;
  g_scale: number;
}

/** NOAA G-asteikko (geomagneettinen myrsky) Kp-arvosta. */
export function kpToGScale(kp: number): number {
  if (kp >= 9) return 5;
  if (kp >= 8) return 4;
  if (kp >= 7) return 3;
  if (kp >= 6) return 2;
  if (kp >= 5) return 1;
  return 0;
}

/** Karkea arvio revontulien näkyvyydestä annetulla leveysasteella. */
export function auroraChance(kp: number, lat: number): string {
  if (lat < 55) return "Epätodennäköinen";
  const need = 9 - (lat - 55) / 1.6;
  if (kp >= need + 1.5) return "Erittäin hyvä";
  if (kp >= need) return "Hyvä";
  if (kp >= need - 1.5) return "Mahdollinen";
  return "Epätodennäköinen";
}

const CHANCE_LEVELS = ["Epätodennäköinen", "Mahdollinen", "Hyvä", "Erittäin hyvä"];

/**
 * Pudottaa geomagneettista arviota pilvisyyden mukaan:
 * alle 30 % ei vaikutusta, 30–69 % yksi porras, 70–89 % kaksi porrasta, 90 %+ estää näkyvyyden.
 */
export function cloudAdjustedChance(chance: string, cloudCover: number | null): string {
  const level = CHANCE_LEVELS.indexOf(chance);
  if (cloudCover === null || level <= 0) return chance;
  const drop = cloudCover >= 90 ? level : cloudCover >= 70 ? 2 : cloudCover >= 30 ? 1 : 0;
  return CHANCE_LEVELS[Math.max(0, level - drop)];
}

/** Lyhyt sanallinen kuvaus pilvisyydestä. */
export function cloudLabel(cloudCover: number): string {
  if (cloudCover < 15) return "Selkeää";
  if (cloudCover < 40) return "Melko selkeää";
  if (cloudCover < 70) return "Puolipilvistä";
  if (cloudCover < 90) return "Melko pilvistä";
  return "Pilvistä";
}

/** SWPC:n aikaleimat ovat UTC:tä, vaikka aikavyöhyke puuttuu. */
export function parseTs(value: unknown): string {
  const iso = String(value).trim().replace(" ", "T").replace(/(Z|[+-]00:?00)$/, "");
  const date = new Date(`${iso}Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Virheellinen aikaleima: ${value}`);
  return date.toISOString();
}

const swpc = (path: string) => fetchJson(`${SWPC}${path}`, TTL_S).then(asRecords);

async function kpHistory(): Promise<KpPoint[]> {
  const rows = await swpc("/products/noaa-planetary-k-index.json");
  return rows.slice(-24).map((row) => {
    const kp = Number(row.kp ?? row.Kp ?? 0);
    return { time_tag: parseTs(row.time_tag), kp, kind: "observed", g_scale: kpToGScale(kp) };
  });
}

async function kpForecast(): Promise<KpPoint[]> {
  const rows = await swpc("/products/noaa-planetary-k-index-forecast.json");
  return rows.slice(0, 24).map((row) => {
    const kp = Number(row.kp ?? 0);
    return { time_tag: parseTs(row.time_tag), kp, kind: String(row.observed ?? "predicted"), g_scale: kpToGScale(kp) };
  });
}

async function solarWind(): Promise<[number | null, number | null, number | null]> {
  let speed = null, bz = null, bt = null;
  try {
    const last = (await swpc("/products/summary/solar-wind-speed.json")).at(-1);
    if (last) speed = Number(last.proton_speed ?? last.windspeed ?? last.wind_speed ?? 0) || null;
  } catch {}
  try {
    const last = (await swpc("/products/summary/solar-wind-mag-field.json")).at(-1);
    if (last) {
      bz = Number(last.bz_gsm ?? last.bz ?? 0);
      bt = Number(last.bt || 0) || null;
    }
  } catch {}
  return [speed, bz, bt];
}

async function alerts(): Promise<string[]> {
  try {
    const rows = await swpc("/products/alerts.json");
    return rows
      .slice(0, 5)
      .map((row) => String(row.message ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, 280))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function swpcData() {
  return cached("spaceweather", TTL_S, async () => {
    const [history, forecast, [speed, bz, bt], alertList] = await Promise.all([
      kpHistory(),
      kpForecast(),
      solarWind(),
      alerts(),
    ]);
    return { history, forecast, speed, bz, bt, alertList };
  });
}

export async function getSpaceWeather(lat: number, lon: number) {
  // Pilvisyyden haun epäonnistuminen ei saa kaataa avaruussäätä: arvio tehdään silloin pelkästä Kp:stä.
  const [{ history, forecast, speed, bz, bt, alertList }, clouds] = await Promise.all([
    swpcData(),
    getCloudCover(lat, lon).catch((exc): CloudCover | null => {
      console.warn(`Pilvisyyden haku epäonnistui: ${exc}`);
      return null;
    }),
  ]);
  const kpNow = history.at(-1)?.kp ?? 0;
  const g = kpToGScale(kpNow);
  const geomagnetic = auroraChance(kpNow, lat);
  const cloudNow = clouds?.now ?? null;
  const clearest = clouds?.forecast.length
    ? clouds.forecast.reduce((best, p) => (p.cloud_cover < best.cloud_cover ? p : best))
    : null;
  return {
    updated: new Date().toISOString(),
    kp_now: kpNow,
    g_scale: g,
    g_label: G_LABELS[g],
    kp_history: history,
    kp_forecast: forecast,
    solar_wind_speed_kms: speed,
    bz_nt: bz,
    bt_nt: bt,
    aurora_chance: cloudAdjustedChance(geomagnetic, cloudNow),
    aurora_chance_geomagnetic: geomagnetic,
    cloud_cover_pct: cloudNow,
    cloud_label: cloudNow === null ? null : cloudLabel(cloudNow),
    cloud_provider: clouds?.provider ?? null,
    cloud_forecast: clouds?.forecast ?? [],
    clearest_hour: clearest,
    alerts: alertList,
    sources: [
      `${SWPC}/products/noaa-planetary-k-index.json`,
      "https://www.swpc.noaa.gov/products/planetary-k-index",
      ...(clouds ? [clouds.source] : []),
    ],
  };
}
