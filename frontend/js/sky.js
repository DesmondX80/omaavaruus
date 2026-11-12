// Taivaankarttakortti.
import { state, el, json, fmt } from './core.js';
import { placeLabel } from './places.js';
import { drawSky } from './skychart.js';

export async function sky() {
  try {
    const at=new Date(Date.now()+state.offset*60000).toISOString();
    const c=await json(`/api/sky?lat=${state.lat}&lon=${state.lon}&at=${encodeURIComponent(at)}`);
    drawSky(el('sky-chart'),c); el('time-label').textContent=fmt(c.at);
    el('sky-meta').textContent=`${placeLabel()} · ${state.lat.toFixed(2)}°, ${state.lon.toFixed(2)}° · ${c.moon_phase_name}`;
    el('object-list').replaceChildren(...c.objects.filter(o=>o.alt>0&&o.kind!=='star').map(o=>{const s=document.createElement('span'); s.textContent=`${o.name} ${o.alt.toFixed(0)}°`; return s;}));
  } catch(e) {el('sky-meta').textContent=e.message;}
}
