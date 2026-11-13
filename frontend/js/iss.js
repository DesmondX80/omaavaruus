// ISS-kortti: aseman sijainti ja rata kartalla, näkyvät ylilennot reitteineen sekä ilmoitusvalinta.
import { state, el, json, hhmm, num, saved, row, dayLabel, publish, cloudNote } from './core.js';
import { drawMap as paintMap, trackLatLon } from './issmap.js';
import { placeLabel } from './places.js';
import { showPassOnSky } from './sky.js';
import { ISS_KEY, pushActive, syncPush } from './push.js';

const DIRECTIONS = ['P','KO','I','KA','E','LO','L','LU'];
export const dir = az => DIRECTIONS[Math.round(az/45)%8];
const day = t => new Date(t).toLocaleDateString('fi-FI',{weekday:'short',day:'numeric',month:'numeric'});
const where = p => `${num(Math.abs(p.lat),1)}°${p.lat>=0?'P':'E'}, ${num(Math.abs(p.lon),1)}°${p.lon>=0?'I':'L'}`;
// Kartalla näytettävä ylilento (alkuhetki tunnisteena) säilyy, kun tiedot päivittyvät minuutin välein.
let data=null, selected=null;
// Kartan näkymä: 'station' seuraa asemaa, 'pass' näyttää valitun ylilennon havaintopaikan ympäristössä.
// Säde on kartan lyhyemmän sivun puolikas kilometreinä, kummallekin näkymälle omansa.
let mode='station';
const radius={station:5000, pass:2400};
// Maapallon säde on 6 371 km: suurimmalla säteellä koko pallo mahtuu karttaan.
const RADIUS_MIN=300, RADIUS_MAX=7200;
// Käyttäjän raahaama keskipiste; null, kun kartta seuraa asemaa tai on keskitetty havaintopaikkaan.
let pan=null, drawQueued=false;
const LEGEND={
  station: 'Viiva: aseman rata seuraavan kierroksen ajan, kellonajat kertovat missä asema silloin on · ympyrän sisältä asema näkyy yli 5° korkeudella · sininen piste: havaintopaikka · pyöritä raahaamalla',
  pass: 'Paksu viiva: asema näkyy · ohut viiva: taivaalla mutta ei näy · katkoviiva: rata ennen ja jälkeen · ympyrän sisällä asema on yli 5° korkeudella',
};

const visiblePasses = () => data ? data.passes.filter(x=>x.visible_start) : [];
const selectedPass = () => visiblePasses().find(x=>x.start===selected) ?? null;
// Aseman paikka juuri nyt radan näytteiden väliltä; ilman rataa (tai vanhentuneella radalla) viimeksi haettu sijainti.
const stationNow = () => (data.orbit && trackLatLon(data.orbit,Date.now())) ?? {lat:data.position.lat, lon:data.position.lon};

const viewCenter = () => pan ?? (mode==='pass' ? {lat:state.lat, lon:state.lon} : stationNow());

function drawMap() {
  drawQueued=false;
  if(!data) return;
  const passes=visiblePasses(), pass=selectedPass(), i=passes.indexOf(pass);
  if(!pass) mode='station';
  const station=stationNow(), observer={lat:state.lat, lon:state.lon, label:placeLabel()}, onPass=mode==='pass';
  el('iss-map-box').hidden=false;
  el('iss-map-title').textContent=onPass
    ? `${day(pass.visible_start)} ${hhmm(pass.visible_start)} · korkeimmillaan ${num(pass.max_alt)}° ${dir(pass.max_az)}`
    : `Asema nyt · ${where(station)}`;
  el('iss-map-meta').textContent=LEGEND[mode];
  el('iss-sky-link').hidden=!onPass;
  el('iss-prev').disabled=!onPass||i<=0; el('iss-next').disabled=!onPass||i>=passes.length-1;
  for(const b of el('iss-map-box').querySelectorAll('[data-map-mode]')) {
    b.setAttribute('aria-pressed',String(b.dataset.mapMode===mode));
    if(b.dataset.mapMode==='pass') b.disabled=!pass;
  }
  el('iss-zoom-in').disabled=radius[mode]<=RADIUS_MIN; el('iss-zoom-out').disabled=radius[mode]>=RADIUS_MAX;
  paintMap(el('iss-map'),{
    center:viewCenter(), radiusKm:radius[mode], observer, station, circle:onPass ? 'observer' : 'station',
    orbit:onPass ? null : data.orbit ?? null, pass:onPass ? pass : null, heightKm:data.position.height_km, time:hhmm,
  });
}

// Eleen aikana piirretään enintään kerran ruudunpäivitystä kohti.
function queueDraw() { if(!drawQueued) {drawQueued=true; requestAnimationFrame(drawMap);} }

// Näkymän valinta (myös jo valitun) keskittää kartan takaisin asemaan tai havaintopaikkaan.
function setMode(next) { mode=next; pan=null; drawMap(); }

function zoomTo(km) { radius[mode]=Math.max(RADIUS_MIN,Math.min(RADIUS_MAX,km)); queueDraw(); }

// Raahaus pyörittää palloa: kartan kohta seuraa sormea keskipisteen kohdalla. Pohjoinen pysyy ylhäällä.
function panBy(dx, dy) {
  if(!data) return;
  const canvas=el('iss-map'), c=viewCenter(), pxPerDeg=Math.min(canvas.clientWidth,canvas.clientHeight)/2/radius[mode]*111.19;
  const lat=Math.max(-90,Math.min(90,c.lat+dy/pxPerDeg));
  const lon=c.lon-dx/pxPerDeg/Math.max(0.15,Math.cos(lat*Math.PI/180));
  pan={lat, lon:((lon+540)%360+360)%360-180};
  queueDraw();
}

function select(start, reveal=false) {
  selected=start; mode='pass'; pan=null;
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

// Kartan eleet: yhdellä sormella tai hiirellä raahaus pyörittää palloa, kahdella sormella nipistys zoomaa ja siirto pyörittää.
// Kortissa pystysuuntainen pyyhkäisy vierittää sivua (CSS touch-action), koko näytössä kartta liikkuu joka suuntaan.
function initGestures(canvas) {
  const fingers=new Map(); let last=null, moved=false;
  const measure=()=>{
    const p=[...fingers.values()], x=p.reduce((sum,f)=>sum+f.x,0)/p.length, y=p.reduce((sum,f)=>sum+f.y,0)/p.length;
    return {x, y, spread:p.length>1 ? Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y) : 0};
  };
  canvas.addEventListener('pointerdown',e=>{
    canvas.setPointerCapture?.(e.pointerId);
    fingers.set(e.pointerId,{x:e.clientX,y:e.clientY}); last=measure(); moved=false;
  });
  canvas.addEventListener('pointermove',e=>{
    if(!fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const now=measure();
    // Pieni tärähdys napautuksessa ei vielä irrota karttaa aseman seurannasta.
    if(!moved && Math.hypot(now.x-last.x,now.y-last.y)<4 && Math.abs(now.spread-last.spread)<4) return;
    moved=true;
    if(last.spread>10&&now.spread>10) radius[mode]=Math.max(RADIUS_MIN,Math.min(RADIUS_MAX,radius[mode]*last.spread/now.spread));
    panBy(now.x-last.x,now.y-last.y);
    last=now;
  });
  for(const type of ['pointerup','pointercancel']) canvas.addEventListener(type,e=>{fingers.delete(e.pointerId); last=fingers.size ? measure() : null; moved=false;});
}

export function initIss() {
  el('iss-prev').addEventListener('click',()=>step(-1));
  el('iss-next').addEventListener('click',()=>step(1));
  el('iss-full').addEventListener('click',openFull);
  el('iss-sky-link').addEventListener('click',()=>{closeFull(); showPassOnSky(selected);});
  el('iss-close').addEventListener('click',()=>closeFull());
  for(const b of el('iss-map-box').querySelectorAll('[data-map-mode]')) b.addEventListener('click',()=>setMode(b.dataset.mapMode));
  el('iss-zoom-in').addEventListener('click',()=>zoomTo(radius[mode]/1.5));
  el('iss-zoom-out').addEventListener('click',()=>zoomTo(radius[mode]*1.5));
  initGestures(el('iss-map'));
  // Rulla zoomaa vain koko näytössä; kortissa se vierittää sivua kuten muuallakin.
  el('iss-map').addEventListener('wheel',e=>{if(!isFull()) return; e.preventDefault(); zoomTo(radius[mode]*Math.exp(e.deltaY*0.0015));},{passive:false});
  window.addEventListener('popstate',()=>closeFull(true));
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&isFull()) closeFull();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&isFull()&&!document.fullscreenElement) closeFull();});
  // Kartta piirretään näkyvän kokonsa mukaan, joten ikkunan koon muutos vaatii uuden piirron.
  window.addEventListener('resize',drawMap);
  // Piilossa olleen näkymän kartta piirretään, kun näkymä avataan.
  document.addEventListener('viewchange',drawMap);
  // Asema liikkuu noin 7 km sekunnissa: kartta piirretään uudelleen parin sekunnin välein, kun sivu on näkyvissä.
  setInterval(()=>{if(!document.hidden) drawMap();},2000);
}

function renderNotify() {
  const label=document.createElement('label'), input=document.createElement('input');
  input.type='checkbox'; input.disabled=!pushActive(); input.checked=pushActive()&&saved.get(ISS_KEY,{}).notify===true;
  input.addEventListener('change',()=>{saved.set(ISS_KEY,{notify:input.checked}); syncPush();});
  label.append(input,' Ilmoita näkyvistä ylilennoista noin 5–20 min ennen');
  const parts=[label];
  const hint=document.createElement('small'); hint.textContent=pushActive() ? 'Ilmoitus koskee ilmoitusten paikkaa.' : 'Ota ensin ilmoitukset käyttöön yllä.'; parts.push(hint);
  el('iss-notify').replaceChildren(...parts);
}

/** Aseman tilanne lauseena: taivaalla (korkeus ja suunta) tai minkä kohdan yllä se on. */
export function issNowText() {
  if(!data) return '';
  const p=data.position;
  return p.alt>0
    ? `Asema on nyt taivaalla: korkeus ${num(p.alt)}°, suunta ${dir(p.az)} · ${p.sunlit?'auringonvalossa':'Maan varjossa'}`
    : `Asema on nyt kohdan ${where(p)} yllä ${num(p.height_km)} km korkeudella, ${num(p.range_km)} km päässä.`;
}

function render() {
  el('iss-now').textContent=issNowText();
  const visible=visiblePasses();
  if(!visible.some(x=>x.start===selected)) selected=visible[0]?.start ?? null;
  el('iss-passes').replaceChildren(...(visible.length ? visible.map(x=>{
    const li=document.createElement('li');
    const span=hhmm(x.visible_start)===hhmm(x.visible_end) ? `hetken klo ${hhmm(x.visible_start)}` : `${hhmm(x.visible_start)}–${hhmm(x.visible_end)}`;
    const pick=row({tag:'button', iconName:'iss', title:`Korkeimmillaan ${num(x.max_alt)}° ${dir(x.max_az)}${x.max_alt<10?' · matala':''}`,
      details:[`Näkyy ${span} · nousee ${dir(x.start_az)}, laskee ${dir(x.end_az)}${x.magnitude===null?'':` · kirkkaus noin ${num(x.magnitude,1)} mag`}`, cloudNote(x.cloud_cover)],
      when:dayLabel(x.visible_start), whenSub:`klo ${hhmm(x.visible_start)}`});
    pick.classList.add('pass-pick'); pick.dataset.start=x.start; pick.setAttribute('aria-pressed',String(x.start===selected));
    pick.addEventListener('click',()=>select(x.start,true));
    li.append(pick); return li;
  }) : [Object.assign(document.createElement('li'),{className:'muted',textContent:`Ei näkyviä ylilentoja viiteen vuorokauteen (ylilentoja yhteensä ${data.passes.length}, mutta asema on silloin Maan varjossa tai taivas on liian valoisa).`})]));
  el('iss-meta').textContent=`Ratatiedot CelesTrak, epookki ${day(data.tle_epoch)} ${hhmm(data.tle_epoch)}. Ylilento alkaa ja päättyy 5° korkeudella.${data.cloud_provider ? ` Pilvisyysennuste ${data.cloud_provider}, kolme vuorokautta eteenpäin.` : ''}`;
  drawMap();
}

export async function iss() {
  try {data=await json(`/api/iss?lat=${state.lat}&lon=${state.lon}`); render(); publish('iss',data);}
  catch(e) {el('iss-meta').textContent=e.message;}
  renderNotify();
}
document.addEventListener('pushchange',renderNotify);
