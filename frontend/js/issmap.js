// ISS-ylilennon kartta: aseman maanpäällinen reitti havaintopaikan ympäristössä.
// Projektio on havaitsijaan keskitetty keskipituinen tasoprojektio: etäisyys ja suunta havaitsijasta ovat oikein, pohjoinen on ylhäällä.
import { LAND } from './land.js';

const R_EARTH = 6371, RAD = Math.PI/180;
// Kartan lyhyempi sivu kattaa tämän säteen: 5° korkeudella näkyvä asema on enintään noin 1 800 km päässä.
export const MAP_RADIUS_KM = 2400;

/** Paikan (lat, lon) sijainti kilometreinä itään ja pohjoiseen havaitsijasta (lat0, lon0). */
export function project(lat0, lon0, lat, lon) {
  const p0=lat0*RAD, p=lat*RAD, dl=(lon-lon0)*RAD;
  const cosC=Math.sin(p0)*Math.sin(p)+Math.cos(p0)*Math.cos(p)*Math.cos(dl);
  const c=Math.acos(Math.max(-1,Math.min(1,cosC))), k=c<1e-9 ? 1 : c/Math.sin(c);
  return [R_EARTH*k*Math.cos(p)*Math.sin(dl), R_EARTH*k*(Math.cos(p0)*Math.sin(p)-Math.sin(p0)*Math.cos(p)*Math.cos(dl))];
}

/** Etäisyys maata pitkin kohtaan, jonka yllä korkeudella heightKm lentävä asema näkyy annetulla korkeuskulmalla. */
export function horizonKm(heightKm, elevation) {
  const e=elevation*RAD;
  return R_EARTH*(Math.acos(R_EARTH/(R_EARTH+heightKm)*Math.cos(e))-e);
}

/** Reitin ensimmäisen ja viimeisen pisteen hetket millisekunteina. */
export function trackSpan(track) {
  const start=Date.parse(track.start);
  return [start, start+(track.points.length-1)*track.step_s*1000];
}

// Reitin kohta hetkellä time näytepisteiden väliltä; null, jos hetki on reitin ulkopuolella.
function trackPoint(xy, track, time) {
  const f=(time-Date.parse(track.start))/(track.step_s*1000), i=Math.floor(f);
  if(!(f>=0) || f>xy.length-1) return null;
  if(i>=xy.length-1) return xy[xy.length-1];
  const t=f-i;
  return [xy[i][0]+(xy[i+1][0]-xy[i][0])*t, xy[i][1]+(xy[i+1][1]-xy[i][1])*t];
}

// Reitin osuus aikaväliltä [from, to] murtoviivana.
function section(xy, track, from, to) {
  const start=Date.parse(track.start), step=track.step_s*1000;
  const a=trackPoint(xy,track,from), b=trackPoint(xy,track,to);
  if(!a||!b) return [];
  return [a, ...xy.filter((_,i)=>start+i*step>from && start+i*step<to), b];
}

// Mantereet kilometreinä havaitsijasta. Kaukana olevat renkaat jätetään pois: vastakkaisella puolella
// maapalloa projektio venyy, eikä sieltä ole kartalla mitään näkyvää.
let landKey='', landKm=[];
function land(lat0, lon0, cullKm) {
  const key=`${lat0},${lon0},${Math.round(cullKm)}`;
  if(key===landKey) return landKm;
  landKm=[];
  for(const ring of LAND) {
    const pts=[]; let near=false;
    for(let i=0;i<ring.length;i+=2) {
      const p=project(lat0,lon0,ring[i+1]/2,ring[i]/2);
      near ||= Math.hypot(p[0],p[1])<cullKm;
      pts.push(p);
    }
    if(near) landKm.push(pts);
  }
  landKey=key;
  return landKm;
}

/**
 * Piirtää ylilennon kartan. pass: ylilento reitteineen (track), position: aseman sijainti nyt ({lat, lon}),
 * time: funktio, joka muotoilee kellonajan, now: nykyhetki millisekunteina.
 */
export function drawPassMap(canvas, {lat, lon, place, pass, position, heightKm=420, minElevation=5, time, now=Date.now()}) {
  const w=canvas.clientWidth, h=canvas.clientHeight, scale=window.devicePixelRatio||1;
  if(!w||!h) return;
  canvas.width=Math.round(w*scale); canvas.height=Math.round(h*scale);
  const ctx=canvas.getContext('2d'), cx=w/2, cy=h/2, k=Math.min(w,h)/2/MAP_RADIUS_KM;
  const px=([e,n])=>[cx+e*k, cy-n*k];
  const toPx=(la,lo)=>px(project(lat,lon,la,lo));
  ctx.setTransform(scale,0,0,scale,0,0);
  ctx.fillStyle='#071022'; ctx.fillRect(0,0,w,h);

  ctx.beginPath();
  for(const ring of land(lat,lon,Math.max(3750,Math.hypot(w,h)/2/k*1.2))) {
    ring.forEach((p,i)=>{const [x,y]=px(p); i ? ctx.lineTo(x,y) : ctx.moveTo(x,y);});
    ctx.closePath();
  }
  ctx.fillStyle='#1a2236'; ctx.fill('evenodd'); ctx.strokeStyle='#33405f'; ctx.lineWidth=0.6; ctx.stroke();

  // Ympyrän sisällä lentävä asema on havaitsijan taivaalla vähintään ylilennon rajakorkeudella.
  ctx.beginPath(); ctx.arc(cx,cy,horizonKm(heightKm,minElevation)*k,0,2*Math.PI);
  ctx.strokeStyle='rgba(94,214,255,.5)'; ctx.lineWidth=1; ctx.setLineDash([3,4]); ctx.stroke(); ctx.setLineDash([]);

  ctx.font='11px system-ui, sans-serif'; ctx.lineJoin='round';
  const label=(text,x,y,color,align='center')=>{
    ctx.textAlign=align; ctx.lineWidth=3; ctx.strokeStyle='#071022'; ctx.strokeText(text,x,y);
    ctx.fillStyle=color; ctx.fillText(text,x,y);
  };
  const dot=(x,y,r,color)=>{ctx.beginPath(); ctx.arc(x,y,r,0,2*Math.PI); ctx.fillStyle=color; ctx.fill();};
  const path=(pts,color,width,dash=[])=>{
    if(pts.length<2) return;
    ctx.beginPath(); pts.forEach(([x,y],i)=>i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
    ctx.strokeStyle=color; ctx.lineWidth=width; ctx.setLineDash(dash); ctx.lineCap='round'; ctx.stroke(); ctx.setLineDash([]);
  };

  let iss=null;
  const track=pass?.track;
  if(track) {
    const xy=track.points.map(([la,lo])=>toPx(la,lo));
    const [start,end,vStart,vEnd]=[pass.start,pass.end,pass.visible_start,pass.visible_end].map(Date.parse);
    path(xy,'#8b9ac0',1,[2,5]);
    path(section(xy,track,start,end),'#e8eefc',1.5);
    path(section(xy,track,vStart,vEnd),'#ffb547',3.5);
    // Nuoli ylilennon lopussa näyttää kulkusuunnan.
    const tip=trackPoint(xy,track,end), back=trackPoint(xy,track,end-track.step_s*1000);
    if(tip&&back) {
      const a=Math.atan2(tip[1]-back[1],tip[0]-back[0]);
      ctx.beginPath(); ctx.moveTo(tip[0]+7*Math.cos(a),tip[1]+7*Math.sin(a));
      for(const side of [2.5,-2.5]) ctx.lineTo(tip[0]+6*Math.cos(a+side),tip[1]+6*Math.sin(a+side));
      ctx.closePath(); ctx.fillStyle='#e8eefc'; ctx.fill();
    }
    const from=trackPoint(xy,track,vStart), to=trackPoint(xy,track,vEnd);
    // Kellonajat reitin sille puolelle, joka on poispäin havaitsijasta, jotteivät ne peitä paikan nimeä.
    const side=p=>p[1]<cy ? -8 : 16;
    if(from) {dot(from[0],from[1],3,'#ffb547'); label(time(vStart),from[0],from[1]+side(from),'#ffb547');}
    if(to&&time(vEnd)!==time(vStart)) {dot(to[0],to[1],3,'#ffb547'); label(time(vEnd),to[0],to[1]+side(to),'#ffb547');}
    // Ylilennon aikana aseman paikka saadaan reitiltä sekunnin tarkkuudella.
    iss=trackPoint(xy,track,now);
  }
  iss ??= position ? toPx(position.lat,position.lon) : null;

  dot(cx,cy,3.5,'#5ed6ff'); label(place,cx,cy+15,'#5ed6ff');
  if(iss && iss[0]>-10 && iss[0]<w+10 && iss[1]>-10 && iss[1]<h+10) {
    ctx.beginPath(); ctx.arc(iss[0],iss[1],7,0,2*Math.PI); ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.stroke();
    dot(iss[0],iss[1],3.5,'#fff'); label('ISS',iss[0],iss[1]-11,'#fff');
  }
  label('P ↑',w-8,16,'#8b9ac0','right');
}
