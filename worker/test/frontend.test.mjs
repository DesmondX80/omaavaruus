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
