/**
 * Aurinkotuulen reaaliaikaiset mittaukset (NOAA SWPC RTSW): nopeus, tiheys ja magneettikenttä viimeisen
 * vuorokauden ajalta. Syötteessä on rinnakkain usean satelliitin (DSCOVR, ACE, IMAP) data; SWPC merkitsee
 * kulloinkin käytössä olevan lähteen kentällä `active`, joten käyrät piirretään vain siitä.
 */
import { cached, fetchJson } from "./http";

const RTSW = "https://services.swpc.noaa.gov/json/rtsw";
const TTL_S = 300;
const BIN_MS = 10 * 60_000;
const SPAN_MS = 24 * 3_600_000;

export interface WindPoint {
  /** Kymmenen minuutin jakson alku. */
  time_tag: string;
  speed_kms: number | null;
  density_cm3: number | null;
  bz_nt: number | null;
  bt_nt: number | null;
}

type Row = Record<string, unknown>;

const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const timeOf = (row: Row) => Date.parse(`${String(row.time_tag).replace(/Z$/, "")}Z`);

/** Keskiarvot kymmenen minuutin jaksoissa, vanhin ensin. Puuttuvat mittaukset jätetään pois keskiarvosta. */
export function binSolarWind(wind: Row[], mag: Row[], now: number): { source: string | null; points: WindPoint[] } {
  const end = Math.floor(now / BIN_MS) * BIN_MS + BIN_MS;
  const bins = Math.round(SPAN_MS / BIN_MS);
  const sums = Array.from({ length: bins }, () => ({ speed: [0, 0], density: [0, 0], bz: [0, 0], bt: [0, 0] }));
  const add = (rows: Row[], fields: [keyof (typeof sums)[0], string][]) => {
    for (const row of rows) {
      if (row.active !== true) continue;
      const bin = bins - Math.ceil((end - timeOf(row)) / BIN_MS);
      if (!(bin >= 0 && bin < bins)) continue;
      for (const [name, key] of fields) {
        const value = finite(row[key]);
        if (value === null) continue;
        sums[bin][name][0] += value;
        sums[bin][name][1]++;
      }
    }
  };
  add(wind, [["speed", "proton_speed"], ["density", "proton_density"]]);
  add(mag, [["bz", "bz_gsm"], ["bt", "bt"]]);
  const mean = ([sum, n]: number[], digits: number) => (n ? Math.round((sum / n) * 10 ** digits) / 10 ** digits : null);
  const points = sums.map((s, i) => ({
    time_tag: new Date(end - (bins - i) * BIN_MS).toISOString(),
    speed_kms: mean(s.speed, 0),
    density_cm3: mean(s.density, 1),
    bz_nt: mean(s.bz, 1),
    bt_nt: mean(s.bt, 1),
  }));
  // Uusin aktiivinen mittaus kertoo, mistä satelliitista data on.
  const latest = [...wind, ...mag].filter((row) => row.active === true).sort((a, b) => timeOf(b) - timeOf(a))[0];
  return { source: latest ? String(latest.source) : null, points };
}

export function getSolarWind(now = new Date()) {
  return cached("solarwind", TTL_S, async () => {
    const [wind, mag] = await Promise.all([fetchJson(`${RTSW}/rtsw_wind_1m.json`, TTL_S), fetchJson(`${RTSW}/rtsw_mag_1m.json`, TTL_S)]);
    if (!Array.isArray(wind) || !Array.isArray(mag)) throw new Error("Aurinkotuulisyötteen muoto on tuntematon");
    return { updated: now.toISOString(), ...binSolarWind(wind as Row[], mag as Row[], now.getTime()) };
  });
}
