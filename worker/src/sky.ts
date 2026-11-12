/** Taivaankartta: Aurinko, Kuu ja planeetat astronomy-enginellä, kirkkaat tähdet staattisesta luettelosta. */
import {
  Body,
  DefineStar,
  Equator,
  EquatorFromVector,
  Horizon,
  Illumination,
  MakeTime,
  MoonPhase,
  Observer,
  RotateVector,
  Rotation_EQJ_EQD,
  SearchHourAngle,
  SearchRiseSet,
  Spherical,
  VectorFromSphere,
} from "astronomy-engine";

import { BRIGHT_STARS, CONSTELLATIONS } from "./stars";

const PLANETS: [string, Body][] = [
  ["Merkurius", Body.Mercury], ["Venus", Body.Venus], ["Mars", Body.Mars], ["Jupiter", Body.Jupiter],
  ["Saturnus", Body.Saturn], ["Uranus", Body.Uranus], ["Neptunus", Body.Neptune],
];

const SUN_MOON: [string, Body, "sun" | "moon"][] = [["Aurinko", Body.Sun, "sun"], ["Kuu", Body.Moon, "moon"]];

/** Tähtikuvioiden viivat tähtipareina; kartta piirtää ne tähtien nimien perusteella. */
const CONSTELLATION_LINES = CONSTELLATIONS.map(({ name, chains }) => ({
  name,
  lines: chains.flatMap((chain) => chain.slice(1).map((star, i) => [chain[i], star])),
}));

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
    constellations: CONSTELLATION_LINES,
    note: "Korkeus horisontista asteina, atsimuutti myötäpäivään pohjoisesta.",
  };
}

/** Kuinka pitkältä ajalta seuraavaa nousua ja laskua etsitään. Kuun nousujen väli voi ylittää vuorokauden. */
const RISE_SET_DAYS = 2;

/**
 * Yhden kohteen tiedot: paikka taivaalla sekä seuraava nousu, lasku ja etelämeridiaanin ylitys.
 * Palauttaa null, jos nimellä ei löydy kohdetta.
 */
export function getSkyObject(lat: number, lon: number, elevationM: number, at: Date, name: string) {
  const time = MakeTime(at);
  const observer = new Observer(lat, lon, elevationM);
  let body: Body;
  let kind: SkyObject["kind"];
  let magnitude: number | null = null;

  const sunMoon = SUN_MOON.find(([n]) => n === name);
  const planet = PLANETS.find(([n]) => n === name);
  const star = BRIGHT_STARS.find(([n]) => n === name);
  if (sunMoon) {
    [, body, kind] = sunMoon;
  } else if (planet) {
    body = planet[1];
    kind = "planet";
    magnitude = round(Illumination(body, time).mag, 1);
  } else if (star) {
    // Etäisyydellä ei ole merkitystä nousu- ja laskuajoille, kunhan se on tähtien mittaluokkaa.
    DefineStar(Body.Star1, star[1], star[2], 1000);
    body = Body.Star1;
    kind = "star";
    magnitude = star[3];
  } else {
    return null;
  }

  const eq = Equator(body, time, observer, true, true);
  const hor = Horizon(time, observer, eq.ra, eq.dec);
  const rise = SearchRiseSet(body, observer, +1, time, RISE_SET_DAYS);
  const set = SearchRiseSet(body, observer, -1, time, RISE_SET_DAYS);
  const transit = SearchHourAngle(body, observer, 0, time);
  const iso = (t: { date: Date } | null) => t?.date.toISOString() ?? null;

  return {
    name,
    kind,
    at: at.toISOString(),
    alt: round(hor.altitude, 1),
    az: round(hor.azimuth, 1),
    magnitude,
    constellation: CONSTELLATIONS.find((c) => c.chains.some((chain) => chain.includes(name)))?.name ?? null,
    rise: iso(rise),
    set: iso(set),
    transit: iso(transit.time),
    transit_alt: round(transit.hor.altitude, 1),
    // Kun nousua tai laskua ei löydy, kohde pysyy horisontin samalla puolella koko hakujakson.
    visibility: rise || set ? "rises" : hor.altitude > 0 ? "always_up" : "never_up",
  };
}

export interface SkyLight {
  sun_alt: number;
  moon_alt: number;
  /** Kuun valaistu osuus 0…1. */
  moon_illumination: number;
}

/** Auringon ja Kuun korkeus sekä Kuun valaistu osuus: näistä päätellään, onko taivas tarpeeksi pimeä. */
export function skyLight(lat: number, lon: number, at: Date): SkyLight {
  const time = MakeTime(at);
  const observer = new Observer(lat, lon, 0);
  const altitude = (body: Body) => {
    const eq = Equator(body, time, observer, true, true);
    return Horizon(time, observer, eq.ra, eq.dec).altitude;
  };
  return {
    sun_alt: round(altitude(Body.Sun), 1),
    moon_alt: round(altitude(Body.Moon), 1),
    moon_illumination: round(Illumination(Body.Moon, time).phase_fraction, 2),
  };
}
