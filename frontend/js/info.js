// ⓘ-painikkeet ja niiden selitystekstit.
const INFO = {
  kp: ['Kp-indeksi', 'Kp kuvaa maapallon magneettikentän häiriöisyyttä asteikolla 0–9. Mitä suurempi luku, sitä voimakkaampi geomagneettinen myrsky ja sitä etelämpänä revontulia voi nähdä. Lapissa revontulia voi näkyä jo Kp 1–2:lla, Etelä-Suomessa tarvitaan yleensä vähintään Kp 4–5. Arvo on NOAA:n laskema kolmen tunnin arvo, ja käyrä näyttää viimeiset 72 tuntia.'],
  g: ['G-asteikko', 'NOAA:n asteikko geomagneettisten myrskyjen voimakkuudelle. G1 (heikko) vastaa Kp 5:tä, G2 Kp 6:ta, G3 Kp 7:ää, G4 Kp 8:aa ja G5 (äärimmäinen) Kp 9:ää. Alle Kp 5 on rauhallista.'],
  ovation: ['OVATION', 'NOAA:n OVATION Prime -malli laskee aurinkotuulen mittauksista revontulien todennäköisyyden noin tunnin päähän. “Yläpuolella” on todennäköisyys suoraan paikan kohdalla, “lähistöllä” suurin todennäköisyys 500 km säteellä, josta revontulet voivat näkyä horisontin yläpuolella. Arvio: yläpuolella vähintään 5 % on mahdollinen, 15 % hyvä ja 35 % erittäin hyvä; lähistön todennäköisyys antaa porrasta heikomman arvion. Malli kattaa vain lähimmän tunnin, joten myöhemmät tunnit arvioidaan Kp-ennusteesta. Pilvisyys, valoisuus ja kuutamo vähennetään arviosta erikseen.'],
  kpOnly: ['Kp yksin', 'Revontuliarvio pelkän Kp-indeksin ja leveysasteen perusteella, ennen kuin pilvisyys, valoisuus ja kuutamo otetaan huomioon. Kun OVATION-malli on saatavilla, nykyhetken arvio perustuu siihen ja tämä rivi on vertailuksi.'],
  light: ['Valoisuus', 'Revontulet näkyvät vain riittävän pimeällä taivaalla. Kun Aurinko on alle 6° horisontin alapuolella, on liian valoisaa. Hämärässä (Aurinko 6–12° horisontin alapuolella) arvio laskee yhden portaan, ja sitä syvemmällä on pimeää. Kirkas kuutamo (Kuu ylhäällä ja vähintään puoliksi valaistu) himmentää heikkoja revontulia ja laskee arviota yhden portaan.'],
  hourly: ['Tuntiennuste', 'Revontuliarvio tunneittain: mitä kirkkaampi vihreä, sitä parempi. Arviossa yhdistyvät NOAA:n OVATION-malli lähimmälle tunnille ja sen jälkeen Kp-ennuste (kolmen tunnin jaksoissa), pilvisyysennuste, taivaan valoisuus ja kuutamo. Katkoviivalla merkityt tunnit ovat liian valoisia. Liu’uta sormea palkilla nähdäksesi kunkin tunnin tarkemmat tiedot.'],
  push: ['Ilmoitukset', 'Palvelin tarkistaa revontuliarvion 15 minuutin välein ja lähettää ilmoituksen, kun arvio on vähintään valitsemallasi rajalla. Samasta tilanteesta ilmoitetaan enintään kerran kuudessa tunnissa, ellei arvio parane. Ilmoitukset koskevat paikkaa, joka oli valittuna, kun otit ne käyttöön. Palvelimelle tallennetaan selaimen ilmoitusosoite ja paikan sijainti noin 10 kilometrin tarkkuudella; ne poistetaan, kun poistat ilmoitukset käytöstä.'],
  clouds: ['Pilvisyys', 'Kokonaispilvisyys prosentteina: 0 % on täysin selkeää ja 100 % täysin pilvistä. ± kertoo, kuinka tarkasti laitteesi paikansi sijaintisi metreinä. Pilvisyys yli 30 % heikentää revontuliarviota ja yli 90 % estää näkyvyyden.'],
  wind: ['Aurinkotuuli', 'Auringosta virtaavien sähköisesti varattujen hiukkasten nopeus kilometreinä sekunnissa (km/s). Tavallisesti noin 300–500 km/s. Yli 500–600 km/s tehostaa revontulia, varsinkin jos Bz on negatiivinen.'],
  bz: ['Bz', 'Aurinkotuulen mukana kulkevan magneettikentän pohjois–eteläsuuntainen komponentti. Kun Bz on negatiivinen (etelään päin), energiaa pääsee helpommin maapallon magneettikenttään ja revontulien todennäköisyys kasvaa. Yksikkö nT on nanotesla, magneettikentän voimakkuuden yksikkö.'],
  oval: ['Revontuliovaali', 'Kartta näyttää NOAA:n OVATION-mallin ennusteen revontulien todennäköisyydestä noin tunnin päähän. Revontulet syntyvät napojen ympärille renkaaksi, ovaaliksi, joka laajenee etelämmäs magneettisen myrskyn voimistuessa. Kartan keskellä on napa ja reunalla 40. leveyspiiri, katkoviivat ovat 50°, 60°, 70° ja 80° leveyspiirit. Valitun paikan pituuspiiri osoittaa alas. Paikan ympärillä oleva katkoviiva on noin 500 km säde, jonka sisällä olevat revontulet voivat näkyä horisontin yläpuolella. Malli ei huomioi pilviä eikä taivaan valoisuutta.'],
  density: ['Tiheys', 'Aurinkotuulen protonien määrä kuutiosenttimetrissä (p/cm³). Tavallisesti noin 2–10. Tiheyden äkillinen nousu yhdessä nopeuden kasvun kanssa kertoo usein Auringosta tulleen purkauksen (CME) tai nopean virran rintaman saapumisesta, mikä voi voimistaa revontulia.'],
  sky: ['Asteet', 'Kohteen perässä oleva luku on sen korkeus horisontin yläpuolella asteina: 0° on horisontissa ja 90° suoraan yläpuolella. Listassa näkyvät horisontin yläpuolella olevat Aurinko, Kuu ja planeetat. Kartan reunalla ovat ilmansuunnat (P pohjoinen, I itä, E etelä, L länsi) ja viivat yhdistävät tähtikuvioiden tähdet. Napauta kohdetta kartalla tai listassa, niin näet sen nousu- ja laskuajan sekä ajan, jolloin se on korkeimmillaan.'],
  events: ['Tapahtumat', 'Seuraavan vuoden meteoriparvet, kuun- ja auringonpimennykset sekä planeettojen kohtaamiset eli konjunktiot. Näkyvyys on laskettu valitulle paikalle: meteoriparvelle tarvitaan pimeä taivas ja riittävän korkealla oleva säteilypiste eli taivaan kohta, josta meteorit näyttävät tulevan. Meteorimäärä on ZHR-luku eli tuntimäärä ihanneoloissa; todellisuudessa meteoreja näkyy vähemmän. Sää ei ole mukana arviossa.'],
  launch: ['T− ja LIVE', 'T− tarkoittaa aikaa laukaisuun (T = laukaisuhetki), esimerkiksi T−2 h 5 min. Laukaisuajat tarkentuvat usein viime hetkillä. PÄIVITTYVÄ-merkki kertoo, että lista päivittyy automaattisesti. Tähdellä voit merkitä toimijan suosikiksi: suosikkien laukaisut korostetaan, listan voi rajata niihin ja niistä voi saada ilmoituksen noin tuntia ennen laukaisua. Seurantalinkki avaa RocketLaunch.Liven sivun, jolta löytyy myös suoratoisto, kun se on saatavilla.'],
};
export function infoBtn(key) {
  const b=document.createElement('button');
  b.type='button'; b.className='info-btn'; b.dataset.info=key; b.textContent='i';
  b.setAttribute('aria-label',`Mitä ${INFO[key][0]} tarkoittaa?`); b.setAttribute('aria-expanded','false');
  return b;
}
export function line(...parts) {
  const d=document.createElement('div'); d.className='info-host';
  parts.forEach((p,i)=>{if(i) d.append(' '); d.append(p);});
  return d;
}
export function initInfo() {
  document.querySelectorAll('[data-info-slot]').forEach(n=>n.append(infoBtn(n.dataset.infoSlot)));
  // Selitys avautuu sen rivin alle, jolla painike on; toinen painallus sulkee sen.
  document.addEventListener('click',e=>{
    const b=e.target.closest('.info-btn'); if(!b) return;
    const host=b.closest('.info-host'), open=host.nextElementSibling?.classList.contains('info-text')&&host.nextElementSibling.dataset.info===b.dataset.info;
    if(host.nextElementSibling?.classList.contains('info-text')) host.nextElementSibling.remove();
    host.querySelectorAll('.info-btn').forEach(x=>x.setAttribute('aria-expanded','false'));
    if(open) return;
    const [title,text]=INFO[b.dataset.info], box=document.createElement('div');
    box.className='info-text'; box.dataset.info=b.dataset.info; box.setAttribute('role','note');
    const t=document.createElement('b'); t.textContent=title; box.append(t,' ',text);
    host.after(box); b.setAttribute('aria-expanded','true');
  });
}
