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

## Ominaisuudet

- **Avaruussää**: Kp-indeksi (NOAA SWPC), G-asteikko, aurinkotuulen nopeus, Bz ja hälytykset.
- **Revontuliarvio**: NOAA:n OVATION Prime -malli (todennäköisyys paikan yläpuolella ja 500 km säteellä) lähimmälle tunnille, sen jälkeen Kp-ennuste ja leveysaste. Arviosta vähennetään pilvisyys (FMI, varalla Open-Meteo), taivaan valoisuus (Auringon korkeus) ja kuutamo. Tuntiennuste seuraaville 24 tunnille ja paras havaintoikkuna.
- **Paikan valinta**: oma sijainti (selaimen paikannus) tai nimellä haettu paikka (Open-Meteo Geocoding). Haetut paikat ja valinta tallentuvat selaimen localStorageen.
- **Taivaankartta**: Aurinko, Kuu, seitsemän planeettaa ja ~55 kirkkainta tähteä atsimuutti-korkeuskoordinaateissa ([astronomy-engine](https://github.com/cosinekitty/astronomy)). Aikaslider ±12 h.
- **Asennettava (PWA)**: sovelluksen voi lisätä puhelimen kotinäytölle. Service worker pitää sovelluksen ja viimeksi haetut tiedot saatavilla ilman verkkoa ja kertoo, milloin näytettävät tiedot on haettu.
- **Revontuli-ilmoitukset**: push-ilmoitus puhelimeen, kun revontuliarvio valitussa paikassa on vähintään käyttäjän valitsemalla rajalla. Worker tarkistaa tilanteen 15 minuutin välein (Cron Trigger) ja säilyttää tilaukset Workers KV:ssä.
- **Laukaisut**: RocketLaunch.Live, seuraavat laukaisut ja lähtölaskenta.

## Rakenne

```
worker/
  wrangler.toml      # Workerin asetukset, oletuspaikka, CORS-originit
  src/
    index.ts         # reititys, parametrien tarkistus, CORS
    http.ts          # TTL-välimuisti, fetch + SWPC-muodon normalisointi
    spaceweather.ts  # NOAA SWPC: Kp, aurinkotuuli ja revontuliarvio
    ovation.ts       # OVATION Prime -revontulimalli (SWPC)
    clouds.ts        # pilvisyysennuste (FMI, varalla Open-Meteo)
    geocode.ts       # paikannimihaku (Open-Meteo Geocoding)
    push.ts          # ilmoitustilaukset (KV) ja ajastettu tarkistus
    webpush.ts       # push-viestin salaus (RFC 8291) ja VAPID-tunniste (RFC 8292)
    launches.ts      # RocketLaunch.Live + uudelleenyrityksen odotus
    sky.ts           # astronomy-engine + kirkkaat tähdet (stars.ts)
  test/              # vitest: API sekä frontendin tiedostolistojen ja tuontien tarkistus
frontend/
  index.html, styles.css, config.js (API-osoite)
  manifest.webmanifest, icons/   # PWA-manifesti ja kuvakkeet (icon.svg on lähde, PNG:t siitä piirrettyjä)
  sw.js              # service worker: verkko ensin, ilman verkkoa välimuisti
  js/                # ES-moduulit ilman käännösvaihetta
    main.js          # käynnistys ja ajastukset
    core.js          # jaettu tila, API-kutsut, apufunktiot
    weather.js, sky.js, skychart.js, places.js, push.js, launches.js, info.js
```

## Julkaisu

Push `main`-haaraan julkaisee muutokset automaattisesti:

- `worker.yml` ajaa testit ja julkaisee Workerin (secretit `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`; token pohjalla *Edit Cloudflare Workers*).
- `pages.yml` julkaisee `frontend/`-hakemiston GitHub Pagesiin, kirjoittaa repon
  muuttujan `OMAVARUUS_API` (Workerin osoite) `config.js`:ään ja asettaa commitin
  tunnisteen service workerin versioksi (`sw.js`).

Ilmoitukset käyttävät KV-nimiavaruutta `SUBSCRIPTIONS` (`worker/wrangler.toml`). VAPID-avainpari
luodaan ensimmäisellä käyttökerralla ja säilytetään samassa nimiavaruudessa, joten salaisuuksia
ei tarvitse asettaa käsin. Tilauksesta tallennetaan selaimen push-osoite ja paikan sijainti
0,1 asteen tarkkuudella.

Käsin: `npx wrangler login` ja `make deploy`. Sallitut CORS-originit ovat
`worker/wrangler.toml`:n `CORS_ORIGINS`-muuttujassa.

## API

| Reitti | Kuvaus |
| --- | --- |
| `GET /api/health` | Terveystarkistus |
| `GET /api/config` | Oletuskoordinaatit |
| `GET /api/spaceweather?lat&lon` | Kp-historia ja -ennuste, aurinkotuuli, OVATION-todennäköisyys (`ovation`), revontuliarvio nyt ja tunneittain (`hourly`, `best_window`) |
| `GET /api/geocode?q=Rovaniemi` | Paikannimihaku, enintään 5 osumaa |
| `GET /api/push/key` | Ilmoitusten julkinen VAPID-avain |
| `POST /api/push/subscribe` | Tallentaa tai päivittää ilmoitustilauksen (`subscription`, `lat`, `lon`, `place`, `threshold`) |
| `POST /api/push/unsubscribe` | Poistaa tilauksen (`endpoint`) |
| `POST /api/push/test` | Lähettää testi-ilmoituksen tallennettuun tilaukseen (`endpoint`) |
| `GET /api/launches` | 5 seuraavaa laukaisua |
| `GET /api/sky?lat&lon&at` | Taivaankartta hetkelle |

## Seuraavat askeleet

Suunnitellut ominaisuudet ja parannukset ovat [repon issueissa](https://github.com/DesmondX80/omaavaruus/issues).
