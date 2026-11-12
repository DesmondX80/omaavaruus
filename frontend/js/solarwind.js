// Aurinkotuuli- ja ovaalikortti: OVATION-mallin revontuliovaali napakarttana ja aurinkotuulen käyrät vuorokauden ajalta.
import { state, el, json, hhmm, num } from './core.js';
import { LAND } from './land.js';
import { placeLabel } from './places.js';

const SVG = 'http://www.w3.org/2000/svg';
const MAP_SIZE = 320, MAP_R = 150;
// Kortin arvot ajastetaan avaruussään tahtiin; OVATION päivittyy noin viiden minuutin välein.
let lastMap = null;

function svgEl(name, attrs, text) {
  const n=document.createElementNS(SVG,name);
  for(const [k,v] of Object.entries(attrs)) n.setAttribute(k,v);
  if(text!==undefined) n.textContent=text;
  return n;
}

// Napakartta, jossa havaitsijan pituuspiiri osoittaa alas. Reuna on leveysasteella latMin, keskellä napa.
function projector(map, lon0) {
  const south=map.hemisphere==='south', span=90-map.lat_min, c=MAP_SIZE/2;
  return (lon, lat) => {
    const r=(90-(south?-lat:lat))/span*MAP_R, t=(lon-lon0)*Math.PI/180;
    // Pohjoisnavan yläpuolelta katsottuna itä kiertää vastapäivään, eteläisellä pallonpuoliskolla myötäpäivään.
    return [c+(south?-1:1)*r*Math.sin(t), c+r*Math.cos(t)];
  };
}

// Värit kuten SWPC:n kartassa: vihreästä (pieni todennäköisyys) keltaisen kautta punaiseen.
// Läpinäkyvyys kasvaa todennäköisyyden mukana, jotta ovaalin vahvin kohta erottuu heikosta reunasta.
const cellColor = p => `hsla(${Math.round(120-Math.min(p,60)/60*120)},90%,55%,${Math.min(0.9,0.08+p/30).toFixed(2)})`;

function drawMap(map) {
  const canvas=el('ovation-map'), scale=window.devicePixelRatio||1;
  canvas.width=canvas.height=MAP_SIZE*scale;
  const ctx=canvas.getContext('2d'), c=MAP_SIZE/2, project=projector(map,state.lon);
  ctx.setTransform(scale,0,0,scale,0,0);
  ctx.clearRect(0,0,MAP_SIZE,MAP_SIZE);
  ctx.save();
  ctx.beginPath(); ctx.arc(c,c,MAP_R,0,2*Math.PI); ctx.fillStyle='#071022'; ctx.fill(); ctx.clip();

  ctx.beginPath();
  for(const ring of LAND) {
    for(let i=0;i<ring.length;i+=2) {
      const [x,y]=project(ring[i]/2,ring[i+1]/2);
      i ? ctx.lineTo(x,y) : ctx.moveTo(x,y);
    }
    ctx.closePath();
  }
  ctx.fillStyle='#1a2236'; ctx.fill('evenodd'); ctx.strokeStyle='#33405f'; ctx.lineWidth=0.6; ctx.stroke();

  // Ruudukon solu kattaa asteen kumpaankin suuntaan; reunimmaiset rivit jäävät osin kartan ulkopuolelle.
  const sign=map.hemisphere==='south'?-1:1;
  map.rows.forEach((row,i)=>{
    const lat=sign*(map.lat_min+i);
    row.forEach((p,lon)=>{
      if(p<3) return;
      ctx.beginPath();
      [[lon-.5,lat-.5],[lon+.5,lat-.5],[lon+.5,lat+.5],[lon-.5,lat+.5]].forEach(([lo,la],k)=>{const [x,y]=project(lo,Math.max(-90,Math.min(90,la))); k?ctx.lineTo(x,y):ctx.moveTo(x,y);});
      ctx.fillStyle=cellColor(p); ctx.fill();
    });
  });

  ctx.strokeStyle='#2a3858'; ctx.setLineDash([2,4]); ctx.lineWidth=0.8;
  for(const lat of [50,60,70,80]) {ctx.beginPath(); ctx.arc(c,c,(90-lat)/(90-map.lat_min)*MAP_R,0,2*Math.PI); ctx.stroke();}
  ctx.setLineDash([]);
  ctx.restore();

  ctx.beginPath(); ctx.arc(c,c,MAP_R,0,2*Math.PI); ctx.strokeStyle='#2a3858'; ctx.lineWidth=1; ctx.stroke();
  // Havaitsija: piste ja 500 km säde, jolta revontulet voivat näkyä horisontin yläpuolella.
  if(Math.abs(state.lat)>=map.lat_min-5) {
    const [x,y]=project(state.lon,state.lat), r=500/111/(90-map.lat_min)*MAP_R;
    ctx.beginPath(); ctx.arc(x,y,r,0,2*Math.PI); ctx.strokeStyle='rgba(94,214,255,.6)'; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x,y,3.5,0,2*Math.PI); ctx.fillStyle='#5ed6ff'; ctx.fill();
    ctx.font='11px system-ui, sans-serif'; ctx.textAlign='center'; ctx.fillText(placeLabel(),x,Math.min(MAP_SIZE-6,y+r+12));
  }
  el('ovation-meta').textContent=`OVATION-ennuste klo ${hhmm(map.forecast)} (havainnot klo ${hhmm(map.observed)}) · väri kertoo revontulien todennäköisyyden: vihreä pieni, punainen suuri · katkoviiva 500 km säde`;
}

// Viivakaavio vuorokauden ajalta. Puuttuvat jaksot katkaisevat viivan.
function chart(id, points, key, {color, unit, digits=0, zero=false}) {
  const svg=el(id), W=320, H=70, L=34, T=6, B=14;
  const values=points.map(p=>p[key]), known=values.filter(v=>v!==null);
  svg.replaceChildren();
  if(!known.length) {svg.append(svgEl('text',{x:W/2,y:H/2,fill:'#8b9ac0','font-size':11,'text-anchor':'middle'},'Ei mittauksia')); return null;}
  let min=Math.min(...known), max=Math.max(...known);
  if(zero) {const m=Math.max(Math.abs(min),Math.abs(max),1); min=-m; max=m;}
  if(max-min<1e-6) {min-=1; max+=1;}
  const x=i=>L+i*(W-L-2)/Math.max(1,points.length-1), y=v=>T+(max-v)/(max-min)*(H-T-B);
  const axis=(v)=>svg.append(svgEl('text',{x:L-4,y:y(v)+3,fill:'#8b9ac0','font-size':9,'text-anchor':'end'},num(v,digits)));
  axis(max); axis(min);
  if(zero) {svg.append(svgEl('line',{x1:L,x2:W-2,y1:y(0),y2:y(0),stroke:'#2a3858'})); axis(0);}
  let d='', pen=false;
  values.forEach((v,i)=>{if(v===null){pen=false; return;} d+=`${pen?'L':'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen=true;});
  if(zero) {
    // Etelään osoittava (negatiivinen) Bz on revontulille suotuisa: alue nollan alapuolella korostetaan.
    const clip=svgEl('clipPath',{id:`${id}-neg`}); clip.append(svgEl('rect',{x:L,y:y(0),width:W-L,height:H-B-y(0)}));
    svg.append(clip, svgEl('path',{d,stroke:'#4ade80','stroke-width':1.6,fill:'none','clip-path':`url(#${id}-neg)`}));
  }
  svg.prepend(svgEl('path',{d,stroke:color,'stroke-width':1.2,fill:'none'}));
  [0,Math.floor(points.length/2),points.length-1].forEach((i,k)=>svg.append(svgEl('text',{x:x(i),y:H-2,fill:'#8b9ac0','font-size':9,'text-anchor':['start','middle','end'][k]},hhmm(points[i].time_tag))));
  const latest=[...values].reverse().find(v=>v!==null);
  return `${num(latest,digits)} ${unit}`;
}

async function loadMap() {
  try {
    lastMap=await json(`/api/ovation?lat=${state.lat}&lon=${state.lon}`);
    drawMap(lastMap);
  } catch(e) {el('ovation-meta').textContent=e.message;}
}

async function loadWind() {
  try {
    const w=await json('/api/solarwind');
    const speed=chart('wind-speed',w.points,'speed_kms',{color:'#ffb547',unit:'km/s'});
    const density=chart('wind-density',w.points,'density_cm3',{color:'#5ed6ff',unit:'p/cm³',digits:1});
    const bz=chart('wind-bz',w.points,'bz_nt',{color:'#e8eefc',unit:'nT',digits:1,zero:true});
    el('wind-speed-now').textContent=speed??'–'; el('wind-density-now').textContent=density??'–'; el('wind-bz-now').textContent=bz??'–';
    el('wind-meta').textContent=`Mittaukset L1-pisteestä (${w.source ?? 'lähde ei tiedossa'}) 10 minuutin keskiarvoina. Aurinkotuuli saapuu sieltä Maahan noin 30–60 minuutissa.`;
  } catch(e) {el('wind-meta').textContent=e.message;}
}

export function solarwind() { loadMap(); loadWind(); }
// Paikan vaihtuessa kartta käännetään uuden paikan suuntaan.
export function redrawMap() { lastMap ? (drawMap(lastMap), lastMap.hemisphere!==(state.lat<0?'south':'north') && loadMap()) : loadMap(); }
