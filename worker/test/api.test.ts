import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import worker, { type Env } from "../src/index";
import { asRecords } from "../src/http";
import { parseLaunch, resetLaunchState, retrySeconds } from "../src/launches";
import { moonPhaseName } from "../src/sky";
import { auroraChance, kpToGScale, parseTs } from "../src/spaceweather";

const env: Env = {
  DEFAULT_LAT: "65.0121",
  DEFAULT_LON: "25.4651",
  DEFAULT_ELEVATION_M: "20",
  DEFAULT_PLACE: "Oulu",
  LAUNCH_LIMIT: "10",
  CORS_ORIGINS: "https://desmondx80.github.io",
};

const get = (path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`https://api.test${path}`, { headers }), env);

beforeEach(() => resetLaunchState());
afterEach(() => vi.unstubAllGlobals());

describe("apufunktiot", () => {
  it("muuntaa Kp:n G-asteikoksi", () => {
    expect(kpToGScale(4.99)).toBe(0);
    expect(kpToGScale(5)).toBe(1);
    expect(kpToGScale(9)).toBe(5);
  });

  it("arvioi revontulet Oulussa", () => {
    expect(["Hyvä", "Erittäin hyvä"]).toContain(auroraChance(5, 65.0));
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("noaa-planetary-k-index.json")) return Response.json([{ time_tag: "2026-10-29T09:00:00", Kp: 5.33 }]);
        if (url.endsWith("solar-wind-speed.json")) return Response.json([{ proton_speed: 512, time_tag: "2026-10-29T09:03:00Z" }]);
        if (url.endsWith("solar-wind-mag-field.json")) return Response.json([{ bt: 6, bz_gsm: -4 }]);
        if (url.endsWith("forecast.json")) return Response.json([["time_tag", "kp", "observed"], ["2026-10-30 00:00:00", "4", "predicted"]]);
        return Response.json([]);
      }),
    );
    const r = await get("/api/spaceweather?lat=65");
    expect(r.status).toBe(200);
    const body = await r.json<any>();
    expect(body.kp_now).toBe(5.33);
    expect(body.g_label).toBe("G1 – heikko myrsky");
    expect([body.solar_wind_speed_kms, body.bz_nt, body.bt_nt]).toEqual([512, -4, 6]);
    expect(body.kp_forecast[0].time_tag).toBe("2026-10-30T00:00:00.000Z");
  });

  it("tuntematon reitti on 404", async () => {
    expect((await get("/api/nope")).status).toBe(404);
  });
});
