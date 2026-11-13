/**
 * Kuun vaiheet ja kuuttomat yöt. Oma reittinsä (/api/moon), jotta laskenta ei kasvata tapahtumakalenterin
 * (/api/events) CPU-aikaa: Workersin ilmaistasolla kullakin pyynnöllä on oma 10 ms:n budjettinsa.
 */
import { Body, Equator, Horizon, MakeTime, NextMoonQuarter, Observer, SearchAltitude, SearchMoonQuarter, SearchRiseSet, type AstroTime } from "astronomy-engine";

/** Neljännesten nimet astronomy-enginen järjestyksessä (0 = uusikuu). */
const QUARTERS = ["Uusikuu", "Ensimmäinen neljännes", "Täysikuu", "Viimeinen neljännes"];
/** Kuinka pitkälle vaiheita haetaan. Neljä kuukautta riittää katselun suunnitteluun, ja lyhyempi jakso pitää CPU-ajan pienenä. */
const PHASE_DAYS = 120;
/** Kuinka monelta yöltä kuuttomuus tarkistetaan. Jokainen yö vaatii neljä hakua, joten jakso on rajattu CPU-ajan vuoksi. */
const MOONLESS_NIGHTS = 14;
/** Pimeä yö alkaa ja päättyy, kun Aurinko on 12° horisontin alla (sama raja kuin revontuliarvion ”Pimeää”). */
const DARK_SUN_ALT = -12;
const DAY_MS = 86_400_000;

export interface MoonPhase {
  /** 0 uusikuu, 1 ensimmäinen neljännes, 2 täysikuu, 3 viimeinen neljännes. */
  quarter: number;
  title: string;
  time: string;
}

/** Peräkkäiset yöt, joina Kuu on horisontin alla koko pimeän ajan: ensimmäisen yön pimeän alku ja viimeisen loppu. */
export interface MoonlessNights {
  start: string;
  end: string;
  nights: number;
}

export function moonPhases(from: Date, days = PHASE_DAYS): MoonPhase[] {
  const end = from.getTime() + days * DAY_MS, phases: MoonPhase[] = [];
  for (let q = SearchMoonQuarter(MakeTime(from)); q.time.date.getTime() < end; q = NextMoonQuarter(q)) {
    phases.push({ quarter: q.quarter, title: QUARTERS[q.quarter], time: q.time.date.toISOString() });
  }
  return phases;
}

function altitude(body: Body, time: AstroTime, observer: Observer): number {
  const eq = Equator(body, time, observer, true, true);
  return Horizon(time, observer, eq.ra, eq.dec, "normal").altitude;
}

/** Kuuttomat yöt seuraavien `nights` yön ajalta. Valoisina öinä (Aurinko ei laske 12° alle) ei ole pimeää aikaa lainkaan. */
export function moonlessNights(lat: number, lon: number, from: Date, nights = MOONLESS_NIGHTS): MoonlessNights[] {
  const observer = new Observer(lat, lon, 0), runs: MoonlessNights[] = [];
  const last = from.getTime() + nights * DAY_MS;
  let cursor = MakeTime(from), previous: MoonlessNights | null = null;
  while (cursor.date.getTime() < last) {
    // Jos on jo pimeää, kuluva yö alkaa nyt.
    const dusk = altitude(Body.Sun, cursor, observer) <= DARK_SUN_ALT ? cursor : SearchAltitude(Body.Sun, observer, -1, cursor, 1, DARK_SUN_ALT);
    if (!dusk) {
      // Valoisa yö: ketju katkeaa, ja haku jatkuu seuraavasta vuorokaudesta.
      previous = null;
      cursor = cursor.AddDays(1);
      continue;
    }
    if (dusk.date.getTime() >= last) break;
    const dawn = SearchAltitude(Body.Sun, observer, +1, dusk, 1, DARK_SUN_ALT) ?? dusk.AddDays(1);
    const hours = (dawn.date.getTime() - dusk.date.getTime()) / DAY_MS;
    const moonless = altitude(Body.Moon, dusk, observer) < 0 && !SearchRiseSet(Body.Moon, observer, +1, dusk, hours);
    if (moonless) {
      if (previous) {
        previous.end = dawn.date.toISOString();
        previous.nights++;
      } else {
        previous = { start: dusk.date.toISOString(), end: dawn.date.toISOString(), nights: 1 };
        runs.push(previous);
      }
    } else previous = null;
    // Seuraava yö haetaan vasta aamun jälkeen; pieni lisäys estää löytämästä samaa aamua uudelleen.
    cursor = dawn.AddDays(1 / 24);
  }
  return runs;
}

export function getMoon(lat: number, lon: number, from: Date) {
  return { from: from.toISOString(), phases: moonPhases(from), moonless: moonlessNights(lat, lon, from) };
}
