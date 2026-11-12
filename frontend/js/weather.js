// Avaruussääkortti: Kp, revontuliarvio, tuntiennuste, aurinkotuuli ja hälytykset.
import { state, el, json, hhmm, num } from './core.js';
import { infoBtn, line } from './info.js';

const LEVELS=['Epätodennäköinen','Mahdollinen','Hyvä','Erittäin hyvä'];
const moonText=h=>`Kuu ${Math.round(h.moon_illumination*100)} % valaistu, ${h.moon_alt>0?'horisontin yläpuolella':'horisontin alapuolella'}`;
function hourDetail(h) {
  return [
    `Klo ${hhmm(h.time_tag)}: ${h.chance ?? 'ei Kp-ennustetta'}`,
    h.kp==null?null:`Kp ${num(h.kp,1)}`,
    h.cloud_cover==null?'pilvisyys ei tiedossa':`pilvisyys ${Math.round(h.cloud_cover)} %`,
    `${h.light.toLowerCase()} (Aurinko ${num(h.sun_alt)}°)`,
    moonText(h).replace('Kuu','kuu'),
    h.limits.length?`rajoittaa: ${h.limits.join(', ')}`:null,
  ].filter(Boolean).join(' · ');
}
function hourly(w) {
  el('hourly').hidden=!w.hourly.length;
  const b=w.best_window;
  el('best-window').textContent=b
    ? `Paras hetki: klo ${hhmm(b.start)}–${hhmm(b.end)} (${b.chance})`
    : 'Ei revontulille otollista hetkeä seuraavan 24 tunnin aikana';
  el('best-window').classList.toggle('none',!b);
  const selected=w.hourly.find(h=>h.time_tag===state.hour) ?? w.hourly.find(h=>h.time_tag===b?.start);
  el('hour-detail').textContent=selected?hourDetail(selected):'';
  el('hours').replaceChildren(...w.hourly.map(h=>{
    const btn=document.createElement('button'), bar=document.createElement('i'), label=document.createElement('small');
    const hour=new Date(h.time_tag).getHours();
    btn.type='button'; btn.className=`hour l${h.chance==null?'x':LEVELS.indexOf(h.chance)}${h.light==='Valoisaa'?' day':''}`;
    btn.setAttribute('aria-label',hourDetail(h)); btn.setAttribute('aria-pressed',String(h===selected));
    label.textContent=hour%3===0?String(hour).padStart(2,'0'):'';
    btn.append(bar,label);
    btn.addEventListener('click',()=>{
      state.hour=h.time_tag; el('hour-detail').textContent=hourDetail(h);
      el('hours').querySelectorAll('.hour').forEach(x=>x.setAttribute('aria-pressed',String(x===btn)));
    });
    return btn;
  }));
}
export async function weather() {
  try {
    const w = await json(`/api/spaceweather?lat=${state.lat}&lon=${state.lon}`);
    el('kp').textContent=w.kp_now.toFixed(1);
    el('g-label').replaceChildren(w.g_label, ' ', infoBtn('g'));
    el('aurora').textContent=`Revontuliarvio: ${w.aurora_chance}${w.aurora_limits.length?` – rajoittaa: ${w.aurora_limits.join(', ')}`:''}`;
    const where=state.place?`paikassa ${state.place.name}`:state.gps?`sijainnissasi (±${Math.round(state.gps.accuracy)} m)`:'oletussijainnissa';
    el('clouds').replaceChildren(...(w.cloud_cover_pct==null
      ? [line('Pilvisyystietoa ei saatu – arvio perustuu vain Kp-indeksiin')]
      : [
          line(`Pilvisyys ${where}: ${w.cloud_label} (${Math.round(w.cloud_cover_pct)} %)`, infoBtn('clouds')),
          line(`Lähde: ${w.cloud_provider}`),
        ]),
      line(`Kp yksin: ${w.aurora_chance_geomagnetic}`, infoBtn('kpOnly')),
      line(`Valoisuus: ${w.light} (Aurinko ${num(w.sun_alt)}°)`, infoBtn('light')),
      line(moonText(w)),
    );
    hourly(w);
    el('wind').replaceChildren(
      line(`Aurinkotuuli: ${w.solar_wind_speed_kms ?? '–'} km/s`, infoBtn('wind')),
      line(`Bz: ${w.bz_nt ?? '–'} nT`, infoBtn('bz')),
    );
    el('alerts').replaceChildren(...w.alerts.map(t => {const li=document.createElement('li'); li.textContent=t; return li;}));
    const svg=el('kp-chart'); svg.replaceChildren(); const pts=w.kp_history;
    if(pts.length) {
      const p=document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d',pts.map((v,i)=>`${i?'L':'M'}${5+i*310/Math.max(1,pts.length-1)},${100-v.kp*10}`).join(' '));
      p.setAttribute('stroke','#5ed6ff'); p.setAttribute('fill','none'); svg.append(p);
    }
  } catch(e) {el('g-label').textContent=e.message;}
}
