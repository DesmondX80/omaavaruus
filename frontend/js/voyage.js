// Avaruuslento: peli, jossa lähdetään Maasta raketilla tutkimaan planeettoja. Avautuu koko näytön tilaan
// Aurinkokunta-kortin painikkeesta tai osoitteella #lento. Kaikki lasketaan selaimessa (flight.js), ja tila
// tallentuu tämän selaimen localStorageen.
//
// Pelin kello: simulaatioaika = ankkuri + (oikea aika − ankkurin oikea aika) × kiihdytys. Kun peli on suljettuna
// tai taustalla, aika kulkee oikeaa vauhtia (1×), joten raketti lentää myös sovelluksen ollessa kiinni.
// Kello pysähtyy laukaisuhetkeen ja saapumiseen, jotta ne eivät mene ohi.
import { el, num, saved, button } from './core.js';
import { FLIGHT_BODIES, FUEL_KMS, fmtDuration, nearestPlanet, norm, planetState, shipState, soiEntry, transfer, windowSearch } from './flight.js';
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

const fresh = () => ({v:1, location:'Maa', fuel:FUEL_KMS, simTime:Date.now(), realTime:Date.now(), warp:0, plan:null, flight:null, log:[]});
let game=null, options=null, target=null, searchId=0, progress=0, frame=null, lastSave=0;
// Lähtölaskennan päättymishetki (oikeaa aikaa), kartan rajaus, kiihdytyksen pienentämisestä kertova viesti
// ja tieto siitä, onko näkymä piirretty saapumisen jälkeen.
let countdown=null, mapRadius=null, mapFollow=false, notice='', shownArrived=false;

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
  if(game.flight) where.append(make('b',null,`Matkalla ${NAMES[game.flight.to][1]}`), make('small','muted',`lähtö ${NAMES[game.flight.from][0]} kiertoradalta`));
  else where.append(make('b',null,`${NAMES[game.location][0]} kiertoradalla`), make('small','muted',orbitText(game.location)));
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
  } else if(!options) {
    const p=make('div','voyage-progress'); const bar=make('i'); bar.id='voyage-progress-bar'; bar.style.width=`${progress*100}%`; p.append(bar);
    body.append(make('p','muted',`Haetaan laukaisuikkunoita: ${NAMES[game.location][0]} kiertoradalta ${NAMES[target][1]}…`), p);
  } else if(!options.length) {
    body.append(make('p','muted','Siirtorataa ei löytynyt. Kokeile toista kohdetta.'));
  } else {
    body.append(make('h3',null,`Lento ${NAMES[target][1]}`));
    const cards=make('div','voyage-options');
    cards.append(...options.map(optionCard));
    body.append(cards);
    if(options.every(o=>!o.fuelOk)) body.append(make('p','muted','Polttoaine ei riitä yhteenkään vaihtoehtoon. Valitse lähempi kohde.'));
  }
  if(game.log.length) body.append(actions(button('sky-btn','Aloita alusta',restart)));
}

function waiting(body) {
  const p=game.plan, ready=simNow()>=p.depart;
  body.append(make('h3',null,`Lento ${NAMES[p.to][1]}`));
  body.append(list([['Lähtö',fmtDate(p.depart)],['Lentoaika',fmtDays((p.arrive-p.depart)/DAY)],['Perillä',fmtDate(p.arrive)],['Δv',`${dv(p.dvDep)} + ${dv(p.dvArr)} = ${dv(p.dvTotal)}`]],'voyage-plan'));
  const count=make('div','voyage-count'); count.id='voyage-count'; count.dataset.ready=ready ? '1' : '';
  body.append(count);
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

function flying(body) {
  const f=game.flight, arrived=simNow()>=f.arrive;
  shownArrived=arrived;
  const clock=make('div','voyage-count'); clock.id='voyage-met';
  const stats=make('div','voyage-stats');
  stats.append(stat('Nopeus Auringon suhteen','voyage-speed','voyage-speed-sub'), stat(`Etäisyys ${NAMES[f.to][2]}`,'voyage-dist','voyage-eta'),
    stat('Etäisyys Auringosta','voyage-sun'), stat('Valon kulkuaika Maahan','voyage-light'));
  body.append(clock, stats, mapStage());
  if(arrived) {
    body.append(make('p',null,`Alus on ${NAMES[f.to][0]} luona. Jarrutuspoltto (${dv(f.dvArr)}) vie sen kiertoradalle ${orbitText(f.to)}.`),
      actions(button('voyage-go','Jarruta kiertoradalle',capture)));
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
  if(game.flight) flying(body); else if(game.plan) waiting(body); else planning(body);
  update();
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
    return;
  }
  const f=game.flight;
  if(!f) return;
  const ship=shipState(f,t), speed=norm(ship.v), near=nearestPlanet(ship.r,ship.v,t);
  set('voyage-met',`T+ ${fmtDuration(t-f.depart)}`);
  set('voyage-speed',`${num(speed,2)} km/s`);
  set('voyage-speed-sub',`${num(speed*3600)} km/h · ${NAMES[near.name][0]} suhteen ${num(near.speed,2)} km/s`);
  set('voyage-dist',fmtKm(gap(ship.r,planetState(f.to,t).r)));
  set('voyage-eta',t<f.arrive ? `perillä ${fmtDate(f.arrive)}, T− ${fmtDuration(f.arrive-t)}` : 'perillä');
  set('voyage-sun',fmtKm(norm(ship.r)));
  set('voyage-light',lightTime(gap(ship.r,planetState('Maa',t).r)));
  draw();
}

// --- Kartta ---

function fitRadius() {
  const f=game.flight;
  return Math.max(norm(f.r1),norm(planetState(f.to,f.arrive).r))/AU_KM*1.12;
}

function draw() {
  const canvas=document.getElementById('voyage-map'), f=game?.flight;
  if(!canvas || !f) return;
  const w=canvas.clientWidth, h=canvas.clientHeight, scale=window.devicePixelRatio||1;
  if(!w||!h) return;
  if(canvas.width!==Math.round(w*scale) || canvas.height!==Math.round(h*scale)) {canvas.width=Math.round(w*scale); canvas.height=Math.round(h*scale);}
  const t=simNow(), ship=shipState(f,t), shipAu=toAu(ship.r);
  const radius=mapRadius ?? fitRadius(), k=Math.min(w,h)/2/radius;
  const center=mapFollow ? shipAu : [0,0];
  const toPx=([x,y])=>[w/2+(x-center[0])*k, h/2-(y-center[1])*k];
  const ctx=canvas.getContext('2d');
  ctx.setTransform(scale,0,0,scale,0,0);
  drawScene(ctx,solarSystem(t),toPx,w,h,k,f.to);

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

  // Alus kolmiona nopeuden suuntaan.
  const [sx,sy]=toPx(shipAu);
  ctx.save(); ctx.translate(sx,sy); ctx.rotate(Math.atan2(-ship.v[1],ship.v[0]));
  ctx.beginPath(); ctx.moveTo(9,0); ctx.lineTo(-6,5); ctx.lineTo(-3,0); ctx.lineTo(-6,-5); ctx.closePath();
  ctx.fillStyle=SHIP_COLOR; ctx.fill(); ctx.lineWidth=1; ctx.strokeStyle='#03050b'; ctx.stroke();
  ctx.restore();
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

function launch() {
  const p=game.plan;
  countdown=null; notice=''; mapRadius=null; mapFollow=false;
  game.fuel=Math.max(0,game.fuel-p.dvDep);
  game.flight={...p, soi:soiEntry(p)};
  game.plan=null;
  game.log.push({t:p.depart, text:`Laukaisu ${NAMES[p.from][0]} kiertoradalta kohti ${NAMES[p.to][2]} (Δv ${dv(p.dvDep)})`});
  anchor(p.depart,0); render();
}

function capture() {
  const f=game.flight;
  game.fuel=Math.max(0,game.fuel-f.dvArr);
  game.location=f.to; game.flight=null; options=null; target=null; notice='';
  game.log.push({t:f.arrive, text:`Saapuminen ${NAMES[f.to][0]} kiertoradalle ${fmtDays((f.arrive-f.depart)/DAY)} lennon jälkeen (Δv ${dv(f.dvArr)})`});
  anchor(f.arrive,0); render();
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
  if(game.flight && t>=game.flight.arrive && !shownArrived) render();
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
  window.addEventListener('resize',draw);
  sync();
}
