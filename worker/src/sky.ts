/** Taivaankartta: Aurinko, Kuu ja planeetat astronomy-enginellä, kirkkaat tähdet staattisesta luettelosta. */
import {
  Body,
  Equator,
  EquatorFromVector,
  Horizon,
  MakeTime,
  MoonPhase,
  Observer,
  RotateVector,
  Rotation_EQJ_EQD,
  Spherical,
  VectorFromSphere,
} from "astronomy-engine";

import { BRIGHT_STARS } from "./stars";

const PLANETS: [string, Body][] = [
  ["Merkurius", Body.Mercury], ["Venus", Body.Venus], ["Mars", Body.Mars], ["Jupiter", Body.Jupiter],
  ["Saturnus", Body.Saturn], ["Uranus", Body.Uranus], ["Neptunus", Body.Neptune],
];

const MOON_PHASES: [number, string][] = [
  [0, "Uusi kuu"], [45, "Kasvava sirppi"], [90, "Ensimmäinen neljännes"], [135, "Kasvava kupera"],
  [180, "Täysikuu"], [225, "Vähenevä kupera"], [270, "Viimeinen neljännes"], [315, "Vähenevä sirppi"],
];

interface SkyObject {
  name: string;
  kind: "star" | "planet" | "sun" | "moon";
  alt: number;
  az: number;
  magnitude: number | null;
  extra: string | null;
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
const mod = (a: number, n: number) => ((a % n) + n) % n;

export function moonPhaseName(deg: number): string {
  let best = MOON_PHASES[0];
  for (const phase of MOON_PHASES) {
    if (Math.abs(mod(deg - phase[0] + 180, 360) - 180) < Math.abs(mod(deg - best[0] + 180, 360) - 180)) best = phase;
  }
  return best[1];
}

export function getSkyChart(lat: number, lon: number, elevationM: number, at: Date, place: string) {
  const time = MakeTime(at);
  const observer = new Observer(lat, lon, elevationM);
  const objects: SkyObject[] = [];

  // Näennäinen paikka ilman ilmakehän taittumista
  const add = (name: string, kind: SkyObject["kind"], ra: number, dec: number, magnitude: number | null = null) => {
    const hor = Horizon(time, observer, ra, dec);
    objects.push({ name, kind, alt: round(hor.altitude, 2), az: round(hor.azimuth, 2), magnitude, extra: null });
    return hor.altitude;
  };
  const addBody = (name: string, kind: SkyObject["kind"], body: Body) => {
    const eq = Equator(body, time, observer, true, true);
    return add(name, kind, eq.ra, eq.dec);
  };

  const sunAlt = addBody("Aurinko", "sun", Body.Sun);
  addBody("Kuu", "moon", Body.Moon);
  for (const [name, body] of PLANETS) addBody(name, "planet", body);

  const precession = Rotation_EQJ_EQD(time);
  for (const [name, raH, decD, mag] of BRIGHT_STARS) {
    const j2000 = VectorFromSphere(new Spherical(decD, raH * 15, 1), time);
    const eq = EquatorFromVector(RotateVector(precession, j2000));
    add(name, "star", eq.ra, eq.dec, mag);
  }

  const phaseDeg = mod(MoonPhase(time), 360);
  objects.sort((a, b) => Number(a.kind === "star") - Number(b.kind === "star") || b.alt - a.alt);

  return {
    at: at.toISOString(),
    observer: { lat, lon, elevation_m: elevationM, place },
    sun_alt: round(sunAlt, 2),
    is_dark: sunAlt < -6,
    moon_phase_deg: round(phaseDeg, 1),
    moon_phase_name: moonPhaseName(phaseDeg),
    objects,
    note: "Korkeus horisontista asteina, atsimuutti myötäpäivään pohjoisesta.",
  };
}
