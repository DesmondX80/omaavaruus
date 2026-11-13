/**
 * Revontulihistoria viime öiltä: mikä arvio olisi ollut valitussa paikassa, laskettuna jälkikäteen havaituista Kp-arvoista
 * (NOAA, noin 7 vuorokautta), toteutuneesta pilvisyydestä (Open-Meteo, past_days) ja taivaan valoisuudesta.
 * Mitään ei tallenneta: historia lasketaan pyynnön yhteydessä, joten se toimii mille tahansa paikalle eikä kuluta KV-kiintiötä.
 */
import { cached, fetchJson } from "./http";
import { Body, Equator, Horizon, Illumination, MakeTime, Observer, type AstroTime } from "astronomy-engine";
import { auroraChance, CHANCE_LEVELS, kpObserved, visibleChance, type KpPoint } from "./spaceweather";

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const NIGHTS = 7;
const HOUR_MS = 3_600_000;
const KP_BIN_MS = 3 * HOUR_MS;
/** Menneen pilvisyyden haku välimuistiin tunniksi: mennyt ei muutu, ja kuluva tunti tarkentuu hitaasti. */
const CLOUDS_TTL_S = 3600;
/** Yö lasketaan pimeäksi, kun Aurinko on yli 12° horisontin alla (sama raja kuin arviossa ”Pimeää”). */
const DARK_SUN_ALT = -12;

export interface Night {
  /** Illan päivämäärä paikallista aurinkoaikaa (yö 13.–14.11. on 2026-11-13). */
  night: string;
  dark_hours: number;
  kp_max: number | null;
  cloud_mean: number | null;
  /** Yön paras arvio pimeiltä tunneilta, tai null, jos yö oli valoisa tai Kp puuttui. */
  best: string | null;
  best_time: string | null;
}

async function pastClouds(lat: number, lon: number): Promise<Map<number, number>> {
  const la = lat.toFixed(1), lo = lon.toFixed(1), hour = Math.floor(Date.now() / HOUR_MS);
  const rows = await cached(`cloud-history:${la}:${lo}:${hour}`, CLOUDS_TTL_S, async () => {
    const params = new URLSearchParams({ latitude: la, longitude: lo, hourly: "cloud_cover", past_days: String(NIGHTS + 1), forecast_days: "1", timezone: "GMT" });
    const body = (await fetchJson(`${OPEN_METEO}?${params}`, CLOUDS_TTL_S)) as { hourly?: { time?: unknown[]; cloud_cover?: unknown[] } };
    const covers = body.hourly?.cloud_cover ?? [];
    return (body.hourly?.time ?? [])
      .map((t, i) => [Date.parse(`${String(t)}Z`), covers[i] == null ? NaN : Number(covers[i])] as [number, number])
      .filter(([t, c]) => Number.isFinite(t) && Number.isFinite(c));
  });
  return new Map(rows);
}

/** Yöt vanhimmasta uusimpaan. Kuluvaa yötä ei oteta mukaan, koska se on vielä kesken. */
export function nightHistory(lat: number, lon: number, kp: KpPoint[], clouds: Map<number, number>, now: Date): Night[] {
  // Paikallinen aurinkoaika: yön tunnit kuuluvat edellisen illan päivään, kun aikaa siirretään 12 h taaksepäin.
  const solar = lon / 15 * HOUR_MS, nightOf = (t: number) => new Date(t + solar - 12 * HOUR_MS).toISOString().slice(0, 10);
  const tonight = nightOf(now.getTime());
  const kpAt = (t: number) => kp.filter((p) => { const bin = Date.parse(p.time_tag); return bin <= t && t < bin + KP_BIN_MS; }).at(-1)?.kp ?? null;
  const nights = new Map<string, Night & { clouds: number[] }>();
  const observer = new Observer(lat, lon, 0);
  const altitude = (body: Body, time: AstroTime) => {
    const eq = Equator(body, time, observer, true, true);
    return Horizon(time, observer, eq.ra, eq.dec).altitude;
  };
  const moonPhase = new Map<string, number>();
  // Haku alkaa seitsemän yön takaisesta keskipäivästä (aurinkoaikaa), jottei ensimmäinen yö jää vajaaksi.
  const end = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const first = Date.parse(`${nightOf(end - NIGHTS * 24 * HOUR_MS)}T12:00:00Z`) - solar;
  for (let t = Math.ceil(first / HOUR_MS) * HOUR_MS; t < end; t += HOUR_MS) {
    const night = nightOf(t);
    if (night >= tonight) continue;
    const entry = nights.get(night) ?? { night, dark_hours: 0, kp_max: null, cloud_mean: null, best: null, best_time: null, clouds: [] };
    nights.set(night, entry);
    // Valoisa tunti ei vaikuta yön arvioon. CPU-ajan vuoksi Kuun paikka lasketaan vain pimeille tunneille
    // ja sen valaistu osuus kerran yössä (se muuttuu yön aikana vain muutaman prosenttiyksikön).
    const time = MakeTime(new Date(t)), sun = altitude(Body.Sun, time);
    if (sun > DARK_SUN_ALT) continue;
    if (!moonPhase.has(night)) moonPhase.set(night, Illumination(Body.Moon, time).phase_fraction);
    const light = { sun_alt: sun, moon_alt: altitude(Body.Moon, time), moon_illumination: moonPhase.get(night)! };
    entry.dark_hours++;
    const k = kpAt(t), cloud = clouds.get(t) ?? null;
    if (cloud !== null) entry.clouds.push(cloud);
    if (k === null) continue;
    entry.kp_max = Math.max(entry.kp_max ?? 0, k);
    const { chance } = visibleChance(auroraChance(k, lat), cloud, light);
    if (entry.best === null || CHANCE_LEVELS.indexOf(chance) > CHANCE_LEVELS.indexOf(entry.best)) {
      entry.best = chance;
      entry.best_time = new Date(t).toISOString();
    }
  }
  return [...nights.values()].slice(-NIGHTS).map(({ clouds: list, ...night }) => ({
    ...night,
    cloud_mean: list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null,
  }));
}

export async function getAuroraHistory(lat: number, lon: number, now = new Date()) {
  // Pilvisyyden puuttuminen ei estä historiaa: arvio lasketaan silloin ilman pilviä, ja se kerrotaan vastauksessa.
  const [kp, clouds] = await Promise.all([
    kpObserved(),
    pastClouds(lat, lon).catch((exc) => {
      console.warn(`Menneen pilvisyyden haku epäonnistui: ${exc}`);
      return null;
    }),
  ]);
  return { nights: nightHistory(lat, lon, kp, clouds ?? new Map(), now), clouds: clouds ? "Open-Meteo" : null };
}
