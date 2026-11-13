/** Tapahtumakalenteri: meteoriparvet staattisesta luettelosta, pimennykset ja konjunktiot astronomy-enginellä. */
import {
  AngleBetween,
  Body,
  EclipseKind,
  Elongation,
  Equator,
  GeoVector,
  HelioVector,
  Horizon,
  Illumination,
  MakeTime,
  NextGlobalSolarEclipse,
  NextLunarEclipse,
  Observer,
  SearchGlobalSolarEclipse,
  SearchLocalSolarEclipse,
  SearchLunarEclipse,
  Vector,
  type AstroTime,
} from "astronomy-engine";

export interface SkyEvent {
  type: "meteor_shower" | "lunar_eclipse" | "solar_eclipse" | "conjunction";
  title: string;
  /** Tapahtuman hetki: parven huippuyö, pimennyksen syvin vaihe tai planeettojen lähin kohtaaminen. */
  time: string;
  detail: string;
  /** Näkyykö tapahtuma valitulta paikalta. */
  visible: boolean;
  visibility: string;
  /** Paras havaintohetki paikalta katsottuna, jos sellainen on. */
  best_time: string | null;
}

/** Kuinka pitkälle eteenpäin tapahtumia haetaan. */
const HORIZON_DAYS = 365;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Vuosittaiset meteoriparvet (IMO): huippuyön jälkimmäinen päivä (kk, pv), aktiivisuusjakso,
 * ZHR eli tuntiluku ihanneoloissa ja säteilypisteen paikka (RA ja Dec asteina).
 */
const SHOWERS: { name: string; peak: [number, number]; active: string; zhr: number; ra: number; dec: number }[] = [
  { name: "Kvadrantidit", peak: [1, 4], active: "28.12.–12.1.", zhr: 110, ra: 230, dec: 49 },
  { name: "Lyridit", peak: [4, 22], active: "14.–30.4.", zhr: 18, ra: 271, dec: 34 },
  { name: "Eta-akvaridit", peak: [5, 6], active: "19.4.–28.5.", zhr: 50, ra: 338, dec: -1 },
  { name: "Eteläiset delta-akvaridit", peak: [7, 30], active: "12.7.–23.8.", zhr: 25, ra: 340, dec: -16 },
  { name: "Perseidit", peak: [8, 13], active: "17.7.–24.8.", zhr: 100, ra: 48, dec: 58 },
  { name: "Drakonidit", peak: [10, 9], active: "6.–10.10.", zhr: 10, ra: 262, dec: 54 },
  { name: "Orionidit", peak: [10, 21], active: "2.10.–7.11.", zhr: 20, ra: 95, dec: 16 },
  { name: "Leonidit", peak: [11, 17], active: "6.–30.11.", zhr: 15, ra: 152, dec: 22 },
  { name: "Geminidit", peak: [12, 14], active: "4.–20.12.", zhr: 150, ra: 112, dec: 33 },
  { name: "Ursidit", peak: [12, 22], active: "17.–26.12.", zhr: 10, ra: 217, dec: 76 },
];

const PLANETS: [string, Body][] = [
  ["Merkurius", Body.Mercury], ["Venus", Body.Venus], ["Mars", Body.Mars], ["Jupiter", Body.Jupiter], ["Saturnus", Body.Saturn],
];

/** Tätä lähempänä toisiaan olevat planeetat lasketaan konjunktioksi. */
const CONJUNCTION_MAX_DEG = 3;
/**
 * Konjunktiot etsitään ensin kahden vuorokauden askelin. Nopeimmatkin planeetat liikkuvat toistensa suhteen
 * alle kaksi astetta vuorokaudessa, joten rajan alittava kohtaaminen näkyy karkeassa haussa tätä pienempänä.
 */
const SCAN_STEP_MS = 2 * 24 * 3_600_000;
const SCAN_MAX_DEG = CONJUNCTION_MAX_DEG + 5;
/** Tätä lähempänä Aurinkoa oleva planeetta hukkuu Auringon loisteeseen. */
const MIN_ELONGATION_DEG = 12;
/** Meteorit vaativat pimeän taivaan, kirkkaille planeetoille riittää hämärä. */
const DARK_SUN_ALT = -12;
const TWILIGHT_SUN_ALT = -6;

const LUNAR_TITLES: Record<string, string> = {
  [EclipseKind.Penumbral]: "Kuun puolivarjopimennys",
  [EclipseKind.Partial]: "Osittainen kuunpimennys",
  [EclipseKind.Total]: "Täydellinen kuunpimennys",
};
const SOLAR_TITLES: Record<string, string> = {
  [EclipseKind.Partial]: "Osittainen auringonpimennys",
  [EclipseKind.Annular]: "Rengasmainen auringonpimennys",
  [EclipseKind.Total]: "Täydellinen auringonpimennys",
};

const fi = (value: number, digits = 0) => value.toFixed(digits).replace(".", ",").replace("-", "−");
const percent = (fraction: number) => `${fi(Math.min(1, fraction) * 100)} %`;

function bodyAltitude(body: Body, time: AstroTime, observer: Observer): number {
  const eq = Equator(body, time, observer, true, true);
  return Horizon(time, observer, eq.ra, eq.dec).altitude;
}

/**
 * Kohteen korkeusfunktio vuorokauden ajalle `center`-hetken ympärillä. Taivaan paikka (RA, Dec) lasketaan vain
 * jakson alussa ja lopussa ja interpoloidaan niiden välillä: Aurinko ja planeetat siirtyvät vuorokaudessa enintään
 * pari astetta tasaisesti, joten tulos vastaa tarkkaa laskentaa murto-osalla CPU-ajasta.
 */
function fixedAltitude(body: Body, center: number, observer: Observer): (time: AstroTime) => number {
  const start = center - 12 * HOUR_MS, span = 24 * HOUR_MS;
  const [a, b] = [start, start + span].map((t) => Equator(body, MakeTime(new Date(t)), observer, true, true));
  // Rektaskensio tunteina 0–24: väli otetaan lyhyintä tietä nollakohdan yli.
  const dra = ((b.ra - a.ra + 36) % 24) - 12;
  return (time) => {
    const f = (time.date.getTime() - start) / span;
    return Horizon(time, observer, (a.ra + dra * f + 24) % 24, a.dec + (b.dec - a.dec) * f).altitude;
  };
}

/**
 * Paras havaintohetki vuorokauden ajalta `center`-hetken ympäriltä: tunti, jolloin kohde on korkeimmillaan
 * Auringon ollessa `maxSunAlt`-rajan alapuolella. Palauttaa null, jos taivas ei pimene tarpeeksi.
 * Auringon taivaan paikka lasketaan kerran: se siirtyy vuorokaudessa alle asteen, ja täysi laskenta joka tunnille
 * veisi suurimman osan tapahtumakalenterin CPU-ajasta.
 */
function bestDarkHour(center: number, observer: Observer, maxSunAlt: number, altitude: (time: AstroTime) => number) {
  let best: { time: AstroTime; alt: number } | null = null;
  const sunAlt = fixedAltitude(Body.Sun, center, observer);
  for (let h = -12; h <= 12; h++) {
    const time = MakeTime(new Date(center + h * HOUR_MS));
    if (sunAlt(time) > maxSunAlt) continue;
    const alt = altitude(time);
    if (!best || alt > best.alt) best = { time, alt };
  }
  return best;
}

export function meteorShowers(from: Date, to: Date, observer: Observer): SkyEvent[] {
  const events: SkyEvent[] = [];
  for (const year of [from.getUTCFullYear(), from.getUTCFullYear() + 1]) {
    for (const shower of SHOWERS) {
      const peak = Date.UTC(year, shower.peak[0] - 1, shower.peak[1]);
      if (peak + DAY_MS / 2 < from.getTime() || peak > to.getTime()) continue;
      // Säteilypisteen J2000-paikka riittää: prekession vaikutus on alle asteen.
      const best = bestDarkHour(peak, observer, DARK_SUN_ALT, (time) => Horizon(time, observer, shower.ra / 15, shower.dec).altitude);
      let visible = false;
      let visibility: string;
      if (!best) {
        visibility = "Ei näy: yö ei pimene tarpeeksi";
      } else if (best.alt < 10) {
        visibility = best.alt < 0 ? "Ei näy: säteilypiste ei nouse pimeän aikaan" : `Heikosti: säteilypiste jää matalalle (${fi(best.alt)}°)`;
      } else {
        visible = true;
        const moonLit = Illumination(Body.Moon, best.time).phase_fraction;
        const moonUp = bodyAltitude(Body.Moon, best.time, observer) > 0;
        visibility =
          `Säteilypiste korkeimmillaan ${fi(best.alt)}° pimeän aikaan` +
          (moonUp && moonLit > 0.5 ? ` · kuutamo häiritsee (Kuusta valaistu ${percent(moonLit)})` : "");
      }
      events.push({
        type: "meteor_shower",
        title: shower.name,
        time: new Date(peak).toISOString(),
        detail: `Meteoriparven huippu · ihanneoloissa noin ${shower.zhr} meteoria tunnissa · aktiivinen ${shower.active}`,
        visible,
        visibility,
        best_time: visible && best ? best.time.date.toISOString() : null,
      });
    }
  }
  return events;
}

/** Kuunpimennys paikasta riippumattomana tietona: syvin vaihe, laji, peitto ja vaiheiden puolikestot minuutteina. */
export interface LunarEclipseRow {
  peak: string;
  kind: string;
  obscuration: number;
  sd_partial: number;
  sd_penum: number;
}

/**
 * Kuunpimennykset aikavälillä. Ne ovat samat kaikkialla, joten lista lasketaan kerran vuorokaudessa kaikille paikoille
 * (haku vie noin 6 ms, ks. index.ts); paikkakohtainen näkyvyys lasketaan siitä kevyesti.
 */
export function lunarEclipseList(from: Date, to: Date): LunarEclipseRow[] {
  const rows: LunarEclipseRow[] = [];
  for (let e = SearchLunarEclipse(from); e.peak.date <= to; e = NextLunarEclipse(e.peak)) {
    rows.push({ peak: e.peak.date.toISOString(), kind: e.kind, obscuration: e.obscuration, sd_partial: e.sd_partial, sd_penum: e.sd_penum });
  }
  return rows;
}

export function lunarEclipses(rows: LunarEclipseRow[], observer: Observer): SkyEvent[] {
  const events: SkyEvent[] = [];
  for (const row of rows) {
    const e = { ...row, peak: MakeTime(new Date(row.peak)) };
    // Varjovaiheen alku, syvin kohta ja loppu: kuinka monessa Kuu on horisontin yläpuolella.
    const halfMinutes = e.sd_partial || e.sd_penum;
    const up = [-halfMinutes, 0, halfMinutes].filter(
      (minutes) => bodyAltitude(Body.Moon, e.peak.AddDays(minutes / 1440), observer) > 0,
    ).length;
    events.push({
      type: "lunar_eclipse",
      title: LUNAR_TITLES[e.kind] ?? "Kuunpimennys",
      time: e.peak.date.toISOString(),
      detail:
        e.kind === EclipseKind.Penumbral
          ? "Kuu himmenee vain hieman, joten pimennystä on vaikea huomata"
          : `Maan varjo peittää enimmillään ${percent(e.obscuration)} Kuusta`,
      visible: up > 0,
      visibility: up === 3 ? "Näkyy kokonaan" : up > 0 ? "Näkyy osittain: Kuu on osan ajasta horisontin alla" : "Ei näy: Kuu on horisontin alla",
      best_time: up > 0 ? e.peak.date.toISOString() : null,
    });
  }
  return events;
}

/** Auringonpimennysten syvimmät vaiheet maapallolla aikavälillä. Samat kaikkialla, joten lista jaetaan paikkojen kesken. */
export function solarEclipseList(from: Date, to: Date): string[] {
  const peaks: string[] = [];
  for (let e = SearchGlobalSolarEclipse(from); e.peak.date <= to; e = NextGlobalSolarEclipse(e.peak)) peaks.push(e.peak.date.toISOString());
  return peaks;
}

/** Auringon ja Kuun säteiden summa asteina pienellä varalla: tätä lähempänä toisiaan Kuu peittää osan Auringosta. */
const ECLIPSE_CONTACT_DEG = 0.6;

/**
 * Käyvätkö Aurinko ja Kuu paikalta katsottuna päällekkäin maailmanlaajuisen pimennyksen aikana Auringon ollessa
 * horisontin tuntumassa tai sen yläpuolella. Tarkistus tehdään
 * 15 minuutin välein neljän tunnin ajalta syvimmän vaiheen molemmin puolin: se on paljon kevyempi kuin paikallinen haku,
 * joka jatkaisi seuraavaan paikalta näkyvään pimennykseen, vaikka se olisi vuosien päässä.
 */
function eclipseReachesObserver(peak: number, observer: Observer): boolean {
  for (let m = -240; m <= 240; m += 15) {
    const time = MakeTime(new Date(peak + m * 60_000));
    const sun = Equator(Body.Sun, time, observer, true, true);
    // Horisontin alla tapahtuva pimennys ei näy, eikä paikallinen haku löydä sitä (se jatkaisi seuraavaan).
    if (Horizon(time, observer, sun.ra, sun.dec).altitude < -1) continue;
    const moon = Equator(Body.Moon, time, observer, true, true);
    if (AngleBetween(sun.vec, moon.vec) < ECLIPSE_CONTACT_DEG) return true;
  }
  return false;
}

/** Vain paikalta näkyvät auringonpimennykset: muualla näkyvistä ei ole havaitsijalle iloa. */
export function solarEclipses(from: Date, to: Date, observer: Observer, globalPeaks = solarEclipseList(from, to)): SkyEvent[] {
  const events: SkyEvent[] = [];
  for (const peak of globalPeaks.map(Date.parse).filter((t) => t >= from.getTime() && t <= to.getTime())) {
    if (!eclipseReachesObserver(peak, observer)) continue;
    // Paikallinen haku alkaa päivää ennen, joten se löytää juuri tämän pimennyksen yhdellä kierroksella.
    const e = SearchLocalSolarEclipse(new Date(peak - DAY_MS), observer);
    if (Math.abs(e.peak.time.date.getTime() - peak) > DAY_MS) continue;
    if (Math.max(e.partial_begin.altitude, e.peak.altitude, e.partial_end.altitude) <= 0) continue;
    events.push({
      type: "solar_eclipse",
      title: SOLAR_TITLES[e.kind] ?? "Auringonpimennys",
      time: e.peak.time.date.toISOString(),
      detail: `Kuu peittää enimmillään ${percent(e.obscuration)} Auringosta · katso vain pimennyslaseilla`,
      visible: true,
      visibility:
        e.peak.altitude > 0
          ? `Näkyy: Aurinko on syvimmässä vaiheessa ${fi(e.peak.altitude)}° korkeudella`
          : "Näkyy osittain: Aurinko on syvimmässä vaiheessa horisontin alla",
      best_time: e.peak.altitude > 0 ? e.peak.time.date.toISOString() : null,
    });
  }
  return events;
}

export function conjunctions(from: Date, to: Date, observer: Observer): SkyEvent[] {
  const events: SkyEvent[] = [];
  const steps = Math.floor((to.getTime() - from.getTime()) / SCAN_STEP_MS);
  const vector = (body: Body, ms: number, aberration: boolean) => GeoVector(body, MakeTime(new Date(ms)), aberration);
  const separation = (a: Body, b: Body, ms: number) => AngleBetween(vector(a, ms, true), vector(b, ms, true));
  // Karkea haku: planeettojen suunnat lasketaan kerran askelta kohden. Aberraatio ei vaikuta minimin löytymiseen.
  // Maan paikka lasketaan kerran askelta kohden ja planeettojen suunnat Maasta sen avulla (valon kulkuaika jätetään pois).
  const times = Array.from({ length: steps + 1 }, (_, n) => MakeTime(new Date(from.getTime() + n * SCAN_STEP_MS)));
  const earth = times.map((t) => HelioVector(Body.Earth, t));
  const coarse = PLANETS.map(([, body]) => times.map((t, n) => {
    const p = HelioVector(body, t), e = earth[n];
    return new Vector(p.x - e.x, p.y - e.y, p.z - e.z, t);
  }));

  for (let i = 0; i < PLANETS.length; i++) {
    for (let j = i + 1; j < PLANETS.length; j++) {
      const [nameA, a] = PLANETS[i];
      const [nameB, b] = PLANETS[j];
      const scan = coarse[i].map((v, n) => AngleBetween(v, coarse[j][n]));
      for (let n = 1; n < steps; n++) {
        if (scan[n] > SCAN_MAX_DEG || scan[n] >= scan[n - 1] || scan[n] > scan[n + 1]) continue;
        // Tarkennetaan pienin kulmaetäisyys kolmijakohaulla karkean minimin ympäriltä.
        let lo = from.getTime() + (n - 1) * SCAN_STEP_MS;
        let hi = from.getTime() + (n + 1) * SCAN_STEP_MS;
        while (hi - lo > HOUR_MS / 2) {
          const m1 = lo + (hi - lo) / 3;
          const m2 = hi - (hi - lo) / 3;
          if (separation(a, b, m1) < separation(a, b, m2)) hi = m2;
          else lo = m1;
        }
        const closest = (lo + hi) / 2;
        const degrees = separation(a, b, closest);
        if (degrees > CONJUNCTION_MAX_DEG) continue;

        const sun = Elongation(a, new Date(closest));
        const best = bestDarkHour(closest, observer, TWILIGHT_SUN_ALT, fixedAltitude(a, closest, observer));
        const visible = sun.elongation >= MIN_ELONGATION_DEG && !!best && best.alt > 3;
        events.push({
          type: "conjunction",
          title: `${nameA} ja ${nameB} lähekkäin`,
          time: new Date(closest).toISOString(),
          detail: `Planeetat ovat lähimmillään ${fi(degrees, 1)}° päässä toisistaan`,
          visible,
          visibility: visible
            ? `Näkyy ${sun.visibility === "morning" ? "aamutaivaalla" : "iltataivaalla"}, korkeimmillaan ${fi(best.alt)}°`
            : sun.elongation < MIN_ELONGATION_DEG
              ? "Ei näy: planeetat ovat liian lähellä Aurinkoa"
              : "Ei näy: planeetat ovat pimeän aikaan horisontin alla tai aivan sen tuntumassa",
          best_time: visible ? best.time.date.toISOString() : null,
        });
      }
    }
  }
  return events;
}

/**
 * Kalenteri on jaettu kolmeen osaan, jotka haetaan eri pyynnöillä: kukin mahtuu Workersin ilmaistason 10 ms:n
 * CPU-budjettiin (meteoriparvet ja kuunpimennykset noin 2 ms, konjunktiot noin 5 ms, auringonpimennykset noin 7 ms).
 */
export const EVENT_GROUPS = ["main", "conjunctions", "solar"] as const;
export type EventGroup = (typeof EVENT_GROUPS)[number];

export const eventRange = (from: Date) => ({ from, to: new Date(from.getTime() + HORIZON_DAYS * DAY_MS) });

/** Yhden osan tapahtumat aikajärjestyksessä ja niiden näkyvyys paikalta. Kuunpimennysten lista voidaan antaa valmiina. */
export function getEventGroup(group: EventGroup, lat: number, lon: number, from: Date, lunar?: LunarEclipseRow[], solarPeaks?: string[]) {
  const observer = new Observer(lat, lon, 0);
  const { to } = eventRange(from);
  const events =
    group === "conjunctions" ? conjunctions(from, to, observer)
    : group === "solar" ? solarEclipses(from, to, observer, solarPeaks ?? solarEclipseList(from, to))
    : [...meteorShowers(from, to, observer), ...lunarEclipses(lunar ?? lunarEclipseList(from, to), observer)];
  events.sort((x, y) => x.time.localeCompare(y.time));
  return { from: from.toISOString(), to: to.toISOString(), events };
}

/** Kaikki seuraavan vuoden tapahtumat yhdellä kertaa (testit ja kehitys; reitit hakevat osat erikseen). */
export function getEvents(lat: number, lon: number, from: Date) {
  const parts = EVENT_GROUPS.map((group) => getEventGroup(group, lat, lon, from));
  return { ...parts[0], events: parts.flatMap((p) => p.events).sort((x, y) => x.time.localeCompare(y.time)) };
}
