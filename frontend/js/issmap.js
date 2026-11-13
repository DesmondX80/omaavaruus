// ISS-kartta: aseman sijainti ja maanpäällinen reitti joko aseman tai havaintopaikan ympäristössä.
// Projektio on kartan keskipisteeseen keskitetty keskipituinen tasoprojektio: etäisyys ja suunta keskipisteestä ovat oikein, pohjoinen on ylhäällä.
import { LAND } from './land.js';

const R_EARTH = 6371, RAD = Math.PI/180, MIN = 60000;
// Keskipisteen vastakkaisella puolella maapalloa projektio venyy äärettömiin: sinne osuvia reitin pisteitä ei piirretä.
const FAR_KM = 15000;

/** Paikan (lat, lon) sijainti kilometreinä itään ja pohjoiseen keskipisteestä (lat0, lon0). */
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

// Hetken paikka reitin näytteiden joukossa: näytteen indeksi ja osuus seuraavaan; null reitin ulkopuolella.
function locate(track, time) {
  const f=(time-Date.parse(track.start))/(track.step_s*1000), last=track.points.length-1;
  if(!(f>=0) || f>last) return null;
  const i=Math.min(Math.floor(f),Math.max(0,last-1));
  return [i, f-i];
}

/** Aseman alapuolinen piste hetkellä time reitin näytteiden väliltä; null, jos hetki on reitin ulkopuolella. */
export function trackLatLon(track, time) {
  const at=locate(track,time);
  if(!at) return null;
  const [i,t]=at, a=track.points[i], b=track.points[i+1] ?? a;
  // Pituusasteen lyhyempi kaari: päivämäärärajan yli mentäessä ero ei ole 360°.
  let lon=a[1]+(((b[1]-a[1]+540)%360)-180)*t;
  if(lon>180) lon-=360; else if(lon<=-180) lon+=360;
  return {lat:a[0]+(b[0]-a[0])*t, lon};
}

// Sama kartan pisteille (xy); null myös, kun kohta on projektion ulottumattomissa.
function trackPoint(xy, track, time) {
  const at=locate(track,time);
  if(!at) return null;
  const [i,t]=at, a=xy[i], b=xy[i+1] ?? a;
  return a&&b ? [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t] : null;
}

// Reitin osuus aikaväliltä [from, to] murtoviivana; väli rajataan reitin kestoon.
function section(xy, track, from, to) {
  const [first,last]=trackSpan(track), step=track.step_s*1000;
  from=Math.max(from,first); to=Math.min(to,last);
  if(from>=to) return [];
  return [trackPoint(xy,track,from), ...xy.filter((_,i)=>first+i*step>from && first+i*step<to), trackPoint(xy,track,to)];
}

// Mantereet kilometreinä keskipisteestä. Kaukana olevat renkaat jätetään pois. Rengas, jonka sisään jää
// keskipisteen vastapiste, kääntyy projektiossa nurin (sen "sisäpuoli" on kartan reunaa kohti): se merkitään,
// jotta täyttö voidaan kääntää takaisin koko maapallon ympyrällä.
let landKey='', landKm=[];
function land(lat0, lon0, cullKm) {
  const key=`${lat0.toFixed(2)},${lon0.toFixed(2)},${Math.round(cullKm/100)}`;
  if(key===landKey) return landKm;
  landKm=[];
  for(const ring of LAND) {
    const pts=[]; let near=false, total=0, turn=0, prev=null;
    for(let i=0;i<ring.length;i+=2) {
      const p=project(lat0,lon0,ring[i+1]/2,ring[i]/2), d=Math.hypot(p[0],p[1]), a=Math.atan2(p[1],p[0]);
      near ||= d<cullKm; total+=d;
      if(prev!==null) turn+=Math.atan2(Math.sin(a-prev),Math.cos(a-prev));
      prev=a; pts.push(p);
    }
    if(!near) continue;
    // Keskipisteen ympäri kiertävä rengas sulkee sisäänsä joko keskipisteen tai vastapisteen; kaukana oleva rengas jälkimmäisen.
    pts.inverted=Math.abs(turn)>Math.PI && total/pts.length>Math.PI*R_EARTH/2;
    landKm.push(pts);
  }
  landKey=key;
  return landKm;
}

// Mittakaavajanalle pyöreä pituus, joka on enintään noin neljännes kartan leveydestä.
const scaleKm = maxKm => [5000,2000,1000,500,200,100].find(v=>v<=maxKm) ?? 50;

/**
 * Piirtää kartan.
 * center: kartan keskipiste, radiusKm: lyhyemmän sivun puolikas kilometreinä, observer: havaintopaikka ({lat, lon, label}),
 * station: aseman sijainti nyt tai null, circle: 'station' tai 'observer' sen mukaan, kumman ympärille näkyvyysalue piirretään,
 * orbit: aseman rata nykyhetken ympäriltä, pass: ylilento reitteineen, time: kellonajan muotoilu.
 */
export function drawMap(canvas, {center, radiusKm, observer, station=null, circle='observer', orbit=null, pass=null, heightKm=420, minElevation=5, time, now=Date.now()}) {
  const w=canvas.clientWidth, h=canvas.clientHeight, scale=window.devicePixelRatio||1;
  if(!w||!h) return;
  canvas.width=Math.round(w*scale); canvas.height=Math.round(h*scale);
  const ctx=canvas.getContext('2d'), cx=w/2, cy=h/2, k=Math.min(w,h)/2/radiusKm;
  const px=([e,n])=>[cx+e*k, cy-n*k];
  const toPx=(la,lo)=>{const p=project(center.lat,center.lon,la,lo); return Math.hypot(p[0],p[1])>FAR_KM ? null : px(p);};
  ctx.setTransform(scale,0,0,scale,0,0);
  ctx.fillStyle='#071022'; ctx.fillRect(0,0,w,h);

  ctx.beginPath();
  for(const ring of land(center.lat,center.lon,Math.max(3750,Math.hypot(w,h)/2/k*1.2))) {
    ring.forEach((p,i)=>{const [x,y]=px(p); i ? ctx.lineTo(x,y) : ctx.moveTo(x,y);});
    ctx.closePath();
    if(ring.inverted) {const r=Math.PI*R_EARTH*k; ctx.moveTo(cx+r,cy); ctx.arc(cx,cy,r,0,2*Math.PI);}
  }
  ctx.fillStyle='#1a2236'; ctx.fill('evenodd'); ctx.strokeStyle='#33405f'; ctx.lineWidth=0.6; ctx.stroke();

  ctx.font='11px system-ui, sans-serif'; ctx.lineJoin='round';
  const label=(text,x,y,color,align='center')=>{
    ctx.textAlign=align; ctx.lineWidth=3; ctx.strokeStyle='#071022'; ctx.strokeText(text,x,y);
    ctx.fillStyle=color; ctx.fillText(text,x,y);
  };
  const dot=(x,y,r,color)=>{ctx.beginPath(); ctx.arc(x,y,r,0,2*Math.PI); ctx.fillStyle=color; ctx.fill();};
  // Murtoviiva; null katkaisee viivan.
  const path=(pts,color,width,dash=[])=>{
    ctx.beginPath(); let pen=false;
    for(const p of pts) {if(!p) {pen=false; continue;} pen ? ctx.lineTo(p[0],p[1]) : ctx.moveTo(p[0],p[1]); pen=true;}
    ctx.strokeStyle=color; ctx.lineWidth=width; ctx.setLineDash(dash); ctx.lineCap='round'; ctx.stroke(); ctx.setLineDash([]);
  };
  // Nuolenkärki reitin kohtaan hetkellä t kulkusuuntaan.
  const arrow=(xy,track,t,color)=>{
    const tip=trackPoint(xy,track,t), back=trackPoint(xy,track,t-track.step_s*500);
    if(!tip||!back) return null;
    const a=Math.atan2(tip[1]-back[1],tip[0]-back[0]);
    ctx.beginPath(); ctx.moveTo(tip[0]+7*Math.cos(a),tip[1]+7*Math.sin(a));
    for(const side of [2.5,-2.5]) ctx.lineTo(tip[0]+6*Math.cos(a+side),tip[1]+6*Math.sin(a+side));
    ctx.closePath(); ctx.fillStyle=color; ctx.fill();
    return tip;
  };

  const site=toPx(observer.lat,observer.lon), iss=station ? toPx(station.lat,station.lon) : null;
  // Ympyrän sisällä asema on havaitsijan taivaalla vähintään ylilennon rajakorkeudella.
  // Aseman ympärille piirrettynä sama ympyrä rajaa alueen, jolta asema näkyy.
  const ring=circle==='station' ? iss : site;
  if(ring) {
    ctx.beginPath(); ctx.arc(ring[0],ring[1],horizonKm(heightKm,minElevation)*k,0,2*Math.PI);
    ctx.strokeStyle='rgba(94,214,255,.5)'; ctx.lineWidth=1; ctx.setLineDash([3,4]); ctx.stroke(); ctx.setLineDash([]);
  }

  if(orbit) {
    const xy=orbit.points.map(([la,lo])=>toPx(la,lo)), [first,last]=trackSpan(orbit);
    path(section(xy,orbit,first,now),'#8b9ac0',1,[2,5]);
    path(section(xy,orbit,now,last),'#e8eefc',1.5);
    // Tasaminuutit kymmenen minuutin välein kertovat, milloin asema on missäkin; nuoli näyttää suunnan.
    for(let t=Math.ceil((now+2*MIN)/(10*MIN))*10*MIN; t<=last; t+=10*MIN) {
      const p=arrow(xy,orbit,t,'#e8eefc');
      if(p) label(time(t),p[0],p[1]+(p[1]<cy ? -9 : 17),'#e8eefc');
    }
  }

  const track=pass?.track;
  if(track) {
    const xy=track.points.map(([la,lo])=>toPx(la,lo));
    const [start,end,vStart,vEnd]=[pass.start,pass.end,pass.visible_start,pass.visible_end].map(Date.parse);
    path(xy,'#8b9ac0',1,[2,5]);
    path(section(xy,track,start,end),'#e8eefc',1.5);
    path(section(xy,track,vStart,vEnd),'#ffb547',3.5);
    arrow(xy,track,end,'#e8eefc');
    const from=trackPoint(xy,track,vStart), to=trackPoint(xy,track,vEnd);
    // Kellonajat reitin sille puolelle, joka on poispäin havaitsijasta, jotteivät ne peitä paikan nimeä.
    const side=p=>p[1]<(site?.[1] ?? cy) ? -8 : 16;
    if(from) {dot(from[0],from[1],3,'#ffb547'); label(time(vStart),from[0],from[1]+side(from),'#ffb547');}
    if(to&&time(vEnd)!==time(vStart)) {dot(to[0],to[1],3,'#ffb547'); label(time(vEnd),to[0],to[1]+side(to),'#ffb547');}
  }

  if(site) {dot(site[0],site[1],3.5,'#5ed6ff'); label(observer.label,site[0],site[1]+15,'#5ed6ff');}
  if(iss) {
    ctx.beginPath(); ctx.arc(iss[0],iss[1],7,0,2*Math.PI); ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.stroke();
    dot(iss[0],iss[1],3.5,'#fff'); label('ISS',iss[0],iss[1]-11,'#fff');
  }

  label('P ↑',w-8,16,'#8b9ac0','right');
  const km=scaleKm(w/4/k), len=km*k;
  ctx.beginPath(); ctx.moveTo(10,h-14); ctx.lineTo(10,h-10); ctx.lineTo(10+len,h-10); ctx.lineTo(10+len,h-14);
  ctx.strokeStyle='#8b9ac0'; ctx.lineWidth=1; ctx.stroke();
  label(`${km.toLocaleString('fi-FI')} km`,10+len/2,h-16,'#8b9ac0');
}
