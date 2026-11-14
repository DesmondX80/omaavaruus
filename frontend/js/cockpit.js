// Avaruuslennon 3D-ohjaamo: pelaaja istuu aluksessa ja katsoo ikkunasta ulos. three.js (WebGL) on tallennettu
// repoon ja ladataan vasta, kun ohjaamo avataan (voyage.js tuo tämän moduulin dynaamisesti).
//
// Mittakaavat: kamera on aina origossa (floating origin), ja muiden kohteiden paikat lasketaan aluksen suhteen
// kaksoistarkkuudella ennen kuin ne annetaan näytönohjaimelle. Logaritminen syvyyspuskuri piirtää tarkasti sekä
// ohjaamon (metrejä) että planeetat ja tähdet (miljardeja kilometrejä). Yksikkö on metri.
//
// Koordinaatit: ekliptikan (x, y, z) → three.js (x, z, −y), eli ekliptikan pohjoisnapa on ylöspäin.
import * as THREE from './vendor/three-0.170.0.module.min.js';
import { FLIGHT_BODIES, MOONS, bodyState } from './flight.js';
import { PLANETS, SUN_RADIUS_KM } from './planets.js';
import { BRIGHT_STARS } from './stars.js';
import { glowCanvas, planetCanvas, ringCanvas } from './textures.js';

const KM = 1000;
const OBLIQUITY = 23.4393*Math.PI/180;
const STAR_DISTANCE = 1e16;
// Pyörähdysajat tunteina (negatiivinen = takaperoinen).
const SPIN_HOURS = {Merkurius:1407.6, Venus:-5832.5, Maa:23.934, Mars:24.623, Jupiter:9.925, Saturnus:10.656, Uranus:-17.24, Neptunus:16.11};
const SHAKE_MS = 7000;

const toScene = ([x,y,z]) => new THREE.Vector3(x,z,-y);
function equatorial(raHours, decDeg) {
  const ra=raHours*15*Math.PI/180, dec=decDeg*Math.PI/180;
  const x=Math.cos(dec)*Math.cos(ra), y=Math.cos(dec)*Math.sin(ra), z=Math.sin(dec);
  // Päiväntasaajan koordinaatit ekliptikan koordinaateiksi.
  return [x, y*Math.cos(OBLIQUITY)+z*Math.sin(OBLIQUITY), -y*Math.sin(OBLIQUITY)+z*Math.cos(OBLIQUITY)];
}

function texture(canvas) {
  const t=new THREE.CanvasTexture(canvas);
  t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=4;
  return t;
}

// Tähtitaivas: luettelon kirkkaat tähdet oikeista suunnista sekä himmeä tausta, joka tihenee Linnunradan tasoa
// kohti (taustan tähdet ovat satunnaisia, vain jakauma vastaa taivasta).
function stars() {
  const group=new THREE.Group();
  const layer=(points, size)=>{
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(points.flatMap(p=>p.pos),3));
    g.setAttribute('color',new THREE.Float32BufferAttribute(points.flatMap(p=>p.color),3));
    group.add(new THREE.Points(g,new THREE.PointsMaterial({size, sizeAttenuation:false, vertexColors:true, depthWrite:false})));
  };
  const at=v=>toScene(v).multiplyScalar(STAR_DISTANCE).toArray();
  const bright=BRIGHT_STARS.map(([,ra,dec,mag])=>{
    const b=Math.max(0.35,Math.min(1,1.15-mag*0.25));
    return {mag, pos:at(equatorial(ra,dec)), color:[b,b,Math.min(1,b*1.05)]};
  });
  layer(bright.filter(s=>s.mag<1),3.2);
  layer(bright.filter(s=>s.mag>=1&&s.mag<2),2.4);
  layer(bright.filter(s=>s.mag>=2),1.7);
  // Galaksin pohjoisnapa: RA 12 h 51,4 min, Dec +27,13°.
  const pole=equatorial(12.857,27.128);
  let seed=1234567; const rnd=()=>((seed=Math.imul(seed^(seed>>>13),1103515245)+12345)>>>0)/4294967296;
  const faint=[];
  while(faint.length<2600) {
    const z=rnd()*2-1, a=rnd()*2*Math.PI, r=Math.sqrt(1-z*z), v=[r*Math.cos(a),r*Math.sin(a),z];
    const b=Math.asin(Math.abs(v[0]*pole[0]+v[1]*pole[1]+v[2]*pole[2]))*180/Math.PI;
    if(rnd()>0.3+0.7*Math.exp(-((b/14)**2))) continue;
    const l=0.25+rnd()*0.35, tint=rnd();
    faint.push({pos:at(v), color:[l*(tint>0.8 ? 1.1 : 0.95),l,l*(tint<0.2 ? 1.15 : 1)]});
  }
  layer(faint,1.2);
  return group;
}

// Ohjaamo yksinkertaisista muodoista. Kamera on silmien kohdalla origossa ja katsoo −z-suuntaan.
function cabin(screens) {
  const group=new THREE.Group();
  const frame=new THREE.MeshStandardMaterial({color:0x2c3446, roughness:0.75, metalness:0.35, emissive:0x0a0d15});
  const dark=new THREE.MeshStandardMaterial({color:0x161b26, roughness:0.9, metalness:0.1, emissive:0x06080c});
  const seat=new THREE.MeshStandardMaterial({color:0x3a2a22, roughness:0.95, emissive:0x0c0806});
  const box=(w,h,d,mat,x,y,z,rx=0,ry=0,rz=0)=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
    m.position.set(x,y,z); m.rotation.set(rx,ry,rz); group.add(m); return m;
  };
  // Etuikkunan kehys.
  box(3.0,0.14,0.14,frame,0,0.78,-1.15);
  box(3.0,0.16,0.16,frame,0,-0.42,-1.1);
  box(0.14,1.3,0.14,frame,-1.2,0.18,-1.12,0,0,-0.12);
  box(0.14,1.3,0.14,frame,1.2,0.18,-1.12,0,0,0.12);
  // Sivuikkunoiden tolpat ja katto.
  box(0.12,1.4,0.12,frame,-1.55,0.15,0.1,0.15,0,-0.1);
  box(0.12,1.4,0.12,frame,1.55,0.15,0.1,0.15,0,0.1);
  box(0.12,0.12,1.3,frame,-1.4,0.8,-0.5);
  box(0.12,0.12,1.3,frame,1.4,0.8,-0.5);
  box(3.2,0.06,0.9,dark,0,0.9,0.35);
  // Seinät ikkunoiden alla, takaseinä ja lattia.
  box(0.08,0.8,2.4,dark,-1.62,-0.85,-0.1);
  box(0.08,0.8,2.4,dark,1.62,-0.85,-0.1);
  box(3.3,2.2,0.08,dark,0,0,1.05);
  box(3.3,0.06,2.4,dark,0,-1.25,-0.1);
  // Kojelauta ja sen näytöt.
  box(2.7,0.1,0.75,frame,0,-0.5,-0.78,0.32);
  box(2.7,0.55,0.08,dark,0,-0.8,-1.08);
  screens.forEach((s,i)=>{
    const m=new THREE.Mesh(new THREE.PlaneGeometry(0.62,0.31),new THREE.MeshBasicMaterial({map:s.texture, toneMapped:false}));
    m.position.set((i-1)*0.72,-0.435,-0.74); m.rotation.set(-Math.PI/2+0.32+0.55,0,0);
    m.rotation.y=-(i-1)*0.18;
    group.add(m);
  });
  // Istuin näkyy, kun katsoo alas tai taakse.
  box(0.7,0.12,0.6,seat,0,-0.95,0.25);
  box(0.7,1.0,0.12,seat,0,-0.45,0.6,-0.12);
  box(0.4,0.25,0.12,seat,0,0.2,0.66,-0.12);
  box(0.1,0.1,0.55,seat,-0.42,-0.7,0.2);
  box(0.1,0.1,0.55,seat,0.42,-0.7,0.2);
  // Ohut lasi heijastaa hieman sinistä.
  const glass=new THREE.Mesh(new THREE.PlaneGeometry(2.3,1.15),new THREE.MeshBasicMaterial({color:0x8fb4ff, transparent:true, opacity:0.035, depthWrite:false}));
  glass.position.set(0,0.18,-1.13); group.add(glass);
  return group;
}

// Kojelaudan näyttö: canvas-tekstuuri, johon kirjoitetaan otsikko ja rivit.
function display() {
  const c=document.createElement('canvas'); c.width=512; c.height=256;
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace;
  let last='';
  return {texture:t, draw(title, lines, bar = null) {
    const key=JSON.stringify([title,lines,bar]);
    if(key===last) return;
    last=key;
    const ctx=c.getContext('2d');
    ctx.fillStyle='#03121a'; ctx.fillRect(0,0,512,256);
    ctx.strokeStyle='#1d4a5c'; ctx.lineWidth=6; ctx.strokeRect(3,3,506,250);
    ctx.fillStyle='#5ed6ff'; ctx.font='600 28px system-ui, sans-serif'; ctx.fillText(title,24,46);
    lines.forEach(([text,size,color],i)=>{
      ctx.fillStyle=color ?? '#e8eefc'; ctx.font=`${size ?? 40}px ui-monospace, monospace`;
      ctx.fillText(text,24,104+i*56);
    });
    if(bar!=null) {
      ctx.fillStyle='#1d2740'; ctx.fillRect(24,200,464,24);
      ctx.fillStyle=bar>0.2 ? '#4ade80' : '#ff7b93'; ctx.fillRect(24,200,464*Math.max(0,Math.min(1,bar)),24);
    }
    t.needsUpdate=true;
  }};
}

/**
 * Luo ohjaamonäkymän elementtiin host. state() palauttaa joka ruudulla pelin tilan:
 * {t, ship: {r, v} (aluksen paikka km ja nopeus Auringon suhteen), aim (planeetta, johon nokka osoittaa, tai null),
 *  warp, launchAge (ms laukaisusta), countdown (ms tai null), screens (kolmen näytön otsikko ja rivit)}.
 * Palauttaa {start, stop, resetView} tai heittää virheen, jos WebGL ei ole käytettävissä.
 */
export function createCockpit(host, state) {
  const renderer=new THREE.WebGLRenderer({antialias:true, logarithmicDepthBuffer:true});
  renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  host.append(renderer.domElement);
  renderer.domElement.className='voyage-cockpit-canvas';

  const scene=new THREE.Scene();
  scene.background=new THREE.Color(0x000000);
  const ship=new THREE.Group(), head=new THREE.Group();
  const camera=new THREE.PerspectiveCamera(70,1,0.02,1e17);
  head.add(camera); ship.add(head); scene.add(ship);
  scene.add(stars());

  // Aurinko: pallo, häikäisy ja valonlähde, joka valaisee planeetat oikealta puolelta. Himmeä hajavalo erottaa
  // planeetan yöpuolen, kun alus kiertää sitä varjon puolella.
  const sunGlow=new THREE.Sprite(new THREE.SpriteMaterial({map:texture(glowCanvas('rgba(255,255,240,1)','rgba(255,200,90,.35)')), depthWrite:false, blending:THREE.AdditiveBlending, toneMapped:false}));
  const sunCore=new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS_KM*KM,32,16),new THREE.MeshBasicMaterial({color:0xfff6dc, toneMapped:false}));
  const sunLight=new THREE.PointLight(0xffffff,3.2,0,0);
  scene.add(sunGlow,sunCore,sunLight,new THREE.AmbientLight(0x8090b0,0.18));

  // Planeetat: pallo tekstuureineen ja piste, joka pitää kaukaisen planeetan näkyvänä kirkkaana pisteenä.
  // Kuut piirretään samoin kuin planeetat; ne kääntävät aina saman puolen planeettaansa kohti.
  const bodies=[...PLANETS, ...Object.entries(MOONS).map(([name,m])=>({name, radiusKm:m.radiusKm, color:m.color, moon:true}))];
  const planets=bodies.map(p=>{
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(p.radiusKm*KM,64,32),new THREE.MeshStandardMaterial({map:texture(planetCanvas(p.name)), roughness:1, metalness:0}));
    const dotGeo=new THREE.BufferGeometry(); dotGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0],3));
    const dot=new THREE.Points(dotGeo,new THREE.PointsMaterial({color:p.color, size:3.5, sizeAttenuation:false, depthWrite:false}));
    scene.add(mesh,dot);
    if(p.name==='Saturnus') {
      const inner=FLIGHT_BODIES.Saturnus.radiusKm*1.24*KM, outer=FLIGHT_BODIES.Saturnus.radiusKm*2.27*KM;
      const geo=new THREE.RingGeometry(inner,outer,128,1);
      // Tekstuurin u-koordinaatti säteen mukaan, jotta renkaan raidat kiertävät.
      const pos=geo.attributes.position, uv=geo.attributes.uv;
      for(let i=0;i<pos.count;i++) uv.setXY(i,(Math.hypot(pos.getX(i),pos.getY(i))-inner)/(outer-inner),0.5);
      const ring=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({map:texture(ringCanvas()), transparent:true, side:THREE.DoubleSide, roughness:1, depthWrite:false}));
      // Saturnuksen pyörähdysakseli: RA 40,59°, Dec 83,54°.
      ring.lookAt(toScene(equatorial(40.59/15,83.54))); mesh.add(ring);
    }
    return {name:p.name, radiusKm:p.radiusKm, moon:p.moon, mesh, dot};
  });

  // Moottorin hehku valaisee ohjaamon laukaisussa takaa.
  // Valojen kantama on rajattu muutamaan metriin, jotta ne eivät valaise planeettoja.
  const engine=new THREE.PointLight(0xff8a3a,0,6,2);
  engine.position.set(0,-0.6,1.6); ship.add(engine);
  const interior=new THREE.PointLight(0x9fb8ff,0.8,5,1);
  interior.position.set(0,0.6,0.3); ship.add(interior);

  const screens=[display(),display(),display()];
  ship.add(cabin(screens));

  // Katse: raahaus kääntää päätä ohjaamossa, asentoanturit lisäävät puhelimen kääntymisen.
  let yaw=0, pitch=-0.05, dragging=null, orientation=null, orientationBase=null, moved=0;
  const canvas=renderer.domElement;
  canvas.addEventListener('pointerdown',e=>{dragging={x:e.clientX,y:e.clientY}; canvas.setPointerCapture?.(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{
    if(!dragging) return;
    yaw=Math.max(-2.6,Math.min(2.6,yaw+(e.clientX-dragging.x)*0.005));
    pitch=Math.max(-1.2,Math.min(1.05,pitch+(e.clientY-dragging.y)*0.005));
    dragging={x:e.clientX,y:e.clientY}; moved=performance.now();
  });
  const end=()=>{dragging=null;};
  canvas.addEventListener('pointerup',end); canvas.addEventListener('pointercancel',end);
  const onOrientation=e=>{
    if(e.alpha==null) return;
    const euler=new THREE.Euler(e.beta*Math.PI/180,e.alpha*Math.PI/180,-e.gamma*Math.PI/180,'YXZ');
    const q=new THREE.Quaternion().setFromEuler(euler).multiply(new THREE.Quaternion(-Math.SQRT1_2,0,0,Math.SQRT1_2));
    const screenAngle=(screen.orientation?.angle ?? window.orientation ?? 0)*Math.PI/180;
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-screenAngle));
    if(!orientationBase) orientationBase=q.clone().invert();
    orientation=orientationBase.clone().multiply(q); moved=performance.now();
  };

  // Aluksen asento: nokka osoittaa kohteeseen aim, ja asento kääntyy pehmeästi.
  const look=new THREE.Matrix4(), want=new THREE.Quaternion(), origin=new THREE.Vector3(), up=new THREE.Vector3(0,1,0);
  let attitudeReady=false;

  let running=false, frame=null, lastFrame=0, lastRender=0;
  function resize() {
    const w=host.clientWidth, h=host.clientHeight;
    if(!w||!h) return;
    const size=renderer.getSize(new THREE.Vector2());
    if(size.x!==w||size.y!==h) {renderer.setSize(w,h,false); camera.aspect=w/h; camera.fov=w<h ? 80 : 65; camera.updateProjectionMatrix();}
  }

  function update(now) {
    const s=state(), t=s.t, view=s.ship;
    // Floating origin: kaikki paikat aluksen suhteen, metreinä.
    const rel=km=>toScene([(km[0]-view.r[0])*KM,(km[1]-view.r[1])*KM,(km[2]-view.r[2])*KM]);
    const sun=rel([0,0,0]);
    sunCore.position.copy(sun); sunLight.position.copy(sun);
    sunGlow.position.copy(sun); sunGlow.scale.setScalar(sun.length()*0.16);
    const k=renderer.domElement.clientHeight/2/Math.tan(camera.fov*Math.PI/360);
    for(const p of planets) {
      const pos=rel(bodyState(p.name,t).r);
      p.mesh.position.copy(pos); p.dot.position.copy(pos);
      p.mesh.rotation.y=p.moon ? 2*Math.PI*((t-Date.UTC(2000,0,1,12))/(MOONS[p.name].periodDays*86400000)%1) : 2*Math.PI*((t/3600000/SPIN_HOURS[p.name])%1);
      // Piste piilotetaan, kun pallo näkyy itse riittävän suurena. Kuun piste näkyy vain alle 20 milj. km päästä.
      p.dot.visible=p.radiusKm*KM/pos.length()*k<2 && (!p.moon || pos.length()<2e10);
    }
    if(s.aim) {look.lookAt(origin,rel(bodyState(s.aim,t).r),up); want.setFromRotationMatrix(look);}
    else want.copy(ship.quaternion);
    if(!attitudeReady) {ship.quaternion.copy(want); attitudeReady=true;}
    const turning=ship.quaternion.angleTo(want)>1e-4;
    ship.quaternion.slerp(want,Math.min(1,(now-lastFrame)/1500));
    head.rotation.set(0,0,0); head.quaternion.setFromEuler(new THREE.Euler(pitch,yaw,0,'YXZ'));
    if(orientation) head.quaternion.multiply(orientation);

    // Laukaisun tärinä ja moottorin hehku vaimenevat muutamassa sekunnissa; lähtölaskennan lopussa jyrinä alkaa.
    const age=s.launchAge, rumble=age<SHAKE_MS ? 1-age/SHAKE_MS : s.countdown!=null && s.countdown<1500 ? 0.4 : 0;
    camera.position.set((Math.random()-0.5)*0.03*rumble,(Math.random()-0.5)*0.03*rumble,0);
    engine.intensity=rumble*18*(0.85+Math.random()*0.3);

    const [a,b,c]=s.screens;
    screens[0].draw(...a); screens[1].draw(...b); screens[2].draw(...c);
    return rumble>0 || turning || s.warp>1 || now-moved<1000;
  }

  // Liikkuessa piirretään joka ruudulla, muuten neljästi sekunnissa (näytöt ja kello päivittyvät silti).
  function loop(now) {
    frame=null;
    if(!running || document.hidden) return;
    resize();
    const active=update(now);
    lastFrame=now;
    if(active || now-lastRender>250) {renderer.render(scene,camera); lastRender=now;}
    frame=requestAnimationFrame(loop);
  }

  return {
    start() { if(running) return; running=true; lastFrame=performance.now(); attitudeReady=false; frame=requestAnimationFrame(loop); },
    stop() { running=false; if(frame) cancelAnimationFrame(frame); frame=null; },
    resetView() { yaw=0; pitch=-0.05; orientationBase=null; moved=performance.now(); },
    get orientation() { return !!orientation; },
    async toggleOrientation() {
      if(orientation || orientationBase) {window.removeEventListener('deviceorientation',onOrientation); orientation=null; orientationBase=null; return false;}
      if(typeof DeviceOrientationEvent!=='undefined' && typeof DeviceOrientationEvent.requestPermission==='function') {
        if(await DeviceOrientationEvent.requestPermission()!=='granted') throw new Error('Asentoanturien käyttö estettiin. Salli liike ja suunta selaimen asetuksista.');
      }
      window.addEventListener('deviceorientation',onOrientation);
      return true;
    },
  };
}
