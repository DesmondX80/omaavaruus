export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(detail);
  }
}

/** Isolaatin oma TTL-välimuisti: ensimmäinen taso, joka ei maksa mitään. */
const store = new Map<string, { expires: number; value: Promise<unknown> }>();

/** Tyhjentää välimuistin (testit). */
export function clearCache(): void {
  store.clear();
}

/** Muunnos jaettuun välimuistiin tallennettavaksi JSONiksi ja takaisin, kun arvo ei sellaisenaan ole JSONia. */
export interface Codec<T> {
  encode(value: T): unknown;
  decode(stored: unknown): T;
}

/**
 * Toinen taso: datakeskuksen yhteinen Cache API. Isolaatit syntyvät ja kuolevat minuuteissa, joten ilman tätä
 * jokainen uusi isolaatti hakisi ja jäsentäisi saman syötteen (esim. OVATION noin 0,9 Mt) uudelleen.
 * Puuttuu testeistä ja muualta kuin Workers-ajoympäristöstä; silloin käytetään vain isolaatin välimuistia.
 */
const sharedCache = (): Cache | null => (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null;
const sharedUrl = (key: string) => `https://cache.omaavaruus.internal/${encodeURIComponent(key)}`;
const STORED_AT = "X-Stored-At";

async function readShared<T>(key: string, codec: Codec<T>): Promise<{ value: T; storedAt: number } | null> {
  try {
    const hit = await sharedCache()?.match(sharedUrl(key));
    const storedAt = Number(hit?.headers.get(STORED_AT));
    if (!hit || !Number.isFinite(storedAt)) return null;
    return { value: codec.decode(await hit.json()), storedAt };
  } catch (exc) {
    console.warn(`Jaetun välimuistin luku epäonnistui (${key}): ${exc}`);
    return null;
  }
}

async function writeShared<T>(key: string, ttlS: number, value: T, codec: Codec<T>): Promise<void> {
  try {
    const response = Response.json(codec.encode(value), {
      headers: { "Cache-Control": `max-age=${ttlS}`, [STORED_AT]: String(Date.now()) },
    });
    await sharedCache()?.put(sharedUrl(key), response);
  } catch (exc) {
    console.warn(`Jaettuun välimuistiin kirjoitus epäonnistui (${key}): ${exc}`);
  }
}

const asJson: Codec<any> = { encode: (value) => value, decode: (stored) => stored };

/**
 * Arvo välimuistista tai factorysta. `shared` jakaa arvon saman datakeskuksen isolaattien kesken; arvon pitää
 * olla JSONia tai codecilla sellaiseksi muunnettava. Jaetusta välimuistista saatu arvo vanhenee isolaatissakin
 * alkuperäisen tallennushetken mukaan, joten data ei ole koskaan TTL:ää vanhempaa.
 */
export function cached<T>(key: string, ttlS: number, factory: () => Promise<T>, shared?: boolean | Codec<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
  const codec = shared === true ? (asJson as Codec<T>) : shared || null;
  const entry = { expires: Date.now() + ttlS * 1000, value: null as unknown as Promise<T> };
  entry.value = (async () => {
    if (codec && sharedCache()) {
      const stored = await readShared(key, codec);
      if (stored) {
        entry.expires = stored.storedAt + ttlS * 1000;
        return stored.value;
      }
    }
    const value = await factory();
    if (codec) await writeShared(key, ttlS, value, codec);
    return value;
  })();
  store.set(key, entry);
  // Epäonnistunutta hakua ei jätetä välimuistiin
  entry.value.catch(() => store.get(key) === entry && store.delete(key));
  return entry.value;
}

/** Toimiiko jaettu välimuisti tässä ympäristössä: kirjoittaa ja lukee testiavaimen (terveystarkistus). */
export async function sharedCacheWorks(): Promise<boolean> {
  if (!sharedCache()) return false;
  const probe = String(Math.random());
  await writeShared("probe", 60, probe, asJson);
  return (await readShared("probe", asJson))?.value === probe;
}

/** Hakee resurssin; Cloudflaren reunavälimuisti jakaa vastauksen isolaattien kesken. */
async function fetchOk(url: string, cacheTtl: number, accept: string): Promise<Response> {
  const resp = await fetch(url, {
    headers: { "User-Agent": "OmaAvaruus/0.1", Accept: accept },
    cf: { cacheTtl, cacheEverything: true },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new HttpError(resp.status, `HTTP ${resp.status}`, retryAfter(resp));
  return resp;
}

export async function fetchJson(url: string, cacheTtl: number): Promise<unknown> {
  return (await fetchOk(url, cacheTtl, "application/json")).json();
}

export async function fetchText(url: string, cacheTtl: number, accept = "*/*"): Promise<string> {
  return (await fetchOk(url, cacheTtl, accept)).text();
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
