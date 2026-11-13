// ISS-kortti: aseman sijainti ja rata kartalla, näkyvät ylilennot reitteineen sekä ilmoitusvalinta.
import { state, el, json, hhmm, num, saved, button } from './core.js';
import { drawMap as paintMap, trackLatLon } from './issmap.js';
import { placeLabel } from './places.js';
import { ISS_KEY, pushActive, syncPush } from './push.js';

const DIRECTIONS = ['P','KO','I','KA','E','LO','L','LU'];
const dir = az => DIRECTIONS[Math.round(az/45)%8];
const day = t => new Date(t).toLocaleDateString('fi-FI',{weekday:'short',day:'numeric',month:'numeric'});
const where = p => `${num(Math.abs(p.lat),1)}°${p.lat>=0?'P':'E'}, ${num(Math.abs(p.lon),1)}°${p.lon>=0?'I':'L'}`;
// Kartalla näytettävä ylilento (alkuhetki tunnisteena) säilyy, kun tiedot päivittyvät minuutin välein.
let data=null, selected=null;
// Kartan näkymä: 'station' seuraa asemaa, 'pass' näyttää valitun ylilennon havaintopaikan ympäristössä.
// Säde on kartan lyhyemmän sivun puolikas kilometreinä, kummallekin näkymälle omansa.
let mode='station';
const radius={station:5000, pass:2400};
const RADIUS_MIN=300, RADIUS_MAX=6000;
const LEGEND={
  station: 'Viiva: aseman rata seuraavan kierroksen ajan, kellonajat kertovat missä asema silloin on · ympyrän sisältä asema näkyy yli 5° korkeudella · sininen piste: havaintopaikka',
  pass: 'Paksu viiva: asema näkyy · ohut viiva: taivaalla mutta ei näy · katkoviiva: rata ennen ja jälkeen · ympyrän sisällä asema on yli 5° korkeudella',
};

const visiblePasses = () => data ? data.passes.filter(x=>x.visible_start) : [];
const selectedPass = () => visiblePasses().find(x=>x.start===selected) ?? null;
// Aseman paikka juuri nyt radan näytteiden väliltä; ilman rataa (tai vanhentuneella radalla) viimeksi haettu sijainti.
const stationNow = () => (data.orbit && trackLatLon(data.orbit,Date.now())) ?? {lat:data.position.lat, lon:data.position.lon};

function drawMap() {
  if(!data) return;
  const passes=visiblePasses(), pass=selectedPass(), i=passes.indexOf(pass);
  if(!pass) mode='station';
  const station=stationNow(), observer={lat:state.lat, lon:state.lon, label:placeLabel()}, onPass=mode==='pass';
  el('iss-map-box').hidden=false;
  el('iss-map-title').textContent=onPass
    ? `${day(pass.visible_start)} ${hhmm(pass.visible_start)} · korkeimmillaan ${num(pass.max_alt)}° ${dir(pass.max_az)}`
    : `Asema nyt · ${where(station)}`;
  el('iss-map-meta').textContent=LEGEND[mode];
  el('iss-prev').disabled=!onPass||i<=0; el('iss-next').disabled=!onPass||i>=passes.length-1;
  for(const b of el('iss-map-box').querySelectorAll('[data-map-mode]')) {
    b.setAttribute('aria-pressed',String(b.dataset.mapMode===mode));
    if(b.dataset.mapMode==='pass') b.disabled=!pass;
  }
  el('iss-zoom-in').disabled=radius[mode]<=RADIUS_MIN; el('iss-zoom-out').disabled=radius[mode]>=RADIUS_MAX;
  paintMap(el('iss-map'),{
    center:onPass ? observer : station, radiusKm:radius[mode], observer, station, circle:onPass ? 'observer' : 'station',
    orbit:onPass ? null : data.orbit ?? null, pass:onPass ? pass : null, heightKm:data.position.height_km, time:hhmm,
  });
}

function setMode(next) { mode=next; drawMap(); }

function zoomTo(km) { radius[mode]=Math.max(RADIUS_MIN,Math.min(RADIUS_MAX,km)); drawMap(); }

function select(start, reveal=false) {
  selected=start; mode='pass';
  for(const b of el('iss-passes').querySelectorAll('.pass-pick')) b.setAttribute('aria-pressed',String(b.dataset.start===selected));
  drawMap();
  if(reveal&&!isFull()) el('iss-map-box').scrollIntoView({block:'nearest',behavior:'smooth'});
}

function step(delta) {
  const passes=visiblePasses(), next=passes[passes.indexOf(selectedPass())+delta];
  if(next) select(next.start);
}

// Koko näytön tila toimii kuten taivaankartalla: kortti peittää ikkunan, ja selaimen takaisin-ele sulkee sen.
const isFull = () => el('iss').classList.contains('iss-full');
function openFull() {
  if(isFull()) return;
  el('iss').classList.add('iss-full'); document.body.classList.add('sky-locked');
  history.pushState({issFull:true},'');
  el('iss').requestFullscreen?.().catch(()=>{});
  drawMap();
}
function closeFull(fromHistory=false) {
  if(!isFull()) return;
  el('iss').classList.remove('iss-full'); document.body.classList.remove('sky-locked');
  if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  if(!fromHistory && history.state?.issFull) history.back();
  drawMap();
}

// Nipistys zoomaa: kahden sormen etäisyyden muutos suhteutetaan säteeseen eleen alussa.
function initPinch(canvas) {
  const fingers=new Map(); let base=null;
  const spread=()=>{const [a,b]=[...fingers.values()]; return Math.hypot(a.x-b.x,a.y-b.y);};
  const track=e=>fingers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  canvas.addEventListener('pointerdown',e=>{track(e); base=fingers.size===2 ? {spread:spread(), radius:radius[mode]} : null;});
  canvas.addEventListener('pointermove',e=>{
    if(!fingers.has(e.pointerId)) return;
    track(e);
    if(base&&fingers.size===2&&spread()>10) zoomTo(base.radius*base.spread/spread());
  });
  for(const type of ['pointerup','pointercancel','pointerleave']) canvas.addEventListener(type,e=>{fingers.delete(e.pointerId); base=null;});
}

export function initIss() {
  el('iss-prev').addEventListener('click',()=>step(-1));
  el('iss-next').addEventListener('click',()=>step(1));
  el('iss-full').addEventListener('click',openFull);
  el('iss-close').addEventListener('click',()=>closeFull());
  for(const b of el('iss-map-box').querySelectorAll('[data-map-mode]')) b.addEventListener('click',()=>setMode(b.dataset.mapMode));
  el('iss-zoom-in').addEventListener('click',()=>zoomTo(radius[mode]/1.5));
  el('iss-zoom-out').addEventListener('click',()=>zoomTo(radius[mode]*1.5));
  initPinch(el('iss-map'));
  // Rulla zoomaa vain koko näytössä; kortissa se vierittää sivua kuten muuallakin.
  el('iss-map').addEventListener('wheel',e=>{if(!isFull()) return; e.preventDefault(); zoomTo(radius[mode]*Math.exp(e.deltaY*0.0015));},{passive:false});
  window.addEventListener('popstate',()=>closeFull(true));
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&isFull()) closeFull();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&isFull()&&!document.fullscreenElement) closeFull();});
  // Kartta piirretään näkyvän kokonsa mukaan, joten ikkunan koon muutos vaatii uuden piirron.
  window.addEventListener('resize',drawMap);
  // Asema liikkuu noin 7 km sekunnissa: kartta piirretään uudelleen parin sekunnin välein, kun sivu on näkyvissä.
  setInterval(()=>{if(!document.hidden) drawMap();},2000);
}

function renderNotify() {
  const label=document.createElement('label'), input=document.createElement('input');
  input.type='checkbox'; input.disabled=!pushActive(); input.checked=pushActive()&&saved.get(ISS_KEY,{}).notify===true;
  input.addEventListener('change',()=>{saved.set(ISS_KEY,{notify:input.checked}); syncPush();});
  label.append(input,' Ilmoita näkyvistä ylilennoista noin 5–20 min ennen');
  const parts=[label];
  if(!pushActive()) {const hint=document.createElement('small'); hint.textContent='Vaatii, että ilmoitukset on otettu käyttöön Avaruussää-kortista. Ilmoitus koskee ilmoitusten paikkaa.'; parts.push(hint);}
  el('iss-notify').replaceChildren(...parts);
}

function render() {
  const p=data.position;
  el('iss-now').textContent = p.alt>0
    ? `Asema on nyt taivaalla: korkeus ${num(p.alt)}°, suunta ${dir(p.az)} · ${p.sunlit?'auringonvalossa':'Maan varjossa'}`
    : `Asema on nyt kohdan ${where(p)} yllä ${num(p.height_km)} km korkeudella, ${num(p.range_km)} km päässä.`;
  const visible=visiblePasses();
  if(!visible.some(x=>x.start===selected)) selected=visible[0]?.start ?? null;
  el('iss-passes').replaceChildren(...(visible.length ? visible.map(x=>{
    const li=document.createElement('li'), when=document.createElement('span'), body=document.createElement('span');
    const pick=button('pass-pick','',()=>select(x.start,true));
    pick.dataset.start=x.start; pick.setAttribute('aria-pressed',String(x.start===selected));
    when.className='event-day'; when.textContent=`${day(x.visible_start)} ${hhmm(x.visible_start)}`;
    const b=document.createElement('b'); b.textContent=`Korkeimmillaan ${num(x.max_alt)}° ${dir(x.max_az)}${x.max_alt<10?' · matala':''}`;
    const s=document.createElement('small');
    const span=hhmm(x.visible_start)===hhmm(x.visible_end) ? `hetken klo ${hhmm(x.visible_start)}` : `${hhmm(x.visible_start)}–${hhmm(x.visible_end)}`;
    s.textContent=`Näkyy ${span} · nousee ${dir(x.start_az)}, laskee ${dir(x.end_az)}${x.magnitude===null?'':` · kirkkaus noin ${num(x.magnitude,1)} mag`}`;
    body.append(b,s); pick.append(when,body); li.append(pick); return li;
  }) : [Object.assign(document.createElement('li'),{textContent:`Ei näkyviä ylilentoja viiteen vuorokauteen (ylilentoja yhteensä ${data.passes.length}, mutta asema on silloin Maan varjossa tai taivas on liian valoisa).`})]));
  el('iss-meta').textContent=`Ratatiedot CelesTrak, epookki ${day(data.tle_epoch)} ${hhmm(data.tle_epoch)}. Ylilento alkaa ja päättyy 5° korkeudella.`;
  drawMap();
}

export async function iss() {
  try {data=await json(`/api/iss?lat=${state.lat}&lon=${state.lon}`); render();}
  catch(e) {el('iss-meta').textContent=e.message;}
  renderNotify();
}
document.addEventListener('pushchange',renderNotify);
