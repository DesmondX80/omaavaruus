// ISS-kortti: aseman sijainti, näkyvät ylilennot ja valitun ylilennon reitti kartalla sekä ilmoitusvalinta.
import { state, el, json, hhmm, num, saved, button } from './core.js';
import { drawPassMap, trackSpan } from './issmap.js';
import { placeLabel } from './places.js';
import { ISS_KEY, pushActive, syncPush } from './push.js';

const DIRECTIONS = ['P','KO','I','KA','E','LO','L','LU'];
const dir = az => DIRECTIONS[Math.round(az/45)%8];
const day = t => new Date(t).toLocaleDateString('fi-FI',{weekday:'short',day:'numeric',month:'numeric'});
// Kartalla näytettävä ylilento (alkuhetki tunnisteena) säilyy, kun tiedot päivittyvät minuutin välein.
let data=null, selected=null;

const visiblePasses = () => data ? data.passes.filter(x=>x.visible_start) : [];
const selectedPass = () => visiblePasses().find(x=>x.start===selected) ?? null;

function drawMap() {
  const passes=visiblePasses(), pass=selectedPass(), i=passes.indexOf(pass);
  el('iss-map-box').hidden=!pass;
  if(!pass) {closeFull(); return;}
  el('iss-map-title').textContent=`${day(pass.visible_start)} ${hhmm(pass.visible_start)} · korkeimmillaan ${num(pass.max_alt)}° ${dir(pass.max_az)}`;
  el('iss-prev').disabled=i<=0; el('iss-next').disabled=i>=passes.length-1;
  drawPassMap(el('iss-map'),{lat:state.lat, lon:state.lon, place:placeLabel(), pass, position:data.position, heightKm:data.position.height_km, time:hhmm});
}

function select(start, reveal=false) {
  selected=start;
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

export function initIss() {
  el('iss-prev').addEventListener('click',()=>step(-1));
  el('iss-next').addEventListener('click',()=>step(1));
  el('iss-full').addEventListener('click',openFull);
  el('iss-close').addEventListener('click',()=>closeFull());
  window.addEventListener('popstate',()=>closeFull(true));
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&isFull()) closeFull();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&isFull()&&!document.fullscreenElement) closeFull();});
  // Kartta piirretään näkyvän kokonsa mukaan, joten ikkunan koon muutos vaatii uuden piirron.
  window.addEventListener('resize',()=>{if(data) drawMap();});
  // Käynnissä olevan ylilennon aikana asema liikkuu kartalla sekunneissa.
  setInterval(()=>{
    const track=selectedPass()?.track;
    if(!track) return;
    const [from,to]=trackSpan(track);
    if(Date.now()>=from && Date.now()<=to+2000) drawMap();
  },2000);
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
  const where=`${num(Math.abs(p.lat),1)}°${p.lat>=0?'P':'E'}, ${num(Math.abs(p.lon),1)}°${p.lon>=0?'I':'L'}`;
  el('iss-now').textContent = p.alt>0
    ? `Asema on nyt taivaalla: korkeus ${num(p.alt)}°, suunta ${dir(p.az)} · ${p.sunlit?'auringonvalossa':'Maan varjossa'}`
    : `Asema on nyt kohdan ${where} yllä ${num(p.height_km)} km korkeudella, ${num(p.range_km)} km päässä.`;
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
