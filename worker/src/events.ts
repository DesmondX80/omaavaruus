/** Tapahtumakalenteri: meteoriparvet staattisesta luettelosta, pimennykset ja konjunktiot astronomy-enginellä. */
import {
  AngleBetween,
  Body,
  EclipseKind,
  Elongation,
  Equator,
  GeoVector,
  Horizon,
  Illumination,
  MakeTime,
  NextLocalSolarEclipse,
  NextLunarEclipse,
  Observer,
  SearchLocalSolarEclipse,
  SearchLunarEclipse,
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
 * Paras havaintohetki vuorokauden ajalta `center`-hetken ympäriltä: tunti, jolloin kohde on korkeimmillaan
 * Auringon ollessa `maxSunAlt`-rajan alapuolella. Palauttaa null, jos taivas ei pimene tarpeeksi.
 */
function bestDarkHour(center: number, observer: Observer, maxSunAlt: number, altitude: (time: AstroTime) => number) {
  let best: { time: AstroTime; alt: number } | null = null;
  for (let h = -12; h <= 12; h++) {
    const time = MakeTime(new Date(center + h * HOUR_MS));
    if (bodyAltitude(Body.Sun, time, observer) > maxSunAlt) continue;
    const alt = altitude(time);
    if (!best || alt > best.alt) best = { time, alt };
  }
  return best;
}

function meteorShowers(from: Date, to: Date, observer: Observer): SkyEvent[] {
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

function lunarEclipses(from: Date, to: Date, observer: Observer): SkyEvent[] {
  const events: SkyEvent[] = [];
  for (let e = SearchLunarEclipse(from); e.peak.date <= to; e = NextLunarEclipse(e.peak)) {
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

/** Vain paikalta näkyvät auringonpimennykset: muualla näkyvistä ei ole havaitsijalle iloa. */
function solarEclipses(from: Date, to: Date, observer: Observer): SkyEvent[] {
  const events: SkyEvent[] = [];
  for (let e = SearchLocalSolarEclipse(from, observer); e.peak.time.date <= to; e = NextLocalSolarEclipse(e.peak.time, observer)) {
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

function conjunctions(from: Date, to: Date, observer: Observer): SkyEvent[] {
  const events: SkyEvent[] = [];
  const steps = Math.floor((to.getTime() - from.getTime()) / SCAN_STEP_MS);
  const vector = (body: Body, ms: number, aberration: boolean) => GeoVector(body, MakeTime(new Date(ms)), aberration);
  const separation = (a: Body, b: Body, ms: number) => AngleBetween(vector(a, ms, true), vector(b, ms, true));
  // Karkea haku: planeettojen suunnat lasketaan kerran askelta kohden. Aberraatio ei vaikuta minimin löytymiseen.
  const coarse = PLANETS.map(([, body]) => Array.from({ length: steps + 1 }, (_, n) => vector(body, from.getTime() + n * SCAN_STEP_MS, false)));

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
        const best = bestDarkHour(closest, observer, TWILIGHT_SUN_ALT, (time) => bodyAltitude(a, time, observer));
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

/** Seuraavan vuoden taivaan tapahtumat aikajärjestyksessä ja niiden näkyvyys paikalta. */
export function getEvents(lat: number, lon: number, from: Date) {
  const observer = new Observer(lat, lon, 0);
  const to = new Date(from.getTime() + HORIZON_DAYS * DAY_MS);
  const events = [
    ...meteorShowers(from, to, observer),
    ...lunarEclipses(from, to, observer),
    ...solarEclipses(from, to, observer),
    ...conjunctions(from, to, observer),
  ].sort((x, y) => x.time.localeCompare(y.time));
  return { from: from.toISOString(), to: to.toISOString(), events };
}
