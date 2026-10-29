import { HttpError } from "./http";
import { getLaunches } from "./launches";
import { getSkyChart } from "./sky";
import { getSpaceWeather } from "./spaceweather";

export interface Env {
  DEFAULT_LAT: string;
  DEFAULT_LON: string;
  DEFAULT_ELEVATION_M: string;
  DEFAULT_PLACE: string;
  LAUNCH_LIMIT: string;
  CORS_ORIGINS: string;
}

/** Lukee numeerisen kyselyparametrin ja tarkistaa rajat (FastAPI:n Query(ge, le) -vastine). */
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
  switch (url.pathname) {
    case "/api/health":
      return { status: "ok", time: new Date().toISOString() };
    case "/api/config":
      return {
        default_lat: Number(env.DEFAULT_LAT),
        default_lon: Number(env.DEFAULT_LON),
        default_place: env.DEFAULT_PLACE,
        launch_limit: Number(env.LAUNCH_LIMIT),
      };
    case "/api/spaceweather":
      return getSpaceWeather(lat()).catch((exc) => {
        const reason = exc instanceof HttpError ? `NOAA SWPC ${exc.detail}` : String(exc);
        throw new HttpError(503, `Avaruussään haku epäonnistui: ${reason}`);
      });
    case "/api/launches":
      return getLaunches();
    case "/api/sky": {
      const lon = numberParam(url, "lon", Number(env.DEFAULT_LON), -180, 180);
      const at = parseAt(url.searchParams.get("at"));
      try {
        return getSkyChart(lat(), lon, Number(env.DEFAULT_ELEVATION_M), at, env.DEFAULT_PLACE);
      } catch (exc) {
        if (exc instanceof HttpError) throw exc;
        throw new HttpError(503, `Taivaankartan laskenta epäonnistui: ${exc}`);
      }
    }
    default:
      throw new HttpError(404, "Not Found");
  }
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  const allowed = env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET", Vary: "Origin" };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Headers": "*" } });
    }
    if (request.method !== "GET") {
      return Response.json({ detail: "Method Not Allowed" }, { status: 405, headers: cors });
    }
    try {
      return Response.json(await route(new URL(request.url), env), { headers: cors });
    } catch (exc) {
      if (exc instanceof HttpError) {
        return Response.json({ detail: exc.detail }, { status: exc.status, headers: { ...cors, ...exc.headers } });
      }
      console.error(exc);
      return Response.json({ detail: `Sisäinen virhe: ${exc}` }, { status: 500, headers: cors });
    }
  },
} satisfies ExportedHandler<Env>;
