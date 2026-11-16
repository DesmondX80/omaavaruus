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

/**
 * Rakentaa ohjaamon. main on kolmen päänäytön lista (display()), nav ja systems ovat kattonäytöt (screen()).
 * Palauttaa ryhmän, joka lisätään alukseen.
 */
export function buildCabin(main, nav, systems) {
  const root=new THREE.Group();
  const hull=new THREE.MeshStandardMaterial({color:0x1c2028, roughness:0.85, metalness:0.2, emissive:0x05070a});
  const shell=new THREE.MeshStandardMaterial({color:0x2b303a, roughness:0.62, metalness:0.45, emissive:0x07090d});
  const trim=new THREE.MeshStandardMaterial({color:0x4a505b, roughness:0.5, metalness:0.6, emissive:0x0a0c10});
  const rubber=new THREE.MeshStandardMaterial({color:0x0c0d10, roughness:0.95, metalness:0});
  const fabric=new THREE.MeshStandardMaterial({color:0x23262d, roughness:1, metalness:0, emissive:0x050506});
  const bezel=new THREE.MeshStandardMaterial({color:0x08090b, roughness:0.4, metalness:0.3});
  const accent=new THREE.MeshBasicMaterial({color:0x1f7ea3, toneMapped:false});
  const lamp=new THREE.MeshBasicMaterial({color:0xcfe0ff, toneMapped:false});
  const red=new THREE.MeshStandardMaterial({color:0xb3261e, roughness:0.5, emissive:0x2a0504});

  const add=(parent, mesh, x, y, z, rx = 0, ry = 0, rz = 0)=>{
    mesh.rotation.order='YXZ'; mesh.position.set(x,y,z); mesh.rotation.set(rx,ry,rz); parent.add(mesh); return mesh;
  };
  const box=(parent, w, h, d, mat, ...at)=>add(parent,new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat),...at);
  const plane=(parent, w, h, mat, ...at)=>add(parent,new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat),...at);
  const cyl=(parent, r1, r2, h, mat, ...at)=>add(parent,new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,20),mat),...at);
  // Näyttö kehyksineen: kuva on hieman kehyksen etupinnan edessä.
  const monitor=(parent, w, h, mat, x, y, z, rx = 0, ry = 0)=>{
    const g=add(parent,new THREE.Group(),x,y,z,rx,ry);
    box(g,w+0.035,h+0.035,0.03,bezel,0,0,-0.016);
    plane(g,w,h,mat,0,0,0.001);
    return g;
  };
  const screenMat=s=>new THREE.MeshBasicMaterial({map:s.texture, toneMapped:false});

  // --- Runko: etu- ja sivuikkunoiden kehykset, katto, seinät ja lattia ---
  const SIDE=Math.atan2(0.45,1.2), SIDE_LEN=Math.hypot(0.45,1.2)+0.12;
  box(root,3.3,0.1,0.16,shell,0,-0.4,-1.42);
  box(root,3.3,0.12,0.2,shell,0,0.7,-1.38);
  box(root,3.3,0.02,0.05,trim,0,0.635,-1.3);
  box(root,3.3,0.85,0.08,hull,0,-0.86,-1.46);
  for(const s of [-1,1]) {
    box(root,0.12,1.2,0.14,shell,s*1.56,0.15,-1.4,0,0,s*0.1);
    box(root,0.03,1.2,0.03,trim,s*1.5,0.15,-1.33,0,0,s*0.1);
    box(root,0.12,0.1,SIDE_LEN,shell,s*1.78,-0.4,-0.8,0,s*SIDE);
    box(root,0.14,0.12,SIDE_LEN,shell,s*1.76,0.7,-0.8,0,s*SIDE);
    box(root,0.08,0.85,SIDE_LEN,hull,s*1.8,-0.86,-0.8,0,s*SIDE);
    box(root,0.13,1.25,0.16,shell,s*2.0,0.15,-0.18,0,0,s*0.06);
    box(root,0.08,2.3,1.4,hull,s*2.04,-0.15,0.5);
    // Sivuikkunan alla kulkeva käsijohde ja kapea merkkivalonauha.
    box(root,0.03,0.03,SIDE_LEN-0.2,trim,s*1.71,-0.31,-0.8,0,s*SIDE);
    box(root,0.012,0.012,SIDE_LEN-0.3,accent,s*1.735,-0.455,-0.8,0,s*SIDE);
  }
  box(root,4.2,2.3,0.08,hull,0,-0.15,1.15);
  box(root,4.2,0.06,2.8,rubber,0,-1.28,-0.1);
  // Katto: tasainen osa ja ikkunaa kohti laskeva etuosa, jossa ovat valonauhat ja yläpaneeli.
  box(root,4.2,0.06,2.3,hull,0,0.95,0.1);
  const slope=add(root,new THREE.Group(),0,0.83,-1.15,-0.43,0);
  box(slope,4.2,0.05,0.56,hull,0,0,0);
  for(const s of [-1,1]) {
    box(slope,0.62,0.012,0.045,lamp,s*1.05,-0.03,0.05);
    box(slope,0.66,0.02,0.075,shell,s*1.05,-0.026,0.05);
    box(slope,0.3,0.012,0.03,accent,s*1.75,-0.03,-0.1);
  }
  plane(slope,0.95,0.42,panel(608,272,11,3,1),0,-0.031,0.02,Math.PI/2,0);
  box(slope,1.0,0.02,0.47,shell,0,-0.018,0.02);
  box(root,0.9,0.012,0.04,lamp,0,0.915,-0.2);
  box(root,0.9,0.012,0.04,lamp,0,0.915,0.5);
  // Lasi heijastaa hieman sinistä.
  plane(root,3.1,1.0,new THREE.MeshBasicMaterial({color:0x8fb4ff, transparent:true, opacity:0.03, depthWrite:false}),0,0.15,-1.4);

  // --- Kattonäytöt: navigointi vasemmalla, järjestelmät oikealla ---
  [[-1,nav],[1,systems]].forEach(([s,scr])=>{
    const m=monitor(root,0.44,0.2475,screenMat(scr),s*0.94,0.44,-1.26,0.22,-s*0.5);
    box(m,0.47,0.28,0.045,shell,0,0,-0.042);
    cyl(m,0.012,0.012,0.22,trim,0,0.24,-0.045);
    box(m,0.08,0.025,0.07,shell,0,0.142,-0.045);
  });

  // --- Kojelauta: kallistettu näyttöpaneeli, häikäisysuoja ja kytkinhylly ---
  const TILT=-0.6;
  box(root,2.5,0.62,0.62,hull,0,-0.9,-1.12);
  const dash=add(root,new THREE.Group(),0,-0.47,-1.1,TILT,0);
  box(dash,2.4,0.46,0.05,shell,0,0,-0.03);
  main.forEach((s,i)=>monitor(dash,0.62,0.31,screenMat(s),(i-1)*0.74,0.015,0.004));
  box(dash,2.4,0.006,0.006,accent,0,-0.215,0.003);
  box(root,2.5,0.025,0.15,rubber,0,-0.262,-1.19,0.1,0);
  const shelf=add(root,new THREE.Group(),0,-0.7,-0.8,0.3,0);
  box(shelf,2.4,0.04,0.34,shell,0,0,0);
  plane(shelf,1.2,0.3,panel(768,192,23,4,1),0,0.021,0,-Math.PI/2,0);
  box(shelf,2.4,0.02,0.02,trim,0,0.012,0.17);
  // Ohjainsauva oikealla ja tehovipu vasemmalla.
  const stick=add(shelf,new THREE.Group(),0.8,0.02,0.02);
  cyl(stick,0.05,0.055,0.02,trim,0,0.01,0);
  cyl(stick,0.02,0.042,0.05,rubber,0,0.045,0);
  cyl(stick,0.011,0.011,0.1,trim,0,0.11,0);
  add(stick,new THREE.Mesh(new THREE.CapsuleGeometry(0.023,0.085,6,16),rubber),0,0.2,0.006,0.12,0);
  add(stick,new THREE.Mesh(new THREE.SphereGeometry(0.009,12,8),red),0,0.262,0.018);
  const throttle=add(shelf,new THREE.Group(),-0.8,0.02,0.02);
  box(throttle,0.16,0.03,0.24,bezel,0,0.015,0);
  for(const dx of [-0.035,0.035]) {
    box(throttle,0.01,0.11,0.01,trim,dx,0.075,-0.015,-0.35,0);
    box(throttle,0.04,0.024,0.03,rubber,dx,0.13,-0.035,-0.35,0);
  }
  box(throttle,0.012,0.004,0.2,accent,0.075,0.031,0);

  // --- Sivukonsolit: kääntyvät lentäjää kohti, päällä kytkinpaneeli ja pieni näyttö ---
  [[-1,staticScreen(lifeSupport),31],[1,staticScreen(power),47]].forEach(([s,mat,seed])=>{
    const c=add(root,new THREE.Group(),s*1.22,0,-0.46,0,Math.atan2(-s*1.22,0.46));
    box(c,1.0,0.56,0.52,hull,0,-0.93,-0.05);
    const top=add(c,new THREE.Group(),0,-0.6,0,-1.05,0);
    box(top,1.0,0.5,0.04,shell,0,0,-0.022);
    plane(top,0.56,0.44,panel(448,352,seed,2,2),-s*0.2,0,0.001);
    monitor(top,0.32,0.2,mat,s*0.3,0.1,0.004);
    plane(top,0.32,0.17,panel(256,136,seed+1,1,1),s*0.3,-0.14,0.001);
    box(top,1.0,0.006,0.006,accent,0,-0.245,0.003);
    box(c,1.0,0.02,0.03,trim,0,-0.385,-0.245);
  });

  // --- Istuin: näkyy, kun katsoo alas tai taakse ---
  box(root,0.56,0.12,0.5,fabric,0,-0.98,0.22);
  box(root,0.56,0.95,0.12,fabric,0,-0.5,0.56,-0.1,0);
  box(root,0.34,0.22,0.1,fabric,0,0.12,0.62,-0.1,0);
  box(root,0.3,0.5,0.3,hull,0,-1.1,0.3);
  for(const s of [-1,1]) {
    box(root,0.09,0.06,0.5,fabric,s*0.36,-0.74,0.2);
    box(root,0.05,0.2,0.05,trim,s*0.36,-0.86,0.38);
  }
  return root;
}
