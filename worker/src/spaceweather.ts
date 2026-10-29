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

export function getSpaceWeather(lat: number) {
  return cached(`spaceweather:${lat.toFixed(1)}`, TTL_S, async () => {
    const [history, forecast, [speed, bz, bt], alertList] = await Promise.all([
      kpHistory(),
      kpForecast(),
      solarWind(),
      alerts(),
    ]);
    const kpNow = history.at(-1)?.kp ?? 0;
    const g = kpToGScale(kpNow);
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
      aurora_chance: auroraChance(kpNow, lat),
      alerts: alertList,
      sources: [
        `${SWPC}/products/noaa-planetary-k-index.json`,
        "https://www.swpc.noaa.gov/products/planetary-k-index",
      ],
    };
  });
}
