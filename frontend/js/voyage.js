// Avaruuslento: peli, jossa lähdetään Maasta raketilla tutkimaan planeettoja. Avautuu koko näytön tilaan
// Aurinkokunta-kortin painikkeesta tai osoitteella #lento. Kaikki lasketaan selaimessa (flight.js), ja tila
// tallentuu tämän selaimen localStorageen.
//
// Pelin kello: simulaatioaika = ankkuri + (oikea aika − ankkurin oikea aika) × kiihdytys. Kun peli on suljettuna
// tai taustalla, aika kulkee oikeaa vauhtia (1×), joten raketti lentää myös sovelluksen ollessa kiinni.
// Kello pysähtyy laukaisuhetkeen ja saapumiseen, jotta ne eivät mene ohi.
import { el, num, saved, button } from './core.js';
import { FLIGHT_BODIES, FUEL_KMS, departureState, flightStats, fmtDuration, isPlanet, nearestPlanet, norm, parkingState, planetState, shipState, shipView, soiEntry, soiExit, transfer, windowSearch } from './flight.js';
import { PLANET_INFO } from './planetinfo.js';
import { AU_KM, LIGHT_AU_PER_MIN, solarSystem } from './planets.js';
import { drawScene } from './solarsystem.js';

const KEY = 'avaruuslento';
const DAY = 86400000;
/** Aikakiihdytykset: kerroin ja nimi. */
export const WARPS = [[1,'1×'],[10,'10×'],[100,'100×'],[3600,'1 h/s'],[86400,'1 vrk/s'],[7*86400,'1 vk/s'],[30*86400,'1 kk/s'],[365.25*86400,'1 v/s']];
/** Kiihdytys pienenee, kun seuraavaan tapahtumaan on alle näin monta oikeaa millisekuntia. */
const WARP_LEAD = 2500;
const COUNTDOWN_S = 5;
// [genetiivi, illatiivi, partitiivi]
const NAMES = {
  Merkurius:['Merkuriuksen','Merkuriukseen','Merkuriusta'], Venus:['Venuksen','Venukseen','Venusta'], Maa:['Maan','Maahan','Maata'],
  Mars:['Marsin','Marsiin','Marsia'], Jupiter:['Jupiterin','Jupiteriin','Jupiteria'], Saturnus:['Saturnuksen','Saturnukseen','Saturnusta'],
  Uranus:['Uranuksen','Uranukseen','Uranusta'], Neptunus:['Neptunuksen','Neptunukseen','Neptunusta'],
};
const KINDS = {cheapest:['Halvin','Vähiten polttoainetta'], faster:['Nopeampi','Lyhyempi lento, enemmän polttoainetta'], earliest:['Aikaisin perillä','Nopein reitti, johon polttoaine riittää']};
const SHIP_COLOR = '#ffb547';
/** Planeetan tutkiminen (ja tankkaus) kestää vuorokauden pelin aikaa. */
const SURVEY_MS = DAY;

// location: planeetta, jonka kiertoradalla alus on, tai null, kun alus on ohilennon jälkeen Auringon kiertoradalla
// (drift = {r, v, t}). Maa on kotiplaneetta, joten se on tutkittu alusta asti.
const fresh = () => ({v:1, location:'Maa', drift:null, fuel:FUEL_KMS, simTime:Date.now(), realTime:Date.now(), warp:0,
  plan:null, flight:null, survey:null, explored:['Maa'], flights:[], log:[]});
let game=null, options=null, target=null, searchId=0, progress=0, frame=null, lastSave=0;
// Lähtölaskennan päättymishetki (oikeaa aikaa), kartan rajaus, kiihdytyksen pienentämisestä kertova viesti
// ja tieto siitä, onko näkymä piirretty saapumisen jälkeen.
let countdown=null, mapRadius=null, mapFollow=false, notice='', shownArrived=false, logOpen=false;
// 3D-ohjaamo (cockpit.js) ladataan vasta, kun se näytetään ensimmäisen kerran. Sen kangas säilyy elementissä
// cockpitHost, jota siirretään näkymästä toiseen, joten WebGL-kontekstia ei luoda uudelleen.
const VIEW_KEY = 'avaruuslento.view';
let view=saved.get(VIEW_KEY,'cockpit'), cockpit=null, cockpitLoad=null, cockpitError='', cockpitHost=null, launchedAt=-Infinity;

// --- Kello ---

function rawTime() { return game.simTime+(Date.now()-game.realTime)*WARPS[game.warp][0]; }
const holdAt = () => game.plan ? game.plan.depart : game.flight ? game.flight.arrive : Infinity;
function anchor(t, warp) { game.simTime=t; game.realTime=Date.now(); game.warp=warp; save(); }

/** Simulaation hetki (ms). Kello pysähtyy laukaisuhetkeen ja saapumiseen. */
function simNow() {
  const t=rawTime(), stop=holdAt();
  if(t>=stop) {
    if(game.warp>0 || game.simTime<stop) anchor(stop,0);
    return stop;
  }
  return t;
}
function setWarp(i) { notice=''; anchor(simNow(),i); render(); }

// Ennen vaikutuspiirin rajaa ja saapumista kiihdytys pienenee portaittain, jotta tapahtuma ei vilahda ohi.
function limitWarp(t) {
  if(!game.flight || !game.warp) return;
  const next=[game.flight.soi, game.flight.arrive].find(s=>s>t);
  if(next==null) return;
  let i=game.warp;
  while(i>0 && WARPS[i][0]*WARP_LEAD>next-t) i--;
  if(i===game.warp) return;
  notice=`Kiihdytys pienennettiin (${WARPS[i][1]}): ${next===game.flight.soi ? `${NAMES[game.flight.to][0]} vaikutuspiiri` : 'saapuminen'} lähestyy.`;
  anchor(t,i); render();
}

function save() { lastSave=Date.now(); saved.set(KEY,game); }
// Taustalle mentäessä kiihdytys palaa 1×:ään: suljettuna aika kulkee oikeaa vauhtia.
function park() { if(!game) return; countdown=null; if(game.warp) anchor(simNow(),0); else save(); }

function load() {
  const s=saved.get(KEY,null);
  game=s?.v===1 ? {...fresh(), ...s} : fresh();
  // Jos tallennus jäi kiihdytykselle (selain suljettiin kesken), suljettu aika lasketaan silti 1×:nä.
  game.warp=0;
  simNow();
}

// --- Muotoilu ---

const fmtDate = t => new Date(t).toLocaleDateString('fi-FI',{weekday:'short',day:'numeric',month:'numeric',year:'numeric'});
const fmtClock = t => new Date(t).toLocaleTimeString('fi-FI',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
const dv = v => `${num(v,2)} km/s`;
const toAu = r => r.map(x=>x/AU_KM);
const gap = (a, b) => norm([a[0]-b[0],a[1]-b[1],a[2]-b[2]]);
function fmtDays(days) {
  if(days<730) return `${num(Math.round(days))} vrk`;
  const y=Math.floor(days/365.25);
  return `${y} v ${num(Math.round(days-y*365.25))} vrk`;
}
function fmtKm(km) {
  if(km<1e6) return `${num(km)} km`;
  const au=km/AU_KM;
  return au<0.1 ? `${num(km/1e6,2)} milj. km` : `${num(km/1e6)} milj. km (${num(au,2)} AU)`;
}
function lightTime(km) {
  const min=km/AU_KM/LIGHT_AU_PER_MIN;
  return min<1 ? `${num(min*60)} s` : min<120 ? `${num(min,1)} min` : `${num(min/60,1)} h`;
}
const here = () => game.location ?? game.drift;
const fromText = from => isPlanet(from) ? `${NAMES[from][0]} kiertoradalta` : 'Auringon kiertoradalta';
function orbitText(name) {
  const b=FLIGHT_BODIES[name], peri=b.periKm-b.radiusKm, apo=b.apoKm-b.radiusKm;
  return peri===apo ? `${num(peri)} km korkeudella` : `${num(peri)} × ${num(apo)} km radalla`;
}

// --- Näkymät ---

function make(tag, className, text) { const n=document.createElement(tag); if(className) n.className=className; if(text!=null) n.textContent=text; return n; }
function list(rows, className) {
  const dl=make('dl',className);
  for(const [k,v] of rows) dl.append(make('dt',null,k), make('dd',null,v));
  return dl;
}
function stat(label, id, subId) {
  const box=make('div','stat');
  const value=make('b'); value.id=id;
  box.append(make('span',null,label), value);
  if(subId) {const sub=make('small','muted'); sub.id=subId; box.append(sub);}
  return box;
}
function actions(...buttons) { const box=make('div','voyage-actions'); box.append(...buttons); return box; }
function warpButtons() {
  const warps=make('div','seg voyage-warps'); warps.setAttribute('role','group'); warps.setAttribute('aria-label','Aikakiihdytys');
  WARPS.forEach(([,label],i)=>{const b=button('',label,()=>setWarp(i)); b.setAttribute('aria-pressed',String(i===game.warp)); warps.append(b);});
  return warps;
}

function status() {
  const box=make('div','voyage-status');
  const where=make('div','stat');
  where.append(make('span',null,'Sijainti'));
  if(game.flight) where.append(make('b',null,`Matkalla ${NAMES[game.flight.to][1]}`), make('small','muted',`lähtö ${fromText(game.flight.from)}`));
  else if(game.location) where.append(make('b',null,`${NAMES[game.location][0]} kiertoradalla`), make('small','muted',orbitText(game.location)));
  else where.append(make('b',null,'Auringon kiertoradalla'), make('small','muted','ohilennon jälkeen'));
  const fuel=make('div','stat');
  const meter=make('div','voyage-meter'), bar=make('i');
  bar.style.width=`${Math.max(0,Math.min(100,game.fuel/FUEL_KMS*100))}%`; meter.append(bar);
  fuel.append(make('span',null,'Polttoaine (Δv)'), make('b',null,`${num(game.fuel,2)} / ${FUEL_KMS} km/s`), meter);
  box.append(where,fuel);
  return box;
}

function optionCard(o) {
  const [title,sub]=KINDS[o.kind], days=(o.arrive-o.depart)/DAY;
  const card=button(`voyage-option${o.fuelOk ? '' : ' no-fuel'}`,'',()=>choose(o));
  card.disabled=!o.fuelOk;
  const head=make('div','voyage-option-head');
  head.append(make('b',null,title), make('span',`level${o.fuelOk ? '' : ' bad'}`,o.fuelOk ? `jää ${num(game.fuel-o.dvTotal,1)} km/s` : 'polttoaine ei riitä'));
  const wait=o.depart-simNow();
  card.append(head, make('small','muted',sub), list([
    ['Lähtö', `${fmtDate(o.depart)}${wait>DAY ? ` (${fmtDays(wait/DAY)} päästä)` : ''}`],
    ['Lentoaika', fmtDays(days)],
    ['Perillä', fmtDate(o.arrive)],
    ['Δv', `lähtö ${dv(o.dvDep)} + jarrutus ${dv(o.dvArr)} = ${dv(o.dvTotal)}`],
  ]));
  return card;
}

// Planeetan tietokortti. Kiinnostavat faktat paljastuvat, kun planeetta on tutkittu.
function infoCard(name) {
  const info=PLANET_INFO[name], explored=game.explored.includes(name);
  const card=make('div','voyage-info');
  const head=make('div','voyage-option-head');
  head.append(make('b',null,name), make('span',`level${explored ? '' : ' off'}`,explored ? 'tutkittu' : 'tutkimatta'));
  card.append(head, list([['Halkaisija',info.diameter],['Massa',info.mass],['Painovoima',info.gravity],['Vuorokausi',info.day],['Vuosi',info.year],
    ['Lämpötila',info.temperature],['Kaasukehä',info.atmosphere],['Kuut',info.moons]]));
  if(explored) {
    const facts=make('ul','voyage-facts');
    facts.append(...info.facts.map(f=>make('li',null,f)));
    card.append(make('h3',null,'Tutkimuksen löydöt'), facts);
  }
  return card;
}

// Tutkiminen tai tankkaus: kestää vuorokauden pelin aikaa (kiihdytyksellä nopeammin) ja täyttää polttoaineen.
function surveyPanel() {
  const name=game.location, explored=game.explored.includes(name), box=make('div','voyage-survey');
  if(game.survey) {
    const p=make('div','voyage-progress'); const bar=make('i'); bar.id='voyage-survey-bar'; p.append(bar);
    const label=make('p','muted'); label.id='voyage-survey-label';
    box.append(label,p,warpButtons());
  } else if(!explored) {
    box.append(make('p',null,`Tutki ${name} kiertoradalta. Kartoitus kestää vuorokauden, ja sen jälkeen polttoaine täydennetään.`),
      actions(button('voyage-go','Tutki planeetta',startSurvey)));
  } else if(game.fuel<FUEL_KMS-0.005) {
    box.append(make('p','muted',`${name} on jo tutkittu. Tankkaus kestää vuorokauden.`), actions(button('sky-btn','Tankkaa',startSurvey)));
  }
  return box;
}

function logbook() {
  const d=make('details','voyage-log'); d.open=logOpen;
  d.addEventListener('toggle',()=>{logOpen=d.open;});
  d.append(make('summary',null,'Lokikirja'));
  const fl=game.flights, total=fl.reduce((s,f)=>s+f.arrive-f.depart,0), km=fl.reduce((s,f)=>s+f.km,0), top=fl.reduce((m,f)=>Math.max(m,f.maxSpeed),0);
  d.append(list([
    ['Tutkitut planeetat',`${game.explored.length}/8: ${game.explored.join(', ')}`],
    ['Lentoja',String(fl.length)],
    ['Lentoaika yhteensä',fl.length ? fmtDays(total/DAY) : '–'],
    ['Kuljettu matka',fl.length ? fmtKm(km) : '–'],
    ['Huippunopeus',fl.length ? `${num(top,2)} km/s (${num(top*3600)} km/h)` : '–'],
  ],'voyage-plan'));
  if(fl.length) {
    d.append(make('h3',null,'Lennot'));
    const ul=make('ul','voyage-flights');
    for(const f of [...fl].reverse()) {
      const li=make('li');
      li.append(make('b',null,`${f.fromName} → ${f.to}${f.captured ? '' : ' (ohilento)'}`),
        make('span','muted',`${new Date(f.depart).toLocaleDateString('fi-FI')}–${new Date(f.arrive).toLocaleDateString('fi-FI')} · ${fmtDays((f.arrive-f.depart)/DAY)} · ${fmtKm(f.km)}`));
      ul.append(li);
    }
    d.append(ul);
  }
  if(game.log.length) {
    d.append(make('h3',null,'Tapahtumat'));
    const ul=make('ul','voyage-flights');
    for(const e of game.log.slice(-30).reverse()) {const li=make('li'); li.append(make('span','muted',fmtDate(e.t)), make('span',null,e.text)); ul.append(li);}
    d.append(ul);
  }
  return d;
}

function orbiting(body) {
  if(game.location) body.append(infoCard(game.location), surveyPanel());
  else body.append(make('p',null,'Polttoaine ei riittänyt jarrutukseen, joten alus ohitti kohteen ja kiertää nyt Aurinkoa. Suunnittele uusi reitti, jos polttoaine riittää, tai aloita alusta.'));
  body.append(viewSwitch(), showCockpit() ? cockpitStage() : mapStage());
  if(!game.survey) body.append(warpButtons());
  if(game.survey) {body.append(logbook()); return;}
  body.append(make('h3',null,'Valitse kohde'));
  const targets=make('div','voyage-targets');
  for(const name of Object.keys(FLIGHT_BODIES)) {
    if(name===game.location) continue;
    const b=button(`sky-btn${game.explored.includes(name) ? '' : ' voyage-new'}`,name,()=>search(name));
    b.setAttribute('aria-pressed',String(name===target));
    targets.append(b);
  }
  body.append(targets);
  if(!target) {
    body.append(make('p','muted','Sovellus laskee siirtoradan valmiiksi: se etsii seuraavan kahden vuoden laukaisuikkunat ja näyttää halvimman sekä nopeammat vaihtoehdot. Tutkimattomat planeetat on merkitty pisteellä. Polttoaine täydentyy, kun kohdeplaneetta on tutkittu.'));
  } else if(!options) {
    const p=make('div','voyage-progress'); const bar=make('i'); bar.id='voyage-progress-bar'; bar.style.width=`${progress*100}%`; p.append(bar);
    body.append(make('p','muted',`Haetaan laukaisuikkunoita: ${fromText(here())} ${NAMES[target][1]}…`), p);
  } else if(!options.length) {
    body.append(make('p','muted','Siirtorataa ei löytynyt. Kokeile toista kohdetta.'));
  } else {
    body.append(make('h3',null,`Lento ${NAMES[target][1]}`));
    const cards=make('div','voyage-options');
    cards.append(...options.map(optionCard));
    body.append(cards);
    if(options.every(o=>!o.fuelOk)) body.append(make('p','muted',game.location && !game.explored.includes(game.location)
      ? 'Polttoaine ei riitä yhteenkään vaihtoehtoon. Tutki planeetta, niin polttoaine täydennetään.'
      : game.location ? 'Polttoaine ei riitä yhteenkään vaihtoehtoon. Tankkaa tai valitse lähempi kohde.' : 'Polttoaine ei riitä yhteenkään vaihtoehtoon.'));
  }
  body.append(logbook());
  if(game.log.length) body.append(actions(button('sky-btn','Aloita alusta',restart)));
}

function waiting(body) {
  const p=game.plan, ready=simNow()>=p.depart;
  body.append(make('h3',null,`Lento ${NAMES[p.to][1]}`));
  body.append(list([['Lähtö',fmtDate(p.depart)],['Lentoaika',fmtDays((p.arrive-p.depart)/DAY)],['Perillä',fmtDate(p.arrive)],['Δv',`${dv(p.dvDep)} + ${dv(p.dvArr)} = ${dv(p.dvTotal)}`]],'voyage-plan'));
  const count=make('div','voyage-count'); count.id='voyage-count'; count.dataset.ready=ready ? '1' : '';
  body.append(count, viewSwitch(), showCockpit() ? cockpitStage() : mapStage());
  const cancel=button('sky-btn','Peru lento',()=>{game.plan=null; options=null; target=null; save(); render();});
  if(!ready) {
    body.append(make('p','muted','Odota laukaisuikkunaa tai kiihdytä aikaa. Kello pysähtyy laukaisuhetkeen, joten ikkuna ei mene ohi.'), warpButtons(),
      actions(button('sky-btn','Siirry laukaisuhetkeen',()=>{anchor(p.depart,0); render();}), cancel));
  } else if(countdown) {
    body.append(actions(button('sky-btn','Keskeytä lähtölaskenta',()=>{countdown=null; render();})));
  } else {
    body.append(make('p','muted',`Laukaisuikkuna on auki. Lähtöpoltto kuluttaa ${dv(p.dvDep)} polttoainetta.`),
      actions(button('voyage-go','Laukaise',()=>{countdown=Date.now()+COUNTDOWN_S*1000; render();}), cancel));
  }
}

function mapStage() {
  const stage=make('div','voyage-map-stage'), canvas=make('canvas','voyage-map');
  canvas.id='voyage-map'; canvas.setAttribute('role','img'); canvas.setAttribute('aria-label','Aluksen rata aurinkokunnan kartalla');
  const modes=make('div','iss-map-modes');
  for(const [label,follow] of [['Koko rata',false],['Alus',true]]) {
    const b=button('sky-btn',label,()=>{mapFollow=follow; mapRadius=follow ? 0.05 : null; render();});
    b.setAttribute('aria-pressed',String(mapFollow===follow)); modes.append(b);
  }
  const zoom=make('div','iss-map-zoom');
  const zin=button('sky-btn','+',()=>{mapRadius=Math.max(0.0005,(mapRadius ?? fitRadius())/1.6); draw();});
  const zout=button('sky-btn','−',()=>{mapRadius=Math.min(40,(mapRadius ?? fitRadius())*1.6); draw();});
  zin.setAttribute('aria-label','Lähennä'); zout.setAttribute('aria-label','Loitonna');
  zoom.append(zin,zout);
  stage.append(canvas,modes,zoom);
  return stage;
}

// Ohjaamon ja kartan vaihto. Ohjaamo vaatii WebGL:n; jos sitä ei ole, näytetään kartta.
function viewSwitch() {
  const seg=make('div','seg voyage-view'); seg.setAttribute('role','group'); seg.setAttribute('aria-label','Näkymä');
  for(const [id,label] of [['cockpit','Ohjaamo'],['map','Kartta']]) {
    const b=button('',label,()=>{view=id; saved.set(VIEW_KEY,id); render();});
    b.setAttribute('aria-pressed',String(showCockpit()===(id==='cockpit')));
    if(id==='cockpit' && cockpitError) b.disabled=true;
    seg.append(b);
  }
  return seg;
}
const showCockpit = () => view==='cockpit' && !cockpitError;

function cockpitStage() {
  if(!cockpitHost) {
    cockpitHost=make('div','voyage-cockpit');
    const tools=make('div','iss-map-modes');
    tools.append(button('sky-btn','Katse eteen',()=>cockpit?.resetView()));
    const sensor=button('sky-btn','Asentoanturi',async()=>{
      try {sensor.setAttribute('aria-pressed',String(await cockpit?.toggleOrientation() ?? false));}
      catch(e) {notice=e.message; render();}
    });
    sensor.setAttribute('aria-pressed','false');
    if(typeof DeviceOrientationEvent==='undefined') sensor.hidden=true;
    tools.append(sensor);
    const loading=make('div','voyage-cockpit-loading','Ladataan ohjaamoa…');
    cockpitHost.append(loading,tools);
  }
  if(!cockpitLoad) {
    cockpitLoad=import('./cockpit.js').then(m=>{
      cockpit=m.createCockpit(cockpitHost,cockpitState);
      cockpitHost.querySelector('.voyage-cockpit-loading')?.remove();
      syncCockpit();
    }).catch(e=>{
      console.warn('Ohjaamo ei käynnisty',e);
      cockpitError='3D-ohjaamo ei toimi tällä laitteella (WebGL puuttuu), joten näytetään kartta.';
      render();
    });
  }
  return cockpitHost;
}

// Ohjaamo piirtää vain, kun se on näkyvissä.
function syncCockpit() {
  const visible=cockpit && cockpitHost?.isConnected && !el('voyage').hidden && !document.hidden;
  if(visible) cockpit.start(); else cockpit?.stop();
}

function flying(body) {
  const f=game.flight, arrived=simNow()>=f.arrive;
  shownArrived=arrived;
  const clock=make('div','voyage-count'); clock.id='voyage-met';
  const stats=make('div','voyage-stats');
  stats.append(stat('Nopeus Auringon suhteen','voyage-speed','voyage-speed-sub'), stat(`Etäisyys ${NAMES[f.to][2]}`,'voyage-dist','voyage-eta'),
    stat('Etäisyys Auringosta','voyage-sun'), stat('Valon kulkuaika Maahan','voyage-light'));
  body.append(clock, viewSwitch(), showCockpit() ? cockpitStage() : mapStage(), stats);
  if(cockpitError) body.append(make('p','muted',cockpitError));
  if(arrived && game.fuel>=f.dvArr-1e-9) {
    body.append(make('p',null,`Alus on ${NAMES[f.to][0]} luona. Jarrutuspoltto (${dv(f.dvArr)}) vie sen kiertoradalle ${orbitText(f.to)}.`),
      actions(button('voyage-go','Jarruta kiertoradalle',capture)));
  } else if(arrived) {
    body.append(make('p',null,`Alus on ${NAMES[f.to][0]} luona, mutta polttoaine (${dv(game.fuel)}) ei riitä jarrutukseen (${dv(f.dvArr)}). Alus ohittaa planeetan ja jatkaa Auringon ympäri.`),
      actions(button('voyage-go','Jatka ohilentoa',capture)));
  } else {
    const n=make('p','muted',notice || `${NAMES[f.to][0]} vaikutuspiiriin ${fmtDate(f.soi)}. Kiihdytys pienenee automaattisesti ennen sitä ja ennen saapumista.`);
    body.append(warpButtons(), n);
  }
  body.append(actions(button('sky-btn','Keskeytä lento',restart)));
}

function render() {
  if(!game || el('voyage').hidden) return;
  const body=el('voyage-body');
  body.replaceChildren(status());
  if(game.flight) flying(body); else if(game.plan) waiting(body); else orbiting(body);
  syncCockpit();
  update();
}

// Mittarien arvot lentonäkymään ja ohjaamon näytöille.
function readouts(t) {
  const f=game.flight, tr=f ?? game.plan;
  const ship=f ? shipState(f,t) : departureState(tr.from,t), speed=norm(ship.v);
  const near=f || !isPlanet(tr.from) ? nearestPlanet(ship.r,ship.v,t) : {name:tr.from, speed:0};
  return {
    met: f ? `T+ ${fmtDuration(t-f.depart)}` : countdown ? `T− ${Math.max(1,Math.ceil((countdown-Date.now())/1000))} s` : `T− ${fmtDuration(tr.depart-t)}`,
    date: fmtDate(t), speed, near,
    dist: fmtKm(gap(ship.r,planetState(tr.to,t).r)),
    eta: t<tr.arrive ? `perillä ${fmtDate(tr.arrive)}, T− ${fmtDuration(tr.arrive-t)}` : 'perillä',
    sun: fmtKm(norm(ship.r)),
    light: lightTime(gap(ship.r,planetState('Maa',t).r)),
  };
}

// Ohjaamon tila: aluksen paikka, nokan suunta ja näyttöjen tekstit.
// Lennolla nokka osoittaa lähtöplaneettaan, kunnes sen vaikutuspiiri on takana, ja sitten kohteeseen.
// Kiertoradalla ja ennen laukaisua alus kiertää planeettaa, joka täyttää ikkunan.
function cockpitState() {
  const t=simNow(), base={t, warp:WARPS[game.warp][0], launchAge:Date.now()-launchedAt, countdown:countdown ? countdown-Date.now() : null};
  const tr=game.flight ?? game.plan;
  if(!tr) {
    const name=game.location, ship=name ? parkingState(name,t) : departureState(game.drift,t);
    const date=[fmtDate(t),28,'#8b9ac0'], warp=[WARPS[game.warp][1],28,'#ffb547'];
    return {...base, ship, aim:name,
      screens:[
        [name ? 'KIERTORATA' : 'AURINGON KIERTORATA',[[fmtClock(t),36],date,warp]],
        ['NOPEUS',name ? [[`${num(norm(ship.rel.v),2)} km/s`,44],[`${num(norm(ship.rel.v)*3600)} km/h`,28,'#8b9ac0'],[`${name} ${num(norm(ship.rel.r)-FLIGHT_BODIES[name].radiusKm)} km`,26,'#8b9ac0']]
          : [[`${num(norm(ship.v),2)} km/s`,44],['Auringon suhteen',28,'#8b9ac0']]],
        [name ? name.toUpperCase() : 'POLTTOAINE',[[game.survey ? 'kartoitus käynnissä' : name && game.explored.includes(name) ? 'tutkittu' : name ? 'tutkimatta' : '',30],[`polttoaine ${num(game.fuel,2)} km/s`,26,'#8b9ac0']],game.fuel/FUEL_KMS],
      ]};
  }
  const r=readouts(t);
  const ship=game.flight ? shipView(tr,t) : isPlanet(tr.from) ? parkingState(tr.from,t) : departureState(tr.from,t);
  const aim=game.flight ? (isPlanet(tr.from) && t<tr.exit ? tr.from : tr.to) : isPlanet(tr.from) ? tr.from : tr.to;
  return {
    ...base, ship, aim,
    screens:[
      ['LENTOAIKA',[[r.met,36],[r.date,28,'#8b9ac0'],[WARPS[game.warp][1],28,'#ffb547']]],
      ['NOPEUS',[[`${num(r.speed,2)} km/s`,44],[`${num(r.speed*3600)} km/h`,28,'#8b9ac0'],[game.flight ? `${r.near.name} ${num(r.near.speed,2)} km/s` : 'pysäköintirata',26,'#8b9ac0']]],
      [`KOHDE: ${tr.to.toUpperCase()}`,[[r.dist,34],[`polttoaine ${num(game.fuel,2)} km/s`,26,'#8b9ac0']],game.fuel/FUEL_KMS],
    ],
  };
}

// Kellon, mittarien ja kartan päivitys ilman koko näkymän uudelleenrakentamista.
function update() {
  const t=simNow();
  el('voyage-date').textContent=fmtDate(t);
  el('voyage-time').textContent=`${fmtClock(t)} · ${WARPS[game.warp][1]}`;
  const set=(id,text)=>{const n=document.getElementById(id); if(n) n.textContent=text;};
  if(game.plan) {
    const left=game.plan.depart-t, count=document.getElementById('voyage-count');
    set('voyage-count',countdown ? `${Math.max(1,Math.ceil((countdown-Date.now())/1000))}` : left>0 ? `T− ${fmtDuration(left)}` : 'T− 0');
    if(count && left<=0 && !count.dataset.ready) {count.dataset.ready='1'; render();}
  }
  if(game.survey) {
    const f=Math.min(1,(t-game.survey.start)/SURVEY_MS), bar=document.getElementById('voyage-survey-bar');
    if(bar) bar.style.width=`${f*100}%`;
    set('voyage-survey-label',`${game.explored.includes(game.survey.body) ? 'Tankkaus' : `Kartoitus: ${game.survey.body}`} ${num(f*100)} % · valmis ${fmtDate(game.survey.start+SURVEY_MS)} ${fmtClock(game.survey.start+SURVEY_MS)}`);
  }
  if(!game.flight) {draw(); return;}
  const r=readouts(t);
  set('voyage-met',r.met);
  set('voyage-speed',`${num(r.speed,2)} km/s`);
  set('voyage-speed-sub',`${num(r.speed*3600)} km/h · ${NAMES[r.near.name][0]} suhteen ${num(r.near.speed,2)} km/s`);
  set('voyage-dist',r.dist);
  set('voyage-eta',r.eta);
  set('voyage-sun',r.sun);
  set('voyage-light',r.light);
  draw();
}

// --- Kartta ---

function fitRadius() {
  const f=game.flight ?? game.plan;
  if(!f) return Math.max(1.6,norm(departureState(here(),simNow()).r)/AU_KM*1.25);
  return Math.max(norm(f.r1),norm(planetState(f.to,f.arrive).r))/AU_KM*1.12;
}

function draw() {
  const canvas=document.getElementById('voyage-map'), f=game?.flight ?? game?.plan;
  if(!canvas || !game) return;
  const w=canvas.clientWidth, h=canvas.clientHeight, scale=window.devicePixelRatio||1;
  if(!w||!h) return;
  if(canvas.width!==Math.round(w*scale) || canvas.height!==Math.round(h*scale)) {canvas.width=Math.round(w*scale); canvas.height=Math.round(h*scale);}
  const t=simNow(), ship=!f ? departureState(here(),t) : t>f.depart ? shipState(f,t) : departureState(f.from,t), shipAu=toAu(ship.r);
  const radius=mapRadius ?? fitRadius(), k=Math.min(w,h)/2/radius;
  const center=mapFollow ? shipAu : [0,0];
  const toPx=([x,y])=>[w/2+(x-center[0])*k, h/2-(y-center[1])*k];
  const ctx=canvas.getContext('2d');
  ctx.setTransform(scale,0,0,scale,0,0);
  drawScene(ctx,solarSystem(t),toPx,w,h,k,f?.to ?? game.location);
  if(f) drawTransfer(ctx,f,t,toPx,w);
  drawShip(ctx,toPx(shipAu),ship.v);
}

function drawTransfer(ctx, f, t, toPx, w) {
  // Kuljettu reitti yhtenäisenä ja tuleva rata katkoviivana.
  const N=240, path=(a,b)=>{
    ctx.beginPath();
    for(let i=0;i<=N;i++) {const p=toPx(toAu(shipState(f,a+(b-a)*i/N).r)); i ? ctx.lineTo(p[0],p[1]) : ctx.moveTo(p[0],p[1]);}
  };
  ctx.strokeStyle=SHIP_COLOR;
  if(t>f.depart) {path(f.depart,t); ctx.globalAlpha=0.9; ctx.lineWidth=2; ctx.stroke();}
  if(t<f.arrive) {path(t,f.arrive); ctx.globalAlpha=0.6; ctx.lineWidth=1.5; ctx.setLineDash([5,5]); ctx.stroke(); ctx.setLineDash([]);}
  ctx.globalAlpha=1;

  // Kohdeplaneetan paikka saapumishetkellä.
  if(t<f.arrive) {
    const [ax,ay]=toPx(toAu(planetState(f.to,f.arrive).r));
    ctx.beginPath(); ctx.arc(ax,ay,7,0,2*Math.PI); ctx.strokeStyle='#fff'; ctx.lineWidth=1.2; ctx.setLineDash([2,3]); ctx.stroke(); ctx.setLineDash([]);
    ctx.font='11px system-ui, sans-serif'; ctx.textAlign='center'; ctx.lineWidth=3; ctx.strokeStyle='#03050b';
    const label=`saapuminen ${new Date(f.arrive).toLocaleDateString('fi-FI')}`;
    const half=ctx.measureText(label).width/2+4, lx=Math.max(half,Math.min(w-half,ax));
    ctx.strokeText(label,lx,ay+20); ctx.fillStyle='#c9d3ec'; ctx.fillText(label,lx,ay+20);
  }
}

// Alus kolmiona nopeuden suuntaan.
function drawShip(ctx, [sx,sy], v) {
  ctx.save(); ctx.translate(sx,sy); ctx.rotate(Math.atan2(-v[1],v[0]));
  ctx.beginPath(); ctx.moveTo(9,0); ctx.lineTo(-6,5); ctx.lineTo(-3,0); ctx.lineTo(-6,-5); ctx.closePath();
  ctx.fillStyle=SHIP_COLOR; ctx.fill(); ctx.lineWidth=1; ctx.strokeStyle='#03050b'; ctx.stroke();
  ctx.restore();
}

// --- Toiminnot ---

async function search(to) {
  const id=++searchId; target=to; options=null; progress=0; render();
  const it=windowSearch(here(),to,simNow(),{fuel:game.fuel});
  let last=performance.now();
  for(;;) {
    const r=it.next();
    if(r.done) {options=r.value; break;}
    progress=r.value;
    // Laskenta paloissa: käyttöliittymä saa vuoron noin 60 kertaa sekunnissa.
    if(performance.now()-last>12) {
      const bar=document.getElementById('voyage-progress-bar'); if(bar) bar.style.width=`${progress*100}%`;
      await new Promise(res=>setTimeout(res,0));
      if(id!==searchId) return;
      last=performance.now();
    }
  }
  if(id===searchId) render();
}

function choose(o) {
  // Haun aikana kello on edennyt: jo mennyt lähtö siirretään tähän hetkeen samalla lentoajalla.
  const now=simNow();
  const tr=o.depart<now ? transfer(o.from,o.to,now,(o.arrive-o.depart)/DAY) : o;
  if(!tr || tr.dvTotal>game.fuel) return;
  game.plan={from:tr.from, to:tr.to, depart:tr.depart, arrive:tr.arrive, dvDep:tr.dvDep, dvArr:tr.dvArr, dvTotal:tr.dvTotal, r1:tr.r1, v1:tr.v1};
  save(); render();
}

function launch() {
  const p=game.plan;
  countdown=null; notice=''; mapRadius=null; mapFollow=false; launchedAt=Date.now();
  game.fuel=Math.max(0,game.fuel-p.dvDep);
  game.flight={...p, soi:soiEntry(p), exit:soiExit(p)};
  game.plan=null; game.drift=null; game.location=null;
  game.log.push({t:p.depart, text:`Laukaisu ${fromText(p.from)} kohti ${NAMES[p.to][2]} (Δv ${dv(p.dvDep)})`});
  anchor(p.depart,0); render();
}

// Saapuminen: jarrutus kiertoradalle, tai ohilento, jos polttoaine ei riitä. Lento kirjataan lokikirjaan.
function capture() {
  const f=game.flight, captured=game.fuel>=f.dvArr-1e-9, stats=flightStats(f);
  game.flights.push({fromName:isPlanet(f.from) ? f.from : 'Auringon kiertorata', to:f.to, depart:f.depart, arrive:f.arrive, km:stats.km, maxSpeed:stats.maxSpeed, captured});
  if(captured) {
    game.fuel=Math.max(0,game.fuel-f.dvArr);
    game.location=f.to; game.drift=null;
    game.log.push({t:f.arrive, text:`Saapuminen ${NAMES[f.to][0]} kiertoradalle ${fmtDays((f.arrive-f.depart)/DAY)} lennon jälkeen (Δv ${dv(f.dvArr)})`});
  } else {
    const s=shipState(f,f.arrive);
    game.location=null; game.drift={r:s.r, v:s.v, t:f.arrive};
    game.log.push({t:f.arrive, text:`Ohilento: polttoaine ei riittänyt jarrutukseen ${NAMES[f.to][0]} kiertoradalle`});
  }
  game.flight=null; options=null; target=null; notice='';
  anchor(f.arrive,0); render();
}

function startSurvey() {
  game.survey={body:game.location, start:simNow()};
  save(); render();
}
function finishSurvey() {
  const {body,start}=game.survey, first=!game.explored.includes(body);
  if(first) game.explored.push(body);
  game.fuel=FUEL_KMS; game.survey=null; logOpen=false;
  game.log.push({t:start+SURVEY_MS, text:first ? `${body} tutkittu (${game.explored.length}/8), polttoaine täydennetty` : `Tankkaus ${NAMES[body][0]} kiertoradalla`});
  if(game.explored.length===8 && first) game.log.push({t:start+SURVEY_MS, text:'Kaikki aurinkokunnan planeetat on tutkittu!'});
  notice=''; save(); render();
}

function restart() {
  if(!confirm('Aloitetaanko alusta? Uusi lento lähtee Maan kiertoradalta täydellä polttoaineella.')) return;
  game=fresh(); options=null; target=null; countdown=null; notice='';
  save(); render();
}

// --- Avaaminen ja sulkeminen ---

function tick() {
  frame=null;
  if(el('voyage').hidden || document.hidden) return;
  if(countdown && Date.now()>=countdown) launch();
  const t=simNow();
  limitWarp(t);
  if(game.survey && t>=game.survey.start+SURVEY_MS) finishSurvey();
  else if(game.flight && t>=game.flight.arrive && !shownArrived) render();
  else update();
  if(Date.now()-lastSave>5000) save();
  frame=setTimeout(()=>requestAnimationFrame(tick),game.flight ? 50 : 100);
}

function open() {
  if(!el('voyage').hidden) return;
  load();
  el('voyage').hidden=false; document.body.classList.add('sky-locked');
  render();
  if(!frame) tick();
}
function close() {
  if(el('voyage').hidden) return;
  park();
  el('voyage').hidden=true; document.body.classList.remove('sky-locked');
  syncCockpit();
}
// Sulkeminen palaa edelliseen näkymään, jos peli avattiin sovelluksesta; suoralla linkillä taivasnäkymään.
function leave() {
  if(history.state?.voyage) history.back();
  else location.replace('#taivas');
}
const sync = () => location.hash==='#lento' ? open() : close();

export function initVoyage() {
  el('voyage-open').addEventListener('click',()=>{history.pushState({voyage:true},'','#lento'); open();});
  el('voyage-close').addEventListener('click',leave);
  window.addEventListener('hashchange',sync);
  window.addEventListener('popstate',sync);
  document.addEventListener('keydown',e=>{if(e.key==='Escape' && !el('voyage').hidden) leave();});
  document.addEventListener('visibilitychange',()=>{
    if(el('voyage').hidden) return;
    if(document.hidden) {park(); syncCockpit();} else {load(); render(); if(!frame) tick();}
  });
  window.addEventListener('pagehide',park);
  window.addEventListener('resize',draw);
  sync();
}
