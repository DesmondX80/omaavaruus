# OmaAvaruus

Avaruussään, taivaankartan ja rakettilaukaisujen pohjasovellus. Backend on Cloudflare
Worker (TypeScript), frontend kevyt vanilla-JS/SVG-käyttöliittymä GitHub Pagesissa.

- Sovellus: https://desmondx80.github.io/omaavaruus/
- API: https://omaavaruus-api.desmond80x.workers.dev

## Pika-aloitus

```bash
cd ~/projektit
git clone git@github.com:DesmondX80/omaavaruus.git omaavaruus
cd omaavaruus
make dev         # http://localhost:8787 (Worker tarjoilee myös frontendin)
make test
```

Kaikki `make`-komennot ajetaan repon juuresta; ne käyttävät `worker/`-hakemiston npm-skriptejä.

## Ominaisuudet (v0.1)

- **Avaruussää**: Kp-indeksi (NOAA SWPC), G-asteikko, aurinkotuulen nopeus, Bz, hälytykset ja revontuliarvio havaintopaikan leveysasteelle.
- **Taivaankartta**: Aurinko, Kuu, seitsemän planeettaa ja ~55 kirkkainta tähteä atsimuutti-korkeuskoordinaateissa ([astronomy-engine](https://github.com/cosinekitty/astronomy)). Aikaslider ±12 h.
- **Laukaisut**: RocketLaunch.Live, seuraavat laukaisut ja lähtölaskenta.

## Rakenne

```
worker/
  wrangler.toml      # Workerin asetukset, oletuspaikka, CORS-originit
  src/
    index.ts         # reititys, parametrien tarkistus, CORS
    http.ts          # TTL-välimuisti, fetch + SWPC-muodon normalisointi
    spaceweather.ts  # NOAA SWPC
    launches.ts      # RocketLaunch.Live + uudelleenyrityksen odotus
    sky.ts           # astronomy-engine + kirkkaat tähdet (stars.ts)
  test/              # vitest
frontend/            # index.html, styles.css, app.js, sky.js, config.js (API-osoite)
```

## Julkaisu

Push `main`-haaraan julkaisee muutokset automaattisesti:

- `worker.yml` ajaa testit ja julkaisee Workerin (secretit `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`; token pohjalla *Edit Cloudflare Workers*).
- `pages.yml` julkaisee `frontend/`-hakemiston GitHub Pagesiin ja kirjoittaa repon
  muuttujan `OMAVARUUS_API` (Workerin osoite) `config.js`:ään.

Käsin: `npx wrangler login` ja `make deploy`. Sallitut CORS-originit ovat
`worker/wrangler.toml`:n `CORS_ORIGINS`-muuttujassa.

## API

| Reitti | Kuvaus |
| --- | --- |
| `GET /api/health` | Terveystarkistus |
| `GET /api/config` | Oletuskoordinaatit |
| `GET /api/spaceweather?lat=65.0` | Kp-historia ja -ennuste, aurinkotuuli, revontuliarvio |
| `GET /api/launches` | 5 seuraavaa laukaisua |
| `GET /api/sky?lat&lon&at` | Taivaankartta hetkelle |

## Seuraavat askeleet

1. Kääri taivaankartta WebGL:ään (esim. three.js) ja lisää tähtikuvioiden viivat.
2. Lisää NOAA DSCOVR/ACE-reaaliaikaparametrit ja revontulien näkyvyysrajapyykki (esim. Kp + pilvisyys FMI:ltä).
3. Suodata laukaisut suosikkitoimijoittain ja tallenna ilmoitukset (web push).
4. Jaettu välimuisti Workers KV:llä, jos isolaattikohtainen välimuisti ei riitä.
