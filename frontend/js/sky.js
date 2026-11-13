// Taivaankarttakortti.
import { state, el, json, fmt, hhmm, num, button, publish, store, dayLabel } from './core.js';
import { placeLabel } from './places.js';
import { drawSky, objectAt } from './skychart.js';
import { createSkyView } from './skyview.js';

const KINDS = {star:'tähti', planet:'planeetta', iss:'avaruusasema'};
const DIRECTIONS = ['pohjoinen','koillinen','itä','kaakko','etelä','lounas','länsi','luode'];
const direction = az => DIRECTIONS[Math.round(az/45)%8];
// Valittu kohde säilyy, kun kartta piirretään uudelleen (ajan siirto, minuutin välein tehtävä päivitys).
let chart=null, selected=null, detailRequest=0, view=null, mode='map';
// ISS-näkymästä taivaalle valittu ylilento ja sen aseman nimi; ilman valintaa kartalla on ISS:n seuraava näkyvä ylilento.
let pinnedPass=null, pinnedName='ISS';
/** Kuinka kaukana kartan hetkestä seuraava ylilento vielä piirretään (sama kuin aikaliu'un ulottuvuus). */
const PASS_WINDOW=12*3600000;

// Kartalle piirrettävä ylilento: valittu, tai seuraava kartan hetkestä alkaen näkyvä ylilento 12 tunnin sisällä.
function issPass(at) {
  if(pinnedPass) return pinnedPass;
  return (store.iss?.passes ?? []).find(p=>p.sky_track && Date.parse(p.visible_end)>=at && Date.parse(p.visible_start)<at+PASS_WINDOW) ?? null;
}

function showChart() {
  chart.iss_pass=issPass(Date.parse(chart.at));
  drawSky(el('sky-chart'),chart,selected); view?.setChart(chart,selected);
  const p=chart.iss_pass;
  el('sky-meta').textContent=[
    `${placeLabel()} · ${state.lat.toFixed(2)}°, ${state.lon.toFixed(2)}° · ${chart.moon_phase_name}`,
    p && `Keltainen kaari: ${pinnedPass ? pinnedName : 'ISS'} näkyy ${dayLabel(p.visible_start)} klo ${hhmm(p.visible_start)}–${hhmm(p.visible_end)}`,
  ].filter(Boolean).join(' · ');
}

/** Näyttää aseman ylilennon kaaren taivaankartalla. Jos ylilento on aikaliu'un ulottuvilla, kartta siirretään sen alkuun. */
export function showPassOnSky(pass, name='ISS') {
  if(!pass?.sky_track) return;
  pinnedPass=pass; pinnedName=name;
  const minutes=Math.round((Date.parse(pass.visible_start)-Date.now())/600000)*10;
  if(Math.abs(minutes)<=720) {state.offset=minutes; el('time-offset').value=String(minutes);}
  location.hash='#taivas';
  sky();
}

const query = () => `lat=${state.lat}&lon=${state.lon}&at=${encodeURIComponent(new Date(Date.now()+state.offset*60000).toISOString())}`;

// Kellonaika; viikonpäivä mukaan, kun tapahtuma on eri päivänä kuin kartan hetki.
function when(time, ref) {
  const d=new Date(time), sameDay=d.toDateString()===new Date(ref).toDateString();
  return sameDay ? hhmm(d) : `${d.toLocaleDateString('fi-FI',{weekday:'short'})} ${hhmm(d)}`;
}

function renderDetail(o) {
  const line = (...parts) => {const d=document.createElement('div'); d.textContent=parts.filter(Boolean).join(' · '); return d;};
  const title=document.createElement('b'); title.textContent=o.name;
  const facts=line(KINDS[o.kind], o.constellation, o.magnitude===null ? null : `${num(o.magnitude,1)} mag`);
  facts.className='muted';
  const position=line(o.alt>=0 ? `Korkeus ${num(o.alt)}°` : `Horisontin alla (${num(o.alt)}°)`, `suunta ${num(o.az)}° (${direction(o.az)})`);
  if(o.kind==='iss') {
    // Asemalle näytetään käynnissä oleva tai seuraava ylilento (nousu ja lasku 5° korkeudella).
    const pass = o.rise ? line(`ylilento ${when(o.rise,o.at)}–${hhmm(o.set)}`, `korkeimmillaan ${num(o.transit_alt)}°`) : line('Ei ylilentoja kahden vuorokauden aikana');
    el('sky-detail').replaceChildren(title, line('avaruusasema', `${num(o.height_km)} km korkeudella`, o.sunlit ? 'auringonvalossa' : 'Maan varjossa'), position, pass, button('link-btn','Sulje',()=>select(null)));
    el('sky-detail').hidden=false; return;
  }
  const highest=[o.transit, `korkeimmillaan ${when(o.transit,o.at)} (${num(o.transit_alt)}°)`];
  // Tapahtumat aikajärjestyksessä: horisontin yläpuolella oleva kohde laskee ennen seuraavaa nousuaan.
  const upcoming=[o.rise && [o.rise, `nousee ${when(o.rise,o.at)}`], highest, o.set && [o.set, `laskee ${when(o.set,o.at)}`]]
    .filter(Boolean).sort((a,b)=>a[0].localeCompare(b[0])).map(e=>e[1]);
  const events = o.visibility==='always_up' ? line('Ei laske tältä paikalta katsottuna', highest[1])
    : o.visibility==='never_up' ? line('Ei nouse horisontin yläpuolelle')
    : line(...upcoming);
  el('sky-detail').replaceChildren(title, facts, position, events, button('link-btn','Sulje',()=>select(null)));
  el('sky-detail').hidden=false;
}

async function loadDetail() {
  const request=++detailRequest;
  if(!selected) {el('sky-detail').hidden=true; return;}
  try {
    const o=await json(`/api/sky/object?name=${encodeURIComponent(selected)}&${query()}`);
    if(request===detailRequest) renderDetail(o);
  } catch(e) {
    if(request===detailRequest) {el('sky-detail').textContent=e.message; el('sky-detail').hidden=false;}
  }
}

export function select(name) {
  selected=name;
  if(chart) {drawSky(el('sky-chart'),chart,selected); view?.setChart(chart,selected);}
  loadDetail();
}

// Koko näytön tila: kortti peittää ikkunan (CSS), ja jos selain tukee Fullscreen API:a, myös selaimen palkit piiloutuvat.
// Selaimen takaisin-ele sulkee tilan, koska avaaminen lisää historiaan oman merkinnän.
const isFull = () => el('sky').classList.contains('sky-full');
function status(text) { el('sky-status').textContent=text; }

const HINTS = {
  map: 'Napauta kohdetta nähdäksesi sen tiedot.',
  view: 'Käännä näkymää raahaamalla, zoomaa nipistämällä tai rullalla. Napauta kohdetta.',
  sensors: 'Osoita puhelimella taivaalle. Jos suunta heittää, korjaa sitä raahaamalla sivuttain.',
};

function renderToolbar() {
  for(const b of el('sky-toolbar').querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed',String(b.dataset.mode===mode));
  el('sky-chart').hidden=mode!=='map'; el('sky-view').hidden=mode==='map'; el('sky-heading').hidden=mode==='map';
  el('sky-camera').hidden=mode==='map'||!navigator.mediaDevices?.getUserMedia;
  el('sky-camera').setAttribute('aria-pressed',String(view.cameraOn()));
}

async function setMode(next) {
  if(next!=='sensors'&&view.sensorsOn()) view.stopSensors();
  if(next==='map'&&view.cameraOn()) {view.stopCamera(el('sky-video')); el('sky-video').hidden=true;}
  mode=next; renderToolbar(); status(HINTS[mode]);
  if(mode!=='map') view.setChart(chart,selected);
  // Näkymä avautuu valitun kohteen suuntaan, jolloin sen löytää helposti.
  const target=chart?.objects.find(o=>o.name===selected);
  if(mode==='view'&&target) view.lookAt(target.alt,target.az);
  if(mode==='sensors') {
    try {await view.startSensors();}
    // Ilman antureita (esim. tietokoneella) näkymää käännetään käsin.
    catch(e) {mode='view'; renderToolbar(); status(e.message);}
  }
}

function openFull() {
  if(isFull()) return;
  el('sky').classList.add('sky-full'); document.body.classList.add('sky-locked');
  el('sky-toolbar').hidden=false;
  view ??= createSkyView(el('sky-view'),{onSelect:select,onStatus:t=>{el('sky-heading').textContent=t;}});
  history.pushState({skyFull:true},'');
  el('sky').requestFullscreen?.().catch(()=>{});
  setMode('map');
}

function closeFull(fromHistory=false) {
  if(!isFull()) return;
  if(view?.sensorsOn()) view.stopSensors();
  if(view?.cameraOn()) view.stopCamera(el('sky-video'));
  el('sky-video').hidden=true;
  el('sky').classList.remove('sky-full'); document.body.classList.remove('sky-locked');
  el('sky-toolbar').hidden=true; el('sky-chart').hidden=false; el('sky-view').hidden=true; mode='map';
  if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  if(!fromHistory && history.state?.skyFull) history.back();
}

async function toggleCamera() {
  try {
    if(view.cameraOn()) {view.stopCamera(el('sky-video')); el('sky-video').hidden=true;}
    else {el('sky-video').hidden=false; await view.startCamera(el('sky-video'));}
  } catch(e) {el('sky-video').hidden=true; status(`Kameraa ei saatu käyttöön (${e.message}).`);}
  el('sky-camera').setAttribute('aria-pressed',String(view.cameraOn()));
}

export function initSky() {
  el('sky-chart').addEventListener('click',e=>{if(chart) select(objectAt(el('sky-chart'),chart,e.clientX,e.clientY)?.name ?? null);});
  el('sky-full').addEventListener('click',openFull);
  el('sky-close').addEventListener('click',()=>closeFull());
  el('sky-camera').addEventListener('click',toggleCamera);
  for(const b of el('sky-toolbar').querySelectorAll('[data-mode]')) b.addEventListener('click',()=>setMode(b.dataset.mode));
  window.addEventListener('popstate',()=>closeFull(true));
  // Ylilennot haetaan erikseen: kaari piirretään, kun ne saapuvat. Valinta raukeaa, kun ylilento on ohi.
  document.addEventListener('data',e=>{
    if(e.detail!=='iss') return;
    if(pinnedPass && Date.parse(pinnedPass.end)<Date.now()) pinnedPass=null;
    if(chart) showChart();
  });
  // Esc tai selaimen oma poistuminen koko näytöstä sulkee myös tilan.
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&isFull()) closeFull();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&isFull()&&!document.fullscreenElement) closeFull();});
}

export async function sky() {
  try {
    chart=await json(`/api/sky?${query()}`);
    showChart(); el('time-label').textContent=fmt(chart.at);
    el('object-list').replaceChildren(...chart.objects.filter(o=>o.alt>0&&o.kind!=='star').map(o=>button('',`${o.name} ${o.alt.toFixed(0)}°`,()=>select(o.name))));
    if(selected) loadDetail();
    // Kooste näyttää taivaan juuri nyt: aikaliu'ulla siirretty kartta ei kelpaa siihen.
    if(state.offset===0) publish('sky',chart);
  } catch(e) {el('sky-meta').textContent=e.message;}
}
