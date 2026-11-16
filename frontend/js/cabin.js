// Avaruuslennon ohjaamon sisätila: ikkunan kehys, katto, kojelauta näyttöineen, sivukonsolit, ohjaimet ja istuin.
// Kaikki rakennetaan three.js:n perusmuodoista ja canvasille piirretyistä tekstuureista, joten mallitiedostoja ei ole.
// Kamera on silmien kohdalla origossa ja katsoo −z-suuntaan; yksikkö on metri.
import * as THREE from './vendor/three-0.170.0.module.min.js';

function random(seed) {
  return () => {
    seed=(seed+0x6D2B79F5)|0;
    let t=Math.imul(seed^(seed>>>15),1|seed);
    t=(t+Math.imul(t^(t>>>7),61|t))^t;
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}
function canvas(w, h) {
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  return [c, c.getContext('2d')];
}
function texture(c) {
  const t=new THREE.CanvasTexture(c);
  t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=8;
  return t;
}

const SCREEN_BG = '#03121a', SCREEN_LINE = '#1d4a5c', SCREEN_TITLE = '#5ed6ff', SCREEN_TEXT = '#e8eefc', SCREEN_DIM = '#8b9ac0';

/** Näyttö, jonka sisältö piirretään canvasille: draw(key, paint) piirtää vain, kun key muuttuu. */
export function screen(w = 512, h = 256) {
  const [c,ctx]=canvas(w,h), t=texture(c);
  let last=null;
  return {texture:t, w, h, draw(key, paint) {
    if(key===last) return;
    last=key;
    ctx.fillStyle=SCREEN_BG; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle=SCREEN_LINE; ctx.lineWidth=6; ctx.strokeRect(3,3,w-6,h-6);
    paint(ctx,w,h);
    t.needsUpdate=true;
  }};
}

/** Kojelaudan päänäyttö: otsikko, rivit [teksti, koko, väri] ja valinnainen palkki (0–1). */
export function display() {
  const s=screen();
  return {texture:s.texture, draw(title, lines, bar = null) {
    s.draw(JSON.stringify([title,lines,bar]),ctx=>{
      ctx.fillStyle=SCREEN_TITLE; ctx.font='600 28px system-ui, sans-serif'; ctx.fillText(title,24,46);
      lines.forEach(([text,size,color],i)=>{
        ctx.fillStyle=color ?? SCREEN_TEXT; ctx.font=`${size ?? 40}px ui-monospace, monospace`;
        ctx.fillText(text,24,104+i*56);
      });
      if(bar!=null) {
        ctx.fillStyle='#1d2740'; ctx.fillRect(24,200,464,24);
        ctx.fillStyle=bar>0.2 ? '#4ade80' : '#ff7b93'; ctx.fillRect(24,200,464*Math.max(0,Math.min(1,bar)),24);
      }
    });
  }};
}

// Kytkinpaneelin tekstuuri: pohjakuva ja hehkukartta (taustavalaistut merkinnät ja palavat merkkivalot).
const GROUPS = ['SÄHKÖ','ELÄMÄNTUKI','VIESTINTÄ','ASENNONSÄÄTÖ','MOOTTORI','VALOT','NAVIGOINTI','LÄMMÖNSÄÄTÖ','TIETOKONE','POLTTOAINE'];
const LABELS = ['PÄÄ','VARA','BUS A','BUS B','AKKU','O2','CO2','H2O','N2','PUMPPU','TUULETIN','ANT 1','ANT 2','GYRO','IMU','RCS','VENT','TESTI','VIRITYS','LUKKO','LÄMMITIN','HIMMENNIN','KANAVA','NOLLAUS'];
const LIT = ['#6fdcff','#dfe9ff','#ffb547','#5ee08a'];
function panel(w, h, seed, cols, rows) {
  const [base,b]=canvas(w,h), [glow,g]=canvas(w,h), rnd=random(seed);
  b.fillStyle='#23272f'; b.fillRect(0,0,w,h);
  g.fillStyle='#000'; g.fillRect(0,0,w,h);
  for(let i=0;i<w*h/180;i++) {b.fillStyle=`rgba(255,255,255,${rnd()*0.035})`; b.fillRect(rnd()*w,rnd()*h,2,1);}
  const label=(text, x, y, size = 9, align = 'center')=>{
    for(const [ctx,color] of [[b,'#aab3c2'],[g,'rgba(190,215,255,.55)']]) {
      ctx.font=`600 ${size}px system-ui, sans-serif`; ctx.textAlign=align; ctx.fillStyle=color; ctx.fillText(text,x,y);
    }
  };
  const pick=list=>list[Math.floor(rnd()*list.length)];
  const cw=w/cols, ch=h/rows;
  for(let cy=0;cy<rows;cy++) for(let cx=0;cx<cols;cx++) {
    const x0=cx*cw+5, y0=cy*ch+5, pw=cw-10, ph=ch-10;
    b.fillStyle='#1a1d24'; b.fillRect(x0,y0,pw,ph);
    b.strokeStyle='#3b414d'; b.lineWidth=1.5; b.strokeRect(x0+0.5,y0+0.5,pw-1,ph-1);
    b.strokeStyle='rgba(0,0,0,.5)'; b.strokeRect(x0-1.5,y0-1.5,pw+3,ph+3);
    for(const [sx,sy] of [[x0+7,y0+7],[x0+pw-7,y0+7],[x0+7,y0+ph-7],[x0+pw-7,y0+ph-7]]) {
      b.fillStyle='#5a606c'; b.beginPath(); b.arc(sx,sy,2.6,0,2*Math.PI); b.fill();
      b.strokeStyle='#22252b'; b.lineWidth=1; b.beginPath(); const a=rnd()*Math.PI; b.moveTo(sx-2*Math.cos(a),sy-2*Math.sin(a)); b.lineTo(sx+2*Math.cos(a),sy+2*Math.sin(a)); b.stroke();
    }
    label(pick(GROUPS),x0+16,y0+17,10,'left');
    const ix=x0+14, iy=y0+26, iw=pw-28, ih=ph-36, type=Math.floor(rnd()*4);
    if(type===0) {
      // Näppäimistö: taustavalaistut näppäimet, joista osa palaa.
      const n=Math.max(1,Math.floor(iw/36)), m=Math.max(1,Math.floor(ih/30)), kw=iw/n, kh=ih/m;
      for(let j=0;j<m;j++) for(let i=0;i<n;i++) {
        const kx=ix+i*kw+2, ky=iy+j*kh+2, lit=rnd()<0.16, color=pick(LIT);
        b.fillStyle=lit ? color : '#2e333d'; b.fillRect(kx,ky,kw-4,kh-4);
        b.fillStyle='rgba(255,255,255,.12)'; b.fillRect(kx,ky,kw-4,1.5);
        b.fillStyle='rgba(0,0,0,.45)'; b.fillRect(kx,ky+kh-6,kw-4,2);
        if(lit) {g.fillStyle=color; g.globalAlpha=0.85; g.fillRect(kx,ky,kw-4,kh-4); g.globalAlpha=1;}
        else {g.fillStyle='rgba(190,215,255,.4)'; g.fillRect(kx+(kw-4)*0.25,ky+(kh-4)*0.45,(kw-4)*0.5,1.5);}
        b.fillStyle=lit ? 'rgba(0,0,0,.6)' : '#9aa3b2'; b.fillRect(kx+(kw-4)*0.25,ky+(kh-4)*0.45,(kw-4)*0.5,1.5);
      }
    } else if(type===1) {
      // Vipukytkimet nimineen.
      const n=Math.max(1,Math.floor(iw/40)), m=Math.max(1,Math.floor(ih/52));
      for(let j=0;j<m;j++) for(let i=0;i<n;i++) {
        const sx=ix+(i+0.5)*iw/n, sy=iy+(j+0.5)*ih/m+6, up=rnd()<0.6;
        label(pick(LABELS),sx,sy-16,8);
        b.fillStyle='#0e1014'; b.beginPath(); b.arc(sx,sy,7,0,2*Math.PI); b.fill();
        b.strokeStyle='#6a707c'; b.lineWidth=2; b.beginPath(); b.arc(sx,sy,7,0,2*Math.PI); b.stroke();
        b.strokeStyle='#c9cfda'; b.lineWidth=4; b.lineCap='round'; b.beginPath(); b.moveTo(sx,sy); b.lineTo(sx,sy+(up ? -9 : 9)); b.stroke(); b.lineCap='butt';
      }
    } else if(type===2) {
      // Kiertosäätimet asteikkoineen.
      const n=Math.max(1,Math.floor(iw/58)), m=Math.max(1,Math.floor(ih/62));
      for(let j=0;j<m;j++) for(let i=0;i<n;i++) {
        const sx=ix+(i+0.5)*iw/n, sy=iy+(j+0.5)*ih/m+4, a=-2.2+rnd()*4.4-Math.PI/2;
        for(let k=0;k<=10;k++) {
          const ta=-2.2+k*0.44-Math.PI/2;
          for(const ctx of [b,g]) {ctx.strokeStyle=ctx===b ? '#aab3c2' : 'rgba(190,215,255,.5)'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(sx+17*Math.cos(ta),sy+17*Math.sin(ta)); ctx.lineTo(sx+20*Math.cos(ta),sy+20*Math.sin(ta)); ctx.stroke();}
        }
        const grad=b.createRadialGradient(sx-3,sy-3,1,sx,sy,13);
        grad.addColorStop(0,'#5b616d'); grad.addColorStop(1,'#1c1f25');
        b.fillStyle=grad; b.beginPath(); b.arc(sx,sy,13,0,2*Math.PI); b.fill();
        b.strokeStyle='#e8eefc'; b.lineWidth=2; b.beginPath(); b.moveTo(sx+4*Math.cos(a),sy+4*Math.sin(a)); b.lineTo(sx+12*Math.cos(a),sy+12*Math.sin(a)); b.stroke();
        label(pick(LABELS),sx,sy+31,8);
      }
    } else {
      // Merkkivalotaulu.
      const n=Math.max(1,Math.floor(iw/58)), m=Math.max(1,Math.floor(ih/24)), kw=iw/n, kh=ih/m;
      for(let j=0;j<m;j++) for(let i=0;i<n;i++) {
        const kx=ix+i*kw+2, ky=iy+j*kh+2, lit=rnd()<0.3, color=rnd()<0.7 ? '#5ee08a' : '#ffb547', text=pick(LABELS);
        b.fillStyle=lit ? color : '#15181d'; b.fillRect(kx,ky,kw-4,kh-4);
        b.strokeStyle='#3b414d'; b.lineWidth=1; b.strokeRect(kx+0.5,ky+0.5,kw-5,kh-5);
        if(lit) {g.fillStyle=color; g.globalAlpha=0.8; g.fillRect(kx,ky,kw-4,kh-4); g.globalAlpha=1;}
        b.font='600 8px system-ui, sans-serif'; b.textAlign='center'; b.fillStyle=lit ? '#0b0d10' : '#5d6572'; b.fillText(text,kx+(kw-4)/2,ky+(kh-4)/2+3);
      }
    }
  }
  return new THREE.MeshStandardMaterial({map:texture(base), emissiveMap:texture(glow), emissive:0xffffff, emissiveIntensity:0.9, roughness:0.72, metalness:0.25});
}

// Sivukonsolien pienet näytöt: järjestelmäsivut, joiden arvot eivät muutu.
function staticScreen(paint) {
  const s=screen(384,240);
  s.draw('static',paint);
  return new THREE.MeshBasicMaterial({map:s.texture, toneMapped:false});
}
function lifeSupport(ctx, w) {
  ctx.fillStyle=SCREEN_TITLE; ctx.font='600 22px system-ui, sans-serif'; ctx.fillText('ELÄMÄNTUKI',18,36);
  [['HAPPI','21 %',0.7],['PAINE','101 kPa',0.82],['CO₂','0,04 %',0.12],['LÄMPÖ','21 °C',0.55],['KOSTEUS','45 %',0.45]].forEach(([name,value,f],i)=>{
    const y=70+i*34;
    ctx.fillStyle=SCREEN_DIM; ctx.font='18px ui-monospace, monospace'; ctx.textAlign='left'; ctx.fillText(name,18,y);
    ctx.fillStyle=SCREEN_TEXT; ctx.textAlign='right'; ctx.fillText(value,w-18,y); ctx.textAlign='left';
    ctx.fillStyle='#1d2740'; ctx.fillRect(130,y-12,130,10);
    ctx.fillStyle='#4ade80'; ctx.fillRect(130,y-12,130*f,10);
  });
}
function power(ctx, w, h) {
  ctx.fillStyle=SCREEN_TITLE; ctx.font='600 22px system-ui, sans-serif'; ctx.fillText('SÄHKÖ',18,36);
  const rnd=random(5), n=22, bw=(w-36)/n;
  for(let i=0;i<n;i++) {
    const f=0.45+0.4*Math.sin(i/3.1)*Math.sin(i/1.7)+rnd()*0.15, bh=Math.max(6,(h-110)*Math.min(1,Math.abs(f)));
    ctx.fillStyle=i>n-4 ? '#ffb547' : '#3aa9d8'; ctx.fillRect(18+i*bw,h-58-bh,bw-3,bh);
  }
  ctx.fillStyle=SCREEN_DIM; ctx.font='18px ui-monospace, monospace'; ctx.fillText('VÄYLÄ A 28,4 V',18,h-26);
  ctx.textAlign='right'; ctx.fillStyle=SCREEN_TEXT; ctx.fillText('AKKU 97 %',w-18,h-26); ctx.textAlign='left';
}

// Kulunut metallipinta: naarmuja, likaa, valumajälkiä, saumoja ja niittejä. Samaa kuvaa käytetään värinä ja kohokuviona.
function metalTexture(seed, repeat) {
  const [c,ctx]=canvas(512,512), rnd=random(seed);
  ctx.fillStyle='#b9bec6'; ctx.fillRect(0,0,512,512);
  const blot=(n, color, rMin, rMax, alpha)=>{
    for(let i=0;i<n;i++) {
      const x=rnd()*512, y=rnd()*512, r=rMin+rnd()*(rMax-rMin), g=ctx.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0,color); g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.globalAlpha=alpha*(0.4+rnd()*0.6); ctx.fillStyle=g;
      for(const dx of [-512,0,512]) for(const dy of [-512,0,512]) {ctx.setTransform(1,0,0,1,dx,dy); ctx.fillRect(x-r,y-r,2*r,2*r);}
    }
    ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha=1;
  };
  blot(60,'#3a3f48',20,80,0.24); blot(30,'#eef1f5',15,50,0.16); blot(25,'#6b5444',5,20,0.3);
  for(let i=0;i<160;i++) {
    const x=rnd()*512, y=rnd()*512, len=20+rnd()*120;
    ctx.strokeStyle=`rgba(30,34,40,${0.04+rnd()*0.1})`; ctx.lineWidth=1+rnd()*3; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+rnd()*4-2,y+len); ctx.stroke();
  }
  for(let i=0;i<900;i++) {
    const x=rnd()*512, y=rnd()*512, a=rnd()*Math.PI, len=3+rnd()**2*40;
    ctx.strokeStyle=rnd()<0.75 ? `rgba(245,248,252,${0.1+rnd()*0.35})` : `rgba(20,22,26,${0.15+rnd()*0.3})`;
    ctx.lineWidth=0.5+rnd()*0.8; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+Math.cos(a)*len,y+Math.sin(a)*len); ctx.stroke();
  }
  for(const v of [96,352]) {
    ctx.fillStyle='rgba(15,17,20,.7)'; ctx.fillRect(0,v,512,2); ctx.fillRect(v+40,0,2,512);
    ctx.fillStyle='rgba(255,255,255,.35)'; ctx.fillRect(0,v+2,512,1); ctx.fillRect(v+42,0,1,512);
    for(let x=16;x<512;x+=32) for(const [rx,ry] of [[x,v-9],[v+31,x]]) {
      ctx.fillStyle='rgba(20,22,26,.55)'; ctx.beginPath(); ctx.arc(rx+0.7,ry+0.7,3,0,2*Math.PI); ctx.fill();
      ctx.fillStyle='#d6dae0'; ctx.beginPath(); ctx.arc(rx,ry,2.4,0,2*Math.PI); ctx.fill();
    }
  }
  const t=texture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(repeat,repeat);
  return t;
}
// Reikälevy lattiaan.
function floorTexture() {
  const [c,ctx]=canvas(128,128), rnd=random(77);
  ctx.fillStyle='#3d424b'; ctx.fillRect(0,0,128,128);
  for(let i=0;i<300;i++) {ctx.fillStyle=`rgba(${rnd()<0.5 ? '255,255,255' : '0,0,0'},${rnd()*0.08})`; ctx.fillRect(rnd()*128,rnd()*128,3,1);}
  for(let y=8;y<128;y+=16) for(let x=8;x<128;x+=16) {
    ctx.fillStyle='#0b0c0f'; ctx.beginPath(); ctx.arc(x,y,3.6,0,2*Math.PI); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.18)'; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(x,y,4.2,0.6,2.6); ctx.stroke();
  }
  ctx.fillStyle='#17191d'; ctx.fillRect(0,0,128,2); ctx.fillRect(0,0,2,128);
  const t=texture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(9,7);
  return t;
}
// Ristikkotuen levy: metallipinta, johon on leikattu kevennysreiät (läpinäkyvyys alfakanavassa).
function trussTexture() {
  const [c,ctx]=canvas(128,512), rnd=random(9);
  ctx.fillStyle='#aeb4bd'; ctx.fillRect(0,0,128,512);
  for(let i=0;i<400;i++) {ctx.strokeStyle=`rgba(${rnd()<0.6 ? '250,252,255' : '25,28,32'},${0.1+rnd()*0.3})`; ctx.lineWidth=0.6; ctx.beginPath(); const x=rnd()*128, y=rnd()*512; ctx.moveTo(x,y); ctx.lineTo(x+rnd()*16-8,y+rnd()*30-15); ctx.stroke();}
  ctx.strokeStyle='rgba(20,22,26,.6)'; ctx.lineWidth=3; ctx.strokeRect(5,5,118,502);
  ctx.globalCompositeOperation='destination-out';
  for(let i=0;i<5;i++) {
    const y=34+i*96, flip=i%2;
    ctx.beginPath();
    if(flip) {ctx.moveTo(26,y); ctx.lineTo(102,y); ctx.lineTo(102,y+64);} else {ctx.moveTo(26,y); ctx.lineTo(102,y+64); ctx.lineTo(26,y+64);}
    ctx.closePath(); ctx.lineJoin='round'; ctx.lineWidth=10; ctx.fill();
  }
  ctx.globalCompositeOperation='source-over';
  return texture(c);
}
// Ympäristökartta metallin heijastuksiin: tumma ohjaamo, jonka ikkunoiden korkeudella on vaalea sinertävä vyö.
function environment() {
  const [c,ctx]=canvas(256,128), g=ctx.createLinearGradient(0,0,0,128);
  g.addColorStop(0,'#1a1f28'); g.addColorStop(0.3,'#4a586c'); g.addColorStop(0.46,'#b9cbe4'); g.addColorStop(0.56,'#7f93b0'); g.addColorStop(0.7,'#1c212a'); g.addColorStop(1,'#07080b');
  ctx.fillStyle=g; ctx.fillRect(0,0,256,128);
  const t=texture(c);
  t.mapping=THREE.EquirectangularReflectionMapping;
  return t;
}

/**
 * Rakentaa ohjaamon: kaareva kuomun kehys vinotukineen, kulunutta metallia, keskikonsoli kolmella näytöllä, kattonäytöt
 * yläkulmissa sekä sivuilla koneistot ja kaapeliniput. main on kolmen päänäytön lista (display()), nav ja systems ovat
 * kattonäytöt (screen()). Palauttaa ryhmän, joka lisätään alukseen.
 */
export function buildCabin(main, nav, systems) {
  const root=new THREE.Group(), env=environment();
  const metal=(color, repeat, roughness, metalness, seed = 3)=>{
    const t=metalTexture(seed,repeat);
    return new THREE.MeshStandardMaterial({color, map:t, bumpMap:t, bumpScale:0.5, roughness, metalness, envMap:env, envMapIntensity:0.9});
  };
  const steel=metal(0x9aa6b8,2,0.5,0.6), plate=metal(0x7b8798,3,0.55,0.55,5), dark=metal(0x343a45,3,0.6,0.5,8);
  const gloss=new THREE.MeshStandardMaterial({color:0x0c0e12, roughness:0.22, metalness:0.85, envMap:env, envMapIntensity:1.2});
  const hull=new THREE.MeshStandardMaterial({color:0x1c2028, roughness:0.85, metalness:0.2, emissive:0x05070a});
  const rubber=new THREE.MeshStandardMaterial({color:0x0c0d10, roughness:0.9, metalness:0});
  const fabric=new THREE.MeshStandardMaterial({color:0x23262d, roughness:1, metalness:0, emissive:0x050506});
  const bezel=new THREE.MeshStandardMaterial({color:0x08090b, roughness:0.4, metalness:0.3, envMap:env, envMapIntensity:0.4});
  const blue=new THREE.MeshBasicMaterial({color:0x4fb8ff, toneMapped:false});
  const lens=new THREE.MeshBasicMaterial({color:0x0e2a40, toneMapped:false});
  const cyan=new THREE.MeshBasicMaterial({color:0x2fd0e8, toneMapped:false});
  const warn=new THREE.MeshBasicMaterial({color:0xff5a4a, toneMapped:false});
  const lamp=new THREE.MeshBasicMaterial({color:0xcfe0ff, toneMapped:false});
  const red=new THREE.MeshStandardMaterial({color:0xb3261e, roughness:0.5, emissive:0x2a0504});
  const floor=new THREE.MeshStandardMaterial({map:floorTexture(), roughness:0.6, metalness:0.5, envMap:env, envMapIntensity:0.5});
  const truss=new THREE.MeshStandardMaterial({map:trussTexture(), alphaTest:0.5, side:THREE.DoubleSide, roughness:0.5, metalness:0.6, envMap:env, envMapIntensity:0.9});

  const add=(parent, mesh, x, y, z, rx = 0, ry = 0, rz = 0)=>{
    mesh.rotation.order='YXZ'; mesh.position.set(x,y,z); mesh.rotation.set(rx,ry,rz); parent.add(mesh); return mesh;
  };
  const box=(parent, w, h, d, mat, ...at)=>add(parent,new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat),...at);
  const plane=(parent, w, h, mat, ...at)=>add(parent,new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat),...at);
  const cyl=(parent, r1, r2, h, mat, ...at)=>add(parent,new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,28),mat),...at);
  // Palkki pisteestä a pisteeseen b: pituusakseli osoittaa a:sta b:hen.
  const Y=new THREE.Vector3(0,1,0);
  const between=(mesh, a, b)=>{
    const va=new THREE.Vector3(...a), vb=new THREE.Vector3(...b);
    mesh.position.copy(va).add(vb).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(Y,vb.clone().sub(va).normalize());
    root.add(mesh); return mesh;
  };
  const length=(a, b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  const beam=(a, b, w, d, mat)=>between(new THREE.Mesh(new THREE.BoxGeometry(w,length(a,b),d),mat),a,b);
  // Näyttö kehyksineen: kuva on hieman kehyksen etupinnan edessä.
  const monitor=(parent, w, h, mat, x, y, z, rx = 0, ry = 0)=>{
    const g=add(parent,new THREE.Group(),x,y,z,rx,ry);
    box(g,w+0.035,h+0.035,0.03,bezel,0,0,-0.016);
    plane(g,w,h,mat,0,0,0.001);
    return g;
  };
  const screenMat=s=>new THREE.MeshBasicMaterial({map:s.texture, toneMapped:false});

  // --- Kuomun kehys: puolisoikion muotoinen kaari jalkoineen, pursotettuna levystä ---
  const arch=new THREE.Shape();
  arch.moveTo(2.02,-0.9); arch.lineTo(2.02,0); arch.absellipse(0,0,2.02,1.42,0,Math.PI,false); arch.lineTo(-2.02,-0.9);
  arch.lineTo(-1.76,-0.9); arch.lineTo(-1.76,0); arch.absellipse(0,0,1.76,1.17,Math.PI,0,true); arch.lineTo(1.76,-0.9); arch.closePath();
  const archGeo=new THREE.ExtrudeGeometry(arch,{depth:0.2, bevelEnabled:true, bevelThickness:0.015, bevelSize:0.015, bevelSegments:2, curveSegments:48});
  add(root,new THREE.Mesh(archGeo,steel),0,-0.45,-1.64);
  // Kaaren sisäreunan tumma tiiviste ja alapalkki.
  const lip=new THREE.Shape();
  lip.moveTo(1.76,-0.9); lip.lineTo(1.76,0); lip.absellipse(0,0,1.76,1.17,0,Math.PI,false); lip.lineTo(-1.76,-0.9);
  lip.lineTo(-1.72,-0.9); lip.lineTo(-1.72,0); lip.absellipse(0,0,1.72,1.13,Math.PI,0,true); lip.lineTo(1.72,-0.9); lip.closePath();
  add(root,new THREE.Mesh(new THREE.ExtrudeGeometry(lip,{depth:0.1, bevelEnabled:false, curveSegments:48}),rubber),0,-0.45,-1.6);
  box(root,3.6,0.12,0.22,plate,0,-0.52,-1.55);
  box(root,3.6,0.8,0.1,hull,0,-0.95,-1.62);
  // Yläpalkki, josta vinotuet laskevat keskikonsoliin, ja sen pienet koneistokotelot.
  box(root,2.5,0.14,0.2,plate,0,0.79,-1.34);
  box(root,0.5,0.06,0.16,dark,0,0.7,-1.3);
  for(const s of [-1,1]) {
    box(root,0.3,0.05,0.14,dark,s*0.62,0.705,-1.3);
    beam([s*0.9,0.74,-1.38],[s*0.13,-0.3,-1.52],0.085,0.06,steel);
    beam([s*0.84,0.74,-1.36],[s*0.1,-0.26,-1.5],0.02,0.02,dark);
    // Ristikkotuet kaaren kyljestä konsolin sivuun: reikälevy ja kaksi laippaa.
    const a=[s*1.74,0.36,-1.5], b=[s*0.98,-0.66,-1.14], len=length(a,b);
    between(new THREE.Mesh(new THREE.PlaneGeometry(0.2,len),truss),a,b);
    for(const e of [-0.1,0.1]) beam([a[0]+e,a[1],a[2]],[b[0]+e,b[1],b[2]],0.022,0.05,plate);
    box(root,0.3,0.12,0.22,plate,b[0],b[1]-0.02,b[2]);
    box(root,0.24,0.2,0.16,plate,s*1.72,0.4,-1.5);
    // Sivurakenne: kylkikaari, alarunko ja takaseinä.
    beam([s*2.06,-0.4,-0.3],[s*1.62,1.0,-0.3],0.14,0.16,steel);
    box(root,0.1,0.95,2.9,hull,s*2.08,-0.88,-0.2);
    box(root,0.1,0.1,1.4,plate,s*2.05,-0.4,-0.95);
    box(root,0.08,2.4,1.5,hull,s*2.06,-0.1,0.55);
    box(root,0.05,0.05,1.3,plate,s*1.82,0.98,-0.95,0,0,s*0.3);
  }
  box(root,4.3,2.4,0.08,hull,0,-0.1,1.2);
  plane(root,4.4,3.0,floor,0,-1.3,-0.2,-Math.PI/2,0);
  box(root,4.3,0.06,2.6,hull,0,1.03,0);
  // Kattopaneeli ja valot (näkyvät, kun katsoo ylös).
  plane(root,0.95,0.42,panel(608,272,11,3,1),0,0.988,-0.72,Math.PI/2,0);
  box(root,1.02,0.03,0.48,dark,0,1.005,-0.72);
  for(const z of [-0.2,0.5]) box(root,0.8,0.012,0.04,lamp,0,0.995,z);
  // Lasi heijastaa hieman sinistä.
  plane(root,3.5,1.7,new THREE.MeshBasicMaterial({color:0x8fb4ff, transparent:true, opacity:0.03, depthWrite:false}),0,0.1,-1.6);

  // --- Kattonäytöt yläkulmissa: navigointi vasemmalla, järjestelmät oikealla ---
  [[-1,nav],[1,systems]].forEach(([s,scr])=>{
    const m=monitor(root,0.5,0.28,screenMat(scr),s*0.92,0.42,-1.2,0.2,-s*0.5);
    box(m,0.58,0.37,0.08,dark,0,-0.005,-0.06);
    box(m,0.62,0.04,0.11,plate,0,0.195,-0.055);
    box(m,0.04,0.37,0.09,plate,s*0.3,-0.005,-0.055);
    box(m,0.1,0.2,0.09,plate,-s*0.08,0.3,-0.075);
    for(let i=0;i<4;i++) box(m,0.02,0.008,0.004,i===1 ? warn : cyan,-s*0.21+i*0.03*s,-0.165,-0.018);
  });

  // --- Keskikonsoli: torni, jonka huipulla palavat siniset valot, keskinäyttö ja kaksi sivunäyttökoteloa ---
  const TILT=-0.55;
  box(root,0.38,0.7,0.3,plate,0,-0.95,-1.27);
  box(root,0.3,0.6,0.22,plate,0,-1.0,-0.95);
  box(root,0.2,0.34,0.16,dark,0,-0.37,-1.44);
  box(root,0.27,0.05,0.21,steel,0,-0.185,-1.44);
  box(root,0.3,0.06,0.24,steel,0,-0.56,-1.42);
  for(const dx of [-0.045,0.045]) box(root,0.035,0.2,0.006,blue,dx,-0.36,-1.357);
  box(root,0.14,0.012,0.006,cyan,0,-0.235,-1.357);
  monitor(root,0.44,0.22,screenMat(main[1]),0,-0.5,-1.05,TILT,0);
  box(root,0.5,0.03,0.1,dark,0,-0.375,-1.19,0.1,0);
  plane(root,0.34,0.2,panel(272,160,23,2,1),0,-0.69,-0.9,-1.15,0);
  box(root,0.38,0.03,0.24,dark,0,-0.705,-0.905,-1.15+Math.PI/2,0);
  for(const s of [-1,1]) {
    const pod=add(root,new THREE.Group(),s*0.57,-0.5,-1.1,0,-s*0.32);
    box(pod,0.54,0.3,0.3,dark,0,-0.03,-0.25);
    monitor(pod,0.44,0.22,screenMat(main[s<0 ? 0 : 2]),0,0,0,TILT,0);
    box(pod,0.54,0.035,0.14,plate,0,0.14,-0.2,0.1,0);
    for(let i=0;i<6;i++) box(pod,0.022,0.01,0.004,i%4===2 ? warn : cyan,-0.09+i*0.036,0.133,-0.127,0.1,0);
    // Kotelon alla kaksi linssimäistä anturia ja tukijalka.
    for(const dx of [-0.12,0.12]) {
      cyl(pod,0.07,0.07,0.12,gloss,dx,-0.25,-0.08,Math.PI/2,0);
      add(pod,new THREE.Mesh(new THREE.TorusGeometry(0.072,0.012,10,28),steel),dx,-0.25,-0.02);
      add(pod,new THREE.Mesh(new THREE.CircleGeometry(0.035,20),blue),dx,-0.25,-0.0195).material=lens;
    }
    box(pod,0.22,0.55,0.2,plate,0,-0.58,-0.2);
    beam([s*0.36,-0.62,-1.2],[s*0.19,-0.7,-1.15],0.05,0.05,steel);
  }

  // --- Sivujen koneistot: kiiltävät sylinterit vanteineen, pienet järjestelmänäytöt ja kaapeliniput ---
  const rnd=random(321);
  const cable=new THREE.MeshStandardMaterial({color:0x101216, roughness:0.45, metalness:0.3, envMap:env, envMapIntensity:0.6});
  const cableBlue=new THREE.MeshStandardMaterial({color:0x16304a, roughness:0.45, metalness:0.3, envMap:env, envMapIntensity:0.6});
  [[-1,staticScreen(lifeSupport)],[1,staticScreen(power)]].forEach(([s,mat])=>{
    cyl(root,0.21,0.21,1.25,gloss,s*1.44,-0.62,-0.72,Math.PI/2,0);
    cyl(root,0.13,0.21,0.2,gloss,s*1.44,-0.62,-1.44,Math.PI/2,0);
    for(const z of [-1.3,-0.95,-0.5,-0.15]) cyl(root,0.225,0.225,0.06,steel,s*1.44,-0.62,z,Math.PI/2,0);
    box(root,0.5,0.14,1.3,plate,s*1.44,-0.9,-0.72);
    box(root,0.62,0.3,1.5,hull,s*1.5,-1.12,-0.75);
    monitor(root,0.3,0.19,mat,s*1.04,-0.36,-0.96,-0.35,-s*0.8);
    beam([s*1.1,-0.47,-1.02],[s*1.3,-0.62,-1.0],0.03,0.03,steel);
    for(let i=0;i<11;i++) {
      const curve=new THREE.CatmullRomCurve3([
        new THREE.Vector3(s*(1.2+rnd()*0.35),-0.84,-0.1-rnd()*0.25),
        new THREE.Vector3(s*(0.95+rnd()*0.45),-1.2+rnd()*0.12,-0.55-rnd()*0.2),
        new THREE.Vector3(s*(0.8+rnd()*0.5),-1.22+rnd()*0.1,-1.0-rnd()*0.15),
        new THREE.Vector3(s*(0.7+rnd()*0.6),-1.0+rnd()*0.2,-1.5),
      ]);
      root.add(new THREE.Mesh(new THREE.TubeGeometry(curve,28,0.011+rnd()*0.009,7),i%4===0 ? cableBlue : cable));
    }
  });
  // Jalkatuet lattialla.
  for(const s of [-1,1]) box(root,0.2,0.04,0.5,plate,s*0.3,-1.27,-0.65,0.25,0);

  // --- Istuin käsinojineen: ohjainsauva oikean ja tehovipu vasemman käsinojan päässä ---
  box(root,0.56,0.12,0.5,fabric,0,-0.98,0.22);
  box(root,0.56,0.95,0.12,fabric,0,-0.5,0.56,-0.1,0);
  box(root,0.34,0.22,0.1,fabric,0,0.12,0.62,-0.1,0);
  box(root,0.3,0.5,0.3,plate,0,-1.1,0.3);
  for(const s of [-1,1]) {
    box(root,0.1,0.06,0.62,fabric,s*0.36,-0.74,0.14);
    box(root,0.05,0.2,0.05,steel,s*0.36,-0.86,0.38);
    box(root,0.12,0.05,0.16,dark,s*0.36,-0.745,-0.24);
  }
  const stick=add(root,new THREE.Group(),0.36,-0.72,-0.24);
  cyl(stick,0.045,0.05,0.02,steel,0,0.01,0);
  cyl(stick,0.02,0.04,0.05,rubber,0,0.045,0);
  cyl(stick,0.011,0.011,0.1,steel,0,0.11,0);
  add(stick,new THREE.Mesh(new THREE.CapsuleGeometry(0.023,0.085,6,16),rubber),0,0.2,0.006,0.12,0);
  add(stick,new THREE.Mesh(new THREE.SphereGeometry(0.009,12,8),red),0,0.262,0.018);
  const throttle=add(root,new THREE.Group(),-0.36,-0.72,-0.24);
  for(const dx of [-0.03,0.03]) {
    box(throttle,0.01,0.11,0.01,steel,dx,0.075,-0.015,-0.35,0);
    box(throttle,0.04,0.024,0.03,rubber,dx,0.13,-0.035,-0.35,0);
  }
  return root;
}
