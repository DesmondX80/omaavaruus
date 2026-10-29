export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(detail);
  }
}

/** Isolaatin oma TTL-välimuisti; Worker-isolaatit elävät minuutteja, joten tämä riittää ulkoisten API:en suojaksi. */
const store = new Map<string, { expires: number; value: Promise<unknown> }>();

export function cached<T>(key: string, ttlS: number, factory: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
  const value = factory();
  store.set(key, { expires: Date.now() + ttlS * 1000, value });
  // Epäonnistunutta hakua ei jätetä välimuistiin
  value.catch(() => store.get(key)?.value === value && store.delete(key));
  return value;
}

/** Hakee JSONin; Cloudflaren reunavälimuisti jakaa vastauksen isolaattien kesken. */
export async function fetchJson(url: string, cacheTtl: number): Promise<unknown> {
  const resp = await fetch(url, {
    headers: { "User-Agent": "OmaAvaruus/0.1", Accept: "application/json" },
    cf: { cacheTtl, cacheEverything: true },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new HttpError(resp.status, `HTTP ${resp.status}`, retryAfter(resp));
  return resp.json();
}

function retryAfter(resp: Response): Record<string, string> {
  const value = resp.headers.get("Retry-After");
  return value ? { "Retry-After": value } : {};
}

/** SWPC palauttaa sekä lista-dictinä että [otsikot, ...rivit] -muodossa. */
export function asRecords(payload: unknown): Record<string, unknown>[] {
  if (!Array.isArray(payload) || payload.length === 0) return [];
  if (payload[0] !== null && typeof payload[0] === "object" && !Array.isArray(payload[0])) {
    return payload.filter((row) => row !== null && typeof row === "object" && !Array.isArray(row));
  }
  const header = (payload[0] as unknown[]).map((h) => String(h).toLowerCase());
  return payload
    .slice(1)
    .filter(Array.isArray)
    .map((row) => Object.fromEntries(header.map((h, i) => [h, row[i]])));
}
