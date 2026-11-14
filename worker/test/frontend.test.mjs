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
      // Moduulina: tavallinen --check jäsentää .js-tiedoston ensin CommonJS:nä eikä huomaa kaikkia virheitä funktioiden sisällä.
      expect(() => execFileSync(process.execPath, ["--input-type=module", "--check"], { input: read(file), stdio: "pipe" }), file).not.toThrow();
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

describe("avaruuslennon ratamekaniikka", async () => {
  const { helio, helioState, PLANETS, AU_KM } = await import("../../frontend/js/planets.js");
  const F = await import("../../frontend/js/flight.js");
  const Astronomy = await import("astronomy-engine");
  const BODIES = { Merkurius: "Mercury", Venus: "Venus", Maa: "EMB", Mars: "Mars", Jupiter: "Jupiter", Saturnus: "Saturn", Uranus: "Uranus", Neptunus: "Neptune" };
  const toEcliptic = Astronomy.Rotation_EQJ_ECL();
  const close = (a, b, tol) => F.norm([a[0] - b[0], a[1] - b[1], a[2] - b[2]]) / F.norm(b) < tol;

  it("Standishin pitkän aikavälin alkiot pitävät sijainnit tarkkoina vuosisadan päähän", () => {
    for (const iso of ["1850-01-01T00:00:00Z", "2026-11-14T00:00:00Z", "2075-06-01T00:00:00Z", "2150-01-01T00:00:00Z"]) {
      const time = Date.parse(iso);
      for (const { name } of PLANETS) {
        const v = Astronomy.RotateVector(toEcliptic, Astronomy.HelioVector(Astronomy.Body[BODIES[name]], new Date(time)));
        const [x, y, z] = helio(name, time);
        const arcmin = (Math.hypot(x - v.x, y - v.y, z - v.z) / Math.hypot(v.x, v.y, v.z)) * (180 / Math.PI) * 60;
        expect(arcmin, `${name} ${iso}`).toBeLessThan(15);
      }
    }
  });

  it("planeettojen nopeusvektorit vastaavat astronomy-enginen laskemia", () => {
    const time = Date.parse("2026-11-14T00:00:00Z");
    for (const { name } of PLANETS) {
      const s = Astronomy.HelioState(Astronomy.Body[BODIES[name]], new Date(time));
      const v = Astronomy.RotateVector(toEcliptic, new Astronomy.Vector(s.vx, s.vy, s.vz, s.t));
      expect(close(helioState(name, time).vel, [v.x, v.y, v.z], 0.01), name).toBe(true);
    }
    // Maan ratanopeus on noin 29,8 km/s.
    expect(F.norm(F.planetState("Maa", time).v)).toBeCloseTo(29.8, 0);
  });

  it("radan eteneminen säilyttää energian ja liikemäärämomentin", () => {
    const r0 = [AU_KM, 0, 0];
    for (const [v0, dt] of [
      [[0, 30, 1], 200 * 86400], // lähes ympyrärata
      [[5, 38, 2], 3 * 365 * 86400], // venynyt ellipsi
      [[0, 38, 0], 40 * 365 * 86400], // monta kierrosta
      [[10, 45, 3], 5 * 365 * 86400], // hyperbeli
      [[0, 30, 0], -150 * 86400], // taaksepäin
    ]) {
      const a = F.invariants(r0, v0), { r, v } = F.propagate(r0, v0, dt), b = F.invariants(r, v);
      expect(Math.abs(b.energy / a.energy - 1), `${v0} ${dt}`).toBeLessThan(1e-9);
      expect(close(b.h, a.h, 1e-9), `${v0} ${dt}`).toBe(true);
      // Eteneminen takaisin palauttaa alkutilan.
      expect(close(F.propagate(r, v, -dt).r, r0, 1e-8), `${v0} ${dt}`).toBe(true);
    }
    // Ympyrärata palaa kierroksen jälkeen alkuun.
    const vc = Math.sqrt(F.MU_SUN / AU_KM), period = 2 * Math.PI * Math.sqrt(AU_KM ** 3 / F.MU_SUN);
    expect(close(F.propagate(r0, [0, vc, 0], period / 4).r, [0, AU_KM, 0], 1e-9)).toBe(true);
  });

  it("Lambertin ratkaisu toistaa annetun loppupisteen", () => {
    const r1 = [AU_KM, 0, 0];
    for (const [r2, days] of [
      [[0, 1.5 * AU_KM, 0.05 * AU_KM], 150],
      [[-1.2 * AU_KM, 0.3 * AU_KM, 0], 300],
      [[0.2 * AU_KM, -1.4 * AU_KM, 0], 400], // pitkä kaari
      [[0.5 * AU_KM, 0.5 * AU_KM, 0], 20], // hyperbolinen pikalento
      [[-5 * AU_KM, 1 * AU_KM, 0.1 * AU_KM], 1000],
    ]) {
      const sol = F.lambert(r1, r2, days * 86400);
      expect(sol, `${r2}`).not.toBeNull();
      const end = F.propagate(r1, sol.v1, days * 86400);
      expect(close(end.r, r2, 1e-7), `${r2} ${days}`).toBe(true);
      expect(close(end.v, sol.v2, 1e-7), `${r2} ${days}`).toBe(true);
      // Rata kulkee planeettojen suuntaan.
      expect(F.cross(r1, sol.v1)[2]).toBeGreaterThan(0);
    }
  });

  it("Maa→Mars Hohmann kestää noin 259 vrk ja lähtö LEO:sta vaatii noin 3,6 km/s", () => {
    const h = F.hohmann(AU_KM, 1.524 * AU_KM);
    expect(h.tof / 86400).toBeCloseTo(259, 0);
    expect(F.burnDv("Maa", h.vinfDep)).toBeCloseTo(3.6, 1);
    // Lähes 180° siirto Lambertilla vastaa Hohmannia.
    const sol = F.lambert([AU_KM, 0, 0], [-1.524 * AU_KM, 1e-3 * AU_KM, 0], h.tof);
    expect(F.norm(sol.v1) - Math.sqrt(F.MU_SUN / AU_KM)).toBeCloseTo(h.vinfDep, 2);
  });

  it("löytää vuoden 2026 Mars-ikkunan oikeilla planeettojen paikoilla", () => {
    let best = null;
    for (let d = Date.parse("2026-09-01T00:00:00Z"); d < Date.parse("2027-03-01T00:00:00Z"); d += 5 * 86400000) {
      for (let tof = 150; tof <= 400; tof += 10) {
        const tr = F.transfer("Maa", "Mars", d, tof);
        if (tr && (!best || tr.dvDep < best.dvDep)) best = tr;
      }
    }
    // Halvin lähtö on vuodenvaihteen tienoilla, ja Δv LEO:sta on Hohmannin luokkaa.
    expect(best.dvDep).toBeGreaterThan(3.4);
    expect(best.dvDep).toBeLessThan(4);
    expect(best.depart).toBeGreaterThan(Date.parse("2026-10-01T00:00:00Z"));
    expect(best.depart).toBeLessThan(Date.parse("2027-02-01T00:00:00Z"));
    // Alus saapuu Marsin luo siirtoradan päässä.
    const end = F.shipState(best, best.arrive);
    expect(F.norm([end.r[0] - best.r2[0], end.r[1] - best.r2[1], end.r[2] - best.r2[2]])).toBeLessThan(1000);
  });

  it("vaikutuspiirien säteet ovat oikeaa suuruusluokkaa", () => {
    expect(F.FLIGHT_BODIES.Maa.soiKm / 1e6).toBeCloseTo(0.925, 1);
    expect(F.FLIGHT_BODIES.Jupiter.soiKm / 1e6).toBeCloseTo(48.2, 0);
    expect(F.FLIGHT_BODIES.Mars.soiKm / 1e6).toBeCloseTo(0.577, 1);
  });
});

describe("avaruuslennon laukaisuikkunat", async () => {
  const F = await import("../../frontend/js/flight.js");
  const start = Date.parse("2026-11-14T00:00:00Z"), DAY = 86400000;

  it("löytää Maa→Mars-lennolle halvimman ja nopeamman vaihtoehdon", () => {
    const it = F.windowSearch("Maa", "Mars", start);
    let r, last = -1;
    while (!(r = it.next()).done) {
      expect(r.value).toBeGreaterThan(last);
      last = r.value;
    }
    expect(last).toBe(1);
    const [cheapest, faster] = r.value;
    expect(cheapest.kind).toBe("cheapest");
    expect(cheapest.dvTotal).toBeLessThan(6.5);
    expect(cheapest.fuelOk).toBe(true);
    expect(faster.kind).toBe("faster");
    expect(faster.arrive - faster.depart).toBeLessThanOrEqual(0.7 * (cheapest.arrive - cheapest.depart) + DAY);
    expect(faster.dvTotal).toBeGreaterThan(cheapest.dvTotal);
    for (const o of r.value) {
      expect(o.depart).toBeGreaterThanOrEqual(start);
      expect(o.depart).toBeLessThanOrEqual(start + 731 * DAY);
    }
  });

  it("pitää ulkoplaneettojen lentoajan kohtuullisena ja kertoo, riittääkö polttoaine", () => {
    const [cheapest] = F.findWindows("Maa", "Neptunus", start);
    expect((cheapest.arrive - cheapest.depart) / DAY / 365.25).toBeLessThan(36);
    expect(cheapest.fuelOk).toBe(true);
    const poor = F.findWindows("Maa", "Jupiter", start, { fuel: 5 });
    expect(poor.every((o) => !o.fuelOk)).toBe(true);
  });

  it("muotoilee lentoajan kelloksi", () => {
    expect(F.fmtDuration(123 * DAY + 4 * 3600000 + 12 * 60000 + 33500)).toBe("123 vrk 04:12:33");
    expect(F.fmtDuration(-5)).toBe("0 vrk 00:00:00");
  });
});

describe("avaruuslennon ohjaamonäkymä", async () => {
  const F = await import("../../frontend/js/flight.js");
  const { BRIGHT_STARS } = await import("../../frontend/js/stars.js");
  const { BRIGHT_STARS: WORKER_STARS } = await import("../src/stars.ts");
  const start = Date.parse("2026-11-14T00:00:00Z"), DAY = 86400000;
  const [tr] = F.findWindows("Maa", "Mars", start);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

  it("ohjaamon tähtiluettelo on sama kuin Workerin", () => {
    expect(BRIGHT_STARS).toEqual(WORKER_STARS);
  });

  it("alus ei ole planeetan sisällä lähtiessä eikä saapuessa", () => {
    const dep = F.norm(sub(F.shipView(tr, tr.depart).r, F.planetState("Maa", tr.depart).r));
    const arr = F.norm(sub(F.shipView(tr, tr.arrive).r, F.planetState("Mars", tr.arrive).r));
    expect(dep).toBeGreaterThan(F.FLIGHT_BODIES.Maa.periKm);
    expect(dep).toBeLessThan(50000);
    expect(arr).toBeGreaterThan(F.FLIGHT_BODIES.Mars.periKm);
    // Ennen laukaisua alus kulkee Maan mukana.
    const before = F.shipView(tr, tr.depart - 30 * DAY);
    expect(F.norm(sub(before.r, F.planetState("Maa", tr.depart - 30 * DAY).r))).toBeCloseTo(dep, 0);
    // Keskellä lentoa näkymä on siirtorata.
    const mid = (tr.depart + tr.arrive) / 2;
    expect(F.norm(sub(F.shipView(tr, mid).r, F.shipState(tr, mid).r))).toBe(0);
  });

  it("vaikutuspiiristä poistutaan muutamassa vuorokaudessa", () => {
    const days = (F.soiExit(tr) - tr.depart) / DAY;
    expect(days).toBeGreaterThan(1);
    expect(days).toBeLessThan(10);
    expect(F.soiEntry(tr)).toBeGreaterThan(F.soiExit(tr));
  });
});

describe("avaruuslennon saapuminen ja jatkolennot", async () => {
  const F = await import("../../frontend/js/flight.js");
  const { PLANET_INFO } = await import("../../frontend/js/planetinfo.js");
  const { PLANETS } = await import("../../frontend/js/planets.js");
  const start = Date.parse("2026-11-14T00:00:00Z");
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

  it("pysäköintirata kiertää planeettaa oikealla korkeudella ja nopeudella", () => {
    const s = F.parkingState("Maa", start), p = F.planetState("Maa", start);
    const r = F.norm(sub(s.r, p.r));
    expect(r).toBeGreaterThanOrEqual(F.FLIGHT_BODIES.Maa.periKm - 1);
    expect(r).toBeLessThanOrEqual(F.FLIGHT_BODIES.Maa.apoKm + 1);
    // Matalan Maan kiertoradan nopeus on noin 7,8 km/s.
    expect(F.norm(s.rel.v)).toBeCloseTo(7.79, 1);
  });

  it("lentää Auringon kiertoradalta (ohilennon jälkeen) uuteen kohteeseen", () => {
    const [tr] = F.findWindows("Maa", "Mars", start);
    const s = F.shipState(tr, tr.arrive);
    const drift = { r: s.r, v: s.v, t: tr.arrive };
    expect(F.isPlanet(drift)).toBe(false);
    expect(F.norm(sub(F.departureState(drift, tr.arrive).r, s.r))).toBeLessThan(1e-3);
    const options = F.findWindows(drift, "Jupiter", tr.arrive, { fuel: 20 });
    expect(options.length).toBeGreaterThan(0);
    // Auringon kiertoradalta lähtö on suoraan nopeuksien erotus.
    expect(options[0].dvDep).toBeCloseTo(options[0].vinfDep, 10);
    expect(F.soiExit(options[0])).toBe(options[0].depart);
    expect(F.norm(sub(F.shipView(options[0], options[0].depart - 86400000).r, F.departureState(drift, options[0].depart - 86400000).r))).toBeLessThan(1);
  });

  it("laskee lennon pituuden ja huippunopeuden lokikirjaan", () => {
    const [tr] = F.findWindows("Maa", "Mars", start);
    const { km, maxSpeed } = F.flightStats(tr);
    // Maa→Mars-siirtorata on noin puolikas ellipsi: 400–600 miljoonaa km, nopeus suurin lähdössä.
    expect(km / 1e6).toBeGreaterThan(350);
    expect(km / 1e6).toBeLessThan(650);
    expect(maxSpeed).toBeCloseTo(F.norm(tr.v1), 1);
  });

  it("jokaisella planeetalla on tietokortti", () => {
    for (const { name } of PLANETS) {
      const info = PLANET_INFO[name];
      for (const key of ["diameter", "mass", "gravity", "day", "year", "temperature", "atmosphere", "moons"]) expect(info[key], `${name} ${key}`).toBeTruthy();
      expect(info.facts.length, name).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("avaruuslennon kurssikorjaukset", async () => {
  const F = await import("../../frontend/js/flight.js");
  const start = Date.parse("2026-11-14T00:00:00Z"), DAY = 86400000;
  const [tr] = F.findWindows("Maa", "Mars", start);
  const mid = tr.depart + 60 * DAY;

  it("ennuste vastaa suunniteltua lentoa, kun kurssia ei ole muutettu", () => {
    const p = F.predict(tr, mid);
    expect(p.miss).toBe(false);
    expect(p.missKm).toBeLessThan(1000);
    expect(Math.abs(p.arrive - tr.arrive)).toBeLessThan(DAY / 4);
    expect(p.dvArr).toBeCloseTo(tr.dvArr, 1);
  });

  it("poltto muuttaa rataa heti ja korjaus palauttaa kohteeseen", () => {
    const burned = F.applyBurn(tr, mid, "prograde", 0.5);
    // Polton hetkellä paikka ei muutu, mutta nopeus kasvaa 0,5 km/s.
    const before = F.shipState(tr, mid), after = F.shipState(burned, mid + 1);
    expect(F.norm(after.v) - F.norm(before.v)).toBeCloseTo(0.5, 2);
    expect(burned.miss).toBe(true);
    expect(burned.missKm).toBeGreaterThan(F.FLIGHT_BODIES.Mars.soiKm);
    const fix = F.autoCorrect(burned, mid + 5 * DAY);
    expect(fix.flight.miss).toBe(false);
    expect(fix.dv).toBeGreaterThan(0.1);
    expect(fix.dv).toBeLessThan(2);
    // Ennen poltto-osuutta rata on ennallaan.
    expect(F.norm(F.shipState(fix.flight, mid - DAY).r.map((x, i) => x - F.shipState(tr, mid - DAY).r[i]))).toBeLessThan(1e-3);
  });

  it("polton suunnat ovat kohtisuorassa toisiinsa nähden", () => {
    const s = F.shipState(tr, mid);
    const pro = F.burnVector(s, "prograde", 1), out = F.burnVector(s, "outward", 1);
    expect(F.dot(pro, out)).toBeCloseTo(0, 10);
    expect(F.norm(F.burnVector(s, "inward", 0.3))).toBeCloseTo(0.3, 10);
    expect(F.dot(F.burnVector(s, "retrograde", 1), pro)).toBeCloseTo(-1, 10);
  });
});
