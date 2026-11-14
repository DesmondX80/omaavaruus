// Planeettojen tekstuurit Avaruuslennon ohjaamonäkymään. Ne piirretään selaimessa canvasille (tasavälinen
// lieriöprojektio, 512 × 256), joten kuvatiedostoja tai lisenssejä ei tarvita. Maan mantereet tulevat
// Natural Earthin ääriviivoista (land.js, public domain), muut pinnat ovat tyyliteltyjä: värit ja vyöt vastaavat
// planeettojen yleisilmettä, mutta yksityiskohdat ovat satunnaisia (kiinteä siemen, joten ne pysyvät samoina).
import { LAND } from './land.js';

const W = 512, H = 256;

// Toistettava satunnaislukugeneraattori (mulberry32).
function random(seed) {
  return () => {
    seed=(seed+0x6D2B79F5)|0;
    let t=Math.imul(seed^(seed>>>15),1|seed);
    t=(t+Math.imul(t^(t>>>7),61|t))^t;
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}

function canvas() {
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  return [c, c.getContext('2d')];
}

// Leveyspiirien suuntaiset vyöt: [suhteellinen leveys, väri] ylhäältä alas, pehmeät reunat ja aaltoilu.
function bands(ctx, rnd, colors, wobble = 2) {
  let y=0;
  const total=colors.reduce((s,[h])=>s+h,0);
  for(const [h,color] of colors) {
    const height=h/total*H;
    ctx.fillStyle=color;
    ctx.beginPath(); ctx.moveTo(0,y);
    for(let x=0;x<=W;x+=16) ctx.lineTo(x,y+Math.sin(x/40+rnd()*0.5)*wobble);
    for(let x=W;x>=0;x-=16) ctx.lineTo(x,y+height+Math.sin(x/37+rnd()*0.5)*wobble+1);
    ctx.fill();
    y+=height;
  }
}

function blotches(ctx, rnd, n, color, rMin, rMax, alpha = 0.25, latSpan = 1) {
  ctx.fillStyle=color;
  for(let i=0;i<n;i++) {
    const x=rnd()*W, y=H/2+(rnd()-0.5)*H*latSpan, r=rMin+rnd()*(rMax-rMin);
    ctx.globalAlpha=alpha*rnd();
    for(const dx of [-W,0,W]) {ctx.beginPath(); ctx.ellipse(x+dx,y,r*1.6,r,0,0,2*Math.PI); ctx.fill();}
  }
  ctx.globalAlpha=1;
}

function polarCaps(ctx, size, color = '#f4f6fa') {
  const g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,color); g.addColorStop(size,color+'00'); g.addColorStop(1-size,color+'00'); g.addColorStop(1,color);
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
}

// Mantereen rengas lieriöprojektiossa. Päivämäärärajan ylittävä rengas jatketaan yhtenäisenä, ja napaa kiertävä
// rengas (Etelämanner) suljetaan kartan reunan kautta. Piirretään kolmesti, jotta reunan yli menevät osat näkyvät.
function landPath(ctx, ring) {
  const pts=[];
  for(let i=0;i<ring.length;i+=2) {
    let x=(ring[i]/2+180)/360*W;
    const y=(90-ring[i+1]/2)/180*H;
    if(pts.length) {const px=pts.at(-1)[0]; while(x-px>W/2) x-=W; while(px-x>W/2) x+=W;}
    pts.push([x,y]);
  }
  const shift=pts.at(-1)[0]-pts[0][0];
  if(Math.abs(shift)>W/2) {
    const edge=pts.reduce((s,p)=>s+p[1],0)/pts.length>H/2 ? H : 0;
    pts.push([pts.at(-1)[0],edge],[pts[0][0],edge]);
  }
  for(const dx of [-W,0,W]) {
    ctx.moveTo(pts[0][0]+dx,pts[0][1]);
    for(const [x,y] of pts) ctx.lineTo(x+dx,y);
    ctx.closePath();
  }
}

const PAINTERS = {
  Merkurius(ctx, rnd) {
    ctx.fillStyle='#8f8a84'; ctx.fillRect(0,0,W,H);
    blotches(ctx,rnd,60,'#6e6a66',8,30,0.5);
    // Kraatterit: tumma pohja ja vaalea reuna.
    for(let i=0;i<260;i++) {
      const x=rnd()*W, y=rnd()*H, r=1+rnd()**3*12;
      ctx.fillStyle='rgba(60,58,55,.45)'; ctx.beginPath(); ctx.arc(x,y,r,0,2*Math.PI); ctx.fill();
      ctx.strokeStyle='rgba(200,196,188,.35)'; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(x-0.6,y-0.6,r,Math.PI,1.8*Math.PI); ctx.stroke();
    }
  },
  Venus(ctx, rnd) {
    bands(ctx,rnd,[[2,'#e9d7a6'],[3,'#f1e0b4'],[2,'#e2c991'],[3,'#efdcae'],[2,'#e6cf9c'],[3,'#f2e3b9'],[2,'#e4cb95']],6);
    blotches(ctx,rnd,40,'#fff6dc',20,60,0.25);
    blotches(ctx,rnd,30,'#c9ad73',15,40,0.2);
  },
  Maa(ctx, rnd) {
    const sea=ctx.createLinearGradient(0,0,0,H);
    sea.addColorStop(0,'#1d3f75'); sea.addColorStop(0.5,'#1f5fa8'); sea.addColorStop(1,'#1d3f75');
    ctx.fillStyle=sea; ctx.fillRect(0,0,W,H);
    ctx.beginPath(); for(const ring of LAND) landPath(ctx,ring);
    ctx.fillStyle='#4f7a3a'; ctx.fill('evenodd');
    // Aavikot ja vuoristot vaaleampina laikkuina maa-alueella.
    ctx.save(); ctx.clip('evenodd'); blotches(ctx,rnd,50,'#b59a62',10,30,0.5,0.5); blotches(ctx,rnd,40,'#2f5a2a',8,25,0.5); ctx.restore();
    polarCaps(ctx,0.08);
    // Pilvet.
    ctx.fillStyle='#ffffff';
    for(let i=0;i<260;i++) {
      const x=rnd()*W, y=H/2+(rnd()-0.5)*H*0.85, r=2+rnd()*8;
      ctx.globalAlpha=0.08+rnd()*0.22;
      ctx.beginPath(); ctx.ellipse(x,y,r*3,r*0.45,(rnd()-0.5)*0.4,0,2*Math.PI); ctx.fill();
    }
    ctx.globalAlpha=1;
  },
  Mars(ctx, rnd) {
    ctx.fillStyle='#b5562e'; ctx.fillRect(0,0,W,H);
    blotches(ctx,rnd,70,'#6b2f1a',10,40,0.55,0.7);
    blotches(ctx,rnd,50,'#d98a5a',8,30,0.35);
    polarCaps(ctx,0.06,'#f3ece6');
  },
  Jupiter(ctx, rnd) {
    bands(ctx,rnd,[[2,'#c9b79c'],[1,'#a98a6a'],[2,'#e8dcc6'],[1.5,'#b07a52'],[2.2,'#efe6d4'],[1.5,'#a8673f'],[2,'#ece2cc'],[1.2,'#b5895f'],[2,'#ddd0b6'],[1,'#a98a6a'],[2,'#c9b79c']],2.5);
    blotches(ctx,rnd,60,'#ffffff',4,14,0.25,0.7);
    // Suuri punainen pilkku eteläisellä vyöhykkeellä.
    ctx.fillStyle='#b8573a'; ctx.globalAlpha=0.9; ctx.beginPath(); ctx.ellipse(W*0.62,H*0.64,22,11,0,0,2*Math.PI); ctx.fill();
    ctx.strokeStyle='#e8c8a8'; ctx.lineWidth=2; ctx.stroke(); ctx.globalAlpha=1;
  },
  Saturnus(ctx, rnd) {
    bands(ctx,rnd,[[2,'#cdb98f'],[2,'#e3d2a6'],[1.5,'#d4bd8c'],[3,'#ecdcb4'],[1.5,'#d8c296'],[2,'#e6d5aa'],[2,'#c9b285']],1.5);
    blotches(ctx,rnd,30,'#f6ead0',6,20,0.15,0.6);
  },
  Uranus(ctx, rnd) {
    bands(ctx,rnd,[[3,'#a9dbe0'],[2,'#b3e3e7'],[3,'#a4d6dc'],[2,'#b0e0e4'],[3,'#9fd2d8']],1);
  },
  Neptunus(ctx, rnd) {
    bands(ctx,rnd,[[3,'#3d5fc4'],[1,'#4a6fd6'],[3,'#3558bd'],[1,'#5679dd'],[3,'#3a5cc2']],2);
    blotches(ctx,rnd,20,'#dfe8ff',3,10,0.4,0.6);
    ctx.fillStyle='#1f347a'; ctx.globalAlpha=0.85; ctx.beginPath(); ctx.ellipse(W*0.4,H*0.62,16,8,0,0,2*Math.PI); ctx.fill(); ctx.globalAlpha=1;
  },
  // Kuut.
  Kuu(ctx, rnd) { cratered(ctx,rnd,'#a9a59e','#7d7a74',[['#5d5b57',25,10,40]]); },
  Phobos(ctx, rnd) { cratered(ctx,rnd,'#7a6e62','#4e463e',[]); },
  Io(ctx, rnd) {
    ctx.fillStyle='#e3cf62'; ctx.fillRect(0,0,W,H);
    blotches(ctx,rnd,90,'#c0702e',4,16,0.6); blotches(ctx,rnd,60,'#f6f0c8',5,18,0.5); blotches(ctx,rnd,40,'#3a2a1a',2,5,0.8);
  },
  Europa(ctx, rnd) {
    ctx.fillStyle='#ddd3c4'; ctx.fillRect(0,0,W,H);
    blotches(ctx,rnd,40,'#b9a58c',10,30,0.4);
    // Ruskeat murtumalinjat jääkuoressa.
    ctx.strokeStyle='rgba(140,90,60,.55)';
    for(let i=0;i<70;i++) {ctx.lineWidth=0.5+rnd()*1.5; ctx.beginPath(); const x=rnd()*W, y=rnd()*H; ctx.moveTo(x,y); ctx.quadraticCurveTo(x+(rnd()-0.5)*200,y+(rnd()-0.5)*80,x+(rnd()-0.5)*300,y+(rnd()-0.5)*100); ctx.stroke();}
  },
  Ganymedes(ctx, rnd) { cratered(ctx,rnd,'#9d9384','#6a6156',[['#c8c0b2',40,10,40]]); },
  Titan(ctx, rnd) { bands(ctx,rnd,[[2,'#c98f3c'],[3,'#d9a54e'],[3,'#dcaa55'],[2,'#cf9844']],3); },
  Enceladus(ctx, rnd) { cratered(ctx,rnd,'#eef2f6','#cdd6df',[['#bfd8ea',20,5,20]]); },
  Triton(ctx, rnd) {
    ctx.fillStyle='#d9c6bf'; ctx.fillRect(0,0,W,H);
    blotches(ctx,rnd,80,'#b79a92',5,20,0.5); blotches(ctx,rnd,30,'#f4ece6',10,40,0.5,0.4);
  },
};

// Kraatteripinta: pohjaväri, kraatterien väri ja lisälaikut [väri, määrä, pienin ja suurin säde].
function cratered(ctx, rnd, base, crater, extra) {
  ctx.fillStyle=base; ctx.fillRect(0,0,W,H);
  for(const [color,n,a,b] of extra) blotches(ctx,rnd,n,color,a,b,0.5);
  for(let i=0;i<200;i++) {
    const x=rnd()*W, y=rnd()*H, r=1+rnd()**3*10;
    ctx.fillStyle=crater; ctx.globalAlpha=0.5; ctx.beginPath(); ctx.arc(x,y,r,0,2*Math.PI); ctx.fill();
  }
  ctx.globalAlpha=1;
}

/** Planeetan tai kuun pintatekstuuri canvasina. */
export function planetCanvas(name) {
  const [c,ctx]=canvas();
  PAINTERS[name](ctx, random([...name].reduce((s,ch)=>s*31+ch.charCodeAt(0),7)));
  return c;
}

/** Saturnuksen renkaat säteittäisenä liukuna (vasemmalta sisäreunasta oikealle ulkoreunaan), läpinäkyvyys alfassa. */
export function ringCanvas() {
  const c=document.createElement('canvas'); c.width=256; c.height=4;
  const ctx=c.getContext('2d'), rnd=random(42);
  for(let x=0;x<256;x++) {
    const f=x/255;
    // Cassinin aukko noin 0,62 kohdalla, sisärengas himmeämpi.
    let a=f<0.12 ? 0.15 : f<0.6 ? 0.75 : f<0.66 ? 0.08 : 0.55;
    a*=0.75+rnd()*0.25;
    ctx.fillStyle=`rgba(${215+Math.round(rnd()*25)},${195+Math.round(rnd()*20)},${160+Math.round(rnd()*20)},${a})`;
    ctx.fillRect(x,0,1,4);
  }
  return c;
}

/** Pehmeä säteittäinen hehku (Aurinko, moottori). */
export function glowCanvas(inner, outer) {
  const c=document.createElement('canvas'); c.width=c.height=256;
  const ctx=c.getContext('2d'), g=ctx.createRadialGradient(128,128,0,128,128,128);
  g.addColorStop(0,inner); g.addColorStop(0.08,inner); g.addColorStop(0.25,outer); g.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=g; ctx.fillRect(0,0,256,256);
  return c;
}
