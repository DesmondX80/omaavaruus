// Avaruuslento: peli, jossa lähdetään Maasta raketilla tutkimaan planeettoja. Avautuu koko näytön tilaan
// Aurinkokunta-kortin painikkeesta tai osoitteella #lento. Kaikki lasketaan selaimessa (flight.js), ja tila
// tallentuu tämän selaimen localStorageen.
//
// Pelin kello: simulaatioaika = ankkuri + (oikea aika − ankkurin oikea aika) × kiihdytys. Kun peli on suljettuna
// tai taustalla, aika kulkee oikeaa vauhtia (1×), joten raketti lentää myös sovelluksen ollessa kiinni.
import { el, num, saved, button } from './core.js';
import { FLIGHT_BODIES, FUEL_KMS, fmtDuration, transfer, windowSearch } from './flight.js';

const KEY = 'avaruuslento';
const DAY = 86400000;
/** Aikakiihdytykset: kerroin ja nimi. */
export const WARPS = [[1,'1×'],[10,'10×'],[100,'100×'],[3600,'1 h/s'],[86400,'1 vrk/s'],[7*86400,'1 vk/s'],[30*86400,'1 kk/s'],[365.25*86400,'1 v/s']];
const NAMES = {
  Merkurius:['Merkuriuksen','Merkuriukseen'], Venus:['Venuksen','Venukseen'], Maa:['Maan','Maahan'], Mars:['Marsin','Marsiin'],
  Jupiter:['Jupiterin','Jupiteriin'], Saturnus:['Saturnuksen','Saturnukseen'], Uranus:['Uranuksen','Uranukseen'], Neptunus:['Neptunuksen','Neptunukseen'],
};
const KINDS = {cheapest:['Halvin','Vähiten polttoainetta'], faster:['Nopeampi','Lyhyempi lento, enemmän polttoainetta'], earliest:['Aikaisin perillä','Nopein reitti, johon polttoaine riittää']};

const fresh = () => ({v:1, location:'Maa', fuel:FUEL_KMS, simTime:Date.now(), realTime:Date.now(), warp:0, plan:null, log:[]});
let game=null, options=null, target=null, searchId=0, progress=0, frame=null, lastSave=0;

// --- Kello ---

function rawTime() { return game.simTime+(Date.now()-game.realTime)*WARPS[game.warp][0]; }
/** Simulaation hetki (ms). Ennen laukaisua kello pysähtyy laukaisuhetkeen, jotta ikkuna ei mene ohi. */
export function simNow() {
  const t=rawTime();
  if(game.plan && t>=game.plan.depart) {
    if(game.warp>0 || game.simTime<game.plan.depart) {game.simTime=game.plan.depart; game.realTime=Date.now(); game.warp=0; save();}
    return game.plan.depart;
  }
  return t;
}
function setWarp(i) { game.simTime=simNow(); game.realTime=Date.now(); game.warp=i; save(); render(); }

function save() { lastSave=Date.now(); saved.set(KEY,game); }
// Taustalle mentäessä kiihdytys palaa 1×:ään: suljettuna aika kulkee oikeaa vauhtia.
function park() { if(!game) return; if(game.warp) {game.simTime=simNow(); game.realTime=Date.now(); game.warp=0;} save(); }

function load() {
  const s=saved.get(KEY,null);
  game=s?.v===1 ? s : fresh();
  // Jos tallennus jäi kiihdytykselle (selain suljettiin kesken), suljettu aika lasketaan silti 1×:nä.
  if(game.warp) {game.warp=0;}
  simNow();
}

// --- Muotoilu ---

const fmtDate = t => new Date(t).toLocaleDateString('fi-FI',{weekday:'short',day:'numeric',month:'numeric',year:'numeric'});
const fmtClock = t => new Date(t).toLocaleTimeString('fi-FI',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
const dv = v => `${num(v,2)} km/s`;
function fmtDays(days) {
  if(days<730) return `${num(Math.round(days))} vrk`;
  const y=Math.floor(days/365.25);
  return `${y} v ${num(Math.round(days-y*365.25))} vrk`;
}
function orbitText(name) {
  const b=FLIGHT_BODIES[name], peri=b.periKm-b.radiusKm, apo=b.apoKm-b.radiusKm;
  return peri===apo ? `${num(peri)} km korkeudella` : `${num(peri)} × ${num(apo)} km radalla`;
}

// --- Näkymät ---

function make(tag, className, text) { const n=document.createElement(tag); if(className) n.className=className; if(text!=null) n.textContent=text; return n; }

function status() {
  const box=make('div','voyage-status');
  const where=make('div','stat');
  where.append(make('span',null,'Sijainti'), make('b',null,`${NAMES[game.location][0]} kiertoradalla`), make('small','muted',orbitText(game.location)));
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
  const rows=[
    ['Lähtö', `${fmtDate(o.depart)}${wait>DAY ? ` (${fmtDays(wait/DAY)} päästä)` : ''}`],
    ['Lentoaika', fmtDays(days)],
    ['Perillä', fmtDate(o.arrive)],
    ['Δv', `lähtö ${dv(o.dvDep)} + jarrutus ${dv(o.dvArr)} = ${dv(o.dvTotal)}`],
  ];
  const dl=make('dl');
  for(const [k,v] of rows) dl.append(make('dt',null,k), make('dd',null,v));
  card.append(head, make('small','muted',sub), dl);
  return card;
}

function planning(body) {
  body.append(make('h3',null,'Valitse kohde'));
  const targets=make('div','voyage-targets');
  for(const name of Object.keys(FLIGHT_BODIES)) {
    if(name===game.location) continue;
    const b=button('sky-btn',name,()=>search(name));
    b.setAttribute('aria-pressed',String(name===target));
    targets.append(b);
  }
  body.append(targets);
  if(!target) {
    body.append(make('p','muted','Sovellus laskee siirtoradan valmiiksi: se etsii seuraavan kahden vuoden laukaisuikkunat ja näyttää halvimman sekä nopeammat vaihtoehdot. Polttoaine täydentyy, kun kohdeplaneetta on tutkittu.'));
    return;
  }
  if(!options) {
    const p=make('div','voyage-progress'); const bar=make('i'); bar.id='voyage-progress-bar'; bar.style.width=`${progress*100}%`; p.append(bar);
    body.append(make('p','muted',`Haetaan laukaisuikkunoita: ${NAMES[game.location][0]} kiertoradalta ${NAMES[target][1]}…`), p);
    return;
  }
  if(!options.length) {body.append(make('p','muted','Siirtorataa ei löytynyt. Kokeile toista kohdetta.')); return;}
  body.append(make('h3',null,`Lento ${NAMES[target][1]}`));
  const list=make('div','voyage-options');
  list.append(...options.map(optionCard));
  body.append(list);
  if(options.every(o=>!o.fuelOk)) body.append(make('p','muted','Polttoaine ei riitä yhteenkään vaihtoehtoon. Valitse lähempi kohde.'));
}

function waiting(body) {
  const p=game.plan, t=simNow(), ready=t>=p.depart;
  body.append(make('h3',null,`Lento ${NAMES[p.to][1]}`));
  const dl=make('dl','voyage-plan');
  for(const [k,v] of [['Lähtö',fmtDate(p.depart)],['Lentoaika',fmtDays((p.arrive-p.depart)/DAY)],['Perillä',fmtDate(p.arrive)],['Δv',`${dv(p.dvDep)} + ${dv(p.dvArr)} = ${dv(p.dvTotal)}`]])
    dl.append(make('dt',null,k), make('dd',null,v));
  body.append(dl);
  const count=make('div','voyage-count'); count.id='voyage-count'; count.dataset.ready=ready ? '1' : '';
  body.append(count);
  if(!ready) {
    body.append(make('p','muted','Odota laukaisuikkunaa tai kiihdytä aikaa. Kello pysähtyy laukaisuhetkeen, joten ikkuna ei mene ohi.'));
    const warps=make('div','seg voyage-warps'); warps.setAttribute('role','group'); warps.setAttribute('aria-label','Aikakiihdytys');
    WARPS.forEach(([,label],i)=>{const b=button('',label,()=>setWarp(i)); b.setAttribute('aria-pressed',String(i===game.warp)); warps.append(b);});
    body.append(warps);
  }
  const actions=make('div','voyage-actions');
  if(!ready) actions.append(button('sky-btn','Siirry laukaisuhetkeen',()=>{game.simTime=p.depart; game.realTime=Date.now(); game.warp=0; save(); render();}));
  else {
    const launch=button('voyage-go','Laukaise',()=>{}); launch.disabled=true;
    actions.append(launch);
  }
  actions.append(button('sky-btn','Peru lento',()=>{game.plan=null; options=null; target=null; save(); render();}));
  body.append(actions);
  if(ready) body.append(make('p','muted','Laukaisuikkuna on auki. Laukaisu ja lentonäkymä tulevat seuraavassa vaiheessa.'));
}

function render() {
  if(!game || el('voyage').hidden) return;
  const body=el('voyage-body');
  body.replaceChildren(status());
  if(game.plan) waiting(body); else planning(body);
  updateClock();
}

function updateClock() {
  const t=simNow();
  el('voyage-date').textContent=fmtDate(t);
  el('voyage-time').textContent=`${fmtClock(t)} · ${WARPS[game.warp][1]}`;
  const count=document.getElementById('voyage-count');
  if(count && game.plan) {
    const left=game.plan.depart-t;
    count.textContent=left>0 ? `T− ${fmtDuration(left)}` : 'T− 0';
    if(left<=0 && !count.dataset.ready) {count.dataset.ready='1'; render();}
  }
}

// --- Toiminnot ---

async function search(to) {
  const id=++searchId; target=to; options=null; progress=0; render();
  const it=windowSearch(game.location,to,simNow(),{fuel:game.fuel});
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

// --- Avaaminen ja sulkeminen ---

function tick() {
  frame=null;
  if(el('voyage').hidden || document.hidden) return;
  updateClock();
  if(Date.now()-lastSave>5000) save();
  frame=setTimeout(()=>requestAnimationFrame(tick),100);
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
    if(document.hidden) park(); else {load(); render(); if(!frame) tick();}
  });
  window.addEventListener('pagehide',park);
  sync();
}
