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

- **Avaruussää**: Kp-indeksi (NOAA SWPC) pylväskaaviona kahden vuorokauden havainnoista ja ennusteesta, G-asteikko, aurinkotuulen nopeus ja Bz.
- **Revontuliarvio**: NOAA:n OVATION Prime -malli (todennäköisyys paikan yläpuolella ja 500 km säteellä) lähimmälle tunnille, sen jälkeen Kp-ennuste ja leveysaste. Arviosta vähennetään pilvisyys (FMI, varalla Open-Meteo), taivaan valoisuus (Auringon korkeus) ja kuutamo. Tuntiennuste seuraaville 24 tunnille ja paras havaintoikkuna.
- **Revontuliovaali ja aurinkotuuli**: OVATION-mallin ennuste napakarttana (mantereiden ääriviivat Natural Earth 110m) ja aurinkotuulen nopeus, tiheys ja Bz vuorokauden ajalta (NOAA SWPC:n reaaliaikamittaukset, DSCOVR/ACE/IMAP).
- **Paikan valinta**: oma sijainti (selaimen paikannus) tai nimellä haettu paikka (Open-Meteo Geocoding). Haetut paikat ja valinta tallentuvat selaimen localStorageen.
- **Taivaankartta**: Aurinko, Kuu, seitsemän planeettaa ja noin 110 tähteä atsimuutti-korkeuskoordinaateissa ([astronomy-engine](https://github.com/cosinekitty/astronomy)). 16 tähtikuvion viivat ja ilmansuunnat horisontin reunalla. Kohteen napautus näyttää sen nousu- ja laskuajan sekä korkeimman kohdan. Aikaslider ±12 h.
- **ISS-ylilennot**: aseman sijainti ja näkyvät ylilennot viideksi vuorokaudeksi valitulle paikalle (CelesTrakin ratatiedot, SGP4 [satellite.js](https://github.com/shashwatak/satellite-js):llä). Näkyvyys vaatii, että asema on auringonvalossa ja taivas hämärä. Asema näkyy myös taivaankartalla, ja näkyvästä ylilennosta voi saada push-ilmoituksen.
- **Taivaan tapahtumat**: seuraavan vuoden meteoriparvet (staattinen luettelo), kuun- ja auringonpimennykset sekä planeettojen konjunktiot astronomy-enginellä laskettuna. Jokaiselle tapahtumalle arvioidaan näkyvyys valitulta paikalta ja paras havaintohetki.
- **Asennettava (PWA)**: sovelluksen voi lisätä puhelimen kotinäytölle. Service worker pitää sovelluksen ja viimeksi haetut tiedot saatavilla ilman verkkoa ja kertoo, milloin näytettävät tiedot on haettu.
- **Revontuli-ilmoitukset**: push-ilmoitus puhelimeen, kun revontuliarvio valitussa paikassa on vähintään käyttäjän valitsemalla rajalla. Worker tarkistaa tilanteen 15 minuutin välein (Cron Trigger) ja säilyttää tilaukset Workers KV:ssä.
- **Laukaisut**: RocketLaunch.Live, seuraavat laukaisut ja lähtölaskenta sekä linkki laukaisun sivulle, josta löytyy suoratoisto. Suosikkitoimijat (tallennetaan selaimeen) korostetaan, listan voi rajata niihin ja niiden laukaisuista voi saada push-ilmoituksen noin tuntia ennen.

## Rakenne

```
worker/
  wrangler.toml      # Workerin asetukset, oletuspaikka, CORS-originit
  src/
    index.ts         # reititys, parametrien tarkistus, CORS
    http.ts          # välimuisti (isolaatti + datakeskuksen Cache API), fetch + SWPC-muodon normalisointi
    spaceweather.ts  # NOAA SWPC: Kp, aurinkotuuli ja revontuliarvio
    ovation.ts       # OVATION Prime -revontulimalli (SWPC) ja kartan ruudukko
    solarwind.ts     # aurinkotuulen reaaliaikamittaukset (SWPC RTSW)
    clouds.ts        # pilvisyysennuste (FMI, varalla Open-Meteo)
    geocode.ts       # paikannimihaku (Open-Meteo Geocoding)
    push.ts          # ilmoitustilaukset (KV) ja ajastettu tarkistus (revontulet, laukaisut, ISS)
    webpush.ts       # push-viestin salaus (RFC 8291) ja VAPID-tunniste (RFC 8292)
    launches.ts      # RocketLaunch.Live + uudelleenyrityksen odotus
    iss.ts           # ISS: ratatiedot (CelesTrak), sijainti ja ylilennot (satellite.js)
    events.ts        # tapahtumakalenteri: meteoriparvet, pimennykset, konjunktiot
    sky.ts           # astronomy-engine + tähdet ja tähtikuvioiden viivat (stars.ts)
  test/              # vitest: API sekä frontendin tiedostolistojen ja tuontien tarkistus
frontend/
  index.html, styles.css, config.js (API-osoite)
  manifest.webmanifest, icons/   # PWA-manifesti ja kuvakkeet (icon.svg on lähde, PNG:t siitä piirrettyjä)
  sw.js              # service worker: verkko ensin, ilman verkkoa välimuisti
  js/                # ES-moduulit ilman käännösvaihetta
    main.js          # käynnistys ja ajastukset
    core.js          # jaettu tila, API-kutsut, apufunktiot
    weather.js, solarwind.js, land.js, sky.js, skychart.js, iss.js, events.js, places.js, push.js, launches.js, info.js
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
| `GET /api/health` | Terveystarkistus; `shared_cache` kertoo, toimiiko jaettu välimuisti |
| `GET /api/config` | Oletuskoordinaatit |
| `GET /api/spaceweather?lat&lon` | Kp-historia ja -ennuste, aurinkotuuli, OVATION-todennäköisyys (`ovation`), revontuliarvio nyt ja tunneittain (`hourly`, `best_window`) |
| `GET /api/solarwind` | Aurinkotuulen nopeus, tiheys, Bz ja Bt 10 minuutin keskiarvoina viimeisen vuorokauden ajalta |
| `GET /api/ovation?lat` | OVATION-ennuste havaitsijan pallonpuoliskolta leveysasteelta 40° navalle |
| `GET /api/geocode?q=Rovaniemi` | Paikannimihaku, enintään 5 osumaa |
| `GET /api/push/key` | Ilmoitusten julkinen VAPID-avain |
| `POST /api/push/subscribe` | Tallentaa tai päivittää ilmoitustilauksen (`subscription`, `lat`, `lon`, `place`, `threshold`, valinnaiset `launch_providers` ja `iss`) |
| `POST /api/push/unsubscribe` | Poistaa tilauksen (`endpoint`) |
| `POST /api/push/test` | Lähettää testi-ilmoituksen tallennettuun tilaukseen (`endpoint`) |
| `GET /api/iss?lat&lon` | ISS:n sijainti ja ylilennot viideksi vuorokaudeksi, näkyvät merkittyinä |
| `GET /api/events?lat&lon` | Seuraavan vuoden meteoriparvet, pimennykset ja konjunktiot sekä niiden näkyvyys paikalta |
| `GET /api/launches` | 5 seuraavaa laukaisua |
| `GET /api/sky?lat&lon&at` | Taivaankartta hetkelle |
| `GET /api/sky/object?name&lat&lon&at` | Yhden kohteen paikka sekä seuraava nousu, lasku ja korkein kohta (`name=ISS`: seuraava ylilento) |

## Seuraavat askeleet

Suunnitellut ominaisuudet ja parannukset ovat [repon issueissa](https://github.com/DesmondX80/omaavaruus/issues).
