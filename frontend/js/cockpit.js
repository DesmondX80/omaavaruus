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
import { AU_KM, PLANETS, SUN_RADIUS_KM } from './planets.js';
import { BRIGHT_STARS } from './stars.js';
import { buildCabin, display, screen } from './cabin.js';
import { glowCanvas, planetCanvas, ringCanvas } from './textures.js';

const KM = 1000;
const OBLIQUITY = 23.4393*Math.PI/180;
const STAR_DISTANCE = 1e16;
// Pyörähdysajat tunteina (negatiivinen = takaperoinen).
const SPIN_HOURS = {Merkurius:1407.6, Venus:-5832.5, Maa:23.934, Mars:24.623, Jupiter:9.925, Saturnus:10.656, Uranus:-17.24, Neptunus:16.11};
// Pyörähdysakselien pohjoisnavat (IAU, J2000): [rektaskensio°, deklinaatio°]. Kuiden akselit ovat pystyssä.
const POLES = {Merkurius:[281.01,61.41], Venus:[272.76,67.16], Maa:[0,90], Mars:[317.68,52.89], Jupiter:[268.06,64.5], Saturnus:[40.59,83.54], Uranus:[257.31,-15.18], Neptunus:[299.36,43.46]};
// Päivätaivaan väri Maan pinnalta katsottuna.
const SKY = new THREE.Color(0x4f8fd0), SKY_LIGHT = new THREE.Color(0xa9cdff);

// Osuus Auringon kiekosta, jonka sen edessä oleva kappale peittää aluksesta katsottuna: kahden ympyrän leikkausala
// jaettuna Auringon kiekon alalla. sunR ja bodyR ovat kiekkojen kulmasäteet ja sep niiden keskipisteiden kulmaetäisyys.
function covered(sunR, bodyR, sep) {
  if(sep>=sunR+bodyR) return 0;
  if(sep<=Math.abs(bodyR-sunR)) return bodyR>=sunR ? 1 : (bodyR/sunR)**2;
  const a=sunR*sunR, b=bodyR*bodyR;
  const lens=a*Math.acos((sep*sep+a-b)/(2*sep*sunR))+b*Math.acos((sep*sep+b-a)/(2*sep*bodyR))
    -0.5*Math.sqrt((-sep+sunR+bodyR)*(sep+sunR-bodyR)*(sep-sunR+bodyR)*(sep+sunR+bodyR));
  return lens/(Math.PI*a);
}
const WHITE = new THREE.Color(0xffffff);

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

// Valokuvatekstuurit (frontend/textures/, lähteet README:ssä). Kuva haetaan vasta, kun kohde näkyy kiekkona, ja
// siihen asti (tai jos haku epäonnistuu) pinnalla on textures.js:n piirretty tekstuuri. Titanilla ei ole kuvaa:
// sen pinta on oranssin utukerroksen peitossa, joten piirretty tekstuuri vastaa sitä, miltä kuu näyttää avaruudesta.
const PHOTO_BODIES = new Set(['Merkurius','Venus','Maa','Mars','Jupiter','Saturnus','Uranus','Neptunus','Kuu','Phobos','Io','Europa','Ganymedes','Enceladus','Triton']);
// Tarkemmat kartat, jotka haetaan vasta lähellä kohdetta: suurin saatavilla oleva leveys (4096 tai 8192 pikseliä).
const HIRES = {Merkurius:8192, Venus:4096, Maa:8192, Mars:8192, Jupiter:4096, Saturnus:4096, Kuu:8192,
  Phobos:4096, Io:8192, Europa:8192, Ganymedes:8192, Enceladus:8192, Triton:4096};
// Kiekon säde ruudulla (CSS-pikseleinä), jolla kuva haetaan, jolla vaihdetaan tarkkaan karttaan ja jolla palataan takaisin.
const PHOTO_MIN_PX = 3, HIRES_PX = 200, HIRES_BACK_PX = 120;
const loader = new THREE.TextureLoader();
function loadPhoto(file, onLoad) {
  loader.load(new URL(`../textures/${file}.webp`,import.meta.url).href,t=>{
    t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=8;
    onLoad(t);
  },undefined,()=>{});
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

// Kattonäyttöjen sisältö. Navigointinäyttö: aurinkokunta ylhäältä (ekliptikan pohjoispuolelta), planeetat radoillaan,
// alus ja suunta kohteeseen. Mittakaava sovitetaan niin, että alus ja kohde mahtuvat kuvaan.
function drawNav(ctx, w, h, t, shipKm, aim) {
  const AU=149597870.7, cx=w/2, cy=h/2+14, target=aim ? bodyState(aim,t).r : null;
  const reach=Math.max(0.5,Math.hypot(shipKm[0],shipKm[1])/AU,target ? Math.hypot(target[0],target[1])/AU : 0)*1.15, k=(h/2-30)/reach;
  const px=r=>[cx+r[0]/AU*k, cy-r[1]/AU*k];
  ctx.fillStyle='#5ed6ff'; ctx.font='600 24px system-ui, sans-serif'; ctx.fillText('NAVIGOINTI',18,36);
  ctx.fillStyle='#8b9ac0'; ctx.font='18px ui-monospace, monospace'; ctx.textAlign='right';
  ctx.fillText(`säde ${reach<10 ? reach.toFixed(1).replace('.',',') : Math.round(reach)} AU`,w-18,34); ctx.textAlign='left';
  ctx.save(); ctx.beginPath(); ctx.rect(8,46,w-16,h-54); ctx.clip();
  ctx.lineWidth=1.5;
  for(const p of PLANETS) {
    const r=bodyState(p.name,t).r, [x,y]=px(r);
    ctx.strokeStyle='rgba(94,214,255,.22)'; ctx.beginPath(); ctx.arc(cx,cy,Math.hypot(r[0],r[1])/AU*k,0,2*Math.PI); ctx.stroke();
    ctx.fillStyle=p.color; ctx.beginPath(); ctx.arc(x,y,p.name===aim ? 6 : 4,0,2*Math.PI); ctx.fill();
  }
  ctx.fillStyle='#ffd27a'; ctx.beginPath(); ctx.arc(cx,cy,6,0,2*Math.PI); ctx.fill();
  const [sx,sy]=px(shipKm);
  if(target) {
    const [tx,ty]=px(target);
    ctx.strokeStyle='#4ade80'; ctx.setLineDash([6,5]); ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(tx,ty); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle='#4ade80'; ctx.beginPath(); ctx.arc(tx,ty,11,0,2*Math.PI); ctx.stroke();
    ctx.fillStyle='#4ade80'; ctx.font='16px ui-monospace, monospace'; ctx.fillText(aim.toUpperCase(),tx+15,ty+5);
  }
  ctx.strokeStyle='#ffffff'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(sx-9,sy); ctx.lineTo(sx+9,sy); ctx.moveTo(sx,sy-9); ctx.lineTo(sx,sy+9); ctx.stroke();
  ctx.restore();
}
// Järjestelmänäyttö: polttoaine ja aikakiihdytys pelin tilasta, muut rivit ovat aluksen vakioarvoja.
function drawSystems(ctx, w, h, fuel, warp, aim) {
  ctx.fillStyle='#5ed6ff'; ctx.font='600 24px system-ui, sans-serif'; ctx.fillText('JÄRJESTELMÄT',18,36);
  const rows=[['POLTTOAINE',fuel==null ? '' : `${Math.round(fuel*100)} %`,fuel],['AIKAKIIHDYTYS',warp>1 ? `${warp>=1e4 ? warp.toExponential(0).replace('e+','e') : warp}×` : '1×',null],
    ['SUUNTA',aim ?? 'vapaa',null],['MOOTTORI','valmius',null],['SÄTEILYSUOJA','OK',null]];
  rows.forEach(([name,value,bar],i)=>{
    const y=78+i*42;
    ctx.fillStyle='#8b9ac0'; ctx.font='20px ui-monospace, monospace'; ctx.textAlign='left'; ctx.fillText(name,18,y);
    ctx.fillStyle=bar!=null && bar<=0.2 ? '#ff7b93' : '#e8eefc'; ctx.textAlign='right'; ctx.fillText(value,w-18,y); ctx.textAlign='left';
    if(bar!=null) {
      ctx.fillStyle='#1d2740'; ctx.fillRect(200,y-15,w-300,14);
      ctx.fillStyle=bar>0.2 ? '#4ade80' : '#ff7b93'; ctx.fillRect(200,y-15,(w-300)*Math.max(0,Math.min(1,bar)),14);
    }
  });
}

/**
 * Luo ohjaamonäkymän elementtiin host. state() palauttaa joka ruudulla pelin tilan:
 * {t, ship: {r, v} (aluksen paikka km ja nopeus Auringon suhteen), aim (planeetta, johon nokka osoittaa, tai null),
 *  nose ja up (valinnaiset ekliptikan suuntavektorit, jotka korvaavat aim-suunnan), warp, shake (tärinä 0–1),
 *  thrust (moottorin hehku 0–1), sky (taivaan kirkkaus 0–1; väri skyColor, oletuksena päivätaivaan sininen), screens (kolmen näytön otsikko ja rivit)}.
 * Palauttaa {start, stop, resetView} tai heittää virheen, jos WebGL ei ole käytettävissä.
 */
export function createCockpit(host, state) {
  const renderer=new THREE.WebGLRenderer({antialias:true, logarithmicDepthBuffer:true});
  renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.autoClear=false; renderer.toneMappingExposure=1.3;
  host.append(renderer.domElement);
  renderer.domElement.className='voyage-cockpit-canvas';

  const scene=new THREE.Scene();
  scene.background=new THREE.Color(0x000000);
  const ship=new THREE.Group(), head=new THREE.Group();
  const camera=new THREE.PerspectiveCamera(70,1,0.02,1e17);
  head.add(camera); ship.add(head); scene.add(ship);
  const starField=stars();
  starField.traverse(o=>{if(o.material) o.material.transparent=true;});
  scene.add(starField);

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
    let ringMaterial=null;
    if(p.name==='Saturnus') {
      const inner=FLIGHT_BODIES.Saturnus.radiusKm*1.24*KM, outer=FLIGHT_BODIES.Saturnus.radiusKm*2.27*KM;
      const geo=new THREE.RingGeometry(inner,outer,128,1);
      // Tekstuurin u-koordinaatti säteen mukaan, jotta renkaan raidat kiertävät.
      const pos=geo.attributes.position, uv=geo.attributes.uv;
      for(let i=0;i<pos.count;i++) uv.setXY(i,(Math.hypot(pos.getX(i),pos.getY(i))-inner)/(outer-inner),0.5);
      // Jääkiteet sirottavat valoa joka suuntaan, joten renkaat piirretään ilman pinnan suunnasta riippuvaa varjostusta.
      ringMaterial=new THREE.MeshBasicMaterial({map:texture(ringCanvas()), transparent:true, side:THREE.DoubleSide, depthWrite:false});
      const ring=new THREE.Mesh(geo,ringMaterial);
      // Renkaat ovat päiväntasaajan tasossa ja kallistuvat pallon mukana.
      ring.rotation.x=-Math.PI/2; mesh.add(ring);
    }
    const tilt=new THREE.Quaternion();
    if(POLES[p.name]) tilt.setFromUnitVectors(new THREE.Vector3(0,1,0),toScene(equatorial(POLES[p.name][0]/15,POLES[p.name][1])).normalize());
    return {name:p.name, radiusKm:p.radiusKm, color:p.color, moon:p.moon, mesh, dot, ringMaterial, tilt, level:0, ring:false};
  });

  // Tekstuurin tarkkuustaso: 0 piirretty, 1 peruskartta (2k), 2 tarkka kartta. Tarkan kartan leveys rajataan laitteen
  // mukaan: 8k vain, jos näytönohjain tukee sitä eikä laite ole kosketusnäyttöinen (8k-kuva vie muistia noin 180 Mt).
  const hiresMax=renderer.capabilities.maxTextureSize>=8192 && !matchMedia('(pointer: coarse)').matches ? 8192 : Math.min(4096,renderer.capabilities.maxTextureSize);
  const hiresWidth=name=>Math.min(HIRES[name] ?? 0,hiresMax);
  function setLevel(p, level) {
    p.level=level;
    const file=p.name.toLowerCase()+(level===2 ? `-${hiresWidth(p.name)/1024}k` : '');
    loadPhoto(file,t=>{
      // Taso on voinut vaihtua haun aikana; vanhentunut kuva hylätään.
      if(p.level!==level) {t.dispose(); return;}
      p.mesh.material.map?.dispose(); p.mesh.material.map=t; p.mesh.material.needsUpdate=true;
      moved=performance.now();
    });
    if(p.ringMaterial && !p.ring) {
      p.ring=true;
      loadPhoto('saturnus-renkaat',t=>{p.ringMaterial.map?.dispose(); p.ringMaterial.map=t; p.ringMaterial.needsUpdate=true; moved=performance.now();});
    }
  }

  // Ohjaamo piirretään omana näkymänään avaruuden päälle, aluksen omassa koordinaatistossa. Näin sen valot eivät
  // valaise planeettoja, ja varjokartan syvyystarkkuus riittää: avaruuden mittakaavassa (miljardeja kilometrejä)
  // muutaman metrin varjoja ei voisi laskea.
  const cabinScene=new THREE.Scene(), cabinCamera=new THREE.PerspectiveCamera(70,1,0.02,40);
  cabinScene.add(cabinCamera);
  const screens=[display(),display(),display()], nav=screen(512,288), systems=screen(512,288);
  const cabin=buildCabin(screens,nav,systems);
  cabin.traverse(o=>{
    if(!o.isMesh) return;
    o.castShadow=!o.material.transparent;
    o.receiveShadow=!o.material.isMeshBasicMaterial;
  });
  cabinScene.add(cabin);
  renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  // Auringonvalo ikkunoista: suunta lasketaan joka ruudulla Auringon suunnasta aluksen koordinaatistossa, ja kehyksen
  // tuet heittävät varjonsa konsolille ja lattialle. Varjokartta lasketaan uudelleen vain, kun suunta muuttuu.
  const sunBeam=new THREE.DirectionalLight(0xfff4e2,3);
  sunBeam.castShadow=true;
  sunBeam.shadow.mapSize.setScalar(matchMedia('(pointer: coarse)').matches ? 1024 : 2048);
  Object.assign(sunBeam.shadow.camera,{left:-3,right:3,top:3,bottom:-3,near:1,far:16});
  sunBeam.shadow.camera.updateProjectionMatrix();
  sunBeam.shadow.bias=-0.0006; sunBeam.shadow.normalBias=0.02; sunBeam.shadow.radius=3;
  sunBeam.shadow.autoUpdate=false;
  // Lähellä olevan planeetan tai kuun heijastama valo: väri kohteen mukaan, voimakkuus sen näennäisen koon ja vaiheen mukaan.
  const shine=new THREE.DirectionalLight(0xffffff,0);
  // Sisävalaistus: himmeä yleisvalo, kattovalot, näyttöjen hohde ja laukaisussa takaa loistava moottorin hehku.
  // bounce on ikkunoista sisään tulevan auringonvalon heijastuma ohjaamon pinnoista: sitä ei lasketa säteittäin, vaan
  // sen voimakkuus arvioidaan siitä, kuinka suoraan Aurinko paistaa etu- ja sivuikkunoihin.
  const fill=new THREE.HemisphereLight(0xb4bccb,0x1b1c20,0.34);
  // Päivätaivaan hajavalo Maan pinnalla ja nousun alussa.
  const skyLight=new THREE.HemisphereLight(0xa9cdff,0x6a6f78,0);
  const bounce=new THREE.HemisphereLight(0xfff0dc,0x4a4640,0);
  const ceiling=new THREE.PointLight(0xffe9cf,1.5,6,1.4);
  ceiling.position.set(0,0.9,-0.1);
  const screenGlow=new THREE.PointLight(0x5ed6ff,0.3,2.4,1.5);
  screenGlow.position.set(0,-0.3,-0.8);
  const towerGlow=new THREE.PointLight(0x4fb8ff,0.2,1.2,1.5);
  towerGlow.position.set(0,-0.36,-1.25);
  const engine=new THREE.PointLight(0xff8a3a,0,6,2);
  engine.position.set(0,-0.6,1.6);
  cabinScene.add(sunBeam,sunBeam.target,shine,shine.target,fill,skyLight,bounce,ceiling,screenGlow,towerGlow,engine);
  // Ilmajarrutuksen plasma: hehkuvat tasot etu- ja sivuikkunoiden ulkopuolella, näkyvissä vain kun peli antaa taivaalle oman värin.
  const plasmaMaterial=new THREE.MeshBasicMaterial({color:0xff6a1f, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide, toneMapped:false});
  const plasma=new THREE.Group();
  for(const [x,z,ry,w] of [[0,-1.8,0,4.6],[-2.3,-0.6,Math.PI/2,2.6],[2.3,-0.6,Math.PI/2,2.6]]) {
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,2.4),plasmaMaterial);
    m.position.set(x,0.2,z); m.rotation.y=ry; plasma.add(m);
  }
  cabinScene.add(plasma);
  const sunLocal=new THREE.Vector3(), lastSun=new THREE.Vector3(), inverse=new THREE.Quaternion(), shineLocal=new THREE.Vector3(), toSun=new THREE.Vector3();

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
  const skyTint=new THREE.Color();
  const spinQ=new THREE.Quaternion(), shakeQ=new THREE.Quaternion(), shakeE=new THREE.Euler();
  let attitudeReady=false;

  let running=false, frame=null, lastFrame=0, lastRender=0, auxDrawn=-Infinity;
  function resize() {
    const w=host.clientWidth, h=host.clientHeight;
    if(!w||!h) return;
    const size=renderer.getSize(new THREE.Vector2());
    if(size.x!==w||size.y!==h) {renderer.setSize(w,h,false); camera.aspect=cabinCamera.aspect=w/h;
      // Pystykulma valitaan niin, että kojelaudan kolme näyttöä ja kattonäytöt mahtuvat kuvaan myös kapeammassa ikkunassa.
      camera.fov=Math.max(65,Math.min(80,2*Math.atan(Math.tan(48*Math.PI/180)/(w/h))*180/Math.PI)); camera.updateProjectionMatrix();
      cabinCamera.fov=camera.fov; cabinCamera.updateProjectionMatrix(); return true;}
    return false;
  }

  function update(now) {
    const s=state(), t=s.t, view=s.ship;
    // Floating origin: kaikki paikat aluksen suhteen, metreinä.
    const rel=km=>toScene([(km[0]-view.r[0])*KM,(km[1]-view.r[1])*KM,(km[2]-view.r[2])*KM]);
    const sun=rel([0,0,0]);
    sunCore.position.copy(sun); sunLight.position.copy(sun);
    sunGlow.position.copy(sun); sunGlow.scale.setScalar(sun.length()*0.16);
    const k=renderer.domElement.clientHeight/2/Math.tan(camera.fov*Math.PI/360);
    // sunlit on Auringon kiekosta näkyvä osuus: planeetan tai kuun varjossa (yöpuolella tai pimennyksessä) se on nolla.
    const sunDistance=sun.length(), sunRadius=Math.asin(Math.min(1,SUN_RADIUS_KM*KM/sunDistance));
    let nearest=null, nearestSize=0, sunlit=1;
    for(const p of planets) {
      const pos=rel(bodyState(p.name,t).r);
      if(p.radiusKm*KM/pos.length()>nearestSize) {nearestSize=p.radiusKm*KM/pos.length(); nearest=p;}
      if(pos.length()<sunDistance) sunlit*=1-covered(sunRadius,Math.asin(Math.min(1,p.radiusKm*KM/pos.length())),pos.angleTo(sun));
      p.mesh.position.copy(pos); p.dot.position.copy(pos);
      const spin=p.moon ? 2*Math.PI*((t-Date.UTC(2000,0,1,12))/(MOONS[p.name].periodDays*86400000)%1) : 2*Math.PI*((t/3600000/SPIN_HOURS[p.name])%1);
      p.mesh.quaternion.copy(p.tilt).multiply(spinQ.setFromAxisAngle(up,spin));
      // Piste piilotetaan, kun pallo näkyy itse riittävän suurena. Kuun piste näkyy vain alle 20 milj. km päästä.
      const px=p.radiusKm*KM/pos.length()*k;
      p.dot.visible=px<2 && (!p.moon || pos.length()<2e10);
      if(PHOTO_BODIES.has(p.name)) {
        const hires=hiresWidth(p.name)>2048;
        if(p.level===0 && px>PHOTO_MIN_PX) setLevel(p,hires && px>HIRES_PX ? 2 : 1);
        else if(p.level===1 && hires && px>HIRES_PX) setLevel(p,2);
        else if(p.level===2 && px<HIRES_BACK_PX) setLevel(p,1);
      }
    }
    if(s.nose) {look.lookAt(origin,toScene(s.nose),toScene(s.up ?? [0,0,1]).normalize()); want.setFromRotationMatrix(look);}
    else if(s.aim) {look.lookAt(origin,rel(bodyState(s.aim,t).r),up); want.setFromRotationMatrix(look);}
    else want.copy(ship.quaternion);
    if(!attitudeReady) {ship.quaternion.copy(want); attitudeReady=true;}
    const turning=ship.quaternion.angleTo(want)>1e-4;
    ship.quaternion.slerp(want,Math.min(1,(now-lastFrame)/1500));
    head.rotation.set(0,0,0); head.quaternion.setFromEuler(new THREE.Euler(pitch,yaw,0,'YXZ'));
    if(orientation) head.quaternion.multiply(orientation);

    // Laukaisun tärinä ja moottorin hehku vaimenevat muutamassa sekunnissa; lähtölaskennan lopussa jyrinä alkaa.
    // Tärinä: nopeaa satunnaista värinää, jonka päällä on hitaampaa heiluntaa (rungon ja moottorien matalat taajuudet),
    // sekä pientä kiertoa, jotta koko näkymä ei vain siirry vaan myös nytkähtelee.
    const rumble=Math.max(0,Math.min(1,s.shake ?? 0)), tt=now/1000, jitter=k=>(Math.random()-0.5)*k*rumble;
    camera.position.set(jitter(0.022)+Math.sin(tt*23)*0.006*rumble,jitter(0.03)+(Math.sin(tt*31)*0.4+Math.sin(tt*47+1)*0.3)*0.012*rumble,jitter(0.012));
    head.quaternion.multiply(shakeQ.setFromEuler(shakeE.set(jitter(0.014),jitter(0.01),jitter(0.012))));
    engine.intensity=(s.thrust ?? 0)*18*(0.85+Math.random()*0.3);
    // Päivätaivas: tausta sinistyy ja tähdet himmenevät; ilmakehän yläpuolella taivas on musta.
    const sky=Math.max(0,Math.min(1,s.sky ?? 0));
    scene.background.copy(s.skyColor ? skyTint.set(s.skyColor) : SKY).multiplyScalar(sky);
    skyLight.color.copy(s.skyColor ? skyTint : SKY_LIGHT);
    plasma.visible=!!s.skyColor;
    if(s.skyColor) {plasmaMaterial.color.copy(skyTint); plasmaMaterial.opacity=sky*(0.55+Math.random()*0.2);}
    starField.traverse(o=>{if(o.material) o.material.opacity=Math.max(0,1-sky*2.5);});
    skyLight.intensity=1.6*sky;
    cabinCamera.position.copy(camera.position); cabinCamera.quaternion.copy(head.quaternion);

    // Auringonvalo ohjaamossa: suunta aluksen koordinaatistossa, kirkkaus himmenee loivasti etäisyyden kasvaessa
    // (todellinen 1/r²-lasku jättäisi ulkoplaneetoilla ohjaamon lähes pimeäksi).
    inverse.copy(ship.quaternion).invert();
    sunLocal.copy(sun).normalize().applyQuaternion(inverse);
    sunBeam.position.copy(sunLocal).multiplyScalar(8);
    sunBeam.intensity=3.4*Math.max(0.3,Math.min(1.3,Math.sqrt(AU_KM*KM/sunDistance)))*sunlit;
    sunGlow.material.opacity=sunlit;
    if(sunLocal.distanceToSquared(lastSun)>1e-7) {lastSun.copy(sunLocal); sunBeam.shadow.needsUpdate=true;}
    bounce.intensity=sunBeam.intensity*0.22*Math.max(0,Math.min(1,-sunLocal.z*0.9+Math.abs(sunLocal.x)*0.5+sunLocal.y*0.2));
    // Lähimmän kappaleen heijastama valo: valaistun puolen osuus (vaihe) kertaa kiekon peittämä osuus taivaasta.
    if(nearest && nearestSize>0.02) {
      const pos=nearest.mesh.position;
      const phase=(1+toSun.copy(sun).sub(pos).normalize().dot(shineLocal.copy(pos).normalize().negate()))/2;
      shine.color.set(nearest.color).lerp(WHITE,0.45);
      shine.intensity=Math.min(1.6,6*Math.min(1,nearestSize)**2*phase+0.5*Math.min(1,nearestSize)*phase);
      shine.position.copy(shineLocal.copy(pos).normalize().applyQuaternion(inverse)).multiplyScalar(8);
    } else shine.intensity=0;

    const [a,b,c]=s.screens;
    screens[0].draw(...a); screens[1].draw(...b); screens[2].draw(...c);
    // Kattonäytöt päivittyvät enintään kahdesti sekunnissa.
    if(now-auxDrawn>500) {
      auxDrawn=now;
      const fuel=s.screens.find(x=>x[2]!=null)?.[2] ?? null;
      nav.draw(`${t}|${s.aim}`,(ctx,w,h)=>drawNav(ctx,w,h,t,view.r,s.aim));
      systems.draw(`${fuel}|${s.warp}|${s.aim}`,(ctx,w,h)=>drawSystems(ctx,w,h,fuel,s.warp,s.aim));
    }
    return rumble>0 || turning || s.warp>1 || now-moved<1000;
  }

  // Liikkuessa piirretään joka ruudulla, muuten neljästi sekunnissa (näytöt ja kello päivittyvät silti).
  function loop(now) {
    frame=null;
    if(!running || document.hidden) return;
    // Koon muutos tyhjentää kankaan, joten se piirretään heti uudelleen (esim. sivupaneelin liukuessa).
    const resized=resize();
    const active=update(now);
    lastFrame=now;
    if(active || resized || now-lastRender>250) {
      // Ensin avaruus ilman sävykuvausta, sitten ohjaamo sen päälle omalla syvyyspuskurillaan.
      renderer.toneMapping=THREE.NoToneMapping; renderer.render(scene,camera);
      renderer.clearDepth();
      renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.render(cabinScene,cabinCamera);
      lastRender=now;
    }
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
