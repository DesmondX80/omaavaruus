import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import worker, { type Env } from "../src/index";
import { checkSubscriptions, shouldNotify, type Subscription } from "../src/push";
import { b64urlEncode } from "../src/webpush";
import { memoryKv } from "./helpers";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
let env: Env & { SUBSCRIPTIONS: ReturnType<typeof memoryKv> };
let browserKeys: { p256dh: string; auth: string };
let pushStatus = 201;
let pushCalls: { url: string; headers: Headers; bytes: number }[] = [];

const post = (path: string, body: unknown) =>
  worker.fetch(new Request(`https://api.test${path}`, { method: "POST", body: JSON.stringify(body) }), env);
const subscribeBody = (extra: Record<string, unknown> = {}) => ({
  subscription: { endpoint: ENDPOINT, keys: browserKeys },
  lat: 65.0123,
  lon: 25.4651,
  place: "Oulu",
  threshold: "Hyvä",
  ...extra,
});
const stored = () => [...env.SUBSCRIPTIONS.data].filter(([key]) => key.startsWith("sub:")).map(([, value]) => JSON.parse(value) as Subscription);

beforeEach(async () => {
  env = {
    DEFAULT_LAT: "65.0121",
    DEFAULT_LON: "25.4651",
    DEFAULT_ELEVATION_M: "20",
    DEFAULT_PLACE: "Oulu",
    LAUNCH_LIMIT: "10",
    CORS_ORIGINS: "https://desmondx80.github.io",
    SUBSCRIPTIONS: memoryKv(),
    PUSH_SUBJECT: "https://example.test/",
  };
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  browserKeys = {
    p256dh: b64urlEncode((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer),
    auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
  };
  pushStatus = 201;
  pushCalls = [];
  // Pimeä yö lähellä uuttakuuta, Kp 5,33 ja selkeä taivas: Oulussa arvio on "Erittäin hyvä".
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-08T23:30:00Z"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === ENDPOINT) {
        pushCalls.push({ url, headers: new Headers(init?.headers), bytes: (init?.body as Uint8Array).length });
        return new Response("", { status: pushStatus });
      }
      if (url.endsWith("noaa-planetary-k-index.json")) return Response.json([{ time_tag: "2026-11-08T21:00:00", Kp: 5.33 }]);
      if (url.startsWith("https://opendata.fmi.fi/")) {
        return new Response(
          `<BsWfs:BsWfsElement gml:id="x"><BsWfs:Time>2026-11-08T23:00:00Z</BsWfs:Time>` +
            `<BsWfs:ParameterName>TotalCloudCover</BsWfs:ParameterName><BsWfs:ParameterValue>10</BsWfs:ParameterValue></BsWfs:BsWfsElement>`,
        );
      }
      return Response.json([]);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ilmoitustilaukset", () => {
  it("antaa saman VAPID-avaimen joka kerta", async () => {
    const first = await (await worker.fetch(new Request("https://api.test/api/push/key"), env)).json<any>();
    const second = await (await worker.fetch(new Request("https://api.test/api/push/key"), env)).json<any>();
    expect(first.publicKey).toMatch(/^B[\w-]{86}$/);
    expect(second.publicKey).toBe(first.publicKey);
  });

  it("tallentaa tilauksen sijainnin 0,1 asteen tarkkuudella ja päivittää sen", async () => {
    const r = await post("/api/push/subscribe", subscribeBody());
    expect(r.status).toBe(200);
    expect(stored()).toEqual([{ endpoint: ENDPOINT, keys: browserKeys, lat: 65, lon: 25.5, place: "Oulu", threshold: "Hyvä" }]);
    await post("/api/push/subscribe", subscribeBody({ place: "Rovaniemi", lat: 66.49897, lon: 25.68867, threshold: "Mahdollinen" }));
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ lat: 66.5, lon: 25.7, place: "Rovaniemi", threshold: "Mahdollinen" });
  });

  it("hylkää tuntemattoman push-palvelun ja virheelliset tiedot", async () => {
    const bad = (body: unknown) => post("/api/push/subscribe", body).then((r) => r.status);
    expect(await bad(subscribeBody({ subscription: { endpoint: "https://evil.example/push", keys: browserKeys } }))).toBe(422);
    expect(await bad(subscribeBody({ subscription: { endpoint: "http://fcm.googleapis.com/x", keys: browserKeys } }))).toBe(422);
    expect(await bad(subscribeBody({ threshold: "Epätodennäköinen" }))).toBe(422);
    expect(await bad(subscribeBody({ lat: 100 }))).toBe(422);
    expect(await bad([1, 2])).toBe(422);
    expect((await post("/api/launches", {})).status).toBe(405);
    expect(stored()).toEqual([]);
  });

  it("poistaa tilauksen", async () => {
    await post("/api/push/subscribe", subscribeBody());
    expect((await post("/api/push/unsubscribe", { endpoint: ENDPOINT })).status).toBe(200);
    expect(stored()).toEqual([]);
  });

  it("lähettää testi-ilmoituksen vain tallennettuun tilaukseen", async () => {
    expect((await post("/api/push/test", { endpoint: ENDPOINT })).status).toBe(404);
    await post("/api/push/subscribe", subscribeBody());
    expect((await post("/api/push/test", { endpoint: ENDPOINT })).status).toBe(200);
    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0].headers.get("Content-Encoding")).toBe("aes128gcm");
    expect(pushCalls[0].headers.get("Authorization")).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=B[\w-]{86}$/);
    expect(pushCalls[0].headers.get("TTL")).toBe("3600");
    // Otsake 86 tavua + salattu sisältö + 16 tavun tarkiste
    expect(pushCalls[0].bytes).toBeGreaterThan(86 + 16);
  });
});

describe("ilmoitusten ajastettu tarkistus", () => {
  it("päättää ilmoittamisesta rajan ja edellisen ilmoituksen perusteella", () => {
    const now = Date.parse("2026-11-08T23:30:00Z");
    const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
    expect(shouldNotify({ threshold: "Hyvä" }, 1, now)).toBe(false);
    expect(shouldNotify({ threshold: "Hyvä" }, 2, now)).toBe(true);
    expect(shouldNotify({ threshold: "Hyvä", last: { at: ago(1), level: 2 } }, 2, now)).toBe(false);
    expect(shouldNotify({ threshold: "Hyvä", last: { at: ago(1), level: 2 } }, 3, now)).toBe(true);
    expect(shouldNotify({ threshold: "Hyvä", last: { at: ago(7), level: 3 } }, 2, now)).toBe(true);
  });

  it("lähettää ilmoituksen kerran ja muistaa sen", async () => {
    await post("/api/push/subscribe", subscribeBody());
    expect(await checkSubscriptions(env)).toEqual({ subscriptions: 1, sent: 1 });
    expect(pushCalls).toHaveLength(1);
    expect(stored()[0].last).toEqual({ at: "2026-11-08T23:30:00.000Z", level: 3 });
    expect(await checkSubscriptions(env)).toEqual({ subscriptions: 1, sent: 0 });
    expect(pushCalls).toHaveLength(1);
  });

  it("ei ilmoita rajan alapuolella", async () => {
    // Leveysasteella 60 sama Kp antaa vain arvion "Mahdollinen".
    await post("/api/push/subscribe", subscribeBody({ lat: 60, threshold: "Erittäin hyvä" }));
    expect(await checkSubscriptions(env)).toEqual({ subscriptions: 1, sent: 0 });
    expect(pushCalls).toEqual([]);
  });

  it("poistaa tilauksen, jonka push-palvelu ilmoittaa lakanneen", async () => {
    await post("/api/push/subscribe", subscribeBody());
    pushStatus = 410;
    expect(await checkSubscriptions(env)).toEqual({ subscriptions: 1, sent: 0 });
    expect(stored()).toEqual([]);
  });

  it("käynnistyy cron-ajastuksesta", async () => {
    await post("/api/push/subscribe", subscribeBody());
    const pending: Promise<unknown>[] = [];
    await worker.scheduled({} as ScheduledController, env, { waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as ExecutionContext);
    await Promise.all(pending);
    expect(pushCalls).toHaveLength(1);
  });
});
