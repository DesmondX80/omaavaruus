// ISS-kartta: aseman sijainti ja maanpäällinen reitti maapallolla, jota voi pyörittää ja zoomata.
// Projektio on ortografinen (maapallo kaukaa katsottuna), pohjoinen ylhäällä: lähelle zoomattuna se vastaa tavallista karttaa.
import { LAND } from './land.js';

const R_EARTH = 6371, RAD = Math.PI/180, MIN = 60000;

/**
 * Paikan (lat, lon) sijainti kilometreinä itään ja pohjoiseen kartan keskipisteestä (lat0, lon0).
 * Kolmas arvo on keskipisteestä mitatun kulmaetäisyyden kosini: negatiivinen, kun paikka on maapallon takapuolella.
 */
export function project(lat0, lon0, lat, lon) {
  const p0=lat0*RAD, p=lat*RAD, dl=(lon-lon0)*RAD;
  return [
    R_EARTH*Math.cos(p)*Math.sin(dl),
    R_EARTH*(Math.cos(p0)*Math.sin(p)-Math.sin(p0)*Math.cos(p)*Math.cos(dl)),
    Math.sin(p0)*Math.sin(p)+Math.cos(p0)*Math.cos(p)*Math.cos(dl),
  ];
}

// Piste suunnassa bearing (radiaaneina pohjoisesta itään) kulmaetäisyydellä dist paikasta (lat, lon).
function destination(lat, lon, bearing, dist) {
  const p=lat*RAD, sinP=Math.sin(p)*Math.cos(dist)+Math.cos(p)*Math.sin(dist)*Math.cos(bearing);
  const dl=Math.atan2(Math.sin(bearing)*Math.sin(dist)*Math.cos(p), Math.cos(dist)-Math.sin(p)*sinP);
  return [Math.asin(Math.max(-1,Math.min(1,sinP)))/RAD, lon+dl/RAD];
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

const wrapAngle = a => Math.atan2(Math.sin(a),Math.cos(a));

// Mantereiden ääriviivat polkuna. Takapuolelle jäävät pisteet siirretään samassa suunnassa pallon reunalle ja
// niiden välit piirretään reunaa pitkin, jolloin täyttö rajautuu näkyvään puoliskoon.
// Rengas, jonka sisään jää keskipisteen vastapiste, kiertää reunan kokonaan ja täyttyisi nurinpäin:
// täyttö käännetään takaisin lisäämällä polkuun koko pallon ympyrä (parillinen–pariton-täyttö).
function landPath(ctx, center, cx, cy, k) {
  const limb=R_EARTH*k;
  for(const ring of LAND) {
    const pts=[]; let front=false, turn=0, far=0;
    for(let i=0;i<ring.length;i+=2) {
      const [e,n,cosC]=project(center.lat,center.lon,ring[i+1]/2,ring[i]/2), a=Math.atan2(n,e);
      if(pts.length) turn+=wrapAngle(a-pts[pts.length-1].a);
      front ||= cosC>=0; far+=Math.acos(Math.max(-1,Math.min(1,cosC)));
      pts.push({e,n,a,back:cosC<0});
    }
    if(!front) continue;
    pts.forEach((p,i)=>{
      const prev=pts[i-1], x=p.back ? cx+limb*Math.cos(p.a) : cx+p.e*k, y=p.back ? cy-limb*Math.sin(p.a) : cy-p.n*k;
      if(!i) ctx.moveTo(x,y);
      // Ruudulla y kasvaa alaspäin, joten kulmat kääntyvät vastakkaisiksi.
      else if(p.back&&prev.back) ctx.arc(cx,cy,limb,-prev.a,-p.a,wrapAngle(p.a-prev.a)>0);
      else ctx.lineTo(x,y);
    });
    ctx.closePath();
    // Keskipisteen ympäri kiertävä rengas sulkee sisäänsä joko keskipisteen tai vastapisteen; kaukana oleva rengas jälkimmäisen.
    if(Math.abs(turn)>Math.PI && far/pts.length>Math.PI/2) {ctx.moveTo(cx+limb,cy); ctx.arc(cx,cy,limb,0,2*Math.PI);}
  }
}

// Mittakaavajanalle pyöreä pituus, joka on enintään noin neljännes kartan leveydestä.
const scaleKm = maxKm => [5000,2000,1000,500,200,100].find(v=>v<=maxKm) ?? 50;

/**
 * Piirtää kartan.
 * center: kartan keskipiste, radiusKm: lyhyemmän sivun puolikas kilometreinä kartan keskellä (maapallon säde on 6 371 km), observer: havaintopaikka ({lat, lon, label}),
 * station: aseman sijainti nyt tai null, circle: 'station' tai 'observer' sen mukaan, kumman ympärille näkyvyysalue piirretään,
 * orbit: aseman rata nykyhetken ympäriltä, pass: ylilento reitteineen, time: kellonajan muotoilu.
 */
export function drawMap(canvas, {center, radiusKm, observer, station=null, circle='observer', orbit=null, pass=null, heightKm=420, minElevation=5, time, now=Date.now()}) {
  const w=canvas.clientWidth, h=canvas.clientHeight, scale=window.devicePixelRatio||1;
  if(!w||!h) return;
  canvas.width=Math.round(w*scale); canvas.height=Math.round(h*scale);
  const ctx=canvas.getContext('2d'), cx=w/2, cy=h/2, k=Math.min(w,h)/2/radiusKm;
  // Maapallon takapuolelle jäävää paikkaa ei piirretä.
  const toPx=(la,lo)=>{const [e,n,cosC]=project(center.lat,center.lon,la,lo); return cosC<0 ? null : [cx+e*k, cy-n*k];};
  const limb=R_EARTH*k;
  ctx.setTransform(scale,0,0,scale,0,0);
  ctx.fillStyle='#03050b'; ctx.fillRect(0,0,w,h);
  ctx.beginPath(); ctx.arc(cx,cy,limb,0,2*Math.PI); ctx.fillStyle='#071022'; ctx.fill();

  ctx.beginPath(); landPath(ctx,center,cx,cy,k);
  ctx.fillStyle='#1a2236'; ctx.fill('evenodd'); ctx.strokeStyle='#33405f'; ctx.lineWidth=0.6; ctx.stroke();

  // Asteverkko 30° välein antaa pallolle muodon.
  ctx.beginPath();
  const grid=(la,lo,pen)=>{const p=toPx(la,lo); if(!p) return false; pen ? ctx.lineTo(p[0],p[1]) : ctx.moveTo(p[0],p[1]); return true;};
  for(let la=-60;la<=60;la+=30) {let pen=false; for(let lo=-180;lo<=180;lo+=5) pen=grid(la,lo,pen);}
  for(let lo=-180;lo<180;lo+=30) {let pen=false; for(let la=-85;la<=85;la+=5) pen=grid(la,lo,pen);}
  ctx.strokeStyle='rgba(139,154,192,.13)'; ctx.lineWidth=0.6; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,limb,0,2*Math.PI); ctx.strokeStyle='#2a3858'; ctx.lineWidth=1; ctx.stroke();

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
  const around=circle==='station' ? station : observer;
  if(around) {
    const reach=horizonKm(heightKm,minElevation)/R_EARTH, edge=[];
    for(let i=0;i<=72;i++) edge.push(toPx(...destination(around.lat,around.lon,i*5*RAD,reach)));
    path(edge,'rgba(94,214,255,.5)',1,[3,4]);
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
  // Mittakaava pätee kartan keskellä; koko pallon näkymässä reunat lyhenevät liikaa, jotta jana kertoisi mitään.
  if(radiusKm>3500) return;
  const km=scaleKm(w/4/k), len=km*k;
  ctx.beginPath(); ctx.moveTo(10,h-14); ctx.lineTo(10,h-10); ctx.lineTo(10+len,h-10); ctx.lineTo(10+len,h-14);
  ctx.strokeStyle='#8b9ac0'; ctx.lineWidth=1; ctx.stroke();
  label(`${km.toLocaleString('fi-FI')} km`,10+len/2,h-16,'#8b9ac0');
}
