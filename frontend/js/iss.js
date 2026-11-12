// ISS-kortti: aseman sijainti ja näkyvät ylilennot valitulta paikalta sekä ilmoitusvalinta.
import { state, el, json, hhmm, num, saved } from './core.js';
import { ISS_KEY, pushActive, syncPush } from './push.js';

const DIRECTIONS = ['P','KO','I','KA','E','LO','L','LU'];
const dir = az => DIRECTIONS[Math.round(az/45)%8];
const day = t => new Date(t).toLocaleDateString('fi-FI',{weekday:'short',day:'numeric',month:'numeric'});
let data=null;

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
  const visible=data.passes.filter(x=>x.visible_start);
  el('iss-passes').replaceChildren(...(visible.length ? visible.map(x=>{
    const li=document.createElement('li'), when=document.createElement('span'), body=document.createElement('div');
    when.className='event-day'; when.textContent=`${day(x.visible_start)} ${hhmm(x.visible_start)}`;
    const b=document.createElement('b'); b.textContent=`Korkeimmillaan ${num(x.max_alt)}° ${dir(x.max_az)}${x.max_alt<10?' · matala':''}`;
    const s=document.createElement('small');
    const span=hhmm(x.visible_start)===hhmm(x.visible_end) ? `hetken klo ${hhmm(x.visible_start)}` : `${hhmm(x.visible_start)}–${hhmm(x.visible_end)}`;
    s.textContent=`Näkyy ${span} · nousee ${dir(x.start_az)}, laskee ${dir(x.end_az)}${x.magnitude===null?'':` · kirkkaus noin ${num(x.magnitude,1)} mag`}`;
    body.append(b,s); li.append(when,body); return li;
  }) : [Object.assign(document.createElement('li'),{textContent:`Ei näkyviä ylilentoja viiteen vuorokauteen (ylilentoja yhteensä ${data.passes.length}, mutta asema on silloin Maan varjossa tai taivas on liian valoisa).`})]));
  el('iss-meta').textContent=`Ratatiedot CelesTrak, epookki ${day(data.tle_epoch)} ${hhmm(data.tle_epoch)}. Ylilento alkaa ja päättyy 5° korkeudella.`;
}

export async function iss() {
  try {data=await json(`/api/iss?lat=${state.lat}&lon=${state.lon}`); render();}
  catch(e) {el('iss-meta').textContent=e.message;}
  renderNotify();
}
document.addEventListener('pushchange',renderNotify);
