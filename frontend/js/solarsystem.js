// Aurinkokunnan kartta: planeetat kiertoradoillaan oikeassa mittakaavassa, ylhäältä ekliptikan pohjoispuolelta katsottuna.
// Sijainnit lasketaan selaimessa (planets.js), joten kartta ei kuormita palvelinta. Kevätpisteen suunta on oikealle.
import { el, num } from './core.js';
import { AU_KM, LIGHT_AU_PER_MIN, SUN_RADIUS_KM, distance, orbitPoint, solarSystem } from './planets.js';

const DAY = 86400000;
/** Näkymän säde (kartan lyhyemmän sivun puolikas) astronomisina yksikköinä: noin 30 000 km:stä koko aurinkokuntaan. */
const RADIUS_MIN = 0.0002, RADIUS_MAX = 40;
const PRESETS = {inner:1.8, all:35};
/** Toistonopeudet vuorokausina sekunnissa. */
const SPEEDS = [[1/24,'1 h/s'],[1,'1 vrk/s'],[7,'1 vk/s'],[30,'1 kk/s'],[365.25,'1 v/s']];
/** Aikajanan ulottuvuus vuorokausina kumpaankin suuntaan. */
const RANGE_DAYS = 3650;
const HIT_RADIUS = 18;

// offset: kartan hetki suhteessa nykyhetkeen (ms). Kartta kulkee aina oikeassa ajassa, myös siirrettynä.
let offset=0, playing=false, speed=2, radius=PRESETS.all;
// Keskipiste: seurattava kohde (nimi) tai kiinteä kohta [x, y] AU; selected: napautettu kohde.
let follow='Aurinko', fixed=[0,0], selected=null;
let frame=null, lastFrame=0, lastDraw=0, dirty=true, hits=[];

const isFull = () => el('solar').classList.contains('solar-full');
const visible = () => !document.hidden && !el('view-taivas').hidden;
const mapTime = () => Date.now()+offset;

const fmtAu = au => au<0.01 ? `${num(au*AU_KM/1000)} tuhatta km` : `${num(au,au<1 ? 3 : 2)} AU (${num(au*AU_KM/1e6)} milj. km)`;
function lightTime(au) {
  const min=au/LIGHT_AU_PER_MIN;
  return min<1 ? `${num(min*60)} s` : min<120 ? `${num(min,min<10 ? 1 : 0)} min` : `${num(min/60,1)} h`;
}
function relative(ms) {
  const a=Math.abs(ms), sign=ms<0 ? '−' : '+';
  if(a<60000) return 'nyt';
  if(a<DAY) return `${sign}${num(a/3600000,1)} h`;
  if(a<365.25*DAY) return `${sign}${num(a/DAY)} vrk`;
  return `${sign}${num(a/365.25/DAY,1)} v`;
}

// Mittakaavajanalle pyöreä pituus, joka on enintään annettu määrä astronomisia yksiköitä.
const AU_STEPS=[20,10,5,2,1,0.5,0.2,0.1,0.05,0.02,0.01];
const KM_STEPS=[1e6,5e5,2e5,1e5,5e4,2e4,1e4,5000,2000,1000];
function scaleStep(maxAu) {
  const au=AU_STEPS.find(v=>v<=maxAu);
  if(au) return [au, `${num(au,2)} AU`];
  const km=KM_STEPS.find(v=>v<=maxAu*AU_KM) ?? 1000;
  return [km/AU_KM, `${num(km)} km`];
}

/**
 * Kiertorata murtoviivana. Radan 720 perusvälistä piirretään vain kartalle osuvat, ja ne jaetaan muutaman
 * pikselin paloihin, jotta rata pysyy tarkkana myös lähelle zoomattuna eikä planeetta irtoa viivasta.
 */
function orbitPath(ctx, el, toPx, w, h) {
  const N=720, step=2*Math.PI/N, margin=20;
  let prev=toPx(orbitPoint(el,0)), pen=false;
  for(let i=1;i<=N;i++) {
    const p=toPx(orbitPoint(el,i*step));
    const off=Math.max(prev[0],p[0])<-margin || Math.min(prev[0],p[0])>w+margin || Math.max(prev[1],p[1])<-margin || Math.min(prev[1],p[1])>h+margin;
    if(off) {pen=false; prev=p; continue;}
    if(!pen) {ctx.moveTo(prev[0],prev[1]); pen=true;}
    const parts=Math.min(4000,Math.ceil(Math.hypot(p[0]-prev[0],p[1]-prev[1])/3));
    for(let j=1;j<parts;j++) {const q=toPx(orbitPoint(el,(i-1+j/parts)*step)); ctx.lineTo(q[0],q[1]);}
    ctx.lineTo(p[0],p[1]);
    prev=p;
  }
}

function draw() {
  dirty=false; lastDraw=performance.now();
  const canvas=el('solar-map'), w=canvas.clientWidth, h=canvas.clientHeight, scale=window.devicePixelRatio||1;
  const time=mapTime(), planets=solarSystem(time);
  renderText(planets,time);
  if(!w||!h) return;
  canvas.width=Math.round(w*scale); canvas.height=Math.round(h*scale);
  const ctx=canvas.getContext('2d'), cx=w/2, cy=h/2, k=Math.min(w,h)/2/radius;
  const center=follow==='Aurinko' ? [0,0] : planets.find(p=>p.name===follow)?.pos ?? fixed;
  const toPx=([x,y])=>[cx+(x-center[0])*k, cy-(y-center[1])*k];
  ctx.setTransform(scale,0,0,scale,0,0);
  ctx.fillStyle='#03050b'; ctx.fillRect(0,0,w,h);

  for(const p of planets) {
    ctx.beginPath(); orbitPath(ctx,p.el,toPx,w,h);
    ctx.strokeStyle=p.color; ctx.globalAlpha=p.name===selected ? 0.8 : 0.35; ctx.lineWidth=p.name===selected ? 1.5 : 1; ctx.stroke();
  }
  ctx.globalAlpha=1;

  // Kohteet piirretään todellisen kokoisina, mutta vähintään pisteenä, jotta ne näkyvät kaukaa.
  const bodies=[{name:'Aurinko', color:'#ffd75e', pos:[0,0,0], radiusKm:SUN_RADIUS_KM, min:5}, ...planets.map(p=>({...p, min:3.5}))];
  hits=[];
  for(const b of bodies) {
    const [x,y]=toPx(b.pos), r=Math.max(b.min,b.radiusKm/AU_KM*k);
    hits.push({name:b.name, x, y, r});
    if(x<-r||x>w+r||y<-r||y>h+r) continue;
    if(b.name==='Aurinko') {
      const glow=ctx.createRadialGradient(x,y,r*0.5,x,y,r*3);
      glow.addColorStop(0,'rgba(255,215,94,.35)'); glow.addColorStop(1,'rgba(255,215,94,0)');
      ctx.fillStyle=glow; ctx.beginPath(); ctx.arc(x,y,r*3,0,2*Math.PI); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x,y,r,0,2*Math.PI); ctx.fillStyle=b.color; ctx.fill();
    if(b.name===selected) {ctx.beginPath(); ctx.arc(x,y,r+5,0,2*Math.PI); ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.stroke();}
  }

  // Nimet: valittu ja Maa ensin, eikä päällekkäisiä piirretä (koko aurinkokunnan näkymässä sisäplaneetat ovat lähekkäin).
  ctx.font='11px system-ui, sans-serif'; ctx.textAlign='center'; ctx.lineJoin='round';
  const order=[...hits].sort((a,b)=>(b.name===selected)-(a.name===selected) || (b.name==='Maa')-(a.name==='Maa'));
  const taken=[];
  for(const hit of order) {
    if(hit.x<0||hit.x>w||hit.y<0||hit.y>h) continue;
    // Reunan lähellä nimi siirretään kokonaan kartalle.
    const tw=ctx.measureText(hit.name).width, x=Math.max(tw/2+4,Math.min(w-tw/2-4,hit.x)), y=hit.y-hit.r-6;
    const box=[x-tw/2-2,y-11,x+tw/2+2,y+3];
    if(box[2]<0||box[0]>w||box[3]<0||box[1]>h) continue;
    if(taken.some(t=>box[0]<t[2]&&box[2]>t[0]&&box[1]<t[3]&&box[3]>t[1])) continue;
    taken.push(box);
    ctx.lineWidth=3; ctx.strokeStyle='#03050b'; ctx.strokeText(hit.name,x,y);
    ctx.fillStyle=hit.name===selected ? '#fff' : '#c9d3ec'; ctx.fillText(hit.name,x,y);
  }

  const [au,text]=scaleStep(w/4/k), len=au*k;
  ctx.beginPath(); ctx.moveTo(10,h-14); ctx.lineTo(10,h-10); ctx.lineTo(10+len,h-10); ctx.lineTo(10+len,h-14);
  ctx.strokeStyle='#8b9ac0'; ctx.lineWidth=1; ctx.stroke();
  ctx.fillStyle='#8b9ac0'; ctx.fillText(text,10+len/2,h-16);
  ctx.textAlign='right'; ctx.fillText('kevätpiste →',w-8,18);

  el('solar-zoom-in').disabled=radius<=RADIUS_MIN; el('solar-zoom-out').disabled=radius>=RADIUS_MAX;
}

function renderText(planets, time) {
  el('solar-time-label').textContent=`${new Date(time).toLocaleString('fi-FI',{weekday:'short',day:'numeric',month:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})} · ${relative(offset)}`;
  const slider=el('solar-offset');
  if(document.activeElement!==slider || playing) slider.value=String(Math.round(offset/DAY));
  el('solar-play').textContent=playing ? '❚❚' : '▶';
  el('solar-play').setAttribute('aria-label',playing ? 'Pysäytä' : 'Toista');
  const detail=el('solar-detail');
  if(!selected) {detail.textContent='Napauta planeettaa, niin kartta seuraa sitä ja näet sen etäisyydet.'; return;}
  const earth=planets.find(p=>p.name==='Maa').pos;
  if(selected==='Aurinko') {
    const d=Math.hypot(...earth);
    detail.textContent=`Aurinko · ${fmtAu(d)} Maasta, valo kulkee ${lightTime(d)}`;
    return;
  }
  const p=planets.find(x=>x.name===selected), sun=Math.hypot(...p.pos);
  const parts=[selected, `${fmtAu(sun)} Auringosta`];
  if(selected!=='Maa') {const d=distance(p.pos,earth); parts.push(`${fmtAu(d)} Maasta, valo kulkee ${lightTime(d)}`);}
  parts.push(`kierros ${p.periodYears<2 ? `${num(p.periodYears*365.25)} vrk` : `${num(p.periodYears,1)} vuotta`}`);
  detail.textContent=parts.join(' · ');
}

// Silmukka: toistettaessa piirretään joka ruudunpäivityksellä, muuten kerran sekunnissa, jolloin planeetat liikkuvat
// oikeassa ajassa (Maa noin 30 km/s, mikä näkyy lähelle zoomattuna). Silmukka pysähtyy, kun kartta ei ole näkyvissä.
function tick(now) {
  frame=null;
  if(!visible()) return;
  if(playing) {
    offset+=(now-lastFrame)*SPEEDS[speed][0]*DAY/1000;
    if(Math.abs(offset)>=RANGE_DAYS*DAY) {offset=Math.sign(offset)*RANGE_DAYS*DAY; playing=false;}
  }
  lastFrame=now;
  if(playing||dirty||now-lastDraw>=1000) draw();
  frame=requestAnimationFrame(tick);
}
function start() { dirty=true; if(!frame&&visible()) {lastFrame=performance.now(); frame=requestAnimationFrame(tick);} }

function zoomTo(r) { radius=Math.max(RADIUS_MIN,Math.min(RADIUS_MAX,r)); start(); }

// Raahaus irrottaa kartan seuratusta kohteesta ja siirtää keskipistettä.
function panBy(dx, dy) {
  const canvas=el('solar-map'), k=Math.min(canvas.clientWidth,canvas.clientHeight)/2/radius;
  if(follow) {
    fixed=follow==='Aurinko' ? [0,0] : solarSystem(mapTime()).find(p=>p.name===follow).pos.slice(0,2);
    follow=null;
  }
  fixed=[fixed[0]-dx/k, fixed[1]+dy/k];
  start();
}

function pick(x, y) {
  const hit=hits.filter(h=>Math.hypot(h.x-x,h.y-y)<=Math.max(HIT_RADIUS,h.r))
    .sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0];
  if(hit) {selected=hit.name; follow=hit.name;}
  else selected=null;
  start();
}

function preset(name) { radius=PRESETS[name]; follow='Aurinko'; start(); }

function openFull() {
  if(isFull()) return;
  el('solar').classList.add('solar-full'); document.body.classList.add('sky-locked');
  history.pushState({solarFull:true},'');
  el('solar').requestFullscreen?.().catch(()=>{});
  start();
}
function closeFull(fromHistory=false) {
  if(!isFull()) return;
  el('solar').classList.remove('solar-full'); document.body.classList.remove('sky-locked');
  if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  if(!fromHistory && history.state?.solarFull) history.back();
  start();
}

// Eleet kuten ISS-kartalla: raahaus siirtää, nipistys zoomaa, napautus valitsee kohteen.
// Kortissa pystysuuntainen pyyhkäisy vierittää sivua (CSS touch-action), koko näytössä kartta liikkuu joka suuntaan.
function initGestures(canvas) {
  const fingers=new Map(); let last=null, moved=false, multi=false;
  const measure=()=>{
    const p=[...fingers.values()], x=p.reduce((s,f)=>s+f.x,0)/p.length, y=p.reduce((s,f)=>s+f.y,0)/p.length;
    return {x, y, spread:p.length>1 ? Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y) : 0};
  };
  canvas.addEventListener('pointerdown',e=>{
    canvas.setPointerCapture?.(e.pointerId);
    fingers.set(e.pointerId,{x:e.clientX,y:e.clientY}); last=measure();
    if(fingers.size===1) {moved=false; multi=false;} else multi=true;
  });
  canvas.addEventListener('pointermove',e=>{
    if(!fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const now=measure();
    if(!moved && Math.hypot(now.x-last.x,now.y-last.y)<4 && Math.abs(now.spread-last.spread)<4) return;
    moved=true;
    if(last.spread>10&&now.spread>10) radius=Math.max(RADIUS_MIN,Math.min(RADIUS_MAX,radius*last.spread/now.spread));
    if(now.x!==last.x||now.y!==last.y) panBy(now.x-last.x,now.y-last.y); else start();
    last=now;
  });
  canvas.addEventListener('pointerup',e=>{
    if(fingers.has(e.pointerId)&&fingers.size===1&&!moved&&!multi) {
      const r=canvas.getBoundingClientRect(); pick(e.clientX-r.left,e.clientY-r.top);
    }
    fingers.delete(e.pointerId); last=fingers.size ? measure() : null;
  });
  canvas.addEventListener('pointercancel',e=>{fingers.delete(e.pointerId); last=fingers.size ? measure() : null;});
}

export function initSolarSystem() {
  const speedSelect=el('solar-speed');
  speedSelect.replaceChildren(...SPEEDS.map(([,label],i)=>new Option(label,String(i),i===speed,i===speed)));
  speedSelect.addEventListener('change',()=>{speed=Number(speedSelect.value);});
  el('solar-offset').min=String(-RANGE_DAYS); el('solar-offset').max=String(RANGE_DAYS);
  el('solar-offset').addEventListener('input',e=>{playing=false; offset=Number(e.target.value)*DAY; start();});
  el('solar-play').addEventListener('click',()=>{
    // Aikajanan päästä toisto alkaa alusta.
    if(!playing && offset>=RANGE_DAYS*DAY) offset=-RANGE_DAYS*DAY;
    playing=!playing; start();
  });
  el('solar-now').addEventListener('click',()=>{playing=false; offset=0; start();});
  for(const b of el('solar').querySelectorAll('[data-solar-preset]')) b.addEventListener('click',()=>preset(b.dataset.solarPreset));
  el('solar-zoom-in').addEventListener('click',()=>zoomTo(radius/1.6));
  el('solar-zoom-out').addEventListener('click',()=>zoomTo(radius*1.6));
  el('solar-full').addEventListener('click',openFull);
  el('solar-close').addEventListener('click',()=>closeFull());
  initGestures(el('solar-map'));
  // Rulla zoomaa vain koko näytössä; kortissa se vierittää sivua.
  el('solar-map').addEventListener('wheel',e=>{if(!isFull()) return; e.preventDefault(); zoomTo(radius*Math.exp(e.deltaY*0.0015));},{passive:false});
  window.addEventListener('popstate',()=>closeFull(true));
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&isFull()) closeFull();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&isFull()&&!document.fullscreenElement) closeFull();});
  window.addEventListener('resize',start);
  document.addEventListener('viewchange',start);
  document.addEventListener('visibilitychange',start);
  start();
}

