import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import worker, { type Env } from "../src/index";
import { clearCache } from "../src/http";
import { resetLaunchState } from "../src/launches";
import { checkSubscriptions, launchesToNotify, passesToNotify, shouldNotify, type Subscription } from "../src/push";
import { ISS_TLE } from "./helpers";
import { b64urlDecode, b64urlEncode } from "../src/webpush";
import { memoryKv } from "./helpers";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
let env: Env & { SUBSCRIPTIONS: ReturnType<typeof memoryKv> };
let browserKeys: { p256dh: string; auth: string };
let pushStatus = 201;
let pushCalls: { url: string; headers: Headers; bytes: number; body: Uint8Array }[] = [];
let browserPrivate: CryptoKey;
/** FMI:n pilvisyysennusteen piste: oletuksena selkeä yö, jona revontuliarvio on "Erittäin hyvä". */
let fmiCloud = { time: "2026-11-08T23:00:00Z", value: 10 };

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

/** Purkaa push-viestin kuten selain (RFC 8291, aes128gcm) ja palauttaa sen JSON-sisällön. */
async function decrypt(body: Uint8Array): Promise<any> {
  const salt = body.slice(0, 16), idLength = body[20], senderPublic = body.slice(21, 21 + idLength), cipher = body.slice(21 + idLength);
  const hkdf = async (salt: Uint8Array, ikm: ArrayBuffer | Uint8Array, info: Uint8Array, bits: number) =>
    crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), bits);
  const sender = await crypto.subtle.importKey("raw", senderPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: sender } as unknown as SubtleCryptoDeriveKeyAlgorithm, browserPrivate, 256);
  const text = (s: string) => new TextEncoder().encode(s);
  const keyInfo = new Uint8Array([...text("WebPush: info\0"), ...b64urlDecode(browserKeys.p256dh), ...senderPublic]);
  const ikm = await hkdf(b64urlDecode(browserKeys.auth), secret, keyInfo, 256);
  const cek = await crypto.subtle.importKey("raw", await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 128), "AES-GCM", false, ["decrypt"]);
  const iv = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 96);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cek, cipher));
  // Viimeinen tietue päättyy erottimeen 2, jonka jälkeen tulee vain täytettä.
  return JSON.parse(new TextDecoder().decode(plain.slice(0, plain.lastIndexOf(2))));
}
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
  browserPrivate = pair.privateKey;
  browserKeys = {
    p256dh: b64urlEncode((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer),
    auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
  };
  pushStatus = 201;
  pushCalls = [];
  fmiCloud = { time: "2026-11-08T23:00:00Z", value: 10 };
  // Haut (pilvisyys, ratatiedot) välimuistissa edellisestä testistä peittäisivät testin oman syötteen.
  clearCache();
  resetLaunchState();
  // Pimeä yö lähellä uuttakuuta, Kp 5,33 ja selkeä taivas: Oulussa arvio on "Erittäin hyvä".
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-08T23:30:00Z"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === ENDPOINT) {
        pushCalls.push({ url, headers: new Headers(init?.headers), bytes: (init?.body as Uint8Array).length, body: init?.body as Uint8Array });
        return new Response("", { status: pushStatus });
      }
      if (url.startsWith("https://celestrak.org/")) return new Response(ISS_TLE);
      if (url.startsWith("https://fdo.rocketlaunch.live/")) {
        return Response.json({
          result: [
            { id: 1, name: "Starlink 12-3", t0: "2026-11-09T00:10Z", provider: { name: "SpaceX" }, vehicle: { name: "Falcon 9" }, pad: {} },
            { id: 2, name: "Electron | Test", t0: "2026-11-09T00:20Z", provider: { name: "Rocket Lab" }, vehicle: { name: "Electron" }, pad: {} },
            { id: 3, name: "Starlink 12-4", t0: "2026-11-09T05:00Z", provider: { name: "SpaceX" }, vehicle: { name: "Falcon 9" }, pad: {} },
          ],
        });
      }
      if (url.endsWith("noaa-planetary-k-index.json")) return Response.json([{ time_tag: "2026-11-08T21:00:00", Kp: 5.33 }]);
      if (url.startsWith("https://opendata.fmi.fi/")) {
        return new Response(
          `<BsWfs:BsWfsElement gml:id="x"><BsWfs:Time>${fmiCloud.time}</BsWfs:Time>` +
            `<BsWfs:ParameterName>TotalCloudCover</BsWfs:ParameterName><BsWfs:ParameterValue>${fmiCloud.value}</BsWfs:ParameterValue></BsWfs:BsWfsElement>`,
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
    expect(stored()).toEqual([{ endpoint: ENDPOINT, keys: browserKeys, lat: 65, lon: 25.5, place: "Oulu", threshold: "Hyvä", launch_providers: [], iss: false }]);
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
    expect(await decrypt(pushCalls[0].body)).toMatchObject({ title: "OmaAvaruus: testi-ilmoitus", view: "nyt" });
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
    expect(await checkSubscriptions(env)).toEqual({ subscriptions: 1, sent: 1, launches_sent: 0, iss_sent: 0 });
    expect(pushCalls).toHaveLength(1);
    expect(stored()[0].last).toEqual({ at: "2026-11-08T23:30:00.000Z", level: 3 });
    // Napautus avaa Revontulet-näkymän.
    expect(await decrypt(pushCalls[0].body)).toMatchObject({ title: "Revontulia voi näkyä nyt – Oulu", view: "revontulet" });
    expect(await checkSubscriptions(env)).toEqual({ subscriptions: 1, sent: 0, launches_sent: 0, iss_sent: 0 });
    expect(pushCalls).toHaveLength(1);
  });

  it("ei ilmoita rajan alapuolella", async () => {
    // Leveysasteella 60 sama Kp antaa vain arvion "Mahdollinen".
    await post("/api/push/subscribe", subscribeBody({ lat: 60, threshold: "Erittäin hyvä" }));
    expect(await checkSubscriptions(env)).toEqual({ subscriptions: 1, sent: 0, launches_sent: 0, iss_sent: 0 });
    expect(pushCalls).toEqual([]);
  });

  it("poistaa tilauksen, jonka push-palvelu ilmoittaa lakanneen", async () => {
    await post("/api/push/subscribe", subscribeBody());
    pushStatus = 410;
    expect(await checkSubscriptions(env)).toEqual({ subscriptions: 1, sent: 0, launches_sent: 0, iss_sent: 0 });
    expect(stored()).toEqual([]);
  });

  it("valitsee ilmoitettaviksi suosikkitoimijan alkavat laukaisut", () => {
    const now = Date.parse("2026-11-08T23:30:00Z");
    const launch = (id: string, provider: string, minutes: number) =>
      ({ id, provider, net: new Date(now + minutes * 60_000).toISOString() }) as any;
    const launches = [launch("a", "SpaceX", 40), launch("b", "Rocket Lab", 40), launch("c", "SpaceX", 120), launch("d", "SpaceX", -5)];
    expect(launchesToNotify({ launch_providers: ["SpaceX"] }, launches, now).map((l) => l.id)).toEqual(["a"]);
    expect(launchesToNotify({ launch_providers: ["SpaceX"], launches_notified: ["a@2026-11-09"] }, launches, now)).toEqual([]);
    // Toiselle päivälle siirtyneestä laukaisusta ilmoitetaan uudelleen.
    expect(launchesToNotify({ launch_providers: ["SpaceX"], launches_notified: ["a@2026-11-08"] }, launches, now)).toHaveLength(1);
    expect(launchesToNotify({}, launches, now)).toEqual([]);
  });

  it("ilmoittaa suosikkitoimijan laukaisusta kerran", async () => {
    await post("/api/push/subscribe", subscribeBody({ threshold: "Erittäin hyvä", lat: 60, launch_providers: ["SpaceX"] }));
    expect(await checkSubscriptions(env)).toEqual({ subscriptions: 1, sent: 0, launches_sent: 1, iss_sent: 0 });
    expect(stored()[0].launches_notified).toEqual(["1@2026-11-09"]);
    // Asetusten päivitys ei unohda jo ilmoitettuja laukaisuja.
    await post("/api/push/subscribe", subscribeBody({ threshold: "Erittäin hyvä", lat: 60, launch_providers: ["SpaceX", "Rocket Lab"] }));
    expect(await checkSubscriptions(env)).toEqual({ subscriptions: 1, sent: 0, launches_sent: 1, iss_sent: 0 });
    expect(stored()[0].launches_notified).toEqual(["1@2026-11-09", "2@2026-11-09"]);
    expect(pushCalls).toHaveLength(2);
    expect(await decrypt(pushCalls[0].body)).toMatchObject({ title: "Laukaisu pian: Starlink 12-3", tag: "launch-1", view: "kalenteri" });
  });

  it("valitsee ilmoitettaviksi pian alkavat näkyvät ylilennot", () => {
    const now = Date.parse("2026-11-16T16:40:00Z");
    const pass = (visible_start: string | null) => ({ visible_start }) as any;
    const passes = [pass("2026-11-16T16:51:00.000Z"), pass("2026-11-16T17:10:00.000Z"), pass(null)];
    expect(passesToNotify({}, passes, now)).toEqual([passes[0]]);
    expect(passesToNotify({ iss_notified: ["2026-11-16T16:51:00.000Z"] }, passes, now)).toEqual([]);
  });

  it("ilmoittaa näkyvästä ISS-ylilennosta kerran", async () => {
    // Helsingissä näkyvä ylilento alkaa 16.11. klo 16.51 UTC (ks. iss-testit).
    vi.setSystemTime(new Date("2026-11-16T16:40:00Z"));
    await post("/api/push/subscribe", subscribeBody({ lat: 60.17, lon: 24.94, place: "Helsinki", threshold: "Erittäin hyvä", iss: true }));
    const result = await checkSubscriptions(env);
    expect(result.iss_sent).toBe(1);
    expect(stored()[0].iss_notified).toHaveLength(1);
    const message = await decrypt(pushCalls[0].body);
    expect(message).toMatchObject({ tag: "iss-2026-11-16T16:51:00.000Z", view: "iss" });
    // Ennusteessa ei ole pilvisyyttä ylilennon tunnille, joten siitä ei mainita.
    expect(message.body).not.toContain("Ennuste");
    expect((await checkSubscriptions(env)).iss_sent).toBe(0);
  });

  it("mainitsee pilvisyyden ISS-ilmoituksessa", async () => {
    vi.setSystemTime(new Date("2026-11-16T16:40:00Z"));
    fmiCloud = { time: "2026-11-16T16:00:00Z", value: 95 };
    await post("/api/push/subscribe", subscribeBody({ lat: 60.17, lon: 24.94, place: "Helsinki", threshold: "Erittäin hyvä", iss: true }));
    expect((await checkSubscriptions(env)).iss_sent).toBe(1);
    expect((await decrypt(pushCalls[0].body)).body).toContain("Ennuste: pilvistä (95 %).");
  });

  it("hylkää virheellisen suosikkilistan", async () => {
    expect((await post("/api/push/subscribe", subscribeBody({ launch_providers: "SpaceX" }))).status).toBe(422);
    expect((await post("/api/push/subscribe", subscribeBody({ launch_providers: [""] }))).status).toBe(422);
  });

  it("käynnistyy cron-ajastuksesta", async () => {
    await post("/api/push/subscribe", subscribeBody());
    const pending: Promise<unknown>[] = [];
    await worker.scheduled({} as ScheduledController, env, { waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as ExecutionContext);
    await Promise.all(pending);
    expect(pushCalls).toHaveLength(1);
  });
});
