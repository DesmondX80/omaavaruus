const state = {lat:65.0121, lon:25.4651, accuracy:null, offset:0, hour:null};
const el = id => document.getElementById(id);
const API = (window.OMAVARUUS_API || "").replace(/\/$/, "");
const fmt = d => d ? new Date(d).toLocaleString('fi-FI') : 'Aika tarkentuu';
async function json(path) {
  const r = await fetch(API + path, {signal:AbortSignal.timeout(45000)});
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`);
  return body;
}
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
function infoBtn(key) {
  const b=document.createElement('button');
  b.type='button'; b.className='info-btn'; b.dataset.info=key; b.textContent='i';
  b.setAttribute('aria-label',`Mitä ${INFO[key][0]} tarkoittaa?`); b.setAttribute('aria-expanded','false');
  return b;
}
function line(...parts) {
  const d=document.createElement('div'); d.className='info-host';
  parts.forEach((p,i)=>{if(i) d.append(' '); d.append(p);});
  return d;
}
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
const hhmm=d=>new Date(d).toLocaleTimeString('fi-FI',{hour:'2-digit',minute:'2-digit'});
const num=(v,digits=0)=>v.toLocaleString('fi-FI',{maximumFractionDigits:digits});
const LEVELS=['Epätodennäköinen','Mahdollinen','Hyvä','Erittäin hyvä'];
const moonText=h=>`Kuu ${Math.round(h.moon_illumination*100)} % valaistu, ${h.moon_alt>0?'horisontin yläpuolella':'horisontin alapuolella'}`;
function hourDetail(h) {
  return [
    `Klo ${hhmm(h.time_tag)}: ${h.chance ?? 'ei Kp-ennustetta'}`,
    h.kp==null?null:`Kp ${num(h.kp,1)}`,
    h.cloud_cover==null?'pilvisyys ei tiedossa':`pilvisyys ${Math.round(h.cloud_cover)} %`,
    `${h.light.toLowerCase()} (Aurinko ${num(h.sun_alt)}°)`,
    moonText(h).replace('Kuu','kuu'),
    h.limits.length?`rajoittaa: ${h.limits.join(', ')}`:null,
  ].filter(Boolean).join(' · ');
}
function hourly(w) {
  el('hourly').hidden=!w.hourly.length;
  const b=w.best_window;
  el('best-window').textContent=b
    ? `Paras hetki: klo ${hhmm(b.start)}–${hhmm(b.end)} (${b.chance})`
    : 'Ei revontulille otollista hetkeä seuraavan 24 tunnin aikana';
  el('best-window').classList.toggle('none',!b);
  const selected=w.hourly.find(h=>h.time_tag===state.hour) ?? w.hourly.find(h=>h.time_tag===b?.start);
  el('hour-detail').textContent=selected?hourDetail(selected):'';
  el('hours').replaceChildren(...w.hourly.map(h=>{
    const btn=document.createElement('button'), bar=document.createElement('i'), label=document.createElement('small');
    const hour=new Date(h.time_tag).getHours();
    btn.type='button'; btn.className=`hour l${h.chance==null?'x':LEVELS.indexOf(h.chance)}${h.light==='Valoisaa'?' day':''}`;
    btn.setAttribute('aria-label',hourDetail(h)); btn.setAttribute('aria-pressed',String(h===selected));
    label.textContent=hour%3===0?String(hour).padStart(2,'0'):'';
    btn.append(bar,label);
    btn.addEventListener('click',()=>{
      state.hour=h.time_tag; el('hour-detail').textContent=hourDetail(h);
      el('hours').querySelectorAll('.hour').forEach(x=>x.setAttribute('aria-pressed',String(x===btn)));
    });
    return btn;
  }));
}
async function weather() {
  try {
    const w = await json(`/api/spaceweather?lat=${state.lat}&lon=${state.lon}`);
    el('kp').textContent=w.kp_now.toFixed(1);
    el('g-label').replaceChildren(w.g_label, ' ', infoBtn('g'));
    el('aurora').textContent=`Revontuliarvio: ${w.aurora_chance}${w.aurora_limits.length?` – rajoittaa: ${w.aurora_limits.join(', ')}`:''}`;
    const where=state.accuracy==null?'oletussijainnissa':`sijainnissasi (±${Math.round(state.accuracy)} m)`;
    el('clouds').replaceChildren(...(w.cloud_cover_pct==null
      ? [line('Pilvisyystietoa ei saatu – arvio perustuu vain Kp-indeksiin')]
      : [
          line(`Pilvisyys ${where}: ${w.cloud_label} (${Math.round(w.cloud_cover_pct)} %)`, infoBtn('clouds')),
          line(`Lähde: ${w.cloud_provider}`),
        ]),
      line(`Kp yksin: ${w.aurora_chance_geomagnetic}`, infoBtn('kpOnly')),
      line(`Valoisuus: ${w.light} (Aurinko ${num(w.sun_alt)}°)`, infoBtn('light')),
      line(moonText(w)),
    );
    hourly(w);
    el('wind').replaceChildren(
      line(`Aurinkotuuli: ${w.solar_wind_speed_kms ?? '–'} km/s`, infoBtn('wind')),
      line(`Bz: ${w.bz_nt ?? '–'} nT`, infoBtn('bz')),
    );
    el('alerts').replaceChildren(...w.alerts.map(t => {const li=document.createElement('li'); li.textContent=t; return li;}));
    const svg=el('kp-chart'); svg.replaceChildren(); const pts=w.kp_history;
    if(pts.length) {
      const p=document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d',pts.map((v,i)=>`${i?'L':'M'}${5+i*310/Math.max(1,pts.length-1)},${100-v.kp*10}`).join(' '));
      p.setAttribute('stroke','#5ed6ff'); p.setAttribute('fill','none'); svg.append(p);
    }
  } catch(e) {el('g-label').textContent=e.message;}
}
async function sky() {
  try {
    const at=new Date(Date.now()+state.offset*60000).toISOString();
    const c=await json(`/api/sky?lat=${state.lat}&lon=${state.lon}&at=${encodeURIComponent(at)}`);
    drawSky(el('sky-chart'),c); el('time-label').textContent=fmt(c.at);
    el('sky-meta').textContent=`${state.lat.toFixed(2)}°, ${state.lon.toFixed(2)}° · ${c.moon_phase_name}`;
    el('object-list').replaceChildren(...c.objects.filter(o=>o.alt>0&&o.kind!=='star').map(o=>{const s=document.createElement('span'); s.textContent=`${o.name} ${o.alt.toFixed(0)}°`; return s;}));
  } catch(e) {el('sky-meta').textContent=e.message;}
}
let board=null, stale=false, warning='';
function render() {
  if(!board) return;
  el('next-launch').textContent=`Data by RocketLaunch.Live · Haettu ${fmt(board.updated)}${stale?' · VANHENTUNUT':''} ${warning}`;
  el('launch-list').replaceChildren(...board.results.map(l=>{
    const li=document.createElement('li'), text=document.createElement('div'), timer=document.createElement('span');
    text.textContent=`${l.name} · ${l.rocket} · ${l.provider} · ${l.location} · ${fmt(l.net)} · ${l.status} `;
    if(l.stream_url) {
      try {
        const url=new URL(l.stream_url);
        if(url.protocol==='https:'&&url.hostname==='www.rocketlaunch.live') {
          const a=document.createElement('a'); a.href=url.href; a.target='_blank'; a.rel='noopener noreferrer';
          a.textContent='Seuraa laukaisua ↗'; a.style.color='#5ed6ff'; text.append(a);
        }
      } catch(e) {console.warn('Virheellinen seurantalinkki');}
    }
    const seconds=l.net?Math.floor((new Date(l.net)-Date.now())/1000):null;
    timer.className='countdown'; timer.textContent=seconds==null?'Aika tarkentuu':seconds<=0?'Ajankohta saavutettu':`T−${Math.floor(seconds/3600)} h ${Math.floor(seconds%3600/60)} min ${seconds%60} s`;
    li.append(text,timer); return li;
  }));
}
async function launches() {
  let delay=600000;
  try {board=await json('/api/launches'); stale=false; warning=''; render();}
  catch(e) {stale=true; warning=e.message; if(board) render(); else el('next-launch').textContent=e.message; delay=300000;}
  setTimeout(launches,delay);
}
function clock() {el('clock').textContent=new Date().toLocaleString('fi-FI'); render();}
(async()=>{
  document.querySelector('.live').textContent='PÄIVITTYVÄ';
  document.querySelectorAll('[data-info-slot]').forEach(n=>n.append(infoBtn(n.dataset.infoSlot))); clock(); setInterval(clock,1000);
  el('time-offset').addEventListener('change',e=>{state.offset=Number(e.target.value); sky();});
  try {const c=await json('/api/config'); state.lat=c.default_lat; state.lon=c.default_lon;} catch(e) {console.warn(e);}
  weather(); sky(); launches(); setInterval(weather,300000); setInterval(sky,60000);
  if(navigator.geolocation) {
    // Tarkka paikannus (GPS, jos saatavilla). Haetaan uudelleen vain, jos sijainti siirtyy yli 200 m.
    const moved=(lat,lon)=>Math.hypot((lat-state.lat)*111320,(lon-state.lon)*111320*Math.cos(lat*Math.PI/180))>200;
    navigator.geolocation.watchPosition(p=>{
      const {latitude:lat, longitude:lon, accuracy}=p.coords, first=state.accuracy==null;
      const refresh=first||moved(lat,lon);
      state.accuracy=accuracy;
      if(refresh) {state.lat=lat; state.lon=lon; weather(); sky();}
    },e=>console.warn('Paikannus epäonnistui:',e.message), {enableHighAccuracy:true, timeout:15000, maximumAge:60000});
  }
})();
