import { cloudAt, cloudCoverOrNull } from "./clouds";
import { getEvents } from "./events";
import { searchPlaces } from "./geocode";
import { cached, HttpError, sharedCacheWorks } from "./http";
import { getAuroraHistory } from "./history";
import { getLaunches } from "./launches";
import { getMoon } from "./moon";
import { checkSubscriptions, pushPublicKey, sendTest, subscribe, unsubscribe, type PushEnv } from "./push";
import { getIss, issSkyDetail, satByName, satelliteSkyObjects, SATELLITES, type SatId } from "./iss";
import { getOvation, ovationMap } from "./ovation";
import { getSkyChart, getSkyObject } from "./sky";
import { getSolarWind } from "./solarwind";
import { getSpaceWeather } from "./spaceweather";

export interface Env extends PushEnv {
  DEFAULT_LAT: string;
  DEFAULT_LON: string;
  DEFAULT_ELEVATION_M: string;
  DEFAULT_PLACE: string;
  LAUNCH_LIMIT: string;
  CORS_ORIGINS: string;
}

/** Tapahtumakalenteri muuttuu hitaasti, joten laskettu vuosi kelpaa tunteja. */
const EVENTS_TTL_S = 6 * 3600;

/** Lukee numeerisen kyselyparametrin ja tarkistaa rajat. */
function numberParam(url: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(422, `Parametrin ${name} pitää olla luku väliltä ${min}…${max}.`);
  }
  return value;
}

/** Aikavyöhykkeetön hetki tulkitaan UTC:ksi. */
function parseAt(raw: string | null): Date {
  if (!raw) return new Date();
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`);
  if (Number.isNaN(date.getTime())) throw new HttpError(422, "Parametri at ei ole kelvollinen ISO 8601 -aika.");
  return date;
}

async function route(url: URL, env: Env): Promise<unknown> {
  const lat = () => numberParam(url, "lat", Number(env.DEFAULT_LAT), -90, 90);
  const lon = () => numberParam(url, "lon", Number(env.DEFAULT_LON), -180, 180);
  switch (url.pathname) {
    case "/api/health":
      return { status: "ok", time: new Date().toISOString(), shared_cache: await sharedCacheWorks() };
    case "/api/config":
      return {
        default_lat: Number(env.DEFAULT_LAT),
        default_lon: Number(env.DEFAULT_LON),
        default_place: env.DEFAULT_PLACE,
        launch_limit: Number(env.LAUNCH_LIMIT),
      };
    case "/api/spaceweather":
      return getSpaceWeather(lat(), lon()).catch((exc) => {
        const reason = exc instanceof HttpError ? `NOAA SWPC ${exc.detail}` : String(exc);
        throw new HttpError(503, `Avaruussään haku epäonnistui: ${reason}`);
      });
    case "/api/geocode": {
      const query = (url.searchParams.get("q") ?? "").trim();
      if (query.length < 2 || query.length > 80) {
        throw new HttpError(422, "Parametrin q pitää olla 2–80 merkkiä pitkä paikannimi.");
      }
      return searchPlaces(query).catch((exc) => {
        throw new HttpError(503, `Paikkahaku epäonnistui: ${exc instanceof HttpError ? exc.detail : exc}`);
      });
    }
    case "/api/launches":
      return getLaunches();
    case "/api/push/key":
      return pushPublicKey(env);
    case "/api/sky": {
      const at = parseAt(url.searchParams.get("at"));
      let chart: ReturnType<typeof getSkyChart>;
      try {
        chart = getSkyChart(lat(), lon(), Number(env.DEFAULT_ELEVATION_M), at, env.DEFAULT_PLACE);
      } catch (exc) {
        if (exc instanceof HttpError) throw exc;
        throw new HttpError(503, `Taivaankartan laskenta epäonnistui: ${exc}`);
      }
      // Avaruusasemat lisätään, kun ne ovat horisontin yläpuolella; ratatietojen puuttuminen ei estä karttaa.
      chart.objects.unshift(...(await satelliteSkyObjects(lat(), lon(), at)));
      return chart;
    }
    case "/api/solarwind":
      return getSolarWind().catch((exc) => {
        throw new HttpError(503, `Aurinkotuulen haku epäonnistui: ${exc instanceof HttpError ? `NOAA SWPC ${exc.detail}` : exc}`);
      });
    case "/api/ovation": {
      const south = lat() < 0;
      return getOvation()
        .then((grid) => ovationMap(grid, south))
        .catch((exc) => {
          throw new HttpError(503, `Revontulimallin haku epäonnistui: ${exc instanceof HttpError ? `NOAA SWPC ${exc.detail}` : exc}`);
        });
    }
    case "/api/iss": {
      const sat = (url.searchParams.get("sat") || "iss") as SatId;
      if (!(sat in SATELLITES)) throw new HttpError(422, `Parametrin sat pitää olla jokin näistä: ${Object.keys(SATELLITES).join(", ")}.`);
      return getIss(lat(), lon(), new Date(), sat).catch((exc) => {
        throw new HttpError(503, `${SATELLITES[sat].name}: laskenta epäonnistui: ${exc instanceof HttpError ? `CelesTrak ${exc.detail}` : exc}`);
      });
    }
    case "/api/events": {
      // Näkyvyys ei muutu kymmenen kilometrin matkalla, joten pyöristys antaa lähekkäisille paikoille saman välimuistin.
      const [la, lo] = [lat(), lon()].map((value) => Math.round(value * 10) / 10);
      const [calendar, clouds] = await Promise.all([
        cached(`events:${la}:${lo}`, EVENTS_TTL_S, async () => getEvents(la, lo, new Date()), true),
        cloudCoverOrNull(lat(), lon()),
      ]);
      // Pilvisyys lisätään välimuistista haettuun kalenteriin, koska ennuste vanhenee paljon kalenteria nopeammin.
      return {
        ...calendar,
        events: calendar.events.map((e) => ({ ...e, cloud_cover: e.best_time ? cloudAt(clouds, e.best_time) : null })),
        cloud_provider: clouds?.provider ?? null,
      };
    }
    case "/api/aurora/history": {
      // Historia muuttuu vain kerran tunnissa (uusi Kp-arvo ja pilvihavainto), ja 0,1° pyöristys jakaa sen lähekkäisille paikoille.
      const [la, lo] = [lat(), lon()].map((value) => Math.round(value * 10) / 10);
      const hour = Math.floor(Date.now() / 3_600_000);
      return cached(`aurora-history:${la}:${lo}:${hour}`, 3600, () => getAuroraHistory(la, lo), true).catch((exc) => {
        throw new HttpError(503, `Revontulihistorian laskenta epäonnistui: ${exc instanceof HttpError ? `NOAA SWPC ${exc.detail}` : exc}`);
      });
    }
    case "/api/moon": {
      // Sama pyöristys ja välimuistiaika kuin tapahtumilla: kuuttomat yöt eivät muutu kymmenen kilometrin matkalla.
      const [la, lo] = [lat(), lon()].map((value) => Math.round(value * 10) / 10);
      return cached(`moon:${la}:${lo}`, EVENTS_TTL_S, async () => getMoon(la, lo, new Date()), true);
    }
    case "/api/sky/object": {
      const name = (url.searchParams.get("name") ?? "").trim();
      const at = parseAt(url.searchParams.get("at"));
      const sat = satByName(name);
      if (sat) {
        return issSkyDetail(lat(), lon(), at, sat).catch((exc) => {
          throw new HttpError(503, `${name}: laskenta epäonnistui: ${exc instanceof HttpError ? exc.detail : exc}`);
        });
      }
      const object = getSkyObject(lat(), lon(), Number(env.DEFAULT_ELEVATION_M), at, name);
      if (!object) throw new HttpError(404, "Kohdetta ei löydy taivaankartalta.");
      return object;
    }
    default:
      throw new HttpError(404, "Not Found");
  }
}

const MAX_BODY_CHARS = 4096;

/** POST-reitit: ilmoitustilausten hallinta. Runko on pieni JSON-objekti. */
async function post(url: URL, request: Request, env: Env): Promise<unknown> {
  const actions: Record<string, (env: PushEnv, body: Record<string, unknown>) => Promise<unknown>> = {
    "/api/push/subscribe": subscribe,
    "/api/push/unsubscribe": unsubscribe,
    "/api/push/test": sendTest,
  };
  const action = actions[url.pathname];
  if (!action) throw new HttpError(405, "Method Not Allowed");
  const text = await request.text();
  let body: unknown;
  try {
    body = text.length <= MAX_BODY_CHARS ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(422, "Pyynnön rungon pitää olla pieni JSON-objekti.");
  }
  return action(env, body as Record<string, unknown>);
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  const allowed = env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST", Vary: "Origin" };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Headers": "Content-Type" } });
    }
    if (request.method !== "GET" && request.method !== "POST") {
      return Response.json({ detail: "Method Not Allowed" }, { status: 405, headers: cors });
    }
    try {
      const url = new URL(request.url);
      const result = request.method === "POST" ? await post(url, request, env) : await route(url, env);
      return Response.json(result, { headers: cors });
    } catch (exc) {
      if (exc instanceof HttpError) {
        return Response.json({ detail: exc.detail }, { status: exc.status, headers: { ...cors, ...exc.headers } });
      }
      console.error(exc);
      return Response.json({ detail: `Sisäinen virhe: ${exc}` }, { status: 500, headers: cors });
    }
  },
  /** Cron Trigger: tarkistaa revontulitilanteen ja lähettää ilmoitukset. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkSubscriptions(env).then((result) => console.log(`Ilmoitukset: ${JSON.stringify(result)}`)));
  },
} satisfies ExportedHandler<Env>;
