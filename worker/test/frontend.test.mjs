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
