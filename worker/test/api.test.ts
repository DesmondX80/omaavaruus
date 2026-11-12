import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import worker, { type Env } from "../src/index";
import { parseFmiSimple } from "../src/clouds";
import { asRecords } from "../src/http";
import { parseLaunch, resetLaunchState, retrySeconds } from "../src/launches";
import { moonPhaseName, skyLight } from "../src/sky";
import { auroraChance, bestWindow, cloudAdjustedChance, kpToGScale, lightLabel, parseTs, visibleChance } from "../src/spaceweather";

const env: Env = {
  DEFAULT_LAT: "65.0121",
  DEFAULT_LON: "25.4651",
  DEFAULT_ELEVATION_M: "20",
  DEFAULT_PLACE: "Oulu",
  LAUNCH_LIMIT: "10",
  CORS_ORIGINS: "https://desmondx80.github.io",
};

const fmiXml = (rows: [string, string, string][]) =>
  `<wfs:FeatureCollection>${rows
    .map(
      ([time, name, value]) =>
        `<wfs:member><BsWfs:BsWfsElement gml:id="x"><BsWfs:Time>${time}</BsWfs:Time>` +
        `<BsWfs:ParameterName>${name}</BsWfs:ParameterName><BsWfs:ParameterValue>${value}</BsWfs:ParameterValue>` +
        `</BsWfs:BsWfsElement></wfs:member>`,
    )
    .join("")}</wfs:FeatureCollection>`;

const get = (path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`https://api.test${path}`, { headers }), env);

beforeEach(() => resetLaunchState());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Pimeä yö lähellä uuttakuuta sekä Oulussa että Grönlannissa: valoisuus ja Kuu eivät vaikuta arvioon. */
const darkNight = () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-08T23:30:00Z"));
};

describe("apufunktiot", () => {
  it("muuntaa Kp:n G-asteikoksi", () => {
    expect(kpToGScale(4.99)).toBe(0);
    expect(kpToGScale(5)).toBe(1);
    expect(kpToGScale(9)).toBe(5);
  });

  it("arvioi revontulet Oulussa", () => {
    expect(["Hyvä", "Erittäin hyvä"]).toContain(auroraChance(5, 65.0));
  });

  it("huomioi pilvisyyden revontuliarviossa", () => {
    expect(cloudAdjustedChance("Erittäin hyvä", 10)).toBe("Erittäin hyvä");
    expect(cloudAdjustedChance("Erittäin hyvä", 50)).toBe("Hyvä");
    expect(cloudAdjustedChance("Erittäin hyvä", 80)).toBe("Mahdollinen");
    expect(cloudAdjustedChance("Hyvä", 95)).toBe("Epätodennäköinen");
    expect(cloudAdjustedChance("Mahdollinen", 80)).toBe("Epätodennäköinen");
    expect(cloudAdjustedChance("Hyvä", null)).toBe("Hyvä");
  });

  it("huomioi valoisuuden ja kuutamon revontuliarviossa", () => {
    const dark = { sun_alt: -30, moon_alt: -10, moon_illumination: 0.9 };
    expect(visibleChance("Erittäin hyvä", 10, dark)).toEqual({ chance: "Erittäin hyvä", limits: [] });
    expect(visibleChance("Erittäin hyvä", 10, { ...dark, sun_alt: 5 })).toEqual({ chance: "Epätodennäköinen", limits: ["valoisuus"] });
    expect(visibleChance("Hyvä", 10, { ...dark, sun_alt: -9 })).toEqual({ chance: "Mahdollinen", limits: ["hämärä"] });
    expect(visibleChance("Hyvä", 50, { ...dark, moon_alt: 20 })).toEqual({ chance: "Mahdollinen", limits: ["pilvisyys"] });
    expect(visibleChance("Erittäin hyvä", 10, { ...dark, moon_alt: 20 })).toEqual({ chance: "Hyvä", limits: ["kuu"] });
    expect(visibleChance("Erittäin hyvä", 10, { ...dark, moon_alt: 20, moon_illumination: 0.2 }).chance).toBe("Erittäin hyvä");
    expect(visibleChance("Epätodennäköinen", 10, { ...dark, sun_alt: 5 })).toEqual({ chance: "Epätodennäköinen", limits: [] });
    expect([lightLabel(0), lightLabel(-9), lightLabel(-20)]).toEqual(["Valoisaa", "Hämärää", "Pimeää"]);
  });

  it("laskee Auringon ja Kuun valoisuuden", () => {
    expect(skyLight(65, 25.5, new Date("2026-06-21T10:00:00Z")).sun_alt).toBeGreaterThan(40);
    const winterNight = skyLight(65, 25.5, new Date("2026-11-08T23:30:00Z"));
    expect(winterNight.sun_alt).toBeLessThan(-12);
    expect(winterNight.moon_illumination).toBeLessThan(0.1);
  });

  it("valitsee parhaan havaintoikkunan", () => {
    const hours = ["Mahdollinen", "Hyvä", "Hyvä", null, "Hyvä"].map((chance, i) => ({
      time_tag: `2026-11-08T${20 + i}:00:00.000Z`,
      chance,
    }));
    expect(bestWindow(hours)).toEqual({ start: "2026-11-08T21:00:00.000Z", end: "2026-11-08T23:00:00.000Z", chance: "Hyvä" });
    expect(bestWindow([{ time_tag: "2026-11-08T20:00:00.000Z", chance: "Epätodennäköinen" }])).toBeNull();
  });

  it("purkaa FMI:n WFS-vastauksen", () => {
    const xml = fmiXml([
      ["2026-11-10T15:00:00Z", "TotalCloudCover", "40.5"],
      ["2026-11-10T14:00:00Z", "TotalCloudCover", "99.5"],
      ["2026-11-10T14:00:00Z", "LowCloudCover", "10"],
      ["2026-11-10T16:00:00Z", "TotalCloudCover", "NaN"],
    ]);
    expect(parseFmiSimple(xml, "TotalCloudCover")).toEqual([
      { time_tag: "2026-11-10T14:00:00.000Z", cloud_cover: 99.5 },
      { time_tag: "2026-11-10T15:00:00.000Z", cloud_cover: 40.5 },
    ]);
  });

  it("nimeää kuun vaiheen", () => {
    expect(moonPhaseName(180)).toBe("Täysikuu");
    expect(moonPhaseName(350)).toBe("Uusi kuu");
  });

  it("tulkitsee SWPC-aikaleiman UTC:ksi", () => {
    expect(parseTs("2026-10-29 12:00:00.000")).toBe("2026-10-29T12:00:00.000Z");
  });

  it("purkaa SWPC:n otsikkorivimuodon", () => {
    expect(asRecords([["Time_Tag", "Kp"], ["t", "3"]])).toEqual([{ time_tag: "t", kp: "3" }]);
  });

  it("lukee Retry-Afterin", () => {
    expect(retrySeconds("120")).toBe(120);
    expect(retrySeconds(null)).toBe(3600);
    expect(retrySeconds(new Date(Date.now() + 30_000).toUTCString())).toBeGreaterThan(25);
  });

  it("muuntaa laukaisurivin", () => {
    const launch = parseLaunch({ id: 1, name: "Test", t0: "2026-11-01T10:00Z", slug: "a b", pad: { location: { name: "KSC" } } });
    expect(launch.net).toBe("2026-11-01T10:00:00.000Z");
    expect(launch.location).toBe("KSC");
    expect(launch.stream_url).toBe("https://www.rocketlaunch.live/launch/a%20b");
  });
});

describe("reitit", () => {
  it("terveystarkistus ja CORS", async () => {
    const r = await get("/api/health", { Origin: "https://desmondx80.github.io" });
    expect(r.status).toBe(200);
    expect((await r.json<any>()).status).toBe("ok");
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://desmondx80.github.io");
    const other = await get("/api/health", { Origin: "https://evil.example" });
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("laskee taivaankartan", async () => {
    const r = await get("/api/sky?lat=65&lon=25.5&at=2026-01-01T00:00:00");
    expect(r.status).toBe(200);
    const body = await r.json<any>();
    expect(body.at).toBe("2026-01-01T00:00:00.000Z");
    expect(body.objects.filter((o: any) => o.kind === "planet")).toHaveLength(7);
    expect(body.objects.find((o: any) => o.name === "Polaris").alt).toBeCloseTo(65, 0);
    expect(body.is_dark).toBe(true);
  });

  it("hylkää virheellisen leveysasteen", async () => {
    expect((await get("/api/sky?lat=100")).status).toBe(422);
  });

  it("palauttaa laukaisut ja virheen jälkeen 503 + Retry-After", async () => {
    const t0 = new Date(Date.now() + 3_600_000).toISOString();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ result: [{ id: 1, name: "Test | LEO", t0 }] })));
    const ok = await get("/api/launches");
    expect(ok.status).toBe(200);
    expect((await ok.json<any>()).results[0].name).toBe("Test | LEO");

    resetLaunchState();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429, headers: { "Retry-After": "90" } })));
    const limited = await get("/api/launches");
    expect(limited.status).toBe(503);
    expect(limited.headers.get("Retry-After")).toBe("90");
    expect((await limited.json<any>()).detail).toContain("HTTP 429");
  });

  it("hakee avaruussään", async () => {
    darkNight();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("noaa-planetary-k-index.json")) return Response.json([{ time_tag: "2026-10-29T09:00:00", Kp: 5.33 }]);
        if (url.endsWith("solar-wind-speed.json")) return Response.json([{ proton_speed: 512, time_tag: "2026-10-29T09:03:00Z" }]);
        if (url.endsWith("solar-wind-mag-field.json")) return Response.json([{ bt: 6, bz_gsm: -4 }]);
        if (url.endsWith("forecast.json")) return Response.json([["time_tag", "kp", "observed"], ["2026-11-01 00:00:00", "7", "observed"], ["2026-11-09 00:00:00", "4", "predicted"]]);
        if (url.startsWith("https://opendata.fmi.fi/")) {
          expect(new URL(url).searchParams.get("latlon")).toBe("65.0123,25.4651");
          return new Response(
            fmiXml([
              ["2026-11-08T23:00:00Z", "TotalCloudCover", "80"],
              ["2026-11-09T00:00:00Z", "TotalCloudCover", "20"],
            ]),
          );
        }
        return Response.json([]);
      }),
    );
    const r = await get("/api/spaceweather?lat=65.01234&lon=25.46511");
    expect(r.status).toBe(200);
    const body = await r.json<any>();
    expect(body.kp_now).toBe(5.33);
    expect(body.g_label).toBe("G1 – heikko myrsky");
    expect([body.solar_wind_speed_kms, body.bz_nt, body.bt_nt]).toEqual([512, -4, 6]);
    expect(body.kp_forecast.map((p: any) => p.time_tag)).toEqual(["2026-11-09T00:00:00.000Z"]);
    expect(body.cloud_cover_pct).toBe(80);
    expect(body.cloud_provider).toBe("Ilmatieteen laitos");
    expect(body.aurora_chance_geomagnetic).toBe("Erittäin hyvä");
    expect(body.aurora_chance).toBe("Mahdollinen");
    expect(body.aurora_limits).toEqual(["pilvisyys"]);
    expect(body.light).toBe("Pimeää");
    expect(body.hourly).toHaveLength(24);
    // Kp-ennuste alkaa vasta klo 00 UTC, joten kuluvalle tunnille ei ole arviota.
    expect(body.hourly[0]).toMatchObject({ time_tag: "2026-11-08T23:00:00.000Z", kp: null, cloud_cover: 80, chance: null });
    expect(body.hourly[1]).toMatchObject({ kp: 4, cloud_cover: 20, light: "Pimeää", chance: "Hyvä", limits: [] });
    expect(body.hourly[3]).toMatchObject({ kp: 4, cloud_cover: null, chance: "Hyvä" });
    expect(body.hourly[4].kp).toBeNull();
    expect(body.best_window).toEqual({ start: "2026-11-09T00:00:00.000Z", end: "2026-11-09T03:00:00.000Z", chance: "Hyvä" });
  });

  it("käyttää Open-Meteoa, kun FMI:llä ei ole dataa", async () => {
    darkNight();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https://opendata.fmi.fi/")) return new Response("<ExceptionReport/>", { status: 400 });
        if (url.startsWith("https://api.open-meteo.com/")) {
          return Response.json({
            current: { cloud_cover: 50 },
            hourly: { time: ["2026-11-08T23:00", "2026-11-09T00:00"], cloud_cover: [50, 10] },
          });
        }
        if (url.endsWith("noaa-planetary-k-index.json")) return Response.json([{ time_tag: "2026-10-29T09:00:00", Kp: 5.33 }]);
        return Response.json([]);
      }),
    );
    const r = await get("/api/spaceweather?lat=70&lon=-40");
    expect(r.status).toBe(200);
    const body = await r.json<any>();
    expect(body.cloud_cover_pct).toBe(50);
    expect(body.cloud_provider).toBe("Open-Meteo");
    expect(body.aurora_chance).toBe("Hyvä");
    expect(body.hourly[1].cloud_cover).toBe(10);
  });
  it("antaa Kp-arvion, vaikka kumpikaan pilvisyyslähde ei vastaa", async () => {
    darkNight();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https://opendata.fmi.fi/")) return new Response("<ExceptionReport/>", { status: 400 });
        if (url.startsWith("https://api.open-meteo.com/")) return new Response("", { status: 500 });
        if (url.endsWith("noaa-planetary-k-index.json")) return Response.json([{ time_tag: "2026-10-29T09:00:00", Kp: 5.33 }]);
        return Response.json([]);
      }),
    );
    const r = await get("/api/spaceweather?lat=70&lon=-45");
    expect(r.status).toBe(200);
    const body = await r.json<any>();
    expect(body.cloud_cover_pct).toBeNull();
    expect(body.cloud_provider).toBeNull();
    expect(body.aurora_chance).toBe(body.aurora_chance_geomagnetic);
  });


  it("hakee paikkoja nimellä", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(new URL(url).searchParams.get("name")).toBe("Rovaniemi");
        return Response.json({
          results: [
            { name: "Rovaniemi", latitude: 66.49897, longitude: 25.68867, country: "Suomi", admin1: "Lappi" },
            { name: "Ilman koordinaatteja" },
          ],
        });
      }),
    );
    const r = await get("/api/geocode?q=%20Rovaniemi%20");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      results: [{ name: "Rovaniemi", region: "Lappi", country: "Suomi", lat: 66.49897, lon: 25.68867 }],
    });
  });

  it("paikkahaku: tyhjä tulos, liian lyhyt haku ja lähteen virhe", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ generationtime_ms: 1 })));
    expect(await (await get("/api/geocode?q=zzqqxx")).json()).toEqual({ results: [] });
    expect((await get("/api/geocode?q=a")).status).toBe(422);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    expect((await get("/api/geocode?q=Oulu")).status).toBe(503);
  });

  it("tuntematon reitti on 404", async () => {
    expect((await get("/api/nope")).status).toBe(404);
  });
});
