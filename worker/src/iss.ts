/**
 * Kansainvälinen avaruusasema: nykyinen sijainti ja näkyvät ylilennot havaintopaikalta.
 * Ratatiedot (TLE) CelesTrakista, rata lasketaan SGP4-mallilla (satellite.js).
 */
import {
  degreesLat,
  degreesLong,
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
  gstime,
  jday,
  propagate,
  shadowFraction,
  sunPos,
  twoline2satrec,
  type SatRec,
} from "satellite.js";
import { Body, Equator, Horizon, MakeTime, Observer } from "astronomy-engine";

import { cached, fetchText } from "./http";
import { cloudAt, cloudCoverOrNull } from "./clouds";

/** Seuratut avaruusasemat: tunniste, nimi ja NORAD-luettelonumero CelesTrakin hakuun. Tiangongista seurataan Tianhe-moduulia. */
export const SATELLITES = {
  iss: { name: "ISS", catnr: 25544 },
  css: { name: "Tiangong", catnr: 48274 },
} as const;
export type SatId = keyof typeof SATELLITES;
const tleUrl = (sat: SatId) => `https://celestrak.org/NORAD/elements/gp.php?CATNR=${SATELLITES[sat].catnr}&FORMAT=TLE`;
/** CelesTrak päivittää ratatiedot muutaman kerran vuorokaudessa ja pyytää, ettei samaa hakua tehdä tiheämmin kuin kahden tunnin välein. */
const TLE_TTL_S = 4 * 3600;
/** Tätä vanhempi ratatieto ei enää kelpaa: asema tekee ratakorjauksia, ja ennusteen virhe kasvaa päivien mittaan. */
const TLE_MAX_AGE_MS = 7 * 24 * 3_600_000;
const PASSES_TTL_S = 1800;

const MIN = 60_000;
/**
 * Ylilento lasketaan alkavaksi ja päättyväksi tällä korkeudella; matalammalla asema hukkuu horisontin utuun.
 * Tavallinen raja on 10°, mutta asema kiertää enintään 51,6° leveydellä, eikä Pohjois-Suomessa nouse niin korkealle.
 */
const MIN_ELEVATION = 5;
/** Asema näkyy vain, kun taivas on hämärä tai pimeä: Aurinko vähintään tämän verran horisontin alla. */
const MAX_SUN_ALT = -6;
const SEARCH_DAYS = 5;
/** Karkean haun askel: matalinkin näkyvä ylilento kestää yli kaksi minuuttia korkeuden 10° yläpuolella. */
const STEP_MS = MIN;
/** Kartan reitti: näytteiden väli ja kuinka paljon reittiä piirretään ylilennon kummallekin puolelle. */
const TRACK_STEP_S = 20;
const TRACK_MARGIN_MS = 3 * MIN;
/** Nykyhetken kartan rata. Asema liikkuu minuutissa noin 440 km, joten minuutin näytteiden väli riittää tasaiseen viivaan. */
const ORBIT_STEP_S = 60;
const ORBIT_PAST_MS = 10 * MIN;
const ORBIT_AHEAD_MS = 95 * MIN;

export interface Tle {
  name: string;
  line1: string;
  line2: string;
  epoch: string;
}

export function parseTle(text: string): Tle {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const i = lines.findIndex((line) => line.startsWith("1 "));
  if (i < 0 || !lines[i + 1]?.startsWith("2 ")) throw new Error("Ratatietojen (TLE) muoto on tuntematon");
  const satrec = twoline2satrec(lines[i], lines[i + 1]);
  if (satrec.error) throw new Error(`Ratatiedot (TLE) eivät kelpaa (virhe ${satrec.error})`);
  // Epookki: vuoden kaksi viimeistä numeroa ja vuoden päivä desimaaleineen.
  const year = 2000 + satrec.epochyr;
  const epoch = new Date(Date.UTC(year, 0, 1) + (satrec.epochdays - 1) * 86_400_000);
  return { name: lines[i - 1] ?? "ISS", line1: lines[i], line2: lines[i + 1], epoch: epoch.toISOString() };
}

export async function getTle(now = new Date(), sat: SatId = "iss"): Promise<Tle> {
  const tle = await cached(`${sat}-tle`, TLE_TTL_S, async () => parseTle(await fetchText(tleUrl(sat), TLE_TTL_S, "text/plain")), true);
  if (now.getTime() - Date.parse(tle.epoch) > TLE_MAX_AGE_MS) throw new Error(`${SATELLITES[sat].name}: ratatiedot ovat vanhentuneet (${tle.epoch})`);
  return tle;
}

interface State {
  time: number;
  /** Korkeus horisontista ja atsimuutti asteina, etäisyys kilometreinä. */
  alt: number;
  az: number;
  range: number;
  lat: number;
  lon: number;
  height: number;
  sunlit: boolean;
}

const deg = (rad: number) => (rad * 180) / Math.PI;
const round = (value: number, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;

class Tracker {
  private readonly satrec: SatRec;
  private readonly site;

  constructor(tle: Tle, lat: number, lon: number, heightKm = 0) {
    this.satrec = twoline2satrec(tle.line1, tle.line2);
    this.site = { latitude: (lat * Math.PI) / 180, longitude: (lon * Math.PI) / 180, height: heightKm };
  }

  state(time: number): State | null {
    const date = new Date(time);
    const pv = propagate(this.satrec, date);
    if (!pv) return null;
    const gmst = gstime(date);
    const look = ecfToLookAngles(this.site, eciToEcf(pv.position, gmst));
    const geo = eciToGeodetic(pv.position, gmst);
    return {
      time,
      alt: deg(look.elevation),
      az: (deg(look.azimuth) + 360) % 360,
      range: look.rangeSat,
      lat: degreesLat(geo.latitude),
      lon: degreesLong(geo.longitude),
      height: geo.height,
      // Asema loistaa vain auringonvalossa: Maan varjossa se katoaa näkyvistä kesken ylilennon.
      sunlit: shadowFraction(sunPos(jday(date)).rsun, pv.position) < 0.5,
    };
  }

  /** Pelkkä korkeuskulma: ylilentojen haku tarvitsee vain sen, ja se on selvästi kevyempi kuin koko tila (CPU-aika). */
  elevation(time: number): number {
    const date = new Date(time);
    const pv = propagate(this.satrec, date);
    if (!pv) return -90;
    return deg(ecfToLookAngles(this.site, eciToEcf(pv.position, gstime(date))).elevation);
  }

  /** Hetki, jolla korkeus ylittää (tai alittaa) rajan välillä [a, b]; puolitushaku sekunnin tarkkuuteen. */
  crossing(a: number, b: number, limit: number): number {
    const above = (t: number) => this.elevation(t) >= limit;
    const rising = !above(a);
    while (b - a > 1000) {
      const mid = (a + b) / 2;
      if (above(mid) === rising) b = mid;
      else a = mid;
    }
    return (a + b) / 2;
  }
}

/** Auringon korkeus ja atsimuutti havaitsijan taivaalla. */
function sunAt(observer: Observer, time: number): { alt: number; az: number } {
  const t = MakeTime(new Date(time));
  const eq = Equator(Body.Sun, t, observer, true, true);
  const hor = Horizon(t, observer, eq.ra, eq.dec);
  return { alt: hor.altitude, az: hor.azimuth };
}

/** Arvioitu kirkkaus: perusmagnitudi 1000 km etäisyydellä puolittain valaistuna ja vaihekulman vaikutus (Lambertin pallo). */
function magnitude(state: State, sun: { alt: number; az: number }): number {
  // Vaihekulma havaitsijan taivaalta: Aurinko on niin kaukana, että suunta siihen on asemalta katsottuna sama.
  // Auringon suunta lasketaan kerran ylilentoa kohden: se muuttuu muutamassa minuutissa vain murto-asteen.
  const { alt: sunAlt, az: sunAz } = sun;
  const toVec = (alt: number, az: number) => {
    const a = (alt * Math.PI) / 180, z = (az * Math.PI) / 180;
    return [Math.cos(a) * Math.sin(z), Math.cos(a) * Math.cos(z), Math.sin(a)];
  };
  const toSat = toVec(state.alt, state.az), toSun = toVec(sunAlt, sunAz);
  const cosElong = toSat[0] * toSun[0] + toSat[1] * toSun[1] + toSat[2] * toSun[2];
  // Vaihekulma on 180° miinus kulmaetäisyys Auringosta, kun Aurinko on asemaa paljon kauempana.
  const phase = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosElong)));
  const lambert = (Math.sin(phase) + (Math.PI - phase) * Math.cos(phase)) / Math.PI;
  return round(-1.8 + 5 * Math.log10(state.range / 1000) - 2.5 * Math.log10(Math.max(lambert, 1e-3) / 0.318), 1);
}

export interface Pass {
  start: string;
  start_az: number;
  max: string;
  max_alt: number;
  max_az: number;
  end: string;
  end_az: number;
  /** Näkyvän osuuden alku ja loppu: asema on auringonvalossa ja taivas hämärä tai pimeä. null, jos ei näy lainkaan. */
  visible_start: string | null;
  visible_end: string | null;
  magnitude: number | null;
  /** Maanpäällinen reitti kartalle näkyvistä ylilennoista: pisteet [leveys, pituus] `step_s` sekunnin välein hetkestä `start`. */
  track: Track | null;
  /**
   * Rata havaitsijan taivaalla näkyvistä ylilennoista: [sekunteja ylilennon alusta, korkeus, atsimuutti] nousuhetkestä laskuun.
   * Taivaankartta piirtää siitä kaaren.
   */
  sky_track: [number, number, number][] | null;
}

export interface Track {
  start: string;
  step_s: number;
  points: [number, number][];
}

/** Aseman alapuolinen piste tasavälein aikaväliltä [from, to]. */
function groundTrack(tracker: Tracker, from: number, to: number, stepS: number): Track {
  const step = stepS * 1000;
  const start = Math.floor(from / 1000) * 1000;
  const points: [number, number][] = [];
  for (let t = start; t < to + step; t += step) {
    const state = tracker.state(t);
    if (!state) break;
    points.push([round(state.lat, 2), round(state.lon, 2)]);
  }
  return { start: new Date(start).toISOString(), step_s: stepS, points };
}

/** Aseman rata kartalle: vähän mennyttä ja seuraava kierros (noin 93 min) nykyhetkestä. */
export function issOrbit(tle: Tle, now: Date): Track {
  return groundTrack(new Tracker(tle, 0, 0), now.getTime() - ORBIT_PAST_MS, now.getTime() + ORBIT_AHEAD_MS, ORBIT_STEP_S);
}

/** Ylilennot, joilla asema nousee vähintään MIN_ELEVATION korkeudelle; näkyvät on merkitty. */
export function findPasses(tle: Tle, lat: number, lon: number, from: Date, days = SEARCH_DAYS): Pass[] {
  const tracker = new Tracker(tle, lat, lon);
  const observer = new Observer(lat, lon, 0);
  const passes: Pass[] = [];
  const end = from.getTime() + days * 86_400_000;
  let prevAlt = tracker.elevation(from.getTime()), prevTime = from.getTime();
  // Karkea haku: kaukana horisontin alla asema ei ehdi nousta rajan yli muutamassa minuutissa, joten askel pitenee.
  // Lähellä horisonttia askel on minuutti, jolloin matalinkaan ylilento ei jää väliin.
  const stepAfter = (alt: number) => (alt < -40 ? 4 : alt < -15 ? 2 : 1) * STEP_MS;
  for (let t = prevTime + stepAfter(prevAlt); t <= end; t += stepAfter(prevAlt)) {
    const alt = tracker.elevation(t);
    if (prevAlt < MIN_ELEVATION && alt >= MIN_ELEVATION) {
      const cur = tracker.state(t);
      if (!cur) break;
      const startTime = tracker.crossing(prevTime, t, MIN_ELEVATION);
      // Auringon korkeus interpoloidaan ylilennon ajalle kahdesta laskusta: se muuttuu 15 minuutissa alle 4°.
      const sunStart = sunAt(observer, startTime), sunLater = sunAt(observer, startTime + 15 * MIN);
      const sunAlt = (time: number) => sunStart.alt + ((sunLater.alt - sunStart.alt) * (time - startTime)) / (15 * MIN);
      // Seurataan ylilento loppuun 10 sekunnin välein: tarkkuus riittää korkeimmalle kohdalle ja näkyvyydelle.
      // Seuranta alkaa karkean haun näytteestä, joka on varmasti rajan yläpuolella.
      let best: State = cur;
      let visibleStart: number | null = null, visibleEnd: number | null = null, brightest: number | null = null;
      let s = t;
      let state: State | null = cur;
      // Taivaan rata kerätään samoista näytteistä; alku- ja loppupiste lisätään rajakorkeudelta.
      const sky: [number, number, number][] = [];
      const skyPoint = (time: number, st: State) => sky.push([Math.round((time - startTime) / 1000), round(st.alt, 1), round(st.az, 1)]);
      skyPoint(startTime, tracker.state(startTime)!);
      while (state && state.alt >= MIN_ELEVATION) {
        skyPoint(s, state);
        if (state.alt > best.alt) best = state;
        if (state.sunlit && sunAlt(s) <= MAX_SUN_ALT) {
          visibleStart ??= s;
          visibleEnd = s;
          const mag = magnitude(state, sunStart);
          brightest = brightest === null ? mag : Math.min(brightest, mag);
        }
        s += 10_000;
        state = tracker.state(s);
      }
      const endTime = tracker.crossing(s - 10_000, s, MIN_ELEVATION);
      skyPoint(endTime, tracker.state(endTime)!);
      const iso = (time: number) => new Date(time).toISOString();
      passes.push({
        start: iso(startTime),
        start_az: round(tracker.state(startTime)!.az),
        max: iso(best.time),
        max_alt: round(best.alt),
        max_az: round(best.az),
        end: iso(endTime),
        end_az: round(tracker.state(endTime)!.az),
        visible_start: visibleStart === null ? null : iso(visibleStart),
        visible_end: visibleEnd === null ? null : iso(visibleEnd),
        magnitude: brightest,
        track: visibleStart === null ? null : groundTrack(tracker, startTime - TRACK_MARGIN_MS, endTime + TRACK_MARGIN_MS, TRACK_STEP_S),
        sky_track: visibleStart === null ? null : sky,
      });
      // Haku jatkuu ylilennon jälkeen; silmukan askel lisätään tähän hetkeen.
      prevTime = Math.ceil(s / STEP_MS) * STEP_MS;
      prevAlt = tracker.elevation(prevTime);
      t = prevTime;
      continue;
    }
    prevTime = t;
    prevAlt = alt;
  }
  return passes;
}

/** Aseman sijainti ja näkyvyys havaitsijalta hetkellä `at`. */
export function issPosition(tle: Tle, lat: number, lon: number, at: Date) {
  const state = new Tracker(tle, lat, lon).state(at.getTime());
  if (!state) throw new Error("ISS:n paikan laskenta epäonnistui");
  return {
    at: at.toISOString(),
    lat: round(state.lat, 2),
    lon: round(state.lon, 2),
    height_km: round(state.height),
    alt: round(state.alt, 1),
    az: round(state.az, 1),
    range_km: round(state.range),
    sunlit: state.sunlit,
  };
}

/** Taivaankartan nimestä aseman tunniste, tai null, jos nimi ei ole seurattu asema. */
export const satByName = (name: string): SatId | null =>
  (Object.keys(SATELLITES) as SatId[]).find((id) => SATELLITES[id].name === name) ?? null;

/** Seuratut asemat taivaankartan kohteina, kun ne ovat horisontin yläpuolella. Ratatietojen puuttuminen ohitetaan. */
export async function satelliteSkyObjects(lat: number, lon: number, at: Date) {
  const objects = await Promise.all((Object.keys(SATELLITES) as SatId[]).map(async (sat) => {
    try {
      const p = issPosition(await getTle(new Date(), sat), lat, lon, at);
      return p.alt > 0 ? { name: SATELLITES[sat].name, kind: "iss" as const, alt: p.alt, az: p.az, magnitude: null, extra: null } : null;
    } catch (exc) {
      console.warn(`${SATELLITES[sat].name} taivaankartalle epäonnistui: ${exc}`);
      return null;
    }
  }));
  return objects.filter((o) => o !== null);
}

/** Taivaankartan kohdetiedot asemalle samassa muodossa kuin muille kohteille: nousu ja lasku ovat seuraavan ylilennon. */
export async function issSkyDetail(lat: number, lon: number, at: Date, sat: SatId = "iss") {
  const tle = await getTle(new Date(), sat);
  const p = issPosition(tle, lat, lon, at);
  // Käynnissä oleva ylilento löytyy, kun hakua aloitetaan vähän ennen hetkeä.
  const next = findPasses(tle, lat, lon, new Date(at.getTime() - 15 * MIN), 2).find((pass) => Date.parse(pass.end) > at.getTime());
  return {
    name: SATELLITES[sat].name,
    kind: "iss",
    at: at.toISOString(),
    alt: p.alt,
    az: p.az,
    magnitude: null,
    constellation: null,
    rise: next?.start ?? null,
    set: next?.end ?? null,
    transit: next?.max ?? null,
    transit_alt: next?.max_alt ?? null,
    visibility: next ? "rises" : "never_up",
    height_km: p.height_km,
    sunlit: p.sunlit,
  };
}

/**
 * ISS-näkymän tiedot asemalle: sijainti nyt ja ylilennot seuraavien päivien ajalta. Kukin asema haetaan omalla pyynnöllään,
 * jolloin ylilentohaku (noin 9 ms) mahtuu Workersin ilmaistason CPU-budjettiin.
 */
export async function getIss(lat: number, lon: number, now = new Date(), sat: SatId = "iss") {
  const [tle, clouds] = await Promise.all([getTle(now, sat), cloudCoverOrNull(lat, lon, now)]);
  // Ylilennot ovat samat noin kymmenen kilometrin säteellä; pyöristys jakaa välimuistin lähekkäisille paikoille.
  const la = round(lat, 1), lo = round(lon, 1);
  const slot = Math.floor(now.getTime() / (PASSES_TTL_S * 1000));
  const passes = await cached(`${sat}-passes:${la}:${lo}:${tle.epoch}:${slot}`, PASSES_TTL_S, async () => findPasses(tle, la, lo, new Date(slot * PASSES_TTL_S * 1000)), true);
  return {
    satellite: { id: sat, name: SATELLITES[sat].name },
    tle_epoch: tle.epoch,
    position: issPosition(tle, lat, lon, now),
    orbit: issOrbit(tle, now),
    // Pilvisyys näkyvän osuuden alkuhetkelle, kun se on ennusteen sisällä (null muuten tai jos ennustetta ei saatu).
    passes: passes.filter((p) => Date.parse(p.end) > now.getTime()).map((p) => ({ ...p, cloud_cover: p.visible_start ? cloudAt(clouds, p.visible_start) : null })),
    cloud_provider: clouds?.provider ?? null,
  };
}
