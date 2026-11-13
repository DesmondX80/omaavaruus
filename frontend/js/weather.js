// Revontulet-näkymä: arvio nyt, tuntiennuste, arvioon vaikuttavat tekijät ja Kp-kaavio.
import { state, el, json, hhmm, num, publish } from './core.js';
import { infoBtn } from './info.js';
import { placeLabel } from './places.js';

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
// Tunnin palkin luokka: arvion taso ja katkoviiva liian valoisille tunneille.
export const hourClass = h => `hour l${h.chance==null?'x':LEVELS.indexOf(h.chance)}${h.light==='Valoisaa'?' day':''}`;
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
    btn.type='button'; btn.className=hourClass(h);
    btn.setAttribute('aria-label',hourDetail(h)); btn.setAttribute('aria-pressed',String(h===selected));
    label.textContent=hour%3===0?String(hour).padStart(2,'0'):'';
    btn.append(bar,label);
    return btn;
  }));
  // Näppäimistö: Enter tai välilyönti kohdistetulla tunnilla tuottaa click-tapahtuman.
  [...el('hours').children].forEach((btn,i)=>btn.addEventListener('click',()=>selectHour(i)));
}
// Arvion taso väriksi: hyvä vihreä, mahdollinen keltainen, muu neutraali.
export const chanceTone = chance => ({'Hyvä':'good','Erittäin hyvä':'good','Mahdollinen':'mid'})[chance] ?? 'off';
const pill = (text, tone) => {const s=document.createElement('span'); s.className=`level ${tone==='good'?'':tone}`; s.textContent=text; return s;};

// Yksi arvioon vaikuttava tekijä: nimi ja arvo, tarkenne ja oikealla sen vaikutus arvioon.
function factor(title, detail, level, info) {
  const row=document.createElement('div'), b=document.createElement('b'), small=document.createElement('small');
  row.className='factor'; b.append(title); if(info) b.append(' ',infoBtn(info));
  small.textContent=detail; row.append(b,small); if(level) row.append(level);
  return row;
}

function factors(w) {
  const where=state.place?state.place.name:state.gps?`oma sijainti (±${Math.round(state.gps.accuracy)} m)`:'oletussijainti';
  const cloud=w.cloud_cover_pct;
  const bright=w.moon_alt>0&&w.moon_illumination>=0.5;
  return [
    w.ovation && factor('OVATION-malli', `Yläpuolella ${w.ovation.probability} %, lähistöllä ${w.ovation.nearby} %`, pill(w.aurora_chance_geomagnetic,chanceTone(w.aurora_chance_geomagnetic)), 'ovation'),
    factor(`Kp-indeksi ${num(w.kp_now,1)}`, `${w.g_label} · pelkän Kp:n perusteella: ${w.aurora_chance_kp.toLowerCase()}`, pill(w.aurora_chance_kp,chanceTone(w.aurora_chance_kp)), 'kp'),
    cloud==null
      ? factor('Pilvisyys', 'Pilvisyystietoa ei saatu, joten arvio ei huomioi pilviä', pill('Ei tietoa','off'), 'clouds')
      : factor(`Pilvisyys ${Math.round(cloud)} %`, `${w.cloud_label} · ${where} · ${w.cloud_provider}`, cloud>90?pill('Estää','bad'):cloud>30?pill('Heikentää','mid'):pill('Ei haittaa','good'), 'clouds'),
    factor('Valoisuus', `${w.light} (Aurinko ${num(w.sun_alt)}°)`, w.light==='Valoisaa'?pill('Liian valoisaa','bad'):w.light==='Hämärää'?pill('Heikentää','mid'):pill('Pimeää','good'), 'light'),
    factor(`Kuu ${Math.round(w.moon_illumination*100)} %`, w.moon_alt>0?'Horisontin yläpuolella':'Horisontin alapuolella', bright?pill('Himmentää','mid'):pill('Ei häiritse','good')),
    factor(`Aurinkotuuli ${w.solar_wind_speed_kms ?? '–'} km/s`, `Bz ${w.bz_nt ?? '–'} nT`, w.bz_nt==null?null:w.bz_nt<0?pill('Bz etelään','good'):pill('Bz pohjoiseen','off'), 'bz'),
  ].filter(Boolean);
}

export async function weather() {
  try {
    const w = await json(`/api/spaceweather?lat=${state.lat}&lon=${state.lon}`);
    const now=document.createElement('b'); now.textContent=w.aurora_chance;
    el('aurora').replaceChildren('Nyt: ',now);
    el('aurora-verdict').className=`verdict ${chanceTone(w.aurora_chance)}`;
    el('aurora-eyebrow').textContent=`Revontuliarvio · ${placeLabel()}${w.aurora_limits.length?` · rajoittaa: ${w.aurora_limits.join(', ')}`:''}`;
    el('factors').replaceChildren(...factors(w));
    hourly(w);
    drawKp(el('kp-chart'),w);
    publish('weather',{...w, fetched:Date.now()});
  } catch(e) {el('aurora').textContent=e.message;}
}

// Kaavion valinta: ovaali, Kp tai aurinkotuuli, yksi kerrallaan.
el('aurora-seg').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  for(const x of el('aurora-seg').children) {x.setAttribute('aria-pressed',String(x===b)); el(`pane-${x.dataset.pane}`).hidden=x!==b;}
});
