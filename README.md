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

Käyttöliittymässä on viisi näkymää (puhelimessa alapalkissa, leveällä näytöllä vasemmassa reunassa): **Nyt** kokoaa illan
revontuliarvion, lähimmät tapahtumat ja taivaan tilanteen, ja **Revontulet**, **Taivas**, **ISS** ja **Kalenteri** näyttävät
yksityiskohdat. Paikan valinta ja kaikki ilmoitusasetukset avautuvat yläpalkista. Näkymän voi avata suoraan osoitteella
(`#nyt`, `#revontulet`, `#taivas`, `#iss`, `#kalenteri`).

- **Avaruussää**: Kp-indeksi (NOAA SWPC) pylväskaaviona kahden vuorokauden havainnoista ja ennusteesta, G-asteikko, aurinkotuulen nopeus ja Bz.
- **Revontuliarvio**: NOAA:n OVATION Prime -malli (todennäköisyys paikan yläpuolella ja 500 km säteellä) lähimmälle tunnille, sen jälkeen Kp-ennuste ja leveysaste. Arviosta vähennetään pilvisyys (FMI, varalla Open-Meteo), taivaan valoisuus (Auringon korkeus) ja kuutamo. Tuntiennuste seuraaville 24 tunnille ja paras havaintoikkuna. Viime öiden historia lasketaan jälkikäteen havaituista Kp-arvoista ja toteutuneesta pilvisyydestä (Open-Meteo).
- **Revontulikamerat**: valittua paikkaa lähimmät julkiset all-sky-kamerat (Ilmatieteen laitos, Sodankylän geofysiikan observatorio, Jyväskylän Sirius ry, Aalto-yliopisto, IRF Kiruna) etäisyyksineen ja suuntineen; linkki avaa kameran ylläpitäjän sivun.
- **Auringon tilanne**: Maahan suuntautuvien koronan massapurkausten (CME) arvioidut saapumisajat ja Kp-arviot NASA:n DONKI-palvelusta (WSA-Enlil-malli) sekä viimeaikaiset M- ja X-luokan röntgenpurkaukset (NOAA SWPC, GOES). Lähipäivinä saapuva CME näkyy myös Nyt-näkymän yhteenvedossa.
- **Revontuliovaali ja aurinkotuuli**: OVATION-mallin ennuste napakarttana (mantereiden ääriviivat Natural Earth 110m) ja aurinkotuulen nopeus, tiheys ja Bz vuorokauden ajalta (NOAA SWPC:n reaaliaikamittaukset, DSCOVR/ACE/IMAP).
- **Paikan valinta**: oma sijainti (selaimen paikannus) tai nimellä haettu paikka (Open-Meteo Geocoding). Haetut paikat ja valinta tallentuvat selaimen localStorageen.
- **Taivaankartta**: Aurinko, Kuu, seitsemän planeettaa ja noin 110 tähteä atsimuutti-korkeuskoordinaateissa ([astronomy-engine](https://github.com/cosinekitty/astronomy)). 16 tähtikuvion viivat ja ilmansuunnat horisontin reunalla. Kohteen napautus näyttää sen nousu- ja laskuajan sekä korkeimman kohdan. Aikaslider ±12 h. Koko näytön tilassa on lisäksi perspektiivinäkymä, jota käännetään sormella tai puhelimen asentoantureilla (DeviceOrientation), ja taustalle voi ottaa takakameran kuvan.
- **Aurinkokunta**: kahdeksan planeettaa kiertoradoillaan ylhäältä katsottuna oikeassa mittakaavassa. Kartta kulkee oikeassa ajassa, ja aikajanalla voi siirtyä ±10 vuotta tai toistaa liikettä valitulla nopeudella. Karttaa zoomataan ja siirretään eleillä tai painikkeilla, ja napautettua planeettaa seurataan (etäisyys Auringosta ja Maasta, valon kulkuaika). Sijainnit lasketaan selaimessa JPL:n Keplerin rata-alkioista, joten palvelinta ei kuormiteta.
- **Avaruuslento** (`#lento`, Aurinkokunta-kortin painike ”Lähde lennolle”): peli, jossa lähdetään Maan kiertoradalta raketilla muille planeetoille. Sovellus hakee seuraavan kahden vuoden laukaisuikkunat Lambertin ratkaisuilla ja näyttää halvimman ja nopeammat siirtoradat Δv-kustannuksineen. Laukaisun jälkeen lentonäkymässä on lentoaika (T+), kalenteripäivä, nopeus Auringon ja lähimmän planeetan suhteen, etäisyys kohteeseen, valon kulkuaika Maahan sekä kartta, jolle on piirretty raketti, kuljettu reitti ja tuleva rata. Aikaa voi kiihdyttää 1×:stä vuoteen sekunnissa, ja kiihdytys pienenee itsestään ennen vaikutuspiirin rajaa ja saapumista. Pelin kello kulkee oikeassa ajassa myös sovelluksen ollessa kiinni, ja tila tallentuu selaimeen.
  - **Tutkiminen ja lokikirja**: perillä jarrutetaan kiertoradalle (jos polttoaine ei riitä, alus ohittaa planeetan ja jää Auringon kiertoradalle). Planeetan tietokortissa ovat koko, massa, painovoima, päivän ja vuoden pituus, lämpötila, kaasukehä ja kuut. Vuorokauden kartoituksen jälkeen planeetta on tutkittu, sen faktat paljastuvat ja polttoaine täydennetään. Lokikirjassa ovat lennot, tutkitut planeetat (x/8), kokonaislentoaika, kuljettu matka ja huippunopeus.
  - **Kurssikorjaukset**: lennon aikana moottoria voi polttaa eteen, taakse, sisään tai ulos (10 m/s–1 km/s). Ennuste kertoo ennen polttoa, osuuko alus kohteen vaikutuspiiriin vai ohittaako se kohteen, ja uusi rata näkyy kartalla. Automaattinen korjaus laskee reitin takaisin kohteeseen.
  - **Linkous, kuut ja alukset**: reittihaku ehdottaa myös yhden painovoimalinkouksen reittejä (esim. Maa → Venus → Merkurius), kun ne ovat suoraa lentoa halvempia tai nopeampia. Kohteina ovat myös Kuu, Phobos, Io, Europa, Ganymedes, Titan, Enceladus ja Triton, joihin lennetään emoplaneetan kiertoradalta, ja niillä on omat tietokorttinsa. Maan kiertoradalla voi vaihtaa alusta: kemiallinen raketti (14 km/s), ydinlämpöraketti (22 km/s, vetyä vain Maasta ja kaasujättiläisiltä) tai ionialus (45 km/s, mutta lähtö ja jarrutus ovat kuukausien spiraaleja).
  - **3D-ohjaamo**: lentoa voi seurata aluksen ikkunasta (WebGL, [three.js](https://threejs.org/) 0.170.0, MIT-lisenssi, tallennettu hakemistoon `frontend/js/vendor/`; ladataan vasta, kun ohjaamo avataan). Tähdet ovat oikeissa suunnissa (kirkkaat tähdet samasta luettelosta kuin taivaankartassa, himmeä tausta tihenee Linnunradan tasoa kohti), ja Aurinko ja planeetat ovat oikeassa suunnassa ja näennäisessä koossa. Ohjaamossa on kaareva kuomun kehys vinotukineen ja ristikkotukineen kulunutta metallia, keskikonsoli kolmella päänäytöllä (lentoaika, nopeus, etäisyys ja polttoaine), sivuilla koneistosylinterit ja kaapeliniput, käsinojissa ohjainsauva ja tehovipu sekä yläkulmissa kaksi kattonäyttöä: navigointinäyttö piirtää planeetat, aluksen ja suunnan kohteeseen oikeista sijainneista, ja järjestelmänäyttö näyttää polttoaineen ja aikakiihdytyksen. Auringonvalo tulee ohjaamoon ikkunoista oikeasta suunnasta, ja kehys ja tuet heittävät varjonsa (varjokartta); lähellä oleva planeetta tai kuu valaisee ohjaamoa omalla värillään, ja valo himmenee kauempana Auringosta. Planeetan tai kuun varjossa auringonvalo sammuu sen mukaan, kuinka suuren osan Auringon kiekosta kappale peittää. Sisätila rakennetaan koodissa (`js/cabin.js`) perusmuodoista ja piirretyistä tekstuureista, joten mallitiedostoja ei ole. Katsetta käännetään raahaamalla tai asentoantureilla. Planeettojen ja kuiden pinnat ovat luotainkuvista koottuja karttoja (`frontend/textures/`, ks. [Tekstuurien lähteet](#tekstuurien-lähteet)), jotka haetaan vasta, kun kohde näkyy kiekkona, ja lähellä kohdetta tilalle vaihtuu tarkempi 4k- tai 8k-kartta. Siihen asti ja ilman verkkoa näkyy selaimessa piirretty tyylitelty pinta (Maan mantereet Natural Earth 110m, public domain). Titan on piirretty, koska sen pinta on utukerroksen peitossa. Jos WebGL ei toimi, näytetään kartta.
  - **Leveä näyttö**: vähintään 1000 pikselin levyisessä ikkunassa ohjaamo tai kartta täyttää koko ikkunan ja ohjaimet ovat oikean reunan paneelissa. Yläpalkin painike vie pelin selaimen koko näytön tilaan. Paneelin voi piilottaa yläpalkin painikkeesta, jolloin se liukuu oikealle ja näkymä levenee koko ikkunaan; valinta tallentuu selaimeen.
- **ISS-ylilennot**: ISS:n ja Kiinan Tiangong-aseman sijainti ja näkyvät ylilennot viideksi vuorokaudeksi valitulle paikalle (CelesTrakin ratatiedot, SGP4 [satellite.js](https://github.com/shashwatak/satellite-js):llä). Näkyvyys vaatii, että asema on auringonvalossa ja taivas hämärä. Lähimpien kolmen vuorokauden ylilennoille ja tapahtumille näytetään pilvisyysennuste. Pyöritettävä ja zoomattava maapallokartta näyttää aseman sijainnin ja radan nyt tai valitun ylilennon reitin havaintopaikan ympäristössä, ja sen saa myös koko näytölle. Asema näkyy myös taivaankartalla, jolle seuraava näkyvä ylilento piirretään kaarena, ja näkyvästä ylilennosta voi saada push-ilmoituksen.
- **Taivaan tapahtumat**: seuraavan vuoden meteoriparvet (staattinen luettelo), kuun- ja auringonpimennykset sekä planeettojen konjunktiot astronomy-enginellä laskettuna. Jokaiselle tapahtumalle arvioidaan näkyvyys valitulta paikalta ja paras havaintohetki. Kalenterissa ovat myös Kuun vaiheet ja kuuttomat yöt.
- **Yövalaistus**: yläpalkin silmäpainike muuttaa koko näytön punaiseksi ja himmeäksi, jotta pimeänäkö säilyy ulkona. Kattaa myös kartat ja kamerakuvan.
- **Asennettava (PWA)**: sovelluksen voi lisätä puhelimen kotinäytölle. Service worker pitää sovelluksen ja viimeksi haetut tiedot saatavilla ilman verkkoa ja kertoo, milloin näytettävät tiedot on haettu.
- **Revontuli-ilmoitukset**: push-ilmoitus puhelimeen, kun revontuliarvio valitussa paikassa on vähintään käyttäjän valitsemalla rajalla. Worker tarkistaa tilanteen 15 minuutin välein (Cron Trigger) ja säilyttää tilaukset Workers KV:ssä.
- **Laukaisut**: RocketLaunch.Live, seuraavat laukaisut ja lähtölaskenta sekä linkki laukaisun sivulle, josta löytyy suoratoisto. Laukaisut näkyvät kalenterissa taivaan tapahtumien kanssa samalla aikajanalla. Suosikkitoimijat (tallennetaan selaimeen) merkitään tähdellä, kalenterin voi rajata niihin ja niiden laukaisuista voi saada push-ilmoituksen noin tuntia ennen.

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
    moon.ts          # Kuun vaiheet ja kuuttomat yöt (oma reitti CPU-ajan vuoksi)
    history.ts       # revontulihistoria viime öiltä (lasketaan, ei tallenneta)
    sun.ts           # Auringon tilanne: purkaukset (NOAA) ja Maahan osuvat CME:t (NASA DONKI)
    sky.ts           # astronomy-engine + tähdet ja tähtikuvioiden viivat (stars.ts)
  test/              # vitest: API sekä frontendin tiedostolistojen ja tuontien tarkistus
frontend/
  index.html, styles.css, config.js (API-osoite)
  manifest.webmanifest, icons/   # PWA-manifesti ja kuvakkeet (icon.svg on lähde, PNG:t siitä piirrettyjä)
  sw.js              # service worker: verkko ensin, ilman verkkoa välimuisti
  textures/          # Avaruuslennon planeettojen ja kuiden pintakartat (WebP, lähteet alla)
  js/                # ES-moduulit ilman käännösvaihetta
    main.js          # käynnistys ja ajastukset
    core.js          # jaettu tila, API-kutsut, haettujen tietojen välitys näkymille, apufunktiot
    nav.js           # näkymien vaihto osoitteen #-osan mukaan
    sheets.js        # alhaalta nouseva paneeli: paikka, ilmoitukset, selitykset
    now.js           # Nyt-kooste muiden näkymien tiedoista
    calendar.js      # taivaan tapahtumat ja laukaisut samalla aikajanalla
    weather.js, solarwind.js, land.js, sky.js, skychart.js, skyview.js, iss.js, issmap.js, events.js, launches.js, places.js, push.js, info.js
```

## Tekstuurien lähteet

Avaruuslennon ohjaamon pintakartat ovat hakemistossa `frontend/textures/` (tasavälinen lieriöprojektio, WebP, yhteensä noin 41 Mt). Jokaisesta kohteesta on peruskartta (enintään 2048 × 1024). Lisäksi on tarkat kartat, jotka haetaan vasta, kun kohde täyttää suuren osan ikkunasta: 8k (8192 × 4096) ja 4k Merkuriuksesta, Maasta, Marsista, Kuusta, Iosta, Europasta, Ganymedeestä ja Enceladuksesta sekä 4k Venuksesta, Jupiterista, Saturnuksesta, Phoboksesta ja Tritonista (näistä ei ole tarkempaa lähdettä tai lähteen tarkkuus ei riitä 8k:hon). 8k-karttaa käytetään vain tietokoneella; kosketusnäyttölaitteet ja heikommat näytönohjaimet saavat 4k-kartan.

| Kohde | Lähde | Lisenssi |
| --- | --- | --- |
| Merkurius, Venus (pilvikerros), Maa, Mars, Jupiter, Saturnus ja renkaat, Uranus, Neptunus, Kuu | [Solar System Scope](https://www.solarsystemscope.com/textures/), NASAn aineistoon perustuvat kartat. Maan karttaan on yhdistetty saman lähteen pilvikartta. | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Phobos | Viking-luotainten mosaiikki, NASA/JPL/USGS ([Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Phobos_Viking_Mosaic_DLRcontrol_7200.jpg)); sävytetty ruskeanharmaaksi | public domain |
| Io | Galileo- ja Voyager-luotainten värimosaiikki (Io GalileoSSI-Voyager Global Mosaic ClrMerge 1km), [USGS Astrogeology](https://astrogeology.usgs.gov/search/map/io_galileo_ssi_voyager_color_merged_global_mosaic_1km) | public domain |
| Europa | Seek9750: Moon Europa color map ([Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Moon_Europa_color_map.jpg)), NASAn kuvista | CC0 |
| Ganymedes | Björn Jónsson: Map of Ganymede, NASAn kuvista ([Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Map_of_Ganymede_by_Bj%C3%B6rn_J%C3%B3nsson.jpg)). Tarkoissa kartoissa värit ovat tästä kartasta ja hienot yksityiskohdat USGS:n Voyager- ja Galileo-mosaiikin kirkkaudesta ([USGS Astrogeology](https://astrogeology.usgs.gov/search/map/ganymede_voyager_galileo_ssi_global_color_mosaic_1435m)) | vapaa käyttö, tekijä mainittava; USGS public domain |
| Enceladus | Cassini-luotaimen värikartta PIA18435, NASA/JPL-Caltech/SSI/LPI ([Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Enceladus_Color_Map.jpg)) | public domain |
| Triton | Voyager 2:n värikartta PIA18668, NASA/JPL-Caltech/LPI ([Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Triton_Map.jpg)). Voyager kuvasi vain osan pinnasta: kuvaamaton pohjoinen alue on täytetty ympäristön sumennetulla värillä, ja tehostettuja värejä on haalistettu. | public domain |

## Julkaisu

Push `main`-haaraan julkaisee muutokset automaattisesti:

- `worker.yml` ajaa testit ja julkaisee Workerin (secretit `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`; token pohjalla *Edit Cloudflare Workers*).
- `pages.yml` julkaisee `frontend/`-hakemiston GitHub Pagesiin, kirjoittaa repon
  muuttujan `OMAVARUUS_API` (Workerin osoite) `config.js`:ään ja asettaa commitin
  tunnisteen service workerin versioksi (`sw.js`).

CME-ennusteet haetaan NASA:n API:sta. Ilman omaa avainta käytetään julkista `DEMO_KEY`-avainta, jonka kiintiö on pieni (noin 10 kutsua tunnissa IP-osoitetta kohden); oman maksuttoman avaimen saa osoitteesta https://api.nasa.gov, ja se asetetaan komennolla `npx wrangler secret put NASA_API_KEY` (hakemistossa `worker/`).

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
| `GET /api/iss?lat&lon&sat` | Avaruusaseman (`sat=iss` oletuksena, `sat=css` Tiangong) sijainti ja ylilennot viideksi vuorokaudeksi, näkyvät merkittyinä, reitteineen (`track`) ja ratoineen taivaalla (`sky_track`), sekä aseman rata seuraavan kierroksen ajalta (`orbit`); näkyvillä ylilennoilla pilvisyysennuste (`cloud_cover`, kolme vuorokautta eteenpäin) |
| `GET /api/events?lat&lon`, `/api/events/conjunctions`, `/api/events/solar` | Kalenteri kolmessa osassa (meteoriparvet ja kuunpimennykset, planeettojen konjunktiot, auringonpimennykset), jotta kukin pyyntö mahtuu ilmaistason CPU-budjettiin: seuraavan vuoden meteoriparvet, pimennykset ja konjunktiot sekä niiden näkyvyys paikalta ja pilvisyysennuste parhaalle hetkelle (`cloud_cover`, kolme vuorokautta eteenpäin) |
| `GET /api/sun` | Maahan osuvat CME:t (`cmes`: saapuminen, sivuosuma, Kp-arvio, lähtö ja nopeus) ja M- ja X-luokan purkaukset kolmelta vuorokaudelta (`flares`) |
| `GET /api/aurora/history?lat&lon` | Revontulihistoria seitsemältä viime yöltä: yön suurin havaittu Kp, pimeän ajan pilvisyys ja jälkikäteen laskettu paras arvio |
| `GET /api/moon?lat&lon` | Kuun neljännekset neljäksi kuukaudeksi ja kuuttomat yöt (Kuu horisontin alla koko pimeän ajan) kahdeksi viikoksi |
| `GET /api/launches` | 5 seuraavaa laukaisua |
| `GET /api/sky?lat&lon&at` | Taivaankartta hetkelle |
| `GET /api/sky/object?name&lat&lon&at` | Yhden kohteen paikka sekä seuraava nousu, lasku ja korkein kohta (`name=ISS`: seuraava ylilento) |

## Seuraavat askeleet

Suunnitellut ominaisuudet ja parannukset ovat [repon issueissa](https://github.com/DesmondX80/omaavaruus/issues).
