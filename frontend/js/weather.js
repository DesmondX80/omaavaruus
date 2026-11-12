// Avaruussääkortti: Kp, revontuliarvio, tuntiennuste, aurinkotuuli ja Kp-kaavio.
import { state, el, json, hhmm, num } from './core.js';
import { infoBtn, line } from './info.js';

const LEVELS=['Epätodennäköinen','Mahdollinen','Hyvä','Erittäin hyvä'];
const KP_BIN=3*3600000, KP_DAYS=2;
// Värit NOAA:n tapaan: rauhallinen vihreä, Kp 4 levoton keltainen, myrsky (G1+, Kp ≥ 5) punainen.
const kpColor=kp=>kp>=5?'#ff6b6b':kp>=4?'#ffd75e':'#4ade80';

function svgEl(name,attrs,text) {
  const n=document.createElementNS('http://www.w3.org/2000/svg',name);
  for(const [k,v] of Object.entries(attrs)) n.setAttribute(k,v);
  if(text!==undefined) n.textContent=text;
  return n;
}

// Pylväskaavio kolmen tunnin Kp-arvoista: kaksi vuorokautta havaittuja ja kaksi ennustettuja.
// Ennustepylväät ovat himmeämpiä, ja pystyviiva erottaa menneen tulevasta.
function drawKp(svg,w) {
  const W=320, H=140, L=22, R=4, T=8, B=22, now=Date.now();
  const start=Math.floor(now/KP_BIN)*KP_BIN-KP_DAYS*8*KP_BIN, end=start+2*KP_DAYS*8*KP_BIN;
  const bins=new Map();
  for(const p of w.kp_forecast) bins.set(Date.parse(p.time_tag),p);
  for(const p of w.kp_history) bins.set(Date.parse(p.time_tag),p);
  const n=(end-start)/KP_BIN, bw=(W-L-R)/n, y=kp=>T+(9-kp)/9*(H-T-B), x=t=>L+(t-start)/KP_BIN*bw;
  svg.replaceChildren();
  for(const kp of [0,3,5,7,9]) {
    svg.append(svgEl('line',{x1:L,x2:W-R,y1:y(kp),y2:y(kp),stroke:kp===5?'#7a3340':'#1d2740','stroke-dasharray':kp===5?'4 3':'none'}));
    svg.append(svgEl('text',{x:L-4,y:y(kp)+3,fill:'#8b9ac0','font-size':9,'text-anchor':'end'},kp));
  }
  svg.append(svgEl('text',{x:W-R,y:y(5)-3,fill:'#ff8b8b','font-size':9,'text-anchor':'end'},'myrsky (G1)'));
  for(let t=start;t<end;t+=KP_BIN) {
    const p=bins.get(t); if(!p) continue;
    const future=p.kind!=='observed', h=Math.max(1.5,y(0)-y(p.kp));
    const bar=svgEl('rect',{x:x(t)+0.6,y:y(0)-h,width:bw-1.2,height:h,fill:kpColor(p.kp),opacity:future?0.45:0.9,rx:1});
    bar.append(svgEl('title',{},`${new Date(t).toLocaleString('fi-FI',{weekday:'short',hour:'2-digit',minute:'2-digit'})}: Kp ${num(p.kp,1)}${future?' (ennuste)':''}`));
    svg.append(bar);
  }
  // Päivämäärät paikallisen keskiyön kohdalle.
  const midnight=new Date(start); midnight.setHours(24,0,0,0);
  for(let t=midnight.getTime();t<end;t+=86400000) {
    svg.append(svgEl('line',{x1:x(t),x2:x(t),y1:T,y2:H-B,stroke:'#1d2740'}));
    svg.append(svgEl('text',{x:x(t)+3,y:H-8,fill:'#8b9ac0','font-size':9},new Date(t).toLocaleDateString('fi-FI',{weekday:'short',day:'numeric',month:'numeric'})));
  }
  svg.append(svgEl('line',{x1:x(now),x2:x(now),y1:T-6,y2:H-B,stroke:'#5ed6ff','stroke-width':1.2}));
  // Yläreunassa nyt-teksti ei osu päivämääriin, jotka ovat alareunassa.
  svg.append(svgEl('text',{x:x(now)+3,y:T+4,fill:'#5ed6ff','font-size':9},'nyt'));
}
const moonText=h=>`Kuu ${Math.round(h.moon_illumination*100)} % valaistu, ${h.moon_alt>0?'horisontin yläpuolella':'horisontin alapuolella'}`;
function hourDetail(h) {
  return [
    `Klo ${hhmm(h.time_tag)}: ${h.chance ?? 'ei Kp-ennustetta'}`,
    h.model==='OVATION'?'OVATION-malli':h.kp==null?null:`Kp ${num(h.kp,1)}`,
    h.cloud_cover==null?'pilvisyys ei tiedossa':`pilvisyys ${Math.round(h.cloud_cover)} %`,
    `${h.light.toLowerCase()} (Aurinko ${num(h.sun_alt)}°)`,
    moonText(h).replace('Kuu','kuu'),
    h.limits.length?`rajoittaa: ${h.limits.join(', ')}`:null,
  ].filter(Boolean).join(' · ');
}
// Tuntipalkin tunnit ja valinta. Tunnin voi valita liu'uttamalla sormea tai hiirtä palkilla, napauttamalla tai näppäimistöllä.
let hours=[];
function selectHour(i) {
  const h=hours[i]; if(!h||h.time_tag===state.hour) return;
  state.hour=h.time_tag; el('hour-detail').textContent=hourDetail(h);
  [...el('hours').children].forEach((x,n)=>x.setAttribute('aria-pressed',String(n===i)));
}
function hourAt(e) {
  const r=el('hours').getBoundingClientRect();
  return Math.min(hours.length-1,Math.max(0,Math.floor((e.clientX-r.left)/r.width*hours.length)));
}
// Kosketus siepataan palkille, jotta liu'utus jatkuu, vaikka sormi valuisi palkin ylä- tai alapuolelle.
el('hours').addEventListener('pointerdown',e=>{el('hours').setPointerCapture(e.pointerId); selectHour(hourAt(e));});
el('hours').addEventListener('pointermove',e=>selectHour(hourAt(e)));
function hourly(w) {
  hours=w.hourly;
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
    return btn;
  }));
  // Näppäimistö: Enter tai välilyönti kohdistetulla tunnilla tuottaa click-tapahtuman.
  [...el('hours').children].forEach((btn,i)=>btn.addEventListener('click',()=>selectHour(i)));
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
      ...(w.ovation
        ? [line(`OVATION-malli: ${w.aurora_chance_geomagnetic} (yläpuolella ${w.ovation.probability} %, lähistöllä ${w.ovation.nearby} %)`, infoBtn('ovation'))]
        : []),
      line(`Kp yksin: ${w.aurora_chance_kp}`, infoBtn('kpOnly')),
      line(`Valoisuus: ${w.light} (Aurinko ${num(w.sun_alt)}°)`, infoBtn('light')),
      line(moonText(w)),
    );
    hourly(w);
    el('wind').replaceChildren(
      line(`Aurinkotuuli: ${w.solar_wind_speed_kms ?? '–'} km/s`, infoBtn('wind')),
      line(`Bz: ${w.bz_nt ?? '–'} nT`, infoBtn('bz')),
    );
    drawKp(el('kp-chart'),w);
  } catch(e) {el('g-label').textContent=e.message;}
}
