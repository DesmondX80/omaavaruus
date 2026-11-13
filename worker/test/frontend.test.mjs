import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../frontend");
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [relative(root, path).replaceAll("\\", "/")];
  });
const files = walk(root);
const read = (file) => readFileSync(join(root, file), "utf8");

describe("frontend", () => {
  it("service worker tallettaa kaikki sovelluksen tiedostot", () => {
    const list = read("sw.js").match(/const SHELL = \[([\s\S]*?)\];/)[1];
    const shell = [...list.matchAll(/"([^"]+)"/g)].map((m) => (m[1] === "./" ? "index.html" : m[1]));
    expect(shell.sort()).toEqual(files.filter((f) => f !== "sw.js").sort());
  });

  it("JavaScript-tiedostot ovat syntaksiltaan kelvollisia", () => {
    for (const file of files.filter((f) => f.endsWith(".js"))) {
      expect(() => execFileSync(process.execPath, ["--check", join(root, file)], { stdio: "pipe" }), file).not.toThrow();
    }
  });

  it("moduulien tuonnit osoittavat olemassa oleviin tiedostoihin", () => {
    for (const file of files.filter((f) => f.startsWith("js/"))) {
      for (const [, spec] of read(file).matchAll(/from '(\.\/[^']+)'/g)) {
        expect(files, `${file} tuo ${spec}`).toContain(join("js", spec).replaceAll("\\", "/"));
      }
    }
  });

  it("index.html ja manifesti viittaavat olemassa oleviin tiedostoihin", () => {
    const refs = [...read("index.html").matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
    const icons = JSON.parse(read("manifest.webmanifest")).icons.map((icon) => icon.src);
    expect(refs).toContain("js/main.js");
    for (const ref of [...refs, ...icons]) expect(files, ref).toContain(ref);
  });
});

describe("taivaan perspektiivinäkymä", async () => {
  const { altAz, camera, orientationView, project, vector } = await import("../../frontend/js/skyview.js");
  const dir = (...angles) => altAz(orientationView(...angles).dir);

  it("laskee katselusuunnan puhelimen asennosta", () => {
    // Pystyssä, takakamera pohjoiseen: horisontissa pohjoisessa.
    expect(dir(0, 90, 0)).toMatchObject({ alt: expect.closeTo(0, 5), az: expect.closeTo(0, 5) });
    // Alpha kasvaa vastapäivään: 90° on länsi.
    expect(dir(90, 90, 0).az).toBeCloseTo(270, 5);
    // Yläreunaa kallistettu taaksepäin: kamera osoittaa 45° ylös.
    expect(dir(0, 135, 0).alt).toBeCloseTo(45, 5);
    // Vaakatasossa näyttö ylöspäin: kamera osoittaa maahan.
    expect(dir(0, 0, 0).alt).toBeCloseTo(-90, 5);
  });

  it("projisoi taivaan näytölle oikein päin", () => {
    const south = camera(vector(0, 180), [0, 0, 1], 60);
    expect(project(south, vector(0, 180), 400, 800)).toEqual([200, 400]);
    // Etelään katsottaessa länsi on oikealla ja ylempänä oleva kohde näytön yläosassa.
    const [x, y] = project(south, vector(10, 190), 400, 800);
    expect(x).toBeGreaterThan(200);
    expect(y).toBeLessThan(400);
    expect(project(south, vector(0, 0), 400, 800)).toBeNull();
  });
});

describe("ISS-ylilennon kartta", async () => {
  const { horizonKm, project, trackLatLon, trackSpan } = await import("../../frontend/js/issmap.js");

  it("projisoi paikat kilometreiksi havaitsijasta", () => {
    const [east, north] = project(60, 25, 61, 25);
    expect(east).toBeCloseTo(0, 5);
    expect(north).toBeCloseTo(111.19, 1);
    // Itä on oikealla; 60° leveydellä pituusaste on puolet päiväntasaajan asteesta.
    expect(project(60, 25, 60, 26)[0]).toBeCloseTo(55.6, 0);
    expect(project(0, 179, 0, -179)[0]).toBeCloseTo(222.4, 0);
    expect(project(60, 25, 60, 25)).toEqual([0, 0, 1]);
    // Kolmas arvo kertoo, onko paikka pallon näkyvällä puolella.
    expect(project(60, 25, -60, -155)[2]).toBeCloseTo(-1, 9);
    expect(project(0, 0, 0, 90)[2]).toBeCloseTo(0, 9);
  });

  it("laskee näkyvyysalueen säteen ja reitin keston", () => {
    expect(horizonKm(420, 5)).toBeGreaterThan(1700);
    expect(horizonKm(420, 5)).toBeLessThan(1800);
    expect(horizonKm(420, 90)).toBeCloseTo(0, 5);
    const start = "2026-11-16T16:50:00.000Z";
    expect(trackSpan({ start, step_s: 20, points: [[0, 0], [1, 1], [2, 2]] })).toEqual([Date.parse(start), Date.parse(start) + 40_000]);
  });

  it("laskee aseman paikan radan näytteiden väliltä", () => {
    const start = "2026-11-16T16:50:00.000Z", t0 = Date.parse(start);
    // Pituusaste vaihtuu päivämäärärajalla 180°:sta −180°:een; väliarvo ei saa kiertää maapallon ympäri.
    const track = { start, step_s: 60, points: [[10, 178], [12, -178], [14, -174]] };
    expect(trackLatLon(track, t0 + 30_000)).toEqual({ lat: 11, lon: 180 });
    expect(trackLatLon(track, t0 + 45_000)).toEqual({ lat: 11.5, lon: -179 });
    expect(trackLatLon(track, t0 + 120_000)).toEqual({ lat: 14, lon: -174 });
    expect(trackLatLon(track, t0 - 1)).toBeNull();
    expect(trackLatLon(track, t0 + 120_001)).toBeNull();
  });
});

describe("Nyt-näkymän yhteenveto", async () => {
  const { outlook, overcastNight } = await import("../../frontend/js/outlook.js");
  const now = Date.parse("2026-11-16T15:00:00Z");
  const hhmm = (t) => new Date(t).toISOString().slice(11, 16);
  const pass = { visible_start: "2026-11-16T16:51:00Z", visible_end: "2026-11-16T16:53:00Z", max_alt: 8, max_az: 180, cloud_cover: null };
  const weather = (chance, hourly = []) => ({ best_window: chance && { start: "2026-11-16T20:00:00Z", end: "2026-11-16T23:00:00Z", chance }, hourly });
  const event = { title: "Leonidit", visible: true, best_time: "2026-11-17T04:00:00Z", cloud_cover: 20 };
  const text = (o) => o.title.map((p) => p.text).join("");

  it("valitsee pääsyyn tärkeyden ja ajan mukaan", () => {
    const good = outlook({ weather: weather("Hyvä"), iss: { passes: [pass] }, events: { events: [event] } }, now, hhmm);
    expect(text(good)).toBe("Revontulet: hyvä mahdollisuus klo 20:00–23:00");
    expect(good).toMatchObject({ tone: "good", view: "revontulet", also: ["ISS näkyy klo 16:51 matalalla etelässä", "Leonidit klo 04:00"] });
    // Pelkkä mahdollisuus revontuliin jää näkyvän ylilennon ja tapahtuman taakse.
    const weak = outlook({ weather: weather("Mahdollinen"), iss: { passes: [pass] }, events: { events: [event] } }, now, hhmm);
    expect(text(weak)).toBe("ISS näkyy klo 16:51 matalalla etelässä");
    expect(weak.view).toBe("iss");
    expect(weak.also.at(-1)).toBe("revontulet mahdollisia klo 20:00–23:00");
  });

  it("ohittaa pilvien peittämät ja yli vuorokauden päässä olevat kohteet", () => {
    const o = outlook({ weather: weather(null), iss: { passes: [{ ...pass, cloud_cover: 95 }] }, events: { events: [{ ...event, best_time: "2026-11-18T04:00:00Z" }] } }, now, hhmm);
    expect(o).toMatchObject({ tone: "off", also: [] });
    expect(text(o)).toBe("Ei revontulia eikä näkyviä ylilentoja seuraavan vuorokauden aikana");
  });

  it("nostaa Maahan osuvan CME:n syyksi", () => {
    const sun = { cmes: [{ arrival: "2026-11-17T02:00:00Z", glancing: false, kp_max: 7 }, { arrival: "2026-11-16T20:00:00Z", glancing: true, kp_max: 5 }] };
    const o = outlook({ weather: weather(null), sun }, now, hhmm);
    expect(text(o)).toBe("CME saapuu arviolta klo 02:00, Kp jopa 7");
    expect(o).toMatchObject({ tone: "mid", view: "revontulet" });
  });

  it("kertoo pilvisestä yöstä", () => {
    const hours = (cloud) => Array.from({ length: 8 }, (_, i) => ({ light: i < 2 ? "Valoisaa" : "Pimeää", cloud_cover: cloud }));
    expect(overcastNight(weather(null, hours(95)))).toBe(true);
    expect(overcastNight(weather(null, hours(50)))).toBe(false);
    expect(text(outlook({ weather: weather(null, hours(100)) }, now, hhmm))).toBe("Pilvistä koko yön");
  });
});

describe("ylilennon kaari taivaankartalla", async () => {
  const { arcPoints } = await import("../../frontend/js/skychart.js");
  // Nousu luoteesta, korkein kohta pohjoisessa ja lasku koillisessa: atsimuutti kulkee pohjoisen yli.
  const pass = { start: "2026-11-16T16:50:00.000Z", sky_track: [[0, 5, 300], [60, 20, 350], [120, 25, 10], [180, 5, 60]] };
  const t = (s) => Date.parse(pass.start) + s * 1000;

  it("palauttaa koko radan ja rajatun osuuden", () => {
    expect(arcPoints(pass)).toEqual([[5, 300], [20, 350], [25, 10], [5, 60]]);
    const part = arcPoints(pass, t(30), t(90));
    expect(part[0]).toEqual([12.5, 325]);
    expect(part[1]).toEqual([20, 350]);
    // Puolivälissä 350° ja 10° välillä on pohjoinen (0°), ei etelä (180°).
    expect(part.at(-1)).toEqual([22.5, 0]);
  });

  it("rajaa välin radan kestoon", () => {
    expect(arcPoints(pass, t(-60), t(400))).toEqual(arcPoints(pass));
    expect(arcPoints(pass, t(200), t(300))).toEqual([]);
  });
});

describe("revontulikamerat", async () => {
  const { distanceBearing, nearestCameras } = await import("../../frontend/js/cameras.js");

  it("laskee etäisyyden ja suunnan", () => {
    // Oulusta Sodankylään noin 270 km pohjoiseen.
    const sod = distanceBearing({ lat: 65.01, lon: 25.47 }, { lat: 67.42, lon: 26.39 });
    expect(sod.km).toBeCloseTo(270, -1);
    expect(sod.direction).toBe("pohjoiseen");
    expect(distanceBearing({ lat: 60, lon: 25 }, { lat: 60, lon: 26 }).direction).toBe("itään");
  });

  it("valitsee lähimmät kamerat", () => {
    expect(nearestCameras({ lat: 60.17, lon: 24.94 }).map((c) => c.name)).toEqual(["Helsinki", "Metsähovi", "Nyrölä"]);
    expect(nearestCameras({ lat: 68.9, lon: 20.9 }, 1)[0].name).toBe("Kilpisjärvi");
  });
});

describe("aurinkokunnan kartta", async () => {
  const { helio, eccentricAnomaly, PLANETS } = await import("../../frontend/js/planets.js");
  const Astronomy = await import("astronomy-engine");
  const BODIES = { Merkurius: "Mercury", Venus: "Venus", Maa: "EMB", Mars: "Mars", Jupiter: "Jupiter", Saturnus: "Saturn", Uranus: "Uranus", Neptunus: "Neptune" };

  it("ratkaisee Keplerin yhtälön", () => {
    for (const e of [0, 0.2, 0.9]) {
      for (const M of [0.1, 1, 3, 5]) {
        const E = eccentricAnomaly(M, e);
        expect(Math.atan2(Math.sin(E - e * Math.sin(E) - M), Math.cos(E - e * Math.sin(E) - M))).toBeCloseTo(0, 10);
      }
    }
  });

  it("planeettojen sijainnit vastaavat astronomy-enginen laskemia", () => {
    const toEcliptic = Astronomy.Rotation_EQJ_ECL();
    for (const iso of ["1990-03-01T00:00:00Z", "2026-11-13T12:00:00Z", "2040-07-15T00:00:00Z"]) {
      const time = Date.parse(iso);
      for (const { name } of PLANETS) {
        const v = Astronomy.RotateVector(toEcliptic, Astronomy.HelioVector(Astronomy.Body[BODIES[name]], new Date(time)));
        const [x, y, z] = helio(name, time), r = Math.hypot(v.x, v.y, v.z);
        // Rata-alkioiden tarkkuus: Jupiterin ja Saturnuksen keskinäiset häiriöt jättävät muutaman kaariminuutin eron.
        const arcmin = (Math.hypot(x - v.x, y - v.y, z - v.z) / r) * (180 / Math.PI) * 60;
        expect(arcmin, `${name} ${iso}`).toBeLessThan(15);
      }
    }
  });
});
