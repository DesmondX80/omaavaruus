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
