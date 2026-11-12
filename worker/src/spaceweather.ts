import { getCloudCover, type CloudCover } from "./clouds";
import { asRecords, cached, fetchJson } from "./http";
import { getOvation, OVATION_URL, ovationAt, ovationLevel, type OvationPoint } from "./ovation";
import { skyLight, type SkyLight } from "./sky";

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

export const CHANCE_LEVELS = ["Epätodennäköinen", "Mahdollinen", "Hyvä", "Erittäin hyvä"];

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

/** Taivaan valoisuus Auringon korkeudesta: porvarillinen hämärä päättyy −6°:ssa, merenkulkuhämärä −12°:ssa. */
export function lightLabel(sunAlt: number): string {
  if (sunAlt > -6) return "Valoisaa";
  if (sunAlt > -12) return "Hämärää";
  return "Pimeää";
}

export interface Visibility {
  chance: string;
  /** Mitkä tekijät laskivat arviota: "valoisuus", "pilvisyys", "hämärä", "kuu". */
  limits: string[];
}

/**
 * Arvio siitä, näkyvätkö revontulet oikeasti: geomagneettinen arvio, josta vähennetään
 * pilvisyys, taivaan valoisuus ja kuutamo.
 * - Aurinko yli −6°: liian valoisaa, ei näkyvyyttä.
 * - Aurinko −6…−12°: hämärä pudottaa yhden portaan.
 * - Kuu horisontin yläpuolella ja vähintään puoliksi valaistu: yksi porras, mutta ei alle "Mahdollisen",
 *   koska kuutamo himmentää revontulia eikä peitä niitä kokonaan.
 */
export function visibleChance(geomagnetic: string, cloudCover: number | null, light: SkyLight): Visibility {
  let level = CHANCE_LEVELS.indexOf(geomagnetic);
  if (level <= 0) return { chance: geomagnetic, limits: [] };
  if (light.sun_alt > -6) return { chance: CHANCE_LEVELS[0], limits: ["valoisuus"] };
  const limits: string[] = [];
  const afterClouds = CHANCE_LEVELS.indexOf(cloudAdjustedChance(geomagnetic, cloudCover));
  if (afterClouds < level) limits.push("pilvisyys");
  level = afterClouds;
  if (level > 0 && light.sun_alt > -12) {
    level -= 1;
    limits.push("hämärä");
  }
  if (level > 1 && light.moon_alt > 0 && light.moon_illumination >= 0.5) {
    level -= 1;
    limits.push("kuu");
  }
  return { chance: CHANCE_LEVELS[level], limits };
}

export interface HourPoint extends SkyLight {
  time_tag: string;
  /** null, jos Kp-ennuste ei kata tuntia; silloin arviokin puuttuu. */
  kp: number | null;
  /** Geomagneettisen arvion lähde: OVATION-malli kattaa vain lähimmän tunnin, sen jälkeen Kp-ennuste. */
  model: "OVATION" | "Kp" | null;
  cloud_cover: number | null;
  light: string;
  chance: string | null;
  chance_geomagnetic: string | null;
  limits: string[];
}

/** Ensimmäinen yhtenäinen jakso, jolla arvio on ennusteen paras. null, jos mikään tunti ei ole edes "Mahdollinen". */
export function bestWindow(hours: Pick<HourPoint, "time_tag" | "chance">[]) {
  const levels = hours.map((h) => (h.chance === null ? -1 : CHANCE_LEVELS.indexOf(h.chance)));
  const top = Math.max(0, ...levels);
  if (top === 0) return null;
  const first = levels.indexOf(top);
  let last = first;
  while (levels[last + 1] === top) last++;
  return {
    start: hours[first].time_tag,
    end: new Date(Date.parse(hours[last].time_tag) + HOUR_MS).toISOString(),
    chance: CHANCE_LEVELS[top],
  };
}

const HOUR_MS = 3_600_000;
const HOURLY_COUNT = 24;
const KP_BIN_MS = 3 * HOUR_MS;

/** OVATION-arvio, joka on voimassa ennusteen hetkeen asti. */
interface OvationNow {
  until: number;
  chance: string;
}

/**
 * Tuntikohtainen arvio kuluvasta tunnista eteenpäin: pilvisyysennuste, valoisuus ja geomagneettinen arvio.
 * Ne tunnit, jotka alkavat ennen OVATION-ennusteen hetkeä, käyttävät mallia, myöhemmät Kp-ennustetta (3 h jaksot).
 */
function hourlyOutlook(
  lat: number,
  lon: number,
  now: Date,
  kpRows: KpPoint[],
  clouds: CloudCover | null,
  ovation: OvationNow | null,
): HourPoint[] {
  const start = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const cloudAt = new Map(clouds?.forecast.map((p) => [Date.parse(p.time_tag), p.cloud_cover]));
  return Array.from({ length: HOURLY_COUNT }, (_, i) => {
    const t = start + i * HOUR_MS;
    const kp = kpRows.filter((row) => {
      const bin = Date.parse(row.time_tag);
      return bin <= t && t < bin + KP_BIN_MS;
    }).at(-1)?.kp ?? null;
    const cloud = cloudAt.get(t) ?? null;
    // Kuluvan tunnin valoisuus lasketaan nykyhetkelle, tulevien tuntien tasatunnille.
    const light = skyLight(lat, lon, i === 0 ? now : new Date(t));
    const useOvation = ovation !== null && t <= ovation.until;
    const geomagnetic = useOvation ? ovation.chance : kp === null ? null : auroraChance(kp, lat);
    const visibility = geomagnetic === null ? { chance: null, limits: [] } : visibleChance(geomagnetic, cloud, light);
    return {
      time_tag: new Date(t).toISOString(),
      kp,
      model: useOvation ? "OVATION" : kp === null ? null : "Kp",
      cloud_cover: cloud,
      ...light,
      light: lightLabel(light.sun_alt),
      ...visibility,
      chance_geomagnetic: geomagnetic,
    };
  });
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
  // Syöte sisältää noin viikon havaitut arvot ja kolmen vuorokauden ennusteen; rajaus tehdään käyttöhetkellä.
  return rows.map((row) => {
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
  }, true);
}

export async function getSpaceWeather(lat: number, lon: number) {
  const now = new Date();
  // Pilvisyyden tai OVATION-mallin haun epäonnistuminen ei saa kaataa avaruussäätä:
  // arvio tehdään silloin Kp:stä ja ilman pilvisyyttä.
  const [{ history, forecast, speed, bz, bt, alertList }, clouds, grid] = await Promise.all([
    swpcData(),
    getCloudCover(lat, lon).catch((exc): CloudCover | null => {
      console.warn(`Pilvisyyden haku epäonnistui: ${exc}`);
      return null;
    }),
    getOvation(now).catch((exc) => {
      console.warn(`OVATION-mallin haku epäonnistui: ${exc}`);
      return null;
    }),
  ]);
  const kpNow = history.at(-1)?.kp ?? 0;
  const g = kpToGScale(kpNow);
  const kpChance = auroraChance(kpNow, lat);
  const ovation: OvationPoint | null = grid && ovationAt(grid, lat, lon);
  const geomagnetic = ovation ? CHANCE_LEVELS[ovationLevel(ovation)] : kpChance;
  const cloudNow = clouds?.now ?? null;
  const light = skyLight(lat, lon, now);
  const visibility = visibleChance(geomagnetic, cloudNow, light);
  const ovationNow = ovation && { until: Date.parse(ovation.forecast), chance: geomagnetic };
  const hourly = hourlyOutlook(lat, lon, now, forecast, clouds, ovationNow);
  return {
    updated: now.toISOString(),
    kp_now: kpNow,
    g_scale: g,
    g_label: G_LABELS[g],
    kp_history: history,
    kp_forecast: forecast.filter((p) => Date.parse(p.time_tag) > now.getTime() - KP_BIN_MS).slice(0, 24),
    solar_wind_speed_kms: speed,
    bz_nt: bz,
    bt_nt: bt,
    aurora_chance: visibility.chance,
    aurora_chance_geomagnetic: geomagnetic,
    aurora_chance_kp: kpChance,
    aurora_model: ovation ? "OVATION" : "Kp",
    ovation,
    aurora_limits: visibility.limits,
    ...light,
    light: lightLabel(light.sun_alt),
    cloud_cover_pct: cloudNow,
    cloud_label: cloudNow === null ? null : cloudLabel(cloudNow),
    cloud_provider: clouds?.provider ?? null,
    hourly,
    best_window: bestWindow(hourly),
    alerts: alertList,
    sources: [
      `${SWPC}/products/noaa-planetary-k-index.json`,
      "https://www.swpc.noaa.gov/products/planetary-k-index",
      ...(ovation ? [OVATION_URL] : []),
      ...(clouds ? [clouds.source] : []),
    ],
  };
}
