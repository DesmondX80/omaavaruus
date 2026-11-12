// ⓘ-painikkeet ja niiden selitystekstit.
const INFO = {
  kp: ['Kp-indeksi', 'Kp kuvaa maapallon magneettikentän häiriöisyyttä asteikolla 0–9. Mitä suurempi luku, sitä voimakkaampi geomagneettinen myrsky ja sitä etelämpänä revontulia voi nähdä. Lapissa revontulia voi näkyä jo Kp 1–2:lla, Etelä-Suomessa tarvitaan yleensä vähintään Kp 4–5. Arvo on NOAA:n laskema kolmen tunnin arvo, ja käyrä näyttää viimeiset 72 tuntia.'],
  g: ['G-asteikko', 'NOAA:n asteikko geomagneettisten myrskyjen voimakkuudelle. G1 (heikko) vastaa Kp 5:tä, G2 Kp 6:ta, G3 Kp 7:ää, G4 Kp 8:aa ja G5 (äärimmäinen) Kp 9:ää. Alle Kp 5 on rauhallista.'],
  kpOnly: ['Kp yksin', 'Revontuliarvio pelkän Kp-indeksin ja leveysasteen perusteella, ennen kuin pilvisyys, valoisuus ja kuutamo otetaan huomioon. Kertoo, kannattaisiko revontulia odottaa selkeällä ja pimeällä säällä.'],
  light: ['Valoisuus', 'Revontulet näkyvät vain riittävän pimeällä taivaalla. Kun Aurinko on alle 6° horisontin alapuolella, on liian valoisaa. Hämärässä (Aurinko 6–12° horisontin alapuolella) arvio laskee yhden portaan, ja sitä syvemmällä on pimeää. Kirkas kuutamo (Kuu ylhäällä ja vähintään puoliksi valaistu) himmentää heikkoja revontulia ja laskee arviota yhden portaan.'],
  hourly: ['Tuntiennuste', 'Revontuliarvio tunneittain: mitä kirkkaampi vihreä, sitä parempi. Arviossa yhdistyvät NOAA:n Kp-ennuste (kolmen tunnin jaksoissa), pilvisyysennuste, taivaan valoisuus ja kuutamo. Katkoviivalla merkityt tunnit ovat liian valoisia. Napauta tuntia nähdäksesi tarkemmat tiedot.'],
  clouds: ['Pilvisyys', 'Kokonaispilvisyys prosentteina: 0 % on täysin selkeää ja 100 % täysin pilvistä. ± kertoo, kuinka tarkasti laitteesi paikansi sijaintisi metreinä. Pilvisyys yli 30 % heikentää revontuliarviota ja yli 90 % estää näkyvyyden.'],
  wind: ['Aurinkotuuli', 'Auringosta virtaavien sähköisesti varattujen hiukkasten nopeus kilometreinä sekunnissa (km/s). Tavallisesti noin 300–500 km/s. Yli 500–600 km/s tehostaa revontulia, varsinkin jos Bz on negatiivinen.'],
  bz: ['Bz', 'Aurinkotuulen mukana kulkevan magneettikentän pohjois–eteläsuuntainen komponentti. Kun Bz on negatiivinen (etelään päin), energiaa pääsee helpommin maapallon magneettikenttään ja revontulien todennäköisyys kasvaa. Yksikkö nT on nanotesla, magneettikentän voimakkuuden yksikkö.'],
  sky: ['Asteet', 'Kohteen perässä oleva luku on sen korkeus horisontin yläpuolella asteina: 0° on horisontissa ja 90° suoraan yläpuolella. Listassa näkyvät horisontin yläpuolella olevat Aurinko, Kuu ja planeetat.'],
  launch: ['T− ja LIVE', 'T− tarkoittaa aikaa laukaisuun (T = laukaisuhetki), esimerkiksi T−2 h 5 min. Laukaisuajat tarkentuvat usein viime hetkillä. PÄIVITTYVÄ-merkki kertoo, että lista päivittyy automaattisesti.'],
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
