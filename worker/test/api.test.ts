import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import worker, { type Env } from "../src/index";
import { cloudAt, parseFmiSimple } from "../src/clouds";
import { getEvents } from "../src/events";
import { findPasses, issPosition, parseTle } from "../src/iss";
import { CSS_TLE, ISS_TLE } from "./helpers";
import { binSolarWind } from "../src/solarwind";
import { parsePlaces } from "../src/geocode";
import { asRecords, cached, clearCache, sharedCacheWorks } from "../src/http";
import { parseLaunch, resetLaunchState, retrySeconds } from "../src/launches";
import { getSkyObject, moonPhaseName, skyLight } from "../src/sky";
import { BRIGHT_STARS, CONSTELLATIONS } from "../src/stars";
import { memoryKv } from "./helpers";
import { moonlessNights, moonPhases } from "../src/moon";
import { nightHistory } from "../src/history";
import { parseCmeArrivals, parseFlares } from "../src/sun";
import { GRID_CODEC, ovationAt, ovationLevel, ovationMap, parseOvation } from "../src/ovation";
import { auroraChance, bestWindow, cloudAdjustedChance, kpToGScale, lightLabel, parseTs, visibleChance } from "../src/spaceweather";

const env: Env = {
  DEFAULT_LAT: "65.0121",
  DEFAULT_LON: "25.4651",
  DEFAULT_ELEVATION_M: "20",
  DEFAULT_PLACE: "Oulu",
  LAUNCH_LIMIT: "10",
  CORS_ORIGINS: "https://desmondx80.github.io",
  SUBSCRIPTIONS: memoryKv(),
  PUSH_SUBJECT: "https://example.test/",
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

/** OVATION-syöte, jossa annetuissa pisteissä on todennäköisyys ja muualla 0. */
const ovationFeed = (points: [number, number, number][], forecast = "2026-11-09T00:10:00Z") => ({
  "Observation Time": "2026-11-08T23:10:00Z",
  "Forecast Time": forecast,
  "Data Format": "[Longitude, Latitude, Aurora]",
  coordinates: points,
  type: "MultiPoint",
});

const get = (path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`https://api.test${path}`, { headers }), env);

beforeEach(() => {
  resetLaunchState();
  clearCache();
});
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

  it("lukee OVATION-ruudukon paikalle ja lähistölle", () => {
    // Oulu 65 N 25 E: kohdalla 6 %, 400 km pohjoisessa 40 %, 700 km pohjoisessa 90 % (liian kaukana).
    const grid = parseOvation(ovationFeed([[25, 65, 6], [25, 69, 40], [25, 71, 90], [335, 65, 70]]));
    expect(ovationAt(grid, 65.01, 25.47)).toMatchObject({ probability: 6, nearby: 40, forecast: "2026-11-09T00:10:00.000Z" });
    // Pituusaste −25° on sama ruutu kuin 335°.
    expect(ovationAt(grid, 65, -25).probability).toBe(70);
    expect(() => parseOvation([])).toThrow();
    expect(ovationLevel({ probability: 2, nearby: 4 })).toBe(0);
    expect(ovationLevel({ probability: 6, nearby: 6 })).toBe(1);
    // Lähistön revontulet näkyvät horisontissa: porrasta heikompi arvio kuin yläpuolella.
    expect(ovationLevel({ probability: 6, nearby: 40 })).toBe(2);
    expect(ovationLevel({ probability: 40, nearby: 40 })).toBe(3);
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

  it("hakee pilvisyyden ennusteen tunnilta", () => {
    const clouds = { now: 50, provider: "x", source: "x", forecast: [
      { time_tag: "2026-11-16T16:00:00.000Z", cloud_cover: 95 },
      { time_tag: "2026-11-16T17:00:00.000Z", cloud_cover: 20 },
    ] };
    expect(cloudAt(clouds, "2026-11-16T16:51:00.000Z")).toBe(95);
    expect(cloudAt(clouds, "2026-11-16T17:00:00.000Z")).toBe(20);
    expect(cloudAt(clouds, "2026-11-16T18:10:00.000Z")).toBeNull();
    expect(cloudAt(null, "2026-11-16T16:51:00.000Z")).toBeNull();
  });

  it("järjestää paikkaehdotukset hakusanan alun ja asukasluvun mukaan", () => {
    const row = (name: string, population?: number) => ({ name, latitude: 1, longitude: 2, population });
    const results = [row("Rova"), row("Rovato", 12239), row("Arova", 900000), row("Rovaniemi", 65670), row("Rovate", 965), row("Rovarè", 526), row("Rovale", 79)];
    expect(parsePlaces({ results }, "rova").map((p) => p.name)).toEqual(["Rovaniemi", "Rovato", "Rovate", "Rovarè", "Rova"]);
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
    // Ratatietoja ei haeta verkosta: kartta lasketaan myös ilman avaruusasemaa.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const r = await get("/api/sky?lat=65&lon=25.5&at=2026-01-01T00:00:00");
    expect(r.status).toBe(200);
    const body = await r.json<any>();
    expect(body.at).toBe("2026-01-01T00:00:00.000Z");
    expect(body.objects.filter((o: any) => o.kind === "planet")).toHaveLength(7);
    expect(body.objects.find((o: any) => o.name === "Polaris").alt).toBeCloseTo(65, 0);
    expect(body.is_dark).toBe(true);
  });

  it("palauttaa tähtikuvioiden viivat kartan tähtien niminä", async () => {
    // Ratatietoja ei haeta verkosta: kartta lasketaan myös ilman avaruusasemaa.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const body = await (await get("/api/sky?lat=65&lon=25.5&at=2026-01-01T00:00:00")).json<any>();
    const names = new Set(body.objects.map((o: any) => o.name));
    const plough = body.constellations.find((c: any) => c.name === "Iso karhu");
    expect(plough.lines).toContainEqual(["Dubhe", "Merak"]);
    for (const { lines } of body.constellations) for (const star of lines.flat()) expect(names, star).toContain(star);
  });

  it("tähtikuvioiden viivat yhdistävät lähekkäisiä tähtiä", () => {
    const stars = new Map(BRIGHT_STARS.map(([name, ra, dec]) => [name, [(ra * 15 * Math.PI) / 180, (dec * Math.PI) / 180]]));
    expect(stars.size).toBe(BRIGHT_STARS.length);
    for (const { name, chains } of CONSTELLATIONS) {
      for (const chain of chains) {
        for (let i = 1; i < chain.length; i++) {
          const [ra1, dec1] = stars.get(chain[i - 1])!;
          const [ra2, dec2] = stars.get(chain[i])!;
          const cos = Math.sin(dec1) * Math.sin(dec2) + Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
          const degrees = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
          // Kirjoitusvirhe koordinaateissa näkyisi kohtuuttoman pitkänä viivana.
          expect(degrees, `${name}: ${chain[i - 1]}–${chain[i]}`).toBeLessThan(25);
        }
      }
    }
  });

  it("laskee kohteen nousun, laskun ja korkeimman kohdan", async () => {
    const at = new Date("2026-01-01T00:00:00Z");
    const sirius = getSkyObject(65, 25.5, 20, at, "Sirius")!;
    expect(sirius).toMatchObject({ kind: "star", constellation: "Iso koira", visibility: "rises", magnitude: -1.44 });
    // Sirius on etelässä korkeudella 90° − 65° − 16,7° ≈ 8°.
    expect(sirius.transit_alt).toBeCloseTo(8.3, 0);
    expect(Date.parse(sirius.rise!)).toBeGreaterThan(at.getTime());
    expect(Date.parse(sirius.set!)).toBeGreaterThan(at.getTime());

    expect(getSkyObject(65, 25.5, 20, at, "Vega")).toMatchObject({ visibility: "always_up", rise: null, set: null });
    expect(getSkyObject(65, 25.5, 20, at, "Canopus")).toMatchObject({ visibility: "never_up", rise: null, set: null });
    // Oulussa Aurinko nousee tammikuun alussa noin klo 10.30 Suomen aikaa (8.30 UTC).
    const sun = getSkyObject(65, 25.5, 20, at, "Aurinko")!;
    expect(sun.rise!.slice(0, 13)).toBe("2026-01-01T08");
    expect(getSkyObject(65, 25.5, 20, at, "Jupiter")!.magnitude).toBeLessThan(-1.5);

    const r = await get("/api/sky/object?lat=65&lon=25.5&at=2026-01-01T00:00:00&name=Kuu");
    expect((await r.json<any>()).kind).toBe("moon");
    expect((await get("/api/sky/object?name=Olematon")).status).toBe(404);
  });

  it("laskee taivaan tapahtumat ja niiden näkyvyyden paikalta", async () => {
    const from = new Date("2026-11-12T17:00:00Z");
    const oulu = getEvents(65, 25.5, from).events;
    const find = (events: typeof oulu, title: string) => events.find((e) => e.title === title)!;
    expect(oulu.map((e) => e.time)).toEqual(oulu.map((e) => e.time).sort());

    expect(find(oulu, "Geminidit")).toMatchObject({ type: "meteor_shower", time: "2026-12-14T00:00:00.000Z", visible: true });
    // Elokuussa Oulun yö ei pimene tarpeeksi, Helsingin pimenee.
    expect(find(oulu, "Perseidit")).toMatchObject({ visible: false, best_time: null });
    expect(find(getEvents(60.2, 24.9, from).events, "Perseidit").visible).toBe(true);

    const conjunction = find(oulu, "Mars ja Jupiter lähekkäin");
    expect(conjunction.time.slice(0, 10)).toBe("2026-11-16");
    expect(conjunction.detail).toContain("1,2°");
    expect(conjunction.visibility).toContain("aamutaivaalla");
    expect(find(oulu, "Merkurius ja Venus lähekkäin").visibility).toContain("liian lähellä Aurinkoa");

    expect(find(oulu, "Kuun puolivarjopimennys")).toMatchObject({ type: "lunar_eclipse", visible: true, visibility: "Näkyy kokonaan" });
    expect(find(oulu, "Osittainen auringonpimennys").time.slice(0, 10)).toBe("2027-08-02");

    // Reitit jakavat kalenterin kolmeen osaan CPU-ajan vuoksi; yhdessä ne antavat saman kuin getEvents.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(from);
    const parts = await Promise.all(["/api/events", "/api/events/conjunctions", "/api/events/solar"].map(async (path) => {
      const r = await get(`${path}?lat=65&lon=25.5`);
      expect(r.status).toBe(200);
      return (await r.json<any>()).events as any[];
    }));
    expect(parts[0].every((e) => e.type === "meteor_shower" || e.type === "lunar_eclipse")).toBe(true);
    expect(parts[1].every((e) => e.type === "conjunction")).toBe(true);
    expect(parts[2].map((e) => e.type)).toEqual(["solar_eclipse"]);
    const merged = parts.flat().map((e) => e.title + e.time).sort();
    expect(merged).toEqual(oulu.map((e) => e.title + e.time).sort());
  });

  it("laskee aurinkotuulen kymmenen minuutin keskiarvot aktiivisesta satelliitista", () => {
    const now = Date.parse("2026-11-12T22:15:00Z");
    const wind = [
      { time_tag: "2026-11-12T22:12:00", active: true, source: "SOLAR1", proton_speed: 400, proton_density: 2 },
      { time_tag: "2026-11-12T22:11:00", active: true, source: "SOLAR1", proton_speed: 420, proton_density: null },
      { time_tag: "2026-11-12T22:12:00", active: false, source: "ACE", proton_speed: 900, proton_density: 50 },
      { time_tag: "2026-11-12T21:05:00", active: true, source: "SOLAR1", proton_speed: 500, proton_density: 4 },
      { time_tag: "2026-11-10T21:05:00", active: true, source: "SOLAR1", proton_speed: 999, proton_density: 9 },
    ];
    const mag = [{ time_tag: "2026-11-12T22:13:00", active: true, source: "SOLAR1", bz_gsm: -3.26, bt: 5 }];
    const { source, points } = binSolarWind(wind, mag, now);
    expect(source).toBe("SOLAR1");
    expect(points).toHaveLength(144);
    expect(points.at(-1)).toEqual({ time_tag: "2026-11-12T22:10:00.000Z", speed_kms: 410, density_cm3: 2, bz_nt: -3.3, bt_nt: 5 });
    expect(points.find((p) => p.time_tag === "2026-11-12T21:00:00.000Z")!.speed_kms).toBe(500);
    expect(points.filter((p) => p.speed_kms !== null)).toHaveLength(2);
  });

  it("antaa OVATION-ruudukon havaitsijan pallonpuoliskolta kartalle", () => {
    const grid = parseOvation({
      "Observation Time": "2026-11-12T22:00:00Z",
      "Forecast Time": "2026-11-12T22:40:00Z",
      coordinates: [[25, 67, 30], [25, -67, 12], [300, 90, 4]],
    });
    const north = ovationMap(grid, false);
    expect(north).toMatchObject({ hemisphere: "north", lat_min: 40 });
    expect(north.rows).toHaveLength(51);
    expect(north.rows[67 - 40][25]).toBe(30);
    expect(north.rows[50][300]).toBe(4);
    expect(ovationMap(grid, true).rows[67 - 40][25]).toBe(12);
    // Jaettuun välimuistiin tallennettu ruudukko palautuu samanlaisena.
    grid.values.forEach((_, i) => (grid.values[i] = i % 101));
    const restored = GRID_CODEC.decode(JSON.parse(JSON.stringify(GRID_CODEC.encode(grid))));
    expect(restored).toEqual(grid);
  });

  it("jakaa arvon isolaattien kesken Cache API:n kautta", async () => {
    const entries = new Map<string, Response>();
    vi.stubGlobal("caches", {
      default: {
        match: async (url: string) => entries.get(url)?.clone(),
        put: async (url: string, response: Response) => void entries.set(url, response),
      },
    });
    const codec = { encode: (v: Uint8Array) => [...v], decode: (s: unknown) => Uint8Array.from(s as number[]) };
    const factory = vi.fn(async () => new Uint8Array([1, 2, 3]));
    expect(await cached("jaettu", 60, factory, codec)).toEqual(new Uint8Array([1, 2, 3]));
    // Uusi isolaatti: oma välimuisti on tyhjä, mutta arvo löytyy jaetusta välimuistista.
    clearCache();
    expect(await cached("jaettu", 60, factory, codec)).toEqual(new Uint8Array([1, 2, 3]));
    expect(factory).toHaveBeenCalledTimes(1);
    // Ilman shared-valintaa arvoa ei tallenneta jaettuun välimuistiin.
    await cached("oma", 60, async () => 1);
    expect([...entries.keys()].map((url) => decodeURIComponent(url.split("/").pop()!))).toEqual(["jaettu"]);
    expect(await sharedCacheWorks()).toBe(true);
    // Vanhentunut jaettu arvo: Cache API ei palauta sitä, joten haetaan uusi.
    clearCache();
    entries.clear();
    expect(await cached("jaettu", 60, factory, codec)).toEqual(new Uint8Array([1, 2, 3]));
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("ei käytä jaettua välimuistia, jos sitä ei ole", async () => {
    expect(await sharedCacheWorks()).toBe(false);
    expect(await cached("jaettu-ei", 60, async () => 5, true)).toBe(5);
  });

  it("laskee ISS:n sijainnin ja ylilennot", async () => {
    const tle = parseTle(ISS_TLE);
    expect(tle.epoch).toBe("2026-11-12T10:22:57.431Z");
    const position = issPosition(tle, 60.17, 24.94, new Date("2026-11-12T22:30:00Z"));
    expect(position.height_km).toBeGreaterThan(400);
    expect(position.height_km).toBeLessThan(450);
    expect(Math.abs(position.lat)).toBeLessThanOrEqual(52);

    const passes = findPasses(tle, 60.17, 24.94, new Date("2026-11-12T22:30:00Z"));
    expect(passes.length).toBeGreaterThan(10);
    for (const p of passes) {
      expect(Date.parse(p.start)).toBeLessThan(Date.parse(p.max));
      expect(Date.parse(p.max)).toBeLessThan(Date.parse(p.end));
      // 60° leveydellä asema ei nouse yli 20°: rata ulottuu vain 51,6° leveydelle.
      expect(p.max_alt).toBeLessThanOrEqual(20);
    }
    const visible = passes.find((p) => p.visible_start?.startsWith("2026-11-16T16:5"));
    expect(visible).toBeDefined();
    expect(visible!.magnitude).toBeLessThan(0);
    // Kartan reitti kattaa ylilennon ja vähän sen kummaltakin puolelta; näkymättömille ylilennoille sitä ei lasketa.
    const track = visible!.track!;
    const trackEnd = Date.parse(track.start) + (track.points.length - 1) * track.step_s * 1000;
    expect(Date.parse(track.start)).toBeLessThan(Date.parse(visible!.start) - 170_000);
    expect(trackEnd).toBeGreaterThan(Date.parse(visible!.end) + 170_000);
    expect(track.points.every(([lat, lon]) => Math.abs(lat) <= 52 && Math.abs(lon) <= 180)).toBe(true);
    expect(passes.every((p) => (p.track === null) === (p.visible_start === null))).toBe(true);
    // Taivaan rata alkaa ja päättyy 5° korkeudella, ja sen korkein kohta on ylilennon huippu.
    const sky = visible!.sky_track!;
    expect(sky[0][0]).toBe(0);
    expect(sky[0][1]).toBeCloseTo(5, 0);
    expect(sky.at(-1)![1]).toBeCloseTo(5, 0);
    expect(sky.at(-1)![0]).toBeCloseTo((Date.parse(visible!.end) - Date.parse(visible!.start)) / 1000, -1);
    expect(Math.max(...sky.map((p) => p[1]))).toBeCloseTo(visible!.max_alt, 0);
    expect(sky.every((p, i) => i === 0 || p[0] > sky[i - 1][0])).toBe(true);
    expect(passes.every((p) => (p.sky_track === null) === (p.visible_start === null))).toBe(true);
    // Oulussa asema jää matalalle etelätaivaalle.
    const oulu = findPasses(tle, 65.01, 25.47, new Date("2026-11-12T22:30:00Z"));
    expect(oulu.length).toBeGreaterThan(5);
    expect(Math.max(...oulu.map((p) => p.max_alt))).toBeLessThan(10);
    expect(oulu.every((p) => p.max_az > 120 && p.max_az < 240)).toBe(true);
  });

  it("liittää pilvisyysennusteen näkyviin ylilentoihin ja tapahtumiin", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T16:40:00Z"));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("https://opendata.fmi.fi/")) return new Response(fmiXml([["2026-11-16T16:00:00Z", "TotalCloudCover", "95"], ["2026-11-17T04:00:00Z", "TotalCloudCover", "30"]]));
      return new Response(ISS_TLE);
    }));
    const iss = await (await get("/api/iss?lat=60.17&lon=24.94")).json<any>();
    const pass = iss.passes.find((p: any) => p.visible_start?.startsWith("2026-11-16T16:5"));
    expect(pass.cloud_cover).toBe(95);
    expect(iss.passes.filter((p: any) => !p.visible_start).every((p: any) => p.cloud_cover === null)).toBe(true);
    expect(iss.cloud_provider).toBe("Ilmatieteen laitos");
    // Leonidien paras hetki 17.11. aamulla on ennusteen sisällä, myöhemmät tapahtumat eivät.
    const events = await (await get("/api/events?lat=60.17&lon=24.94")).json<any>();
    expect(events.events.find((e: any) => e.title === "Leonidit").cloud_cover).toBe(30);
    expect(events.events.find((e: any) => e.title === "Geminidit").cloud_cover).toBeNull();
  });

  it("laskee revontulihistorian viime öiltä", async () => {
    const now = new Date("2026-11-13T12:00:00Z");
    const bin = (iso: string, kp: number) => ({ time_tag: iso, kp, kind: "observed", g_scale: 0 });
    // Kp 6 yöllä 9.–10.11. klo 18–21 UTC, muulloin rauhallista.
    const kp = Array.from({ length: 64 }, (_, i) => {
      const t = new Date(Date.parse("2026-11-05T12:00:00Z") + i * 3 * 3_600_000).toISOString();
      return bin(t, t === "2026-11-09T18:00:00.000Z" ? 6 : 1);
    });
    const hour = (iso: string) => Date.parse(iso);
    const clouds = new Map([[hour("2026-11-09T18:00:00Z"), 95], [hour("2026-11-09T19:00:00Z"), 10], [hour("2026-11-09T20:00:00Z"), 95]]);
    const nights = nightHistory(65, 25.5, kp as any, clouds, now);
    expect(nights.map((n) => n.night)).toEqual(["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]);
    const storm = nights[3];
    // Selkeä tunti klo 19 riittää erittäin hyvään arvioon, vaikka sitä edeltävä ja seuraava tunti olivat pilvisiä.
    expect(storm).toMatchObject({ kp_max: 6, best: "Erittäin hyvä", best_time: "2026-11-09T19:00:00.000Z", cloud_mean: 67 });
    expect(storm.dark_hours).toBeGreaterThan(10);
    expect(nights[0]).toMatchObject({ kp_max: 1, cloud_mean: null });
    // Kesäkuussa 65° leveydellä ei tule pimeää: arviota ei ole.
    const summer = nightHistory(65, 25.5, kp.map((p) => ({ ...p, time_tag: p.time_tag.replace("2026-11", "2026-06") })) as any, new Map(), new Date("2026-06-13T12:00:00Z"));
    expect(summer.every((n) => n.dark_hours === 0 && n.best === null)).toBe(true);

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("noaa-planetary-k-index.json")) return Response.json(kp.map((p) => ({ time_tag: p.time_tag.slice(0, 19), Kp: p.kp })));
      if (url.startsWith("https://api.open-meteo.com/")) return Response.json({ hourly: { time: ["2026-11-09T19:00"], cloud_cover: [10] } });
      return new Response("", { status: 404 });
    }));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const body = await (await get("/api/aurora/history?lat=65&lon=25.5")).json<any>();
    expect(body.clouds).toBe("Open-Meteo");
    expect(body.nights[3]).toMatchObject({ night: "2026-11-09", best: "Erittäin hyvä", cloud_mean: 10 });
  });

  it("poimii purkaukset ja Maahan osuvat CME:t", async () => {
    const now = new Date("2026-11-13T18:00:00Z");
    const flare = (max_class: string, max_time: string) => ({ begin_time: max_time, max_time, max_class });
    expect(parseFlares([flare("C5.0", "2026-11-13T10:00:00Z"), flare("M1.2", "2026-11-12T08:00:00Z"), flare("X1.0", "2026-11-09T08:00:00Z"), flare("M3.4", "2026-11-13T14:21:00Z")], now))
      .toEqual([
        { class: "M3.4", begin: "2026-11-13T14:21:00.000Z", peak: "2026-11-13T14:21:00.000Z" },
        { class: "M1.2", begin: "2026-11-12T08:00:00.000Z", peak: "2026-11-12T08:00:00.000Z" },
      ]);
    const sim = (id: string, completed: string, arrival: string | null, extra: object = {}) => ({
      modelCompletionTime: completed, estimatedShockArrivalTime: arrival, isEarthGB: false, kp_18: null, kp_90: 5, kp_135: 6, kp_180: 7,
      cmeInputs: [{ cmeid: id, cmeStartTime: "2026-11-12T03:24Z", speed: 900, isMostAccurate: true }], ...extra,
    });
    const arrivals = parseCmeArrivals([
      sim("A", "2026-11-12T10:00Z", "2026-11-15T02:00Z"),
      // Uudempi ajo samasta CME:stä korvaa vanhemman.
      sim("A", "2026-11-13T09:00Z", "2026-11-14T20:00Z", { kp_180: 8 }),
      sim("B", "2026-11-13T09:00Z", null),
      sim("C", "2026-11-13T09:00Z", "2026-11-10T00:00Z"),
      sim("D", "2026-11-13T12:00Z", "2026-11-16T06:00Z", { isEarthGB: true, kp_90: null, kp_135: null, kp_180: null }),
    ], now);
    expect(arrivals).toEqual([
      { arrival: "2026-11-14T20:00:00.000Z", glancing: false, kp_min: 5, kp_max: 8, start: "2026-11-12T03:24:00.000Z", speed: 900 },
      { arrival: "2026-11-16T06:00:00.000Z", glancing: true, kp_min: null, kp_max: null, start: "2026-11-12T03:24:00.000Z", speed: 900 },
    ]);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      if (url.startsWith("https://api.nasa.gov/")) return new Response("", { status: 429 });
      return Response.json([flare("M3.4", "2026-11-13T14:21:00Z")]);
    }));
    const body = await (await get("/api/sun")).json<any>();
    expect(body.flares).toHaveLength(1);
    // CME-haun epäonnistuminen ei estä purkauksia; avain ei näy virheessä.
    expect(body).toMatchObject({ cmes: null, cmes_error: "HTTP 429" });
    expect(calls.find((u) => u.startsWith("https://api.nasa.gov/"))).toContain("api_key=DEMO_KEY");
  });

  it("laskee Kuun vaiheet ja kuuttomat yöt", async () => {
    const from = new Date("2026-11-13T16:00:00Z");
    const phases = moonPhases(from);
    expect(phases.slice(0, 2)).toMatchObject([
      { quarter: 1, title: "Ensimmäinen neljännes", time: expect.stringMatching(/^2026-11-17T11/) },
      { quarter: 2, title: "Täysikuu", time: expect.stringMatching(/^2026-11-24T14/) },
    ]);
    // Neljännekset seuraavat toisiaan noin viikon välein.
    expect(phases.length).toBeGreaterThanOrEqual(15);
    expect(phases.every((p, i) => i === 0 || p.quarter === (phases[i - 1].quarter + 1) % 4)).toBe(true);
    // Oulussa kasvava sirppi laskee iltahämärissä: kaksi ensimmäistä yötä ovat kuuttomia.
    const nights = moonlessNights(65, 25.5, from);
    expect(nights[0]).toMatchObject({ start: from.toISOString(), nights: 2 });
    expect(nights[0].end.slice(0, 10)).toBe("2026-11-15");
    // Kesäkuun Helsingissä ei tule pimeää lainkaan.
    expect(moonlessNights(60.17, 24.94, new Date("2026-06-10T12:00:00Z"))).toEqual([]);
    const body = await (await get("/api/moon?lat=65&lon=25.5")).json<any>();
    expect(body.phases.length).toBeGreaterThan(10);
    expect(Array.isArray(body.moonless)).toBe(true);
  });

  it("palauttaa ISS-reitin ja lisää aseman taivaankartalle", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T16:52:00Z"));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url.includes("CATNR=48274") ? CSS_TLE : ISS_TLE)));
    const body = await (await get("/api/iss?lat=60.17&lon=24.94")).json<any>();
    expect(body.satellite).toEqual({ id: "iss", name: "ISS" });
    expect(body.position.alt).toBeGreaterThan(5);
    expect(body.passes[0].visible_start).toBeTruthy();
    // Pilvisyysennuste ei ollut saatavilla (haku palautti ratatiedot), mutta ylilennot tulevat silti.
    expect(body.passes[0].cloud_cover).toBeNull();
    expect(body.cloud_provider).toBeNull();
    // Rata nykyhetken kartalle: kymmenen minuuttia taaksepäin ja seuraava kierros minuutin välein.
    expect(body.orbit).toMatchObject({ start: "2026-11-16T16:42:00.000Z", step_s: 60 });
    expect(body.orbit.points.length).toBeGreaterThan(100);
    const [lat, lon] = body.orbit.points[10];
    expect(lat).toBeCloseTo(body.position.lat, 1);
    expect(lon).toBeCloseTo(body.position.lon, 1);
    const chart = await (await get("/api/sky?lat=60.17&lon=24.94")).json<any>();
    expect(chart.objects[0]).toMatchObject({ name: "ISS", kind: "iss" });
    const detail = await (await get("/api/sky/object?lat=60.17&lon=24.94&name=ISS")).json<any>();
    expect(detail).toMatchObject({ kind: "iss", visibility: "rises" });
    expect(Date.parse(detail.rise)).toBeLessThan(Date.now());
    vi.useRealTimers();
  });

  it("laskee Tiangongin ylilennot omalla pyynnöllään", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-13T16:00:00Z"));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url.includes("CATNR=48274") ? CSS_TLE : ISS_TLE)));
    // Madridissa (40°) Tiangong nousee korkealle: rata on kallistunut 41,5°.
    const body = await (await get("/api/iss?lat=40.42&lon=-3.7&sat=css")).json<any>();
    expect(body.satellite).toEqual({ id: "css", name: "Tiangong" });
    expect(body.tle_epoch.slice(0, 10)).toBe("2026-11-13");
    expect(body.passes.length).toBeGreaterThan(5);
    expect(Math.max(...body.passes.map((p: any) => p.max_alt))).toBeGreaterThan(60);
    expect(Math.abs(body.position.lat)).toBeLessThanOrEqual(42);
    // Oulusta (65°) Tiangong ei nouse lainkaan.
    expect((await (await get("/api/iss?lat=65&lon=25.5&sat=css")).json<any>()).passes).toEqual([]);
    expect((await get("/api/iss?lat=65&lon=25.5&sat=hubble")).status).toBe(422);
    const detail = await (await get("/api/sky/object?lat=40.42&lon=-3.7&name=Tiangong")).json<any>();
    expect(detail).toMatchObject({ name: "Tiangong", kind: "iss", visibility: "rises" });
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

  it("käyttää OVATION-mallia lähimmälle tunnille ja Kp-ennustetta sen jälkeen", async () => {
    darkNight();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("ovation_aurora_latest.json")) return Response.json(ovationFeed([[20, 69, 40]]));
        if (url.endsWith("noaa-planetary-k-index.json")) return Response.json([{ time_tag: "2026-10-29T09:00:00", Kp: 5.33 }]);
        if (url.endsWith("forecast.json")) return Response.json([["time_tag", "kp", "observed"], ["2026-11-09 00:00:00", "0", "predicted"]]);
        if (url.startsWith("https://opendata.fmi.fi/")) return new Response(fmiXml([["2026-11-08T23:00:00Z", "TotalCloudCover", "0"]]));
        return Response.json([]);
      }),
    );
    const r = await get("/api/spaceweather?lat=68&lon=21");
    const body = await r.json<any>();
    expect(body.aurora_model).toBe("OVATION");
    expect(body.ovation).toMatchObject({ probability: 0, nearby: 40 });
    expect(body.aurora_chance_kp).toBe("Erittäin hyvä");
    expect(body.aurora_chance_geomagnetic).toBe("Hyvä");
    expect(body.aurora_chance).toBe("Hyvä");
    expect(body.sources).toContain("https://services.swpc.noaa.gov/json/ovation_aurora_latest.json");
    // Ennusteen hetki 00.10 kattaa tunnit 23 ja 00; klo 01 alkaen arvio tulee Kp-ennusteesta.
    expect(body.hourly.slice(0, 3).map((h: any) => [h.model, h.chance_geomagnetic])).toEqual([
      ["OVATION", "Hyvä"],
      ["OVATION", "Hyvä"],
      ["Kp", "Mahdollinen"],
    ]);
  });

  it("ei käytä vanhentunutta OVATION-ennustetta", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T04:30:00Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("ovation_aurora_latest.json")) return Response.json(ovationFeed([[20, 69, 40]]));
        if (url.endsWith("noaa-planetary-k-index.json")) return Response.json([{ time_tag: "2026-10-29T09:00:00", Kp: 5.33 }]);
        return Response.json([]);
      }),
    );
    const body = await (await get("/api/spaceweather?lat=68&lon=21")).json<any>();
    expect(body.aurora_model).toBe("Kp");
    expect(body.ovation).toBeNull();
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
