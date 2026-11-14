// Avaruuslento: peli, jossa lähdetään Maasta raketilla tutkimaan planeettoja. Avautuu koko näytön tilaan
// Aurinkokunta-kortin painikkeesta tai osoitteella #lento. Kaikki lasketaan selaimessa (flight.js), ja tila
// tallentuu tämän selaimen localStorageen.
//
// Pelin kello: simulaatioaika = ankkuri + (oikea aika − ankkurin oikea aika) × kiihdytys. Kun peli on suljettuna
// tai taustalla, aika kulkee oikeaa vauhtia (1×), joten raketti lentää myös sovelluksen ollessa kiinni.
// Kello pysähtyy laukaisuhetkeen ja saapumiseen, jotta ne eivät mene ohi.
import { el, num, saved, button } from './core.js';
import { FLIGHT_BODIES, FUEL_KMS, MOONS, SHIPS, applyBurn, assistTransfer, autoCorrect, bodyState, canRefuel, departureState, flightStats, fmtDuration, isMoon, isPlanet, localTransfer, moonsOf, nearestPlanet, norm, orbitOf, parkingState, planetState, shipState, shipView, soiEntry, soiExit, transfer, windowSearch } from './flight.js';
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
  Kuu:['Kuun','Kuuhun','Kuuta'], Phobos:['Phoboksen','Phobokseen','Phobosta'], Io:['Ion','Iohon','Iota'], Europa:['Europan','Europaan','Europaa'],
  Ganymedes:['Ganymedeen','Ganymedeeseen','Ganymedestä'], Titan:['Titanin','Titaniin','Titania'], Enceladus:['Enceladuksen','Enceladukseen','Enceladusta'],
  Triton:['Tritonin','Tritoniin','Tritonia'],
};
const PLANET_NAMES = Object.keys(FLIGHT_BODIES), MOON_NAMES = Object.keys(MOONS);
const KINDS = {cheapest:['Halvin','Vähiten polttoainetta'], faster:['Nopeampi','Lyhyempi lento, enemmän polttoainetta'], earliest:['Aikaisin perillä','Nopein reitti, johon polttoaine riittää'],
  assist:['Linkous','Ohilento toisen planeetan ohi kääntää rataa lähes ilmaiseksi'], local:['Siirtorata','Hohmannin siirto planeetan ympärillä']};
const SHIP_COLOR = '#ffb547';
/** Planeetan tutkiminen (ja tankkaus) kestää vuorokauden pelin aikaa. */
const SURVEY_MS = DAY;

// location: planeetta, jonka kiertoradalla alus on, tai null, kun alus on ohilennon jälkeen Auringon kiertoradalla
// (drift = {r, v, t}). Maa on kotiplaneetta, joten se on tutkittu alusta asti.
// ship: aluksen tyyppi (flight.js SHIPS); aluksen voi vaihtaa Maan kiertoradalla.
const fresh = () => ({v:1, location:'Maa', drift:null, ship:'kemiallinen', fuel:FUEL_KMS, simTime:Date.now(), realTime:Date.now(), warp:0,
  plan:null, flight:null, survey:null, explored:['Maa'], flights:[], log:[]});
const fuelMax = () => SHIPS[game.ship].fuel;
const isIon = () => !!SHIPS[game.ship].accel;
let game=null, options=null, target=null, searchId=0, progress=0, frame=null, lastSave=0;
// Lähtölaskennan päättymishetki (oikeaa aikaa), kartan rajaus, kiihdytyksen pienentämisestä kertova viesti
// ja tieto siitä, onko näkymä piirretty saapumisen jälkeen.
let countdown=null, mapRadius=null, mapFollow=false, notice='', shownArrived=false, logOpen=false;
// Kurssikorjauspaneeli: auki/kiinni, polton suunta ja suuruus (km/s) sekä esikatseltu rata.
let burnOpen=false, burnDir='prograde', burnDv=0.05, burnPreview=null;
const BURN_DIRS = [['prograde','Eteen'],['retrograde','Taakse'],['inward','Sisään'],['outward','Ulos']];
const BURN_SIZES = [[0.01,'10 m/s'],[0.05,'50 m/s'],[0.1,'100 m/s'],[0.5,'500 m/s'],[1,'1 km/s']];
// 3D-ohjaamo (cockpit.js) ladataan vasta, kun se näytetään ensimmäisen kerran. Sen kangas säilyy elementissä
// cockpitHost, jota siirretään näkymästä toiseen, joten WebGL-kontekstia ei luoda uudelleen.
const VIEW_KEY = 'avaruuslento.view';
let view=saved.get(VIEW_KEY,'cockpit'), cockpit=null, cockpitLoad=null, cockpitError='', cockpitHost=null, launchedAt=-Infinity;

// --- Kello ---

function rawTime() { return game.simTime+(Date.now()-game.realTime)*WARPS[game.warp][0]; }
// Ionialuksen spiraalinousu alkaa ennen varsinaista lähtöä; kello pysähtyy sen alkuun, kunnes pelaaja aloittaa sen.
const holdAt = () => game.plan ? (game.plan.spiralOut && !game.plan.spiralStarted ? game.plan.depart-game.plan.spiralOut : game.plan.depart)
  : game.flight ? game.flight.arrive : Infinity;
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
  const f=game.flight, next=[f.flyby && !f.flyby.done ? f.flyby.t : Infinity, f.soi, f.arrive].filter(s=>s>t).sort((a,b)=>a-b)[0];
  if(next==null) return;
  let i=game.warp;
  while(i>0 && WARPS[i][0]*WARP_LEAD>next-t) i--;
  if(i===game.warp) return;
  notice=`Kiihdytys pienennettiin (${WARPS[i][1]}): ${next===f.flyby?.t ? `ohilento ${NAMES[f.flyby.body][0]} ohi` : next===f.soi && next!==f.arrive ? `${NAMES[f.to][0]} vaikutuspiiri` : 'saapuminen'} lähestyy.`;
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
  const b=orbitOf(name), peri=b.periKm-b.radiusKm, apo=b.apoKm-b.radiusKm;
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
  bar.style.width=`${Math.max(0,Math.min(100,game.fuel/fuelMax()*100))}%`; meter.append(bar);
  fuel.append(make('span',null,`Polttoaine (Δv) · ${SHIPS[game.ship].name}`), make('b',null,`${num(game.fuel,2)} / ${fuelMax()} km/s`), meter);
  box.append(where,fuel);
  return box;
}

function optionCard(o) {
  const [kindTitle,kindSub]=KINDS[o.kind], days=(o.arrive-o.depart)/DAY;
  const title=o.kind==='assist' ? `${kindTitle}: ${o.via}` : kindTitle;
  const sub=o.kind==='assist' ? `Ohilento ${NAMES[o.via][0]} ohi ${fmtDate(o.flyby.t)}${o.flyby.dv>0.005 ? `, poltto ${dv(o.flyby.dv)}` : ', ei polttoa'}` : o.kind==='local' ? `Hohmannin siirto ${NAMES[o.parent][0]} ympärillä` : kindSub;
  const card=button(`voyage-option${o.fuelOk ? '' : ' no-fuel'}`,'',()=>choose(o));
  card.disabled=!o.fuelOk;
  const head=make('div','voyage-option-head');
  head.append(make('b',null,title), make('span',`level${o.fuelOk ? '' : ' bad'}`,o.fuelOk ? `jää ${num(game.fuel-o.dvTotal,1)} km/s` : 'polttoaine ei riitä'));
  const wait=o.depart-simNow();
  const rows=[
    ['Lähtö', `${fmtDate(o.depart)}${wait>DAY ? ` (${fmtDays(wait/DAY)} päästä)` : ''}`],
    ['Lentoaika', days<2 ? fmtDuration(o.arrive-o.depart).replace(/^0 vrk /,'') : fmtDays(days)],
    ['Perillä', fmtDate(o.arrive)],
    ['Δv', `lähtö ${dv(o.dvDep)}${o.dvFlyby>0.005 ? ` + linkous ${dv(o.dvFlyby)}` : ''} + jarrutus ${dv(o.dvArr)} = ${dv(o.dvTotal)}`],
  ];
  if(o.spiralOut || o.spiralIn) rows.push(['Spiraalit',`nousu alkaa ${fmtDate(o.depart-o.spiralOut)} (${fmtDays(o.spiralOut/DAY)}), lasku ${fmtDays(o.spiralIn/DAY)}`]);
  card.append(head, make('small','muted',sub), list(rows));
  return card;
}

// Planeetan tietokortti. Kiinnostavat faktat paljastuvat, kun planeetta on tutkittu.
function infoCard(name) {
  const info=PLANET_INFO[name], explored=game.explored.includes(name);
  const card=make('div','voyage-info');
  const head=make('div','voyage-option-head');
  head.append(make('b',null,name), make('span',`level${explored ? '' : ' off'}`,explored ? 'tutkittu' : 'tutkimatta'));
  card.append(head, list(info.parent
    ? [['Kiertää',info.parent],['Rata',info.orbit],['Halkaisija',info.diameter],['Massa',info.mass],['Painovoima',info.gravity],['Lämpötila',info.temperature],['Kaasukehä',info.atmosphere]]
    : [['Halkaisija',info.diameter],['Massa',info.mass],['Painovoima',info.gravity],['Vuorokausi',info.day],['Vuosi',info.year],
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
  const name=game.location, explored=game.explored.includes(name), box=make('div','voyage-survey'), refuel=canRefuel(game.ship,name);
  const after=refuel ? 'ja sen jälkeen polttoaine täydennetään' : `mutta ${SHIPS[game.ship].name.toLowerCase()}a ei voi tankata täällä (vetyä saa vain Maasta ja kaasujättiläisiltä)`;
  if(game.survey) {
    const p=make('div','voyage-progress'); const bar=make('i'); bar.id='voyage-survey-bar'; p.append(bar);
    const label=make('p','muted'); label.id='voyage-survey-label';
    box.append(label,p,warpButtons());
  } else if(!explored) {
    box.append(make('p',null,`Tutki ${name} kiertoradalta. Kartoitus kestää vuorokauden, ${after}.`),
      actions(button('voyage-go',isMoon(name) ? 'Tutki kuu' : 'Tutki planeetta',startSurvey)));
  } else if(refuel && game.fuel<fuelMax()-0.005) {
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
    ['Tutkitut planeetat',`${game.explored.filter(n=>!isMoon(n)).length}/8: ${game.explored.filter(n=>!isMoon(n)).join(', ')}`],
    ['Tutkitut kuut',`${game.explored.filter(isMoon).length}/${MOON_NAMES.length}${game.explored.some(isMoon) ? `: ${game.explored.filter(isMoon).join(', ')}` : ''}`],
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
  if(game.location==='Maa') body.append(shipyard());
  body.append(make('h3',null,'Valitse kohde'));
  const targetButton=(name, onClick)=>{
    const b=button(`sky-btn${game.explored.includes(name) ? '' : ' voyage-new'}`,name,onClick);
    b.setAttribute('aria-pressed',String(name===target));
    return b;
  };
  const targets=make('div','voyage-targets');
  if(isMoon(game.location)) {
    // Kuusta palataan emoplaneetan kiertoradalle, ja sieltä voi jatkaa muualle.
    const parent=MOONS[game.location].parent;
    targets.append(targetButton(parent,()=>localOption(parent)));
    body.append(targets, make('p','muted',`Kuusta lennetään ensin takaisin ${NAMES[parent][0]} kiertoradalle.`));
  } else {
    for(const name of PLANET_NAMES) if(name!==game.location) targets.append(targetButton(name,()=>search(name)));
    body.append(targets);
    const moons=game.location ? moonsOf(game.location) : [];
    if(moons.length) {
      const row=make('div','voyage-targets');
      row.append(...moons.map(m=>targetButton(m,()=>localOption(m))));
      body.append(make('h3',null,`${NAMES[game.location][0]} kuut`), row);
    }
  }
  if(!target) {
    body.append(make('p','muted','Sovellus laskee siirtoradan valmiiksi: se etsii seuraavan kahden vuoden laukaisuikkunat ja näyttää halvimman sekä nopeammat vaihtoehdot. Tutkimattomat planeetat on merkitty pisteellä. Polttoaine täydentyy, kun kohdeplaneetta on tutkittu.'));
  } else if(!options) {
    const p=make('div','voyage-progress'); const bar=make('i'); bar.id='voyage-progress-bar'; bar.style.width=`${progress*100}%`; p.append(bar);
    body.append(make('p','muted',`Haetaan laukaisuikkunoita ja linkousreittejä: ${fromText(here())} ${NAMES[target][1]}…`), p);
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

// Telakka Maan kiertoradalla: aluksen vaihto. Uusi alus on täyteen tankattu.
function shipyard() {
  const box=make('div','voyage-info');
  box.append(make('h3',null,'Alus'));
  const seg=make('div','seg voyage-ships'); seg.setAttribute('role','group'); seg.setAttribute('aria-label','Alus');
  for(const [id,ship] of Object.entries(SHIPS)) {
    const b=button('',ship.name,()=>{
      if(id===game.ship) return;
      game.ship=id; game.fuel=ship.fuel; options=null; target=null;
      game.log.push({t:simNow(), text:`Vaihdettiin alukseen: ${ship.name} (${ship.fuel} km/s)`});
      save(); render();
    });
    b.setAttribute('aria-pressed',String(id===game.ship)); seg.append(b);
  }
  box.append(seg, make('p','muted',`${SHIPS[game.ship].text} Δv-budjetti ${SHIPS[game.ship].fuel} km/s.`));
  return box;
}

function waiting(body) {
  const p=game.plan, ion=!!p.spiralOut, ready=simNow()>=holdAt();
  body.append(make('h3',null,`Lento ${NAMES[p.to][1]}`));
  const rows=[['Lähtö',fmtDate(p.depart)],['Lentoaika',fmtDays((p.arrive-p.depart)/DAY)],['Perillä',fmtDate(p.arrive)],
    ['Δv',`${dv(p.dvDep)}${p.dvFlyby>0.005 ? ` + ${dv(p.dvFlyby)}` : ''} + ${dv(p.dvArr)} = ${dv(p.dvTotal)}`]];
  if(p.flyby) rows.splice(2,0,['Linkous',`${p.flyby.body} ${fmtDate(p.flyby.t)}`]);
  if(ion) rows.push(['Spiraalinousu',`${fmtDate(p.depart-p.spiralOut)} alkaen, ${fmtDays(p.spiralOut/DAY)}`]);
  body.append(list(rows,'voyage-plan'));
  if(ion && p.spiralStarted) {
    const bar=make('div','voyage-progress'), i=make('i'); i.id='voyage-spiral-bar'; bar.append(i);
    const count=make('div','voyage-count'); count.id='voyage-count';
    body.append(count, viewSwitch(), showCockpit() ? cockpitStage() : mapStage(),
      make('p','muted','Ionimoottori kiihdyttää alusta spiraalina ulospäin. Siirtorata alkaa, kun spiraali on valmis.'), bar, warpButtons());
    return;
  }
  const count=make('div','voyage-count'); count.id='voyage-count'; count.dataset.ready=ready ? '1' : '';
  body.append(count, viewSwitch(), showCockpit() ? cockpitStage() : mapStage());
  const cancel=button('sky-btn','Peru lento',()=>{game.plan=null; options=null; target=null; save(); render();});
  if(!ready) {
    body.append(make('p','muted','Odota laukaisuikkunaa tai kiihdytä aikaa. Kello pysähtyy laukaisuhetkeen, joten ikkuna ei mene ohi.'), warpButtons(),
      actions(button('sky-btn',ion ? 'Siirry spiraalin alkuun' : 'Siirry laukaisuhetkeen',()=>{anchor(holdAt(),0); render();}), cancel));
  } else if(ion) {
    body.append(make('p','muted',`Spiraalinousu kuluttaa ${dv(p.dvDep)} polttoainetta ja kestää ${fmtDays(p.spiralOut/DAY)}.`),
      actions(button('voyage-go','Aloita spiraalinousu',startSpiral), cancel));
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

// Ennusteen kuvaus: saapuminen ja jarrutus tai ohitusetäisyys.
function forecast(f) {
  return f.miss ? `ohittaa ${NAMES[f.to][2]} ${fmtKm(f.missKm)} etäisyydeltä ${fmtDate(f.arrive)} (vaikutuspiiri ${fmtKm(FLIGHT_BODIES[f.to].soiKm)})`
    : `saapuu ${NAMES[f.to][0]} luo ${fmtDate(f.arrive)}, jarrutus ${dv(f.dvArr)}`;
}

// Kurssikorjaukset: poltto valittuun suuntaan, ennuste ennen polttoa ja automaattinen korjaus kohteeseen.
function burnPanel() {
  const f=game.flight, t=simNow();
  const d=make('details','voyage-log voyage-burn'); d.open=burnOpen;
  // toggle laukeaa myös, kun open asetetaan koodista; reagoidaan vain todelliseen muutokseen.
  d.addEventListener('toggle',()=>{if(d.open===burnOpen) return; burnOpen=d.open; burnPreview=null; if(burnOpen) render(); else draw();});
  d.append(make('summary',null,'Kurssikorjaus'));
  if(!burnOpen) return d;
  const seg=(items, value, pick)=>{
    const box=make('div','seg'); box.setAttribute('role','group');
    for(const [v,label] of items) {const b=button('',label,()=>{pick(v); burnPreview=null; render();}); b.setAttribute('aria-pressed',String(v===value)); box.append(b);}
    return box;
  };
  burnPreview ??= applyBurn(f,t,burnDir,burnDv);
  d.append(make('p','muted',`Nykyinen rata ${forecast(f)}.`),
    seg(BURN_DIRS,burnDir,v=>{burnDir=v;}), seg(BURN_SIZES,burnDv,v=>{burnDv=v;}),
    make('p',null,`Polton jälkeen rata ${forecast(burnPreview)}.`));
  const burn=button('voyage-go',`Polta ${BURN_SIZES.find(([v])=>v===burnDv)[1]}`,()=>{
    if(game.fuel<burnDv) return;
    game.fuel-=burnDv; game.flight={...applyBurn(game.flight,simNow(),burnDir,burnDv)};
    game.log.push({t:simNow(), text:`Kurssikorjaus: ${BURN_SIZES.find(([v])=>v===burnDv)[1]} ${BURN_DIRS.find(([v])=>v===burnDir)[1].toLowerCase()}`});
    // Lyhyt tärinä polton merkiksi: laukaisun tärinän viimeinen sekunti.
    burnPreview=null; notice=''; launchedAt=Date.now()-6000; save(); render();
  });
  burn.disabled=game.fuel<burnDv;
  const buttons=[burn];
  if(f.legs?.length>1 || f.miss) {
    const fix=autoCorrect(f,t);
    if(fix && fix.dv>0.0005) {
      const auto=button('sky-btn',`Korjaa kurssi kohteeseen (${dv(fix.dv)})`,()=>{
        if(game.fuel<fix.dv) return;
        game.fuel-=fix.dv; game.flight={...fix.flight};
        game.log.push({t:simNow(), text:`Automaattinen kurssikorjaus kohti ${NAMES[f.to][2]} (Δv ${dv(fix.dv)})`});
        burnPreview=null; save(); render();
      });
      auto.disabled=game.fuel<fix.dv;
      buttons.push(auto);
    }
  }
  d.append(actions(...buttons), make('p','muted','Poltto näkyy kartalla vihreänä katkoviivana ennen kuin sen tekee. Polttoaine kuluu polton verran.'));
  return d;
}

function flying(body) {
  const f=game.flight, arrived=simNow()>=f.arrive;
  shownArrived=arrived;
  const clock=make('div','voyage-count'); clock.id='voyage-met';
  const stats=make('div','voyage-stats');
  stats.append(stat(f.local ? `Nopeus ${NAMES[f.parent][0]} suhteen` : 'Nopeus Auringon suhteen','voyage-speed','voyage-speed-sub'), stat(`Etäisyys ${NAMES[f.to][2]}`,'voyage-dist','voyage-eta'),
    stat('Etäisyys Auringosta','voyage-sun'), stat('Valon kulkuaika Maahan','voyage-light'));
  body.append(clock, viewSwitch(), showCockpit() ? cockpitStage() : mapStage(), stats);
  if(cockpitError) body.append(make('p','muted',cockpitError));
  if(arrived && f.miss) {
    body.append(make('p',null,`Alus ohitti ${NAMES[f.to][0]} ${fmtKm(f.missKm)} etäisyydeltä, vaikutuspiirin ulkopuolelta. Se jatkaa Auringon ympäri.`),
      actions(button('voyage-go','Jatka ohilentoa',capture)));
  } else if(arrived && game.fuel>=f.dvArr-1e-9) {
    body.append(make('p',null,f.spiralIn ? `Alus on ${NAMES[f.to][0]} luona. Spiraalilasku (${dv(f.dvArr)}, ${fmtDays(f.spiralIn/DAY)}) vie sen kiertoradalle ${orbitText(f.to)}.`
      : `Alus on ${NAMES[f.to][0]} luona. Jarrutuspoltto (${dv(f.dvArr)}) vie sen kiertoradalle ${orbitText(f.to)}.`),
      actions(button('voyage-go',f.spiralIn ? 'Aloita spiraalilasku' : 'Jarruta kiertoradalle',capture)));
  } else if(arrived && f.local) {
    body.append(make('p',null,`Polttoaine (${dv(game.fuel)}) ei riitä jarrutukseen (${dv(f.dvArr)}).`), actions(button('sky-btn','Aloita alusta',restart)));
  } else if(arrived) {
    body.append(make('p',null,`Alus on ${NAMES[f.to][0]} luona, mutta polttoaine (${dv(game.fuel)}) ei riitä jarrutukseen (${dv(f.dvArr)}). Alus ohittaa planeetan ja jatkaa Auringon ympäri.`),
      actions(button('voyage-go','Jatka ohilentoa',capture)));
  } else {
    const flyby=f.flyby && !f.flyby.done ? `Linkous ${NAMES[f.flyby.body][0]} ohi ${fmtDate(f.flyby.t)} ${fmtKm(f.flyby.rpKm-FLIGHT_BODIES[f.flyby.body].radiusKm)} korkeudelta. ` : '';
    const n=make('p','muted',notice || (f.local ? `Perillä ${fmtDate(f.arrive)} ${fmtClock(f.arrive)}.`
      : f.miss ? `Nykyinen rata ${forecast(f)}. Tee kurssikorjaus, jotta alus osuu vaikutuspiiriin.`
      : `${flyby}${NAMES[f.to][0]} vaikutuspiiriin ${fmtDate(f.soi)}. Kiihdytys pienenee automaattisesti ennen tapahtumia.`));
    body.append(warpButtons(), n);
    // Ionialus ei voi tehdä hetkellisiä polttoja, eikä paikallisella siirrolla tarvita korjauksia.
    if(!f.local && !f.spiralIn) body.append(burnPanel());
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
  const ship=f ? shipState(f,t) : departureState(tr.from,t);
  // Paikallisella siirrolla nopeus näytetään emoplaneetan suhteen.
  const speed=f?.local ? norm(ship.rel.v) : norm(ship.v);
  const near=f?.local ? {name:f.parent, speed:norm(ship.rel.v)} : f || !isPlanet(tr.from) ? nearestPlanet(ship.r,ship.v,t) : {name:tr.from, speed:0};
  return {
    met: f ? `T+ ${fmtDuration(t-f.depart)}` : countdown ? `T− ${Math.max(1,Math.ceil((countdown-Date.now())/1000))} s` : `T− ${fmtDuration(tr.depart-t)}`,
    date: fmtDate(t), speed, near,
    dist: fmtKm(gap(ship.r,bodyState(tr.to,t).r)),
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
        ['NOPEUS',name ? [[`${num(norm(ship.rel.v),2)} km/s`,44],[`${num(norm(ship.rel.v)*3600)} km/h`,28,'#8b9ac0'],[`${name} ${num(norm(ship.rel.r)-orbitOf(name).radiusKm)} km`,26,'#8b9ac0']]
          : [[`${num(norm(ship.v),2)} km/s`,44],['Auringon suhteen',28,'#8b9ac0']]],
        [name ? name.toUpperCase() : 'POLTTOAINE',[[game.survey ? 'kartoitus käynnissä' : name && game.explored.includes(name) ? 'tutkittu' : name ? 'tutkimatta' : '',30],[`polttoaine ${num(game.fuel,2)} km/s`,26,'#8b9ac0']],game.fuel/fuelMax()],
      ]};
  }
  const r=readouts(t);
  const ship=game.flight ? shipView(tr,t) : isPlanet(tr.from) ? parkingState(tr.from,t) : departureState(tr.from,t);
  // Lennolla nokka osoittaa ensin lähtöplaneettaan, sitten linkousplaneettaan (vielä 3 h ohituksen jälkeen, jotta
  // planeetan näkee loittonevan) ja lopuksi kohteeseen.
  const aim=game.flight ? (isPlanet(tr.from) && t<tr.exit ? tr.from : tr.flyby && t<tr.flyby.t+3*3600000 ? tr.flyby.body : tr.to) : isPlanet(tr.from) ? tr.from : tr.to;
  return {
    ...base, ship, aim,
    screens:[
      ['LENTOAIKA',[[r.met,36],[r.date,28,'#8b9ac0'],[WARPS[game.warp][1],28,'#ffb547']]],
      ['NOPEUS',[[`${num(r.speed,2)} km/s`,44],[`${num(r.speed*3600)} km/h`,28,'#8b9ac0'],[game.flight ? `${r.near.name} ${num(r.near.speed,2)} km/s` : 'pysäköintirata',26,'#8b9ac0']]],
      [`KOHDE: ${tr.to.toUpperCase()}`,[[r.dist,34],[`polttoaine ${num(game.fuel,2)} km/s`,26,'#8b9ac0']],game.fuel/fuelMax()],
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
    const p=game.plan, left=holdAt()-t, count=document.getElementById('voyage-count');
    if(p.spiralStarted) {
      const f=Math.min(1,1-(p.depart-t)/p.spiralOut), bar=document.getElementById('voyage-spiral-bar');
      if(bar) bar.style.width=`${f*100}%`;
      set('voyage-count',`Spiraali ${num(f*100)} % · T− ${fmtDuration(p.depart-t)}`);
    } else {
      set('voyage-count',countdown ? `${Math.max(1,Math.ceil((countdown-Date.now())/1000))}` : left>0 ? `T− ${fmtDuration(left)}` : 'T− 0');
      if(count && left<=0 && !count.dataset.ready) {count.dataset.ready='1'; render();}
    }
  }
  if(game.survey) {
    const sv=game.survey, end=sv.start+(sv.dur ?? SURVEY_MS), f=Math.min(1,(t-sv.start)/(end-sv.start)), bar=document.getElementById('voyage-survey-bar');
    if(bar) bar.style.width=`${f*100}%`;
    const what=sv.kind==='spiral' ? 'Spiraalilasku kiertoradalle' : game.explored.includes(sv.body) ? 'Tankkaus' : `Kartoitus: ${sv.body}`;
    set('voyage-survey-label',`${what} ${num(f*100)} % · valmis ${fmtDate(end)} ${fmtClock(end)}`);
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

// Kuiden luona kartta keskitetään emoplaneettaan ja rajataan kuun radan mukaan.
function localParent() {
  const f=game.flight ?? game.plan;
  if(f?.local) return f.parent;
  if(!f && isMoon(game.location)) return MOONS[game.location].parent;
  return null;
}
function fitRadius() {
  const f=game.flight ?? game.plan, parent=localParent();
  if(parent) return Math.max(...moonsOf(parent).filter(m=>[f?.to,f?.from,game.location].includes(m)).map(m=>MOONS[m].aKm))*1.3/AU_KM;
  if(!f) return Math.max(1.6,norm(departureState(here(),simNow()).r)/AU_KM*1.25);
  return Math.max(norm(f.r1 ?? departureState(f.from,f.depart).r),norm(bodyState(f.to,f.arrive).r))/AU_KM*1.12;
}

function draw() {
  const canvas=document.getElementById('voyage-map'), f=game?.flight ?? game?.plan;
  if(!canvas || !game) return;
  const w=canvas.clientWidth, h=canvas.clientHeight, scale=window.devicePixelRatio||1;
  if(!w||!h) return;
  if(canvas.width!==Math.round(w*scale) || canvas.height!==Math.round(h*scale)) {canvas.width=Math.round(w*scale); canvas.height=Math.round(h*scale);}
  const t=simNow(), ship=!f ? departureState(here(),t) : t>f.depart ? shipState(f,t) : departureState(f.from,t), shipAu=toAu(ship.r);
  const radius=mapRadius ?? fitRadius(), k=Math.min(w,h)/2/radius;
  const parent=localParent(), center=mapFollow ? shipAu : parent ? toAu(planetState(parent,t).r) : [0,0];
  const toPx=([x,y])=>[w/2+(x-center[0])*k, h/2-(y-center[1])*k];
  const ctx=canvas.getContext('2d');
  ctx.setTransform(scale,0,0,scale,0,0);
  drawScene(ctx,solarSystem(t),toPx,w,h,k,f?.to ?? game.location);
  if(parent) drawMoons(ctx,parent,t,toPx,w,h);
  if(f) drawTransfer(ctx,f,t,toPx,w);
  if(burnOpen && burnPreview && game.flight) {
    const N=200, a=t, b=Math.max(t,burnPreview.arrive);
    ctx.beginPath();
    for(let i=0;i<=N;i++) {const p=toPx(toAu(shipState(burnPreview,a+(b-a)*i/N).r)); i ? ctx.lineTo(p[0],p[1]) : ctx.moveTo(p[0],p[1]);}
    ctx.strokeStyle='#4ade80'; ctx.globalAlpha=0.8; ctx.lineWidth=1.5; ctx.setLineDash([3,4]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha=1;
  }
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

  // Linkousplaneetta ohitushetkellä.
  if(f.flyby && t<f.flyby.t) {
    const [fx,fy]=toPx(toAu(planetState(f.flyby.body,f.flyby.t).r));
    ctx.beginPath(); ctx.arc(fx,fy,6,0,2*Math.PI); ctx.strokeStyle='#4ade80'; ctx.lineWidth=1.2; ctx.setLineDash([2,3]); ctx.stroke(); ctx.setLineDash([]);
  }

  // Kohdeplaneetan paikka saapumishetkellä.
  if(t<f.arrive) {
    const [ax,ay]=toPx(toAu(bodyState(f.to,f.arrive).r));
    ctx.beginPath(); ctx.arc(ax,ay,7,0,2*Math.PI); ctx.strokeStyle='#fff'; ctx.lineWidth=1.2; ctx.setLineDash([2,3]); ctx.stroke(); ctx.setLineDash([]);
    ctx.font='11px system-ui, sans-serif'; ctx.textAlign='center'; ctx.lineWidth=3; ctx.strokeStyle='#03050b';
    const label=`${f.miss ? 'ohitus' : 'saapuminen'} ${new Date(f.arrive).toLocaleDateString('fi-FI')}`;
    const half=ctx.measureText(label).width/2+4, lx=Math.max(half,Math.min(w-half,ax));
    ctx.strokeText(label,lx,ay+20); ctx.fillStyle='#c9d3ec'; ctx.fillText(label,lx,ay+20);
  }
}

// Emoplaneetan kuut ratoineen, kun ollaan kuiden luona.
function drawMoons(ctx, parent, t, toPx, w, h) {
  const p=planetState(parent,t).r;
  ctx.font='11px system-ui, sans-serif'; ctx.textAlign='center';
  for(const m of moonsOf(parent)) {
    const a=MOONS[m].aKm, c=toPx(toAu(p)), edge=toPx(toAu([p[0]+a,p[1],p[2]]));
    ctx.beginPath(); ctx.arc(c[0],c[1],Math.abs(edge[0]-c[0]),0,2*Math.PI); ctx.strokeStyle=MOONS[m].color; ctx.globalAlpha=0.35; ctx.lineWidth=1; ctx.stroke(); ctx.globalAlpha=1;
    const [x,y]=toPx(toAu(bodyState(m,t).r));
    if(x<-20||x>w+20||y<-20||y>h+20) continue;
    ctx.beginPath(); ctx.arc(x,y,3,0,2*Math.PI); ctx.fillStyle=MOONS[m].color; ctx.fill();
    ctx.fillStyle='#c9d3ec'; ctx.fillText(m,x,y-7);
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
  const it=windowSearch(here(),to,simNow(),{fuel:game.fuel, ship:game.ship});
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

// Kuu tai paluu emoplaneetalle: paikallinen siirto lähtee heti, joten vaihtoehtoja on yksi.
function localOption(to) {
  searchId++; target=to;
  const tr=localTransfer(game.location,to,simNow()+60000);
  options=[{kind:'local', ...tr, fuelOk:tr.dvTotal<=game.fuel}];
  render();
}

function choose(o) {
  // Haun aikana kello on edennyt: jo mennyt lähtö siirretään tähän hetkeen samalla lentoajalla.
  const now=simNow(), late=o.depart-(o.spiralOut ?? 0)<now;
  let tr=o;
  if(o.local) tr=localTransfer(o.from,o.to,now+60000);
  else if(late && o.kind==='assist') tr=assistTransfer(o.from,o.via,o.to,now,(o.flyby.t-o.depart)/DAY,(o.arrive-o.flyby.t)/DAY,o.ship);
  else if(late) tr=transfer(o.from,o.to,now+(o.spiralOut ?? 0),(o.arrive-o.depart)/DAY,o.ship);
  if(!tr || tr.dvTotal>game.fuel) {notice='Ikkuna ehti mennä ohi. Hae reitit uudelleen.'; options=null; target=null; render(); return;}
  const {kind,fuelOk,r2,v2,...plan}=tr;
  game.plan=plan;
  save(); render();
}

function startSpiral() {
  const p=game.plan;
  p.spiralStarted=true; game.fuel=Math.max(0,game.fuel-p.dvDep);
  game.log.push({t:simNow(), text:`Spiraalinousu alkoi ${fromText(p.from)} kohti ${NAMES[p.to][2]} (Δv ${dv(p.dvDep)})`});
  save(); render();
}

function launch() {
  const p=game.plan;
  countdown=null; notice=''; mapRadius=null; mapFollow=false; burnOpen=false; burnPreview=null;
  // Ionialuksen polttoaine kului jo spiraalinousussa, eikä hiljainen ionimoottori täräytä ohjaamoa.
  if(!p.spiralStarted) {game.fuel=Math.max(0,game.fuel-p.dvDep); launchedAt=Date.now();}
  game.flight=p.local ? {...p, soi:p.arrive, exit:p.depart} : {...p, soi:soiEntry(p), exit:soiExit(p)};
  game.plan=null; game.drift=null; game.location=null;
  game.log.push({t:p.depart, text:p.spiralStarted ? `Spiraalinousu valmis, siirtorata kohti ${NAMES[p.to][2]} alkoi`
    : `Laukaisu ${fromText(p.from)} kohti ${NAMES[p.to][2]}${p.flyby ? ` ${NAMES[p.flyby.body][0]} kautta` : ''} (Δv ${dv(p.dvDep)})`});
  anchor(p.depart,0); render();
}

// Saapuminen: jarrutus kiertoradalle, tai ohilento, jos polttoaine ei riitä. Lento kirjataan lokikirjaan.
function capture() {
  const f=game.flight, captured=!f.miss && game.fuel>=f.dvArr-1e-9, stats=flightStats(f);
  game.flights.push({fromName:isPlanet(f.from) ? f.from : 'Auringon kiertorata', to:f.to, depart:f.depart, arrive:f.arrive, km:stats.km, maxSpeed:stats.maxSpeed, captured});
  if(captured) {
    game.fuel=Math.max(0,game.fuel-f.dvArr);
    game.location=f.to; game.drift=null;
    const took=f.arrive-f.depart<2*DAY ? fmtDuration(f.arrive-f.depart).replace(/^0 vrk /,'') : fmtDays((f.arrive-f.depart)/DAY);
    game.log.push({t:f.arrive, text:`Saapuminen ${NAMES[f.to][0]} kiertoradalle ${took} lennon jälkeen (Δv ${dv(f.dvArr)})`});
    // Ionialus laskeutuu kiertoradalle spiraalina, joka kestää kuten kartoitus.
    if(f.spiralIn) game.survey={kind:'spiral', body:f.to, start:f.arrive, dur:f.spiralIn};
  } else {
    const s=shipState(f,f.arrive);
    game.location=null; game.drift={r:s.r, v:s.v, t:f.arrive};
    game.log.push({t:f.arrive, text:f.miss ? `Ohilento: ${f.to} ohitettiin ${fmtKm(f.missKm)} etäisyydeltä` : `Ohilento: polttoaine ei riittänyt jarrutukseen ${NAMES[f.to][0]} kiertoradalle`});
  }
  game.flight=null; options=null; target=null; notice='';
  anchor(f.arrive,0); render();
}

function startSurvey() {
  game.survey={kind:'survey', body:game.location, start:simNow()};
  save(); render();
}
function finishSurvey() {
  const {body,start,kind,dur}=game.survey, end=start+(dur ?? SURVEY_MS);
  game.survey=null; logOpen=false; notice='';
  if(kind==='spiral') {
    game.log.push({t:end, text:`Spiraalilasku valmis: ${NAMES[body][0]} kiertoradalla`});
    save(); render(); return;
  }
  const first=!game.explored.includes(body), refuel=canRefuel(game.ship,body);
  if(first) game.explored.push(body);
  if(refuel) game.fuel=fuelMax();
  const planets=game.explored.filter(n=>!isMoon(n)).length, moons=game.explored.filter(isMoon).length;
  const count=isMoon(body) ? `${moons}/${MOON_NAMES.length} kuuta` : `${planets}/8 planeettaa`;
  game.log.push({t:end, text:first ? `${body} tutkittu (${count})${refuel ? ', polttoaine täydennetty' : ''}` : `Tankkaus ${NAMES[body][0]} kiertoradalla`});
  if(first && !isMoon(body) && planets===8) game.log.push({t:end, text:'Kaikki aurinkokunnan planeetat on tutkittu!'});
  save(); render();
}

// Linkous: ohilennon poltto (jos tarvitaan) tehdään perikeskuksessa.
function flybyDone() {
  const f=game.flight;
  f.flyby={...f.flyby, done:true};
  game.fuel=Math.max(0,game.fuel-f.flyby.dv);
  game.log.push({t:f.flyby.t, text:`Linkous ${NAMES[f.flyby.body][0]} ohi ${fmtKm(f.flyby.rpKm-FLIGHT_BODIES[f.flyby.body].radiusKm)} korkeudelta${f.flyby.dv>0.005 ? ` (Δv ${dv(f.flyby.dv)})` : ''}`});
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
  const f=game.flight;
  if(f?.flyby && !f.flyby.done && t>=f.flyby.t) flybyDone();
  if(game.plan?.spiralStarted && t>=game.plan.depart) launch();
  if(game.survey && t>=game.survey.start+(game.survey.dur ?? SURVEY_MS)) finishSurvey();
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
