import { HttpError } from "./http";

const URL = "https://fdo.rocketlaunch.live/json/launches/next/5";
const OK_TTL_S = 600;
const ERROR_TTL_S = 60;

export interface Launch {
  id: string;
  name: string;
  net: string | null;
  status: string;
  status_abbrev: string;
  provider: string;
  rocket: string;
  pad: string;
  location: string;
  mission: string | null;
  image: string | null;
  stream_url: string | null;
  seconds_to_launch: number | null;
}

interface Board {
  updated: string;
  count: number;
  next_launch: Launch | null;
  results: Launch[];
}

/** Retry-After voi olla sekunteja tai HTTP-päivämäärä. */
export function retrySeconds(value: string | null, now = Date.now()): number {
  const seconds = Number(value);
  if (value?.trim() && Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds));
  const date = value ? Date.parse(value) : NaN;
  return Number.isNaN(date) ? 3600 : Math.max(1, Math.ceil((date - now) / 1000));
}

type Row = Record<string, any>;

export function parseLaunch(row: Row, now = Date.now()): Launch {
  const raw = row.t0;
  const net = raw ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`) : null;
  if (net && Number.isNaN(net.getTime())) throw new TypeError(`Virheellinen t0: ${raw}`);
  const pad = row.pad ?? {};
  const slug = row.slug;
  return {
    id: String(row.id),
    name: String(row.name),
    net: net?.toISOString() ?? null,
    status: net ? "Suunniteltu" : `Aika tarkentuu: ${row.date_str || "ei tiedossa"}`,
    status_abbrev: "",
    provider: row.provider?.name ?? "",
    rocket: row.vehicle?.name ?? "",
    pad: pad.name ?? "",
    location: pad.location?.name ?? "",
    mission: null,
    image: null,
    stream_url:
      typeof slug === "string" && slug ? `https://www.rocketlaunch.live/launch/${encodeURIComponent(slug)}` : null,
    seconds_to_launch: net ? Math.trunc((net.getTime() - now) / 1000) : null,
  };
}

// Isolaattikohtainen tila: onnistunut lista 10 min, virheen jälkeen odotetaan ennen uutta hakua.
let board: Board | null = null;
let nextFetch = 0;
let lastError: string | null = null;
let inflight: Promise<Board> | null = null;

export function getLaunches(): Promise<Board> {
  const remaining = Math.ceil((nextFetch - Date.now()) / 1000);
  if (remaining > 0) {
    if (lastError) throw cooldown(lastError, remaining);
    return Promise.resolve(board!);
  }
  inflight ??= refresh().finally(() => (inflight = null));
  return inflight;
}

async function refresh(): Promise<Board> {
  let delay = ERROR_TTL_S;
  try {
    const resp = await fetch(URL, {
      headers: { "User-Agent": "OmaAvaruus/0.1", Accept: "application/json" },
      cf: { cacheTtlByStatus: { "200-299": OK_TTL_S, "400-599": 0 }, cacheEverything: true },
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.status === 429) delay = retrySeconds(resp.headers.get("Retry-After"));
    if (!resp.ok) throw new HttpError(resp.status, `RocketLaunch.Live HTTP ${resp.status}.`);
    const rows = ((await resp.json()) as Row).result;
    if (!Array.isArray(rows)) throw new TypeError("Invalid launch list");
    const launches = rows.map((row) => parseLaunch(row));
    board = { updated: new Date().toISOString(), count: launches.length, next_launch: launches[0] ?? null, results: launches };
  } catch (exc) {
    lastError = exc instanceof HttpError ? exc.detail : "Laukaisudatan haku epäonnistui.";
    nextFetch = Date.now() + delay * 1000;
    throw cooldown(lastError, delay);
  }
  lastError = null;
  nextFetch = Date.now() + OK_TTL_S * 1000;
  return board;
}

function cooldown(message: string, seconds: number): HttpError {
  return new HttpError(503, `${message} Uusi haku ${seconds} sekunnin kuluttua.`, { "Retry-After": String(seconds) });
}

/** Testejä varten. */
export function resetLaunchState(): void {
  board = null;
  nextFetch = 0;
  lastError = null;
  inflight = null;
}
