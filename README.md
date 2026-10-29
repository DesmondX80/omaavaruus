# OmaAvaruus

Avaruussään, taivaankartan ja rakettilaukaisujen pohjasovellus. Backend on FastAPI,
frontend on kevyt vanilla-JS/SVG-käyttöliittymä, joka tarjoillaan samasta palvelusta.

## Pika-aloitus

```bash
cd ~/projektit
git clone git@github.com:DesmondX80/omaavaruus.git omaavaruus
cd omaavaruus
make install     # luo backend/.venv ja asentaa riippuvuudet
make dev         # http://localhost:8000
```

Kaikki `make`-komennot ajetaan repon juuresta, jossa `Makefile` sijaitsee. Venv on
`backend/.venv`, ja `make dev` käynnistää sen omalla Pythonilla, joten järjestelmän
Python tai globaali `uvicorn` ei pääse sotkemaan ympäristöä. Tarkistus: `make doctor`.

Tai Dockerilla:

```bash
docker compose up --build
```

## Ominaisuudet (v0.1)

- **Avaruussää**: Kp-indeksi (NOAA SWPC), G-asteikko, aurinkotuulen nopeus, Bz, hälytykset ja revontuliarvio havaintopaikan leveysasteelle.
- **Taivaankartta**: Aurinko, Kuu, seitsemän planeettaa ja ~55 kirkkainta tähteä atsimuutti-korkeuskoordinaateissa (Skyfield + DE421). Aikaslider ±12 h.
- **Laukaisut**: The Space Devs Launch Library 2, seuraava laukaisu ja lähtölaskenta. Päivitys SSE-striiminä (`/api/launches/stream`).

## Rakenne

```
backend/app/
  main.py            # FastAPI-reitit + SSE + staattinen frontend
  config.py          # pydantic-settings, .env
  models.py          # API-skeemat
  cache.py           # TTL-välimuisti ulkoisten API:en suojaksi
  providers/
    http.py          # jaettu httpx-client + SWPC-muodon normalisointi
    space_weather.py # NOAA SWPC
    launches.py      # Launch Library 2
    sky.py           # Skyfield + kirkkaat tähdet
frontend/            # index.html, styles.css, app.js, sky.js
```

## Julkaisu: Cloudflare Worker + GitHub Pages

Tuotannossa backend on Cloudflare Worker (`worker/`, TypeScript) ja frontend GitHub
Pagesissa. Worker toteuttaa saman `/api/*`-rajapinnan kuin FastAPI-backend; taivaankartta
lasketaan [astronomy-enginellä](https://github.com/cosinekitty/astronomy), koska Skyfield
ja DE421-efemeridi eivät mahdu Workerin kokorajoihin (ero Skyfieldiin ~0,01°).

```bash
cd worker
npm install
npm test
npm run dev        # http://localhost:8787 (Worker tarjoilee myös frontendin)
npx wrangler login
npm run deploy     # -> https://omaavaruus-api.<tili>.workers.dev
```

Automaattinen julkaisu `main`-haaraan pushatessa:

1. **Cloudflare**: luo API-token (pohja *Edit Cloudflare Workers*) ja lisää repoon secretit
   `CLOUDFLARE_API_TOKEN` ja `CLOUDFLARE_ACCOUNT_ID`. Työnkulku `worker.yml` julkaisee Workerin.
2. **GitHub Pages**: Settings → Pages → Source: *GitHub Actions*. Lisää repon muuttuja
   (Settings → Secrets and variables → Actions → Variables) `OMAVARUUS_API` =
   Workerin osoite. Työnkulku `pages.yml` kirjoittaa sen `config.js`:ään.
3. Sallitut CORS-originit ovat `worker/wrangler.toml`:n `CORS_ORIGINS`-muuttujassa.

Workerissa ei ole SSE-reittiä `/api/launches/stream`; frontend käyttää tavallista pollausta.

## API

| Reitti | Kuvaus |
| --- | --- |
| `GET /api/health` | Terveystarkistus |
| `GET /api/config` | Oletuskoordinaatit |
| `GET /api/spaceweather?lat=65.0` | Kp-historia ja -ennuste, aurinkotuuli, revontuliarvio |
| `GET /api/launches` | 10 seuraavaa laukaisua |
| `GET /api/launches/stream` | SSE, päivitys 60 s välein |
| `GET /api/sky?lat&lon&at` | Taivaankartta hetkelle |

## Seuraavat askeleet

1. Kääri taivaankartta WebGL:ään (esim. three.js) ja lisää tähtikuvioiden viivat.
2. Lisää NOAA DSCOVR/ACE-reaaliaikaparametrit ja revontulien näkyvyysrajapyykki (esim. Kp + pilvisyys FMI:ltä).
3. Suodata laukaisut suosikkitoimijoittain ja tallenna ilmoitukset (web push).
4. Välimuisti Redisillä, jos instansseja on useampi.
